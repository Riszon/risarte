"use server";

import { revalidatePath } from "next/cache";
import {
  getSessionContext,
  hasRoleInClinic,
  type SessionContext,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  resolveAgendaSettings,
  timeToMinutes,
  type AgendaSettingRow,
} from "@/lib/agenda-settings";
import { mapRoom, sortRooms, type Room, type RoomRow } from "@/lib/rooms";
import {
  closureBlocks,
  mapClosure,
  CLOSURE_REASON_LABELS,
  type AgendaClosureRow,
} from "@/lib/closures";
import { toIsoDate } from "@/lib/agenda-view";

/** "minutes since midnight" → "HH:MM". */
function minutesToHHMM(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}

/** Agenda config the scheduling dialog needs to offer only valid slots/rooms. */
export type AgendaFormConfig = {
  openTime: string;
  closeTime: string;
  weekdays: number[];
  rooms: Room[];
  coordinatorRoomId: string | null;
};

/** Loads rooms + working hours + coordinator room for a unit's scheduling form. */
export async function getAgendaFormConfig(
  clinicId: string
): Promise<AgendaFormConfig> {
  const supabase = await createClient();
  const [{ data: settingRows }, { data: roomRows }, { data: coordRow }] =
    await Promise.all([
      supabase
        .from("clinic_agenda_settings")
        .select("clinic_id, open_time, close_time, weekdays, chairs")
        .returns<AgendaSettingRow[]>(),
      supabase
        .from("clinic_rooms")
        .select("id, clinic_id, name, sort_order, is_active")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .returns<RoomRow[]>(),
      supabase
        .from("clinic_agenda_settings")
        .select("coordinator_room_id")
        .eq("clinic_id", clinicId)
        .maybeSingle(),
    ]);
  const cfg = resolveAgendaSettings(settingRows ?? [], clinicId);
  return {
    openTime: cfg.openTime,
    closeTime: cfg.closeTime,
    weekdays: cfg.weekdays,
    rooms: sortRooms((roomRows ?? []).map(mapRoom)),
    coordinatorRoomId:
      (coordRow as { coordinator_room_id: string | null } | null)
        ?.coordinator_room_id ?? null,
  };
}

/**
 * Edit permission: Recepcionista edits any appointment of her unit; an SDR
 * edits only the appointments she created; Admin edits anything.
 */
function canEditAppointment(
  session: SessionContext,
  clinicId: string,
  createdBy: string | null
): boolean {
  if (session.isAdminMaster) return true;
  if (hasRoleInClinic(session, clinicId, ["receptionist"])) return true;
  const isSdr = Object.values(session.rolesByClinic).some((r) =>
    r.includes("sdr")
  );
  return isSdr && createdBy === session.userId;
}
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  type AppointmentStatus,
  type AppointmentType,
  type StaffOption,
} from "@/lib/appointments";
import type { UserRole } from "@/lib/roles";
import type { JourneyPhase, JourneyStatus } from "@/lib/journey";

export type ActionResult = { ok: boolean; error?: string };

type ParsedAppointment = {
  client_id: string;
  type: AppointmentType;
  starts_at: string;
  ends_at: string;
  provider_user_id: string | null;
  notes: string | null;
  room_id: string | null;
  is_online: boolean;
};

function parseAppointmentForm(
  formData: FormData
): { values: ParsedAppointment } | { error: string } {
  const clientId = String(formData.get("client_id") ?? "");
  const type = String(formData.get("type") ?? "") as AppointmentType;
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const durationMinutes = Number(formData.get("duration") ?? 60);
  const providerUserId = String(formData.get("provider_user_id") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  // The commercial consultant's appointment (apresentação comercial) is ONLINE:
  // it has no physical room. Everything else is attended in a room.
  const isOnline = type === "commercial_presentation";
  const roomId = isOnline ? null : String(formData.get("room_id") ?? "") || null;

  if (!clientId) return { error: "Escolha o cliente." };
  if (!APPOINTMENT_TYPES.includes(type)) {
    return { error: "Tipo de compromisso inválido." };
  }
  if (!date || !time) return { error: "Informe data e horário." };
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15) {
    return { error: "Duração mínima de 15 minutos." };
  }
  if (!providerUserId) {
    return { error: "Escolha o profissional responsável." };
  }

  const startsAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "Data ou horário inválido." };
  }
  if (startsAt.getTime() < Date.now()) {
    return { error: "Não é possível agendar em data/horário no passado." };
  }
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  return {
    values: {
      client_id: clientId,
      type,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      provider_user_id: providerUserId,
      notes,
      room_id: roomId,
      is_online: isOnline,
    },
  };
}

/**
 * Per-unit agenda rules (G2): the slot must be within the unit's working hours
 * and on an open weekday; the chosen room must be free at that time (one client
 * per room). ONLINE appointments (apresentação comercial) don't take a room.
 * Urgência/Emergência bypass everything (encaixe). Returns an error or null.
 */
async function checkAgendaRules(
  clinicId: string,
  formData: FormData,
  excludeId?: string
): Promise<string | null> {
  const type = String(formData.get("type") ?? "");
  const isEncaixe = type === "urgency" || type === "emergency";
  const isOnline = type === "commercial_presentation";
  const roomId = isOnline ? "" : String(formData.get("room_id") ?? "");
  const providerId = String(formData.get("provider_user_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const durationMin = Number(formData.get("duration") ?? 60) || 60;
  if (!date || !time) return null;

  const supabase = await createClient();
  const startDate = new Date(`${date}T${time}:00`);
  const startMs = startDate.getTime();
  const endMs = startMs + durationMin * 60000;

  // Agenda closures (G4) block everyone, including encaixe.
  const { data: closureRows } = await supabase
    .from("agenda_closures")
    .select(
      "id, starts_at, ends_at, scope, reason, note, agenda_closure_rooms ( room_id ), agenda_closure_providers ( user_id )"
    )
    .eq("clinic_id", clinicId)
    .lt("starts_at", new Date(endMs).toISOString())
    .gt("ends_at", new Date(startMs).toISOString());
  for (const row of closureRows ?? []) {
    const closure = mapClosure(row as AgendaClosureRow);
    if (
      closureBlocks(closure, {
        startMs,
        endMs,
        roomId: roomId || null,
        providerId: providerId || null,
      })
    ) {
      return `Agenda fechada neste período (${CLOSURE_REASON_LABELS[closure.reason]}). Escolha outro horário/sala.`;
    }
  }

  // Holiday decided as "no attendance" blocks everyone (G5), like a closure.
  const { data: holidayDecision } = await supabase
    .from("clinic_holiday_decisions")
    .select("will_attend")
    .eq("clinic_id", clinicId)
    .eq("holiday_date", date)
    .maybeSingle();
  if (holidayDecision?.will_attend === false) {
    return "Feriado sem atendimento nesta unidade.";
  }

  // Encaixe ignores working hours and room capacity (but not closures/holidays).
  if (isEncaixe) return null;

  const { data: rows } = await supabase
    .from("clinic_agenda_settings")
    .select("clinic_id, open_time, close_time, weekdays, chairs")
    .returns<AgendaSettingRow[]>();
  const cfg = resolveAgendaSettings(rows ?? [], clinicId);

  // A day is open for scheduling if it's a configured weekday, OR a special
  // open day (G5), OR a holiday the manager decided to attend.
  const weekday = new Date(`${date}T00:00:00`).getDay();
  const { data: openDay } = await supabase
    .from("agenda_open_days")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("date", date)
    .maybeSingle();
  const dayOpen =
    cfg.weekdays.includes(weekday) ||
    Boolean(openDay) ||
    holidayDecision?.will_attend === true;
  if (!dayOpen) {
    return "A unidade não atende neste dia. Libere o dia em “Configurar agenda”.";
  }
  const startMin = timeToMinutes(time);
  const endMin = startMin + durationMin;
  if (startMin < timeToMinutes(cfg.openTime) || endMin > timeToMinutes(cfg.closeTime)) {
    return `Fora do horário de funcionamento da unidade (${cfg.openTime} às ${cfg.closeTime}).`;
  }

  // Room occupancy: a room attends one client at a time. ONLINE skips this.
  if (!isOnline && roomId) {
    const startDate = new Date(`${date}T${time}:00`);
    const startISO = startDate.toISOString();
    const endISO = new Date(startDate.getTime() + durationMin * 60000).toISOString();
    const dayStartIso = new Date(`${date}T00:00:00`).toISOString();
    const dayEndIso = new Date(
      new Date(`${date}T00:00:00`).getTime() + 86400000
    ).toISOString();
    const { data: appts } = await supabase
      .from("appointments")
      .select("id, starts_at, ends_at, status, room_id")
      .eq("clinic_id", clinicId)
      .eq("room_id", roomId)
      .gte("starts_at", dayStartIso)
      .lt("starts_at", dayEndIso);
    const overlapping = (appts ?? []).filter(
      (a) =>
        a.id !== excludeId &&
        a.status !== "cancelled" &&
        a.status !== "no_show" &&
        a.starts_at < endISO &&
        a.ends_at > startISO
    );
    if (overlapping.length > 0) {
      const { data: room } = await supabase
        .from("clinic_rooms")
        .select("name")
        .eq("id", roomId)
        .maybeSingle();
      const roomName = room?.name ?? "selecionada";
      return `A sala ${roomName} já está ocupada neste horário. Escolha outra sala/horário (ou use Urgência/Emergência para encaixe).`;
    }
  }
  return null;
}

export async function createAppointment(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  // The SDR (at the matriz) picks the target unit in the form; the
  // receptionist schedules into her active clinic.
  const formClinicId = String(formData.get("clinic_id") ?? "");
  const clinicId = formClinicId || session.activeClinic?.id;
  if (!clinicId) return { ok: false, error: "Nenhuma clínica selecionada." };

  const isSdr = Object.values(session.rolesByClinic).some((r) =>
    r.includes("sdr")
  );
  const canSchedule =
    session.isAdminMaster ||
    hasRoleInClinic(session, clinicId, ["receptionist"]) ||
    isSdr; // RLS confirms the SDR actually has access to this unit
  if (!canSchedule) {
    return {
      ok: false,
      error: "Você não tem permissão para agendar nesta unidade.",
    };
  }

  const parsed = parseAppointmentForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const ruleError = await checkAgendaRules(clinicId, formData);
  if (ruleError) return { ok: false, error: ruleError };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      ...parsed.values,
      clinic_id: clinicId,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.message.includes("CLIENT_TIME_CONFLICT")) {
      return {
        ok: false,
        error: "Este cliente já tem um agendamento neste horário.",
      };
    }
    if (error.message.includes("PROVIDER_TIME_CONFLICT")) {
      return {
        ok: false,
        error:
          "Este profissional já tem um agendamento neste horário. Escolha outro horário (ou use Urgência/Emergência para encaixe).",
      };
    }
    console.error("createAppointment failed:", error.message);
    return { ok: false, error: "Não foi possível criar o agendamento." };
  }

  await logAudit({
    action: "create",
    entityType: "appointment",
    entityId: data.id,
    clinicId,
  });
  revalidatePath("/agenda");
  return { ok: true };
}

/** Reschedule/change an appointment. Every change is recorded (LGPD audit). */
export async function updateAppointment(
  appointmentId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("appointments")
    .select(
      "clinic_id, client_id, type, starts_at, ends_at, provider_user_id, notes, created_by, room_id, is_online"
    )
    .eq("id", appointmentId)
    .single();

  if (!existing) return { ok: false, error: "Agendamento não encontrado." };
  if (!canEditAppointment(session, existing.clinic_id, existing.created_by)) {
    return {
      ok: false,
      error:
        "Você só pode alterar agendamentos da sua unidade (ou, como Encantador(a), os que você mesmo criou).",
    };
  }
  if (new Date(existing.starts_at).getTime() < Date.now()) {
    return {
      ok: false,
      error:
        "Agendamento passado não pode ser editado — apenas o status pode ser ajustado.",
    };
  }

  // Keep the original client; only schedule details change.
  formData.set("client_id", existing.client_id);
  const parsed = parseAppointmentForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const ruleError = await checkAgendaRules(
    existing.clinic_id,
    formData,
    appointmentId
  );
  if (ruleError) return { ok: false, error: ruleError };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of [
    "type",
    "starts_at",
    "ends_at",
    "provider_user_id",
    "notes",
    "room_id",
    "is_online",
  ] as const) {
    if (existing[key] !== parsed.values[key]) {
      changes[key] = { from: existing[key], to: parsed.values[key] };
    }
  }
  if (Object.keys(changes).length === 0) return { ok: true };

  const { error } = await supabase
    .from("appointments")
    .update({
      type: parsed.values.type,
      starts_at: parsed.values.starts_at,
      ends_at: parsed.values.ends_at,
      provider_user_id: parsed.values.provider_user_id,
      notes: parsed.values.notes,
      room_id: parsed.values.room_id,
      is_online: parsed.values.is_online,
      // A successful reschedule passes the closure check, so it's no longer
      // pending a reschedule due to a closure.
      needs_reschedule: false,
    })
    .eq("id", appointmentId);

  if (error) {
    if (error.message.includes("CLIENT_TIME_CONFLICT")) {
      return {
        ok: false,
        error: "Este cliente já tem um agendamento neste horário.",
      };
    }
    if (error.message.includes("PROVIDER_TIME_CONFLICT")) {
      return {
        ok: false,
        error:
          "Este profissional já tem um agendamento neste horário. Escolha outro horário (ou use Urgência/Emergência para encaixe).",
      };
    }
    console.error("updateAppointment failed:", error.message);
    return { ok: false, error: "Não foi possível alterar o agendamento." };
  }

  await logAudit({
    action: "update",
    entityType: "appointment",
    entityId: appointmentId,
    clinicId: existing.clinic_id,
    details: { changes },
  });
  revalidatePath("/agenda");
  return { ok: true };
}

export async function updateAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus
): Promise<ActionResult> {
  if (!APPOINTMENT_STATUSES.includes(status)) {
    return { ok: false, error: "Status inválido." };
  }

  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: appointment } = await supabase
    .from("appointments")
    .select("clinic_id, status, created_by")
    .eq("id", appointmentId)
    .single();

  if (!appointment) return { ok: false, error: "Agendamento não encontrado." };
  if (
    !canEditAppointment(session, appointment.clinic_id, appointment.created_by)
  ) {
    return {
      ok: false,
      error:
        "Você só pode alterar o status de agendamentos da sua unidade (ou, como Encantador(a), os que você mesmo criou).",
    };
  }

  const { error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId);

  if (error) {
    console.error("updateAppointmentStatus failed:", error.message);
    return { ok: false, error: "Não foi possível alterar o status." };
  }

  await logAudit({
    action: "update",
    entityType: "appointment",
    entityId: appointmentId,
    clinicId: appointment.clinic_id,
    details: { changes: { status: { from: appointment.status, to: status } } },
  });
  revalidatePath("/agenda");
  return { ok: true };
}

export type SchedulingClient = {
  id: string;
  full_name: string;
  inactive: boolean;
};

export type UnitSchedulingData = {
  clients: SchedulingClient[];
  staff: StaffOption[];
  config: AgendaFormConfig;
};

/**
 * Clients and professionals available for scheduling at a given unit. Used by
 * the SDR (who works at the matriz) to schedule into the units she covers.
 */
export async function getUnitSchedulingData(
  clinicId: string
): Promise<UnitSchedulingData> {
  await getSessionContext();
  const supabase = await createClient();

  const [{ data: clientRows }, { data: staffRows }, { data: consultants }] =
    await Promise.all([
      // Include inactive clients (marked in the UI); skip only anonymized ones.
      supabase
        .from("clients")
        .select("id, full_name, status")
        .or(`clinic_id.eq.${clinicId},preferred_clinic_id.eq.${clinicId}`)
        .neq("status", "anonymized")
        .order("full_name")
        .limit(300)
        .returns<{ id: string; full_name: string; status: string }[]>(),
      // Definer function: lets the SDR (based at the matriz) read the unit's
      // staff, which the RLS on user_clinic_roles would otherwise hide.
      supabase.rpc("unit_scheduling_staff", { p_clinic_id: clinicId }),
      supabase.rpc("providers_with_access", {
        p_clinic_id: clinicId,
        p_role: "commercial_consultant",
      }),
    ]);

  const staffMap = new Map<string, StaffOption>();
  for (const row of (staffRows ?? []) as {
    user_id: string;
    role: string;
    full_name: string | null;
  }[]) {
    const entry = staffMap.get(row.user_id) ?? {
      userId: row.user_id,
      name: row.full_name ?? "—",
      roles: [],
    };
    entry.roles.push(row.role as UserRole);
    staffMap.set(row.user_id, entry);
  }
  for (const c of (consultants ?? []) as {
    user_id: string;
    full_name: string;
  }[]) {
    const entry = staffMap.get(c.user_id) ?? {
      userId: c.user_id,
      name: c.full_name ?? "—",
      roles: [],
    };
    if (!entry.roles.includes("commercial_consultant")) {
      entry.roles.push("commercial_consultant");
    }
    staffMap.set(c.user_id, entry);
  }

  const config = await getAgendaFormConfig(clinicId);

  return {
    clients: (clientRows ?? []).map((c) => ({
      id: c.id,
      full_name: c.full_name,
      inactive: c.status === "inactive",
    })),
    staff: [...staffMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    config,
  };
}

/** Reception registers the client's arrival (and the phase advances). */
export async function checkInAppointment(
  appointmentId: string
): Promise<ActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_in_appointment", {
    p_appointment_id: appointmentId,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Apenas a Recepção registra a chegada." };
    }
    console.error("check_in_appointment failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a chegada." };
  }
  revalidatePath("/atendimento");
  revalidatePath("/agenda");
  revalidatePath("/jornada");
  return { ok: true };
}

/** Professional calls the client (in_service) or finishes the attendance (done). */
export async function updateAttendance(
  appointmentId: string,
  state: "in_service" | "done"
): Promise<ActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_attendance", {
    p_appointment_id: appointmentId,
    p_state: state,
  });
  if (error) {
    if (error.message.includes("NOT_CALLER")) {
      return {
        ok: false,
        error: "Apenas quem chamou o cliente pode concluir o atendimento.",
      };
    }
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite esta ação." };
    }
    console.error("update_attendance failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar o atendimento." };
  }
  revalidatePath("/atendimento");
  revalidatePath("/agenda");
  return { ok: true };
}

export type SchedulingInfo = {
  phase: JourneyPhase;
  journeyStatus: JourneyStatus | null;
  lastAppointment: {
    type: AppointmentType;
    status: AppointmentStatus;
    starts_at: string;
  } | null;
};

/**
 * Scheduling follows the journey: tells the dialog the client's current
 * phase (drives the appointment type) and whether the last appointment was
 * cancelled / no-show (the client stays in the current phase — reschedule).
 */
export async function getClientSchedulingInfo(
  clientId: string
): Promise<SchedulingInfo | null> {
  await getSessionContext();
  const supabase = await createClient();

  const [{ data: client }, { data: lastAppointments }] = await Promise.all([
    supabase
      .from("clients")
      .select("journey_phase, journey_status")
      .eq("id", clientId)
      .single(),
    supabase
      .from("appointments")
      .select("type, status, starts_at")
      .eq("client_id", clientId)
      .order("starts_at", { ascending: false })
      .limit(1),
  ]);

  if (!client) return null;
  return {
    phase: client.journey_phase as JourneyPhase,
    journeyStatus: (client.journey_status as JourneyStatus | null) ?? null,
    lastAppointment: lastAppointments?.[0] ?? null,
  };
}

export type BusyRange = { starts_at: string; ends_at: string };

/**
 * Busy time ranges on a given day, to suggest free slots in the dialog.
 * - clientBusy: the client cannot be in two places at once (any type).
 * - providerBusy: the professional's normal appointments (Urgência/Emergência
 *   allow encaixe, so they don't block — matching the DB conflict rule).
 */
export async function getDayBusyTimes(params: {
  providerUserId: string | null;
  clientId: string;
  date: string;
  roomId?: string | null;
  excludeId?: string;
}): Promise<{
  providerBusy: BusyRange[];
  clientBusy: BusyRange[];
  roomBusy: BusyRange[];
}> {
  await getSessionContext();
  const supabase = await createClient();

  const start = new Date(`${params.date}T00:00:00`);
  if (Number.isNaN(start.getTime()))
    return { providerBusy: [], clientBusy: [], roomBusy: [] };
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const active = (s: string) => s !== "cancelled" && s !== "no_show";

  const { data: clientRows } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status")
    .eq("client_id", params.clientId)
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString());
  const clientBusy = (clientRows ?? [])
    .filter((a) => a.id !== params.excludeId && active(a.status))
    .map((a) => ({ starts_at: a.starts_at, ends_at: a.ends_at }));

  let providerBusy: BusyRange[] = [];
  if (params.providerUserId) {
    const { data: provRows } = await supabase
      .from("appointments")
      .select("id, starts_at, ends_at, status, type")
      .eq("provider_user_id", params.providerUserId)
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString());
    providerBusy = (provRows ?? [])
      .filter(
        (a) =>
          a.id !== params.excludeId &&
          active(a.status) &&
          a.type !== "urgency" &&
          a.type !== "emergency"
      )
      .map((a) => ({ starts_at: a.starts_at, ends_at: a.ends_at }));
  }

  let roomBusy: BusyRange[] = [];
  if (params.roomId) {
    const { data: roomRows } = await supabase
      .from("appointments")
      .select("id, starts_at, ends_at, status")
      .eq("room_id", params.roomId)
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString());
    roomBusy = (roomRows ?? [])
      .filter((a) => a.id !== params.excludeId && active(a.status))
      .map((a) => ({ starts_at: a.starts_at, ends_at: a.ends_at }));
  }

  return { providerBusy, clientBusy, roomBusy };
}

// ---------------------------------------------------------------------------
// Agenda closures (G4): close the agenda for a period (whole unit / specific
// rooms / specific providers). Create/remove go through SECURITY DEFINER RPCs
// that also flag affected appointments and notify the reception.
// ---------------------------------------------------------------------------
export async function createAgendaClosure(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  const formClinicId = String(formData.get("clinic_id") ?? "");
  const clinicId = formClinicId || session.activeClinic?.id;
  if (!clinicId) return { ok: false, error: "Nenhuma clínica selecionada." };

  const canClose =
    session.isAdminMaster ||
    hasRoleInClinic(session, clinicId, ["receptionist", "unit_manager"]);
  if (!canClose) {
    return { ok: false, error: "Você não tem permissão para fechar a agenda." };
  }

  const startStr = String(formData.get("starts_at") ?? "");
  const endStr = String(formData.get("ends_at") ?? "");
  const reason = String(formData.get("reason") ?? "other");
  const scope = String(formData.get("scope") ?? "unit");
  const note = String(formData.get("note") ?? "").trim() || null;
  const roomIds = formData.getAll("room_ids").map(String).filter(Boolean);
  const providerIds = formData
    .getAll("provider_ids")
    .map(String)
    .filter(Boolean);

  if (!startStr || !endStr) {
    return { ok: false, error: "Informe o início e o fim do fechamento." };
  }
  const startsAt = new Date(startStr);
  const endsAt = new Date(endStr);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { ok: false, error: "Período inválido." };
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: "O fim deve ser depois do início." };
  }
  if (scope === "rooms" && roomIds.length === 0) {
    return { ok: false, error: "Escolha ao menos uma sala." };
  }
  if (scope === "providers" && providerIds.length === 0) {
    return { ok: false, error: "Escolha ao menos um profissional." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_agenda_closure", {
    p_clinic_id: clinicId,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
    p_reason: reason,
    p_scope: scope,
    p_note: note,
    p_room_ids: scope === "rooms" ? roomIds : [],
    p_provider_ids: scope === "providers" ? providerIds : [],
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sem permissão para fechar a agenda." };
    }
    console.error("create_agenda_closure failed:", error.message);
    return { ok: false, error: "Não foi possível fechar a agenda." };
  }

  await logAudit({
    action: "create",
    entityType: "agenda_closure",
    entityId: clinicId,
    clinicId,
  });
  revalidatePath("/agenda");
  return { ok: true };
}

export async function deleteAgendaClosure(
  closureId: string
): Promise<ActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_agenda_closure", {
    p_id: closureId,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sem permissão para remover o fechamento." };
    }
    console.error("delete_agenda_closure failed:", error.message);
    return { ok: false, error: "Não foi possível remover o fechamento." };
  }
  revalidatePath("/agenda");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Special open days + holiday decisions (G5). Only the Gerente de Unidade (or
// Admin) manages these. Go through SECURITY DEFINER RPCs.
// ---------------------------------------------------------------------------
export async function openSpecialDays(
  clinicId: string,
  dates: string[],
  staffIds: string[],
  note: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!hasRoleInClinic(session, clinicId, ["unit_manager"])) {
    return { ok: false, error: "Apenas a Gerente (ou Admin) libera dias." };
  }
  const cleanDates = [...new Set(dates.filter(Boolean))];
  if (cleanDates.length === 0) {
    return { ok: false, error: "Escolha ao menos um dia para liberar." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("open_special_days", {
    p_clinic_id: clinicId,
    p_dates: cleanDates,
    p_staff_ids: staffIds.filter(Boolean),
    p_note: note.trim() || null,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sem permissão para liberar dias." };
    }
    console.error("open_special_days failed:", error.message);
    return { ok: false, error: "Não foi possível liberar o(s) dia(s)." };
  }
  await logAudit({
    action: "create",
    entityType: "agenda_open_day",
    entityId: clinicId,
    clinicId,
  });
  revalidatePath("/agenda");
  revalidatePath("/agenda/configuracao");
  return { ok: true };
}

export async function removeSpecialDay(openDayId: string): Promise<ActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_special_day", {
    p_id: openDayId,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sem permissão para remover o dia." };
    }
    console.error("remove_special_day failed:", error.message);
    return { ok: false, error: "Não foi possível remover o dia avulso." };
  }
  revalidatePath("/agenda");
  revalidatePath("/agenda/configuracao");
  return { ok: true };
}

export async function decideHoliday(
  clinicId: string,
  dateIso: string,
  willAttend: boolean
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!hasRoleInClinic(session, clinicId, ["unit_manager"])) {
    return { ok: false, error: "Apenas a Gerente (ou Admin) confirma feriados." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_holiday", {
    p_clinic_id: clinicId,
    p_date: dateIso,
    p_will_attend: willAttend,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sem permissão para confirmar feriados." };
    }
    console.error("decide_holiday failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a decisão do feriado." };
  }
  revalidatePath("/agenda");
  return { ok: true };
}

/** Fire-and-forget: notify the manager about pending (undecided) holidays. */
export async function notifyPendingHolidays(
  clinicId: string,
  dates: string[],
  names: string[]
): Promise<void> {
  if (dates.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("notify_pending_holidays", {
    p_clinic_id: clinicId,
    p_dates: dates,
    p_names: names,
  });
  if (error) console.error("notify_pending_holidays failed:", error.message);
}

// ---------------------------------------------------------------------------
// Smart scheduling (GR1): next available slots and per-day counts for the
// "Ver agenda" picker.
// ---------------------------------------------------------------------------
export type AvailableSlot = { date: string; time: string };

/**
 * Next available start times for a unit, respecting working days/hours, special
 * open days, holiday-closed days, agenda closures and the busy times of the
 * chosen provider / room / client. Used to suggest slots in the dialog.
 */
export async function getNextAvailableSlots(params: {
  clinicId: string;
  providerUserId: string | null;
  roomId: string | null;
  clientId: string | null;
  isOnline: boolean;
  durationMin: number;
  limit: number;
}): Promise<AvailableSlot[]> {
  await getSessionContext();
  const { clinicId, providerUserId, roomId, clientId, isOnline } = params;
  const durationMin = Math.max(15, params.durationMin || 60);
  const limit = Math.max(1, Math.min(30, params.limit || 3));
  if (!clinicId) return [];

  const DAYS_AHEAD = 45;
  const now = new Date();
  const winStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const winEnd = new Date(winStart);
  winEnd.setDate(winEnd.getDate() + DAYS_AHEAD);
  const startIso = winStart.toISOString();
  const endIso = winEnd.toISOString();

  const supabase = await createClient();
  const [
    { data: settingRows },
    { data: closureRows },
    { data: openDayRows },
    { data: holidayRows },
    { data: apptRows },
  ] = await Promise.all([
    supabase
      .from("clinic_agenda_settings")
      .select("clinic_id, open_time, close_time, weekdays, chairs")
      .returns<AgendaSettingRow[]>(),
    supabase
      .from("agenda_closures")
      .select(
        "id, starts_at, ends_at, scope, reason, note, agenda_closure_rooms ( room_id ), agenda_closure_providers ( user_id )"
      )
      .eq("clinic_id", clinicId)
      .lt("starts_at", endIso)
      .gt("ends_at", startIso),
    supabase
      .from("agenda_open_days")
      .select("date")
      .eq("clinic_id", clinicId)
      .gte("date", toIsoDate(winStart))
      .lt("date", toIsoDate(winEnd)),
    supabase
      .from("clinic_holiday_decisions")
      .select("holiday_date, will_attend")
      .eq("clinic_id", clinicId)
      .gte("holiday_date", toIsoDate(winStart))
      .lt("holiday_date", toIsoDate(winEnd)),
    supabase
      .from("appointments")
      .select("provider_user_id, room_id, client_id, starts_at, ends_at, status, type")
      .eq("clinic_id", clinicId)
      .gte("starts_at", startIso)
      .lt("starts_at", endIso),
  ]);

  const cfg = resolveAgendaSettings(settingRows ?? [], clinicId);
  const closures = (closureRows ?? []).map((r) => mapClosure(r as AgendaClosureRow));
  const openDaySet = new Set((openDayRows ?? []).map((r) => r.date as string));
  const holidayDecision = new Map<string, boolean>();
  for (const r of (holidayRows ?? []) as {
    holiday_date: string;
    will_attend: boolean;
  }[]) {
    holidayDecision.set(r.holiday_date, r.will_attend);
  }
  const active = (s: string) => s !== "cancelled" && s !== "no_show";
  const appts = (apptRows ?? []).filter((a) => active(a.status));

  const openMin = timeToMinutes(cfg.openTime);
  const closeMin = timeToMinutes(cfg.closeTime);
  const nowMs = Date.now();
  const slots: AvailableSlot[] = [];

  for (let d = 0; d < DAYS_AHEAD && slots.length < limit; d++) {
    const day = new Date(winStart);
    day.setDate(day.getDate() + d);
    const dateOnly = toIsoDate(day);
    const hd = holidayDecision.get(dateOnly);
    if (hd === false) continue;
    const dayOpen =
      cfg.weekdays.includes(day.getDay()) || openDaySet.has(dateOnly) || hd === true;
    if (!dayOpen) continue;

    for (let m = openMin; m + durationMin <= closeMin && slots.length < limit; m += 15) {
      const startMs = new Date(`${dateOnly}T${minutesToHHMM(m)}:00`).getTime();
      const endMs = startMs + durationMin * 60_000;
      if (startMs < nowMs) continue;

      const closed = closures.some((c) =>
        closureBlocks(c, {
          startMs,
          endMs,
          roomId: isOnline ? null : roomId,
          providerId: providerUserId,
        })
      );
      if (closed) continue;

      const overlap = (s: string, e: string) =>
        startMs < new Date(e).getTime() && endMs > new Date(s).getTime();
      if (
        providerUserId &&
        appts.some(
          (a) =>
            a.provider_user_id === providerUserId &&
            a.type !== "urgency" &&
            a.type !== "emergency" &&
            overlap(a.starts_at, a.ends_at)
        )
      )
        continue;
      if (
        !isOnline &&
        roomId &&
        appts.some((a) => a.room_id === roomId && overlap(a.starts_at, a.ends_at))
      )
        continue;
      if (
        clientId &&
        appts.some((a) => a.client_id === clientId && overlap(a.starts_at, a.ends_at))
      )
        continue;

      slots.push({ date: dateOnly, time: minutesToHHMM(m) });
    }
  }
  return slots;
}

/** Per-day appointment counts for a month (the "Ver agenda" picker). */
export async function getMonthDayCounts(
  clinicId: string,
  monthRefIso: string
): Promise<Record<string, number>> {
  await getSessionContext();
  const ref = new Date(monthRefIso);
  if (Number.isNaN(ref.getTime())) return {};
  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);

  const supabase = await createClient();
  const { data } = await supabase
    .from("appointments")
    .select("starts_at, status")
    .eq("clinic_id", clinicId)
    .gte("starts_at", monthStart.toISOString())
    .lt("starts_at", monthEnd.toISOString());

  const counts: Record<string, number> = {};
  for (const a of data ?? []) {
    if (a.status === "cancelled" || a.status === "no_show") continue;
    counts[toIsoDate(new Date(a.starts_at))] =
      (counts[toIsoDate(new Date(a.starts_at))] ?? 0) + 1;
  }
  return counts;
}
