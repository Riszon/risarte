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
  effectiveDayHours,
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
import {
  mapPlanItem,
  PLAN_ITEM_LABELS,
  type PlanItemRow,
} from "@/lib/annual-plan";
import { holidayOn } from "@/lib/holidays";

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
  lunchEnabled: boolean;
  lunchStart: string;
  lunchEnd: string;
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
        .select(
          "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end"
        )
        .returns<AgendaSettingRow[]>(),
      supabase
        .from("clinic_rooms")
        .select("id, clinic_id, name, sort_order, is_active")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .is("deleted_at", null)
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
    lunchEnabled: cfg.lunchEnabled,
    lunchStart: cfg.lunchStart,
    lunchEnd: cfg.lunchEnd,
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

export type ActionResult = { ok: boolean; error?: string; warning?: string };

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

// -----------------------------------------------------------------------------
// H4.7 — Atendimento conjunto (2+ profissionais no mesmo atendimento).
// -----------------------------------------------------------------------------

/** Profissionais adicionais desejados (campo participant_ids), sem duplicar o
 * responsável principal nem incluir vazios. */
function parseParticipantIds(
  formData: FormData,
  primaryId: string | null
): string[] {
  const set = new Set(
    String(formData.get("participant_ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (primaryId) set.delete(primaryId);
  return [...set];
}

/** Nº de cadeiras configurado da unidade (cascata rede → unidade). */
async function getClinicChairs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string
): Promise<number> {
  const { data: rows } = await supabase
    .from("clinic_agenda_settings")
    .select(
      "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end"
    )
    .returns<AgendaSettingRow[]>();
  return resolveAgendaSettings(rows ?? [], clinicId).chairs;
}

/** Valida o limite "nº de profissionais no atendimento ≤ nº de cadeiras". O
 * total conta o responsável principal + os adicionais. */
async function chairLimitError(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  participantCount: number
): Promise<string | null> {
  if (participantCount === 0) return null;
  const chairs = await getClinicChairs(supabase, clinicId);
  const total = 1 + participantCount;
  if (total > chairs) {
    return `Atendimento conjunto com ${total} profissionais, mas a unidade tem só ${chairs} cadeira${chairs === 1 ? "" : "s"}. Reduza os profissionais ou ajuste as cadeiras em “Configurar agenda”.`;
  }
  return null;
}

/** Sincroniza os participantes adicionais de um agendamento; devolve os que
 * foram INCLUÍDOS agora (para notificar só esses). */
async function syncAppointmentParticipants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  appointmentId: string,
  clinicId: string,
  createdBy: string,
  desired: string[]
): Promise<string[]> {
  const { data: currentRows } = await supabase
    .from("appointment_participants")
    .select("provider_user_id")
    .eq("appointment_id", appointmentId);
  const current = (currentRows ?? []).map((r) => r.provider_user_id as string);
  const toAdd = desired.filter((id) => !current.includes(id));
  const toRemove = current.filter((id) => !desired.includes(id));
  if (toRemove.length > 0) {
    await supabase
      .from("appointment_participants")
      .delete()
      .eq("appointment_id", appointmentId)
      .in("provider_user_id", toRemove);
  }
  if (toAdd.length > 0) {
    await supabase.from("appointment_participants").insert(
      toAdd.map((pid) => ({
        appointment_id: appointmentId,
        clinic_id: clinicId,
        provider_user_id: pid,
        created_by: createdBy,
      }))
    );
  }
  return toAdd;
}

/** Profissionais adicionais de um agendamento (para o detalhe e a edição). */
export async function getAppointmentParticipants(
  appointmentId: string
): Promise<{ userId: string; name: string }[]> {
  if (!appointmentId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointment_participants")
    .select(
      "provider_user_id, profiles:profiles!appointment_participants_provider_user_id_fkey ( full_name )"
    )
    .eq("appointment_id", appointmentId)
    .returns<
      { provider_user_id: string; profiles: { full_name: string } | null }[]
    >();
  return (data ?? []).map((r) => ({
    userId: r.provider_user_id,
    name: r.profiles?.full_name ?? "—",
  }));
}

/** H4.7 Bloco 2: quais dos profissionais adicionais já estão ocupados no
 * horário escolhido (na mesma unidade), como responsável OU participante de
 * outro atendimento. Aviso suave (não bloqueia). Devolve os userIds ocupados. */
export async function checkParticipantsBusy(params: {
  clinicId: string;
  date: string;
  time: string;
  durationMin: number;
  participantIds: string[];
  excludeId?: string;
}): Promise<string[]> {
  await getSessionContext();
  const { clinicId, date, time, durationMin, participantIds, excludeId } = params;
  if (participantIds.length === 0 || !clinicId || !date || !time) return [];
  const start = new Date(`${date}T${time}:00`);
  if (Number.isNaN(start.getTime())) return [];
  const end = new Date(start.getTime() + durationMin * 60_000);
  const supabase = await createClient();
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const active = (s: string) => s !== "cancelled" && s !== "no_show";
  const overlaps = (s: string, e: string) =>
    new Date(s).getTime() < end.getTime() &&
    new Date(e).getTime() > start.getTime();

  const { data: appts } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status, provider_user_id")
    .eq("clinic_id", clinicId)
    .gte("starts_at", dayStart.toISOString())
    .lt("starts_at", dayEnd.toISOString());
  const dayAppts = (appts ?? []).filter(
    (a) =>
      a.id !== excludeId && active(a.status) && overlaps(a.starts_at, a.ends_at)
  );
  const overlappingIds = dayAppts.map((a) => a.id);

  let partRows: { provider_user_id: string }[] = [];
  if (overlappingIds.length > 0) {
    const { data: parts } = await supabase
      .from("appointment_participants")
      .select("provider_user_id")
      .in("appointment_id", overlappingIds);
    partRows = parts ?? [];
  }

  const busy = new Set<string>();
  for (const pid of participantIds) {
    if (
      dayAppts.some((a) => a.provider_user_id === pid) ||
      partRows.some((p) => p.provider_user_id === pid)
    ) {
      busy.add(pid);
    }
  }
  return [...busy];
}

/**
 * Per-unit agenda rules (G2): the slot must be within the unit's working hours
 * and on an open weekday; the chosen room must be free at that time (one client
 * per room). ONLINE appointments (apresentação comercial) don't take a room.
 * Urgência/Emergência bypass everything (encaixe). Returns `{ block }` when the
 * slot is not allowed, or `{ warn }` (AJ2) when it's allowed but extends past
 * the unit's hours/lunch — the caller keeps the appointment and alerts.
 */
async function checkAgendaRules(
  clinicId: string,
  formData: FormData,
  excludeId?: string
): Promise<{ block?: string; warn?: string }> {
  const type = String(formData.get("type") ?? "");
  const isEncaixe = type === "urgency" || type === "emergency";
  const isOnline = type === "commercial_presentation";
  const roomId = isOnline ? "" : String(formData.get("room_id") ?? "");
  const providerId = String(formData.get("provider_user_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const durationMin = Number(formData.get("duration") ?? 60) || 60;
  if (!date || !time) return {};

  const supabase = await createClient();
  const startDate = new Date(`${date}T${time}:00`);
  const startMs = startDate.getTime();
  const endMs = startMs + durationMin * 60000;
  // AJ2: acumula um alerta quando o atendimento é permitido mas extrapola.
  let warn: string | undefined;

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
      return {
        block: `Agenda fechada neste período (${CLOSURE_REASON_LABELS[closure.reason]}). Escolha outro horário/sala.`,
      };
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
    return { block: "Feriado sem atendimento nesta unidade." };
  }

  // A special open day for this date overrides annual-plan unit blocks (GR6).
  const { data: openDay } = await supabase
    .from("agenda_open_days")
    .select("id, start_time, end_time")
    .eq("clinic_id", clinicId)
    .eq("date", date)
    .maybeSingle();

  // Annual plan items (GR6) block everyone (including encaixe). Unit-wide types
  // are overridden by a special open day; individual vacation blocks only the
  // chosen professionals.
  const { data: planRows } = await supabase
    .from("agenda_plan_items")
    .select(
      "id, type, starts_date, ends_date, title, note, agenda_plan_item_people ( user_id )"
    )
    .eq("clinic_id", clinicId)
    .lte("starts_date", date)
    .gte("ends_date", date);
  for (const r of planRows ?? []) {
    const item = mapPlanItem(r as PlanItemRow);
    if (item.type === "individual_vacation") {
      if (providerId && item.userIds.includes(providerId)) {
        return {
          block:
            "O profissional está de férias neste período (planejamento anual).",
        };
      }
    } else if (!openDay) {
      return {
        block: `Período de ${PLAN_ITEM_LABELS[item.type]} (planejamento anual). Libere um dia avulso em “Configurar agenda” para atender.`,
      };
    }
  }

  // Encaixe ignores working hours and room capacity (but not closures/holidays/
  // annual-plan blocks above).
  if (isEncaixe) return {};

  const { data: rows } = await supabase
    .from("clinic_agenda_settings")
    .select(
      "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end"
    )
    .returns<AgendaSettingRow[]>();
  const cfg = resolveAgendaSettings(rows ?? [], clinicId);

  // A day is open for scheduling if it's a configured weekday, OR a special
  // open day (G5), OR a holiday the manager decided to attend.
  const weekday = new Date(`${date}T00:00:00`).getDay();
  const dayOpen =
    cfg.weekdays.includes(weekday) ||
    Boolean(openDay) ||
    holidayDecision?.will_attend === true;
  if (!dayOpen) {
    return {
      block:
        "A unidade não atende neste dia. Libere o dia em “Configurar agenda”.",
    };
  }
  // AJ7: janela efetiva do dia — dia avulso num dia NORMAL estende o horário
  // (une); num dia fechado usa a janela própria.
  const isNormalDay =
    cfg.weekdays.includes(weekday) || holidayDecision?.will_attend === true;
  const { open: openHHMM, close: closeHHMM } = effectiveDayHours(
    cfg.openTime,
    cfg.closeTime,
    openDay
      ? {
          start: (openDay.start_time as string).slice(0, 5),
          end: (openDay.end_time as string).slice(0, 5),
        }
      : null,
    isNormalDay
  );
  const openM = timeToMinutes(openHHMM);
  const closeM = timeToMinutes(closeHHMM);
  const startMin = timeToMinutes(time);
  const endMin = startMin + durationMin;

  // AJ2: o INÍCIO precisa estar dentro do horário (>= abertura e antes do
  // fechamento). O FIM pode passar do fechamento — permite, mas alerta.
  if (startMin < openM) {
    return {
      block: `O atendimento não pode começar antes da abertura (${openHHMM}).`,
    };
  }
  if (startMin >= closeM) {
    return {
      block: `O atendimento não pode começar após o fechamento (${closeHHMM}).`,
    };
  }
  if (endMin > closeM) {
    warn = `Este atendimento termina após o horário de fechamento (${closeHHMM}).`;
  }

  // Lunch break (GR4/AJ2): o início não pode cair DENTRO do almoço; mas pode
  // começar antes e avançar sobre o almoço — permite com alerta. ONLINE/
  // apresentação não usa sala física, então ignora o almoço.
  if (cfg.lunchEnabled && !isOnline) {
    const lunchStart = timeToMinutes(cfg.lunchStart);
    const lunchEnd = timeToMinutes(cfg.lunchEnd);
    if (startMin >= lunchStart && startMin < lunchEnd) {
      return {
        block: `O atendimento não pode começar no horário de almoço (${cfg.lunchStart} às ${cfg.lunchEnd}). Use Urgência/Emergência para encaixe.`,
      };
    }
    if (startMin < lunchStart && endMin > lunchStart) {
      const lunchWarn = `Este atendimento avança sobre o horário de almoço (${cfg.lunchStart} às ${cfg.lunchEnd}).`;
      warn = warn ? `${warn} ${lunchWarn}` : lunchWarn;
    }
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
      return {
        block: `A sala ${roomName} já está ocupada neste horário. Escolha outra sala/horário (ou use Urgência/Emergência para encaixe).`,
      };
    }
  }
  return { warn };
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

  const rule = await checkAgendaRules(clinicId, formData);
  if (rule.block) return { ok: false, error: rule.block };

  const supabase = await createClient();

  // H4.7: atendimento conjunto — valida o limite pelo nº de cadeiras.
  const participantIds = parseParticipantIds(
    formData,
    parsed.values.provider_user_id
  );
  const chairErr = await chairLimitError(
    supabase,
    clinicId,
    participantIds.length
  );
  if (chairErr) return { ok: false, error: chairErr };

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

  // E4b/E5: vincula o agendamento às sessões planejadas (uma ou várias — quando
  // o dentista executa mais de um procedimento no mesmo horário) e marca-as
  // como agendadas. O primeiro id fica em appointments.treatment_session_id
  // (referência principal); o vínculo completo vai em treatment_sessions.
  const sessionIds = String(formData.get("treatment_session_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const legacyId = String(formData.get("treatment_session_id") ?? "").trim();
  if (sessionIds.length === 0 && legacyId) sessionIds.push(legacyId);
  if (sessionIds.length > 0) {
    await supabase
      .from("appointments")
      .update({ treatment_session_id: sessionIds[0] })
      .eq("id", data.id);
    await supabase
      .from("treatment_sessions")
      .update({ status: "scheduled", appointment_id: data.id })
      .in("id", sessionIds);
  }

  // H4.7: registra os profissionais adicionais e avisa cada um (aviso forte).
  if (participantIds.length > 0) {
    const added = await syncAppointmentParticipants(
      supabase,
      data.id,
      clinicId,
      session.userId,
      participantIds
    );
    if (added.length > 0) {
      const { error: partErr } = await supabase.rpc(
        "notify_appointment_participants",
        { p_appointment_id: data.id, p_provider_ids: added }
      );
      if (partErr) {
        console.error("notify_appointment_participants:", partErr.message);
      }
    }
  }

  // AJ2: atendimento que extrapola o horário — avisa o profissional (RPC
  // security-definer; sem função aplicada, não quebra o agendamento).
  if (rule.warn) {
    const { error: notifyErr } = await supabase.rpc("notify_appointment_overrun", {
      p_appointment_id: data.id,
    });
    if (notifyErr) console.error("notify_appointment_overrun:", notifyErr.message);
  }

  // AJ11: apresentação comercial agendada — avisa o Consultor/Assistente para
  // acompanhar o plano a tempo (inclui os da Franqueadora com escopo na unidade).
  if (String(formData.get("type") ?? "") === "commercial_presentation") {
    const { error: presErr } = await supabase.rpc("notify_commercial_presentation", {
      p_appointment_id: data.id,
    });
    if (presErr) console.error("notify_commercial_presentation:", presErr.message);
  }

  // H4.6 E2: se o dentista ficou com atendimento em mais de uma unidade neste
  // dia, avisa-o (aviso forte, não bloqueia). Fire-and-forget.
  const { error: crossErr } = await supabase.rpc("notify_provider_cross_unit", {
    p_appointment_id: data.id,
  });
  if (crossErr) console.error("notify_provider_cross_unit:", crossErr.message);

  await logAudit({
    action: "create",
    entityType: "appointment",
    entityId: data.id,
    clinicId,
  });
  revalidatePath("/agenda");
  return { ok: true, warning: rule.warn };
}

/** H4.6 E2: na hora de agendar, checa se o dentista já tem atendimento em OUTRA
 * unidade no mesmo dia (aviso à Recepção) + se o dia é dia dele nesta unidade. */
export async function checkProviderCrossUnit(input: {
  providerUserId: string;
  clinicId: string;
  date: string;
}): Promise<{
  otherUnits: { clinic: string; time: string }[];
  scheduleKnown: boolean;
  isPriorityDay: boolean;
}> {
  const empty = { otherUnits: [], scheduleKnown: false, isPriorityDay: false };
  await getSessionContext();
  if (
    !input.providerUserId ||
    !input.clinicId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
  ) {
    return empty;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("provider_cross_unit_check", {
    p_provider: input.providerUserId,
    p_clinic: input.clinicId,
    p_date: input.date,
  });
  if (error) {
    console.error("provider_cross_unit_check:", error.message);
    return empty;
  }
  const r = (data ?? {}) as {
    otherUnits?: { clinic: string; time: string }[];
    scheduleKnown?: boolean;
    isPriorityDay?: boolean;
  };
  return {
    otherUnits: r.otherUnits ?? [],
    scheduleKnown: Boolean(r.scheduleKnown),
    isPriorityDay: Boolean(r.isPriorityDay),
  };
}

/** H4.6 E4: no fim de semana, gera o aviso da próxima semana para o dentista
 * (a RPC só age no sáb/dom e deduplica por semana). Fire-and-forget. */
export async function notifyWeeklyForecast(): Promise<void> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("notify_weekly_forecast");
  if (error) console.error("notify_weekly_forecast:", error.message);
}

export type PendingSession = {
  id: string;
  label: string;
  minutes: number | null;
  procedureId: string | null;
};

/** Sessões planejadas ainda não agendadas de um cliente (E4b — sugestão na agenda). */
export async function getClientPendingSessions(
  clientId: string
): Promise<PendingSession[]> {
  if (!clientId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("treatment_sessions")
    .select(
      "id, procedure_id, procedure_name, session_index, session_total, name, planned_minutes"
    )
    .eq("client_id", clientId)
    .eq("status", "pending")
    .order("created_at")
    .returns<
      {
        id: string;
        procedure_id: string | null;
        procedure_name: string;
        session_index: number;
        session_total: number;
        name: string | null;
        planned_minutes: number | null;
      }[]
    >();
  return (data ?? []).map((r) => ({
    id: r.id,
    label: `${r.procedure_name} — ${r.name ?? `Sessão ${r.session_index} de ${r.session_total}`}`,
    minutes: r.planned_minutes,
    procedureId: r.procedure_id,
  }));
}

/** Sessões do tratamento de um agendamento (H1.5): as já vinculadas a ele +
 * as pendentes do mesmo cliente (para marcar/desmarcar ao editar). */
export async function getAppointmentSessionOptions(appointmentId: string): Promise<{
  linked: PendingSession[];
  pending: PendingSession[];
}> {
  if (!appointmentId) return { linked: [], pending: [] };
  const supabase = await createClient();
  const { data: appt } = await supabase
    .from("appointments")
    .select("client_id")
    .eq("id", appointmentId)
    .maybeSingle();
  if (!appt?.client_id) return { linked: [], pending: [] };

  const { data } = await supabase
    .from("treatment_sessions")
    .select(
      "id, procedure_id, procedure_name, session_index, session_total, name, planned_minutes, status, appointment_id"
    )
    .eq("client_id", appt.client_id)
    .neq("status", "done")
    .order("created_at")
    .returns<
      {
        id: string;
        procedure_id: string | null;
        procedure_name: string;
        session_index: number;
        session_total: number;
        name: string | null;
        planned_minutes: number | null;
        status: string;
        appointment_id: string | null;
      }[]
    >();
  const toOption = (r: NonNullable<typeof data>[number]): PendingSession => ({
    id: r.id,
    label: `${r.procedure_name} — ${r.name ?? `Sessão ${r.session_index} de ${r.session_total}`}`,
    minutes: r.planned_minutes,
    procedureId: r.procedure_id,
  });
  const rows = data ?? [];
  return {
    linked: rows.filter((r) => r.appointment_id === appointmentId).map(toOption),
    pending: rows.filter((r) => r.status === "pending").map(toOption),
  };
}

export type DaySchedule = {
  /** Dia avulso liberado (G5): janela própria de atendimento. */
  openDay: { start: string; end: string } | null;
  /** Decisão de feriado da unidade: true=atende, false=não atende, null=sem decisão. */
  holidayAttend: boolean | null;
};

/** Situação especial de um dia (H1.6): dia avulso + decisão de feriado, para o
 * seletor de horário do formulário refletir as mesmas regras do servidor. */
export async function getDaySchedule(
  clinicId: string,
  date: string
): Promise<DaySchedule> {
  if (!clinicId || !date) return { openDay: null, holidayAttend: null };
  const supabase = await createClient();
  const [{ data: openDay }, { data: holiday }] = await Promise.all([
    supabase
      .from("agenda_open_days")
      .select("start_time, end_time")
      .eq("clinic_id", clinicId)
      .eq("date", date)
      .maybeSingle(),
    supabase
      .from("clinic_holiday_decisions")
      .select("will_attend")
      .eq("clinic_id", clinicId)
      .eq("holiday_date", date)
      .maybeSingle(),
  ]);
  return {
    openDay: openDay
      ? {
          start: (openDay.start_time as string).slice(0, 5),
          end: (openDay.end_time as string).slice(0, 5),
        }
      : null,
    holidayAttend:
      holiday == null ? null : Boolean(holiday.will_attend),
  };
}

/** Média REAL de minutos por sessão de um dentista, por procedimento (E5 —
 * sugestão ao escolher procedimento + dentista na agenda). */
export async function getProviderProcedureStats(
  providerUserId: string,
  procedureIds: string[]
): Promise<Record<string, { avgMinutes: number; sample: number }>> {
  const ids = procedureIds.filter(Boolean);
  if (!providerUserId || ids.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase.rpc("provider_procedure_minutes", {
    p_provider_id: providerUserId,
    p_procedure_ids: ids,
  });
  const out: Record<string, { avgMinutes: number; sample: number }> = {};
  for (const r of (data ?? []) as {
    procedure_id: string;
    avg_minutes: number;
    sample: number;
  }[]) {
    out[r.procedure_id] = {
      avgMinutes: Math.round(Number(r.avg_minutes)),
      sample: Number(r.sample),
    };
  }
  return out;
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

  const rule = await checkAgendaRules(
    existing.clinic_id,
    formData,
    appointmentId
  );
  if (rule.block) return { ok: false, error: rule.block };

  const changes: Record<string, { from: unknown; to: unknown }> = {};

  // H4.7: participantes adicionais — só sincroniza quando o campo veio (o
  // formulário já carregou a lista). Valida o limite pelo nº de cadeiras e
  // registra a mudança para não cair no early-return "sem alterações".
  const rawParticipants = formData.get("participant_ids");
  let participantSync: string[] | null = null;
  if (rawParticipants !== null) {
    const desired = parseParticipantIds(
      formData,
      parsed.values.provider_user_id
    );
    const chairErr = await chairLimitError(
      supabase,
      existing.clinic_id,
      desired.length
    );
    if (chairErr) return { ok: false, error: chairErr };
    const { data: currentPartRows } = await supabase
      .from("appointment_participants")
      .select("provider_user_id")
      .eq("appointment_id", appointmentId);
    const currentParts = (currentPartRows ?? []).map(
      (r) => r.provider_user_id as string
    );
    const changed =
      desired.length !== currentParts.length ||
      desired.some((id) => !currentParts.includes(id));
    if (changed) {
      participantSync = desired;
      changes["participants"] = { from: currentParts, to: desired };
    }
  }

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

  // H1.5: sincroniza as sessões do tratamento vinculadas. O campo só vem
  // quando o formulário carregou as sessões (drag para remarcar não mexe).
  const rawSessionIds = formData.get("treatment_session_ids");
  let sessionSync: { desired: string[]; link: string[]; unlink: string[] } | null =
    null;
  if (rawSessionIds !== null) {
    const desired = String(rawSessionIds)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { data: currentRows } = await supabase
      .from("treatment_sessions")
      .select("id")
      .eq("appointment_id", appointmentId)
      .neq("status", "done");
    const currentIds = (currentRows ?? []).map((r) => r.id);
    const link = desired.filter((id) => !currentIds.includes(id));
    const unlink = currentIds.filter((id) => !desired.includes(id));
    if (link.length > 0 || unlink.length > 0) {
      sessionSync = { desired, link, unlink };
      changes["treatment_sessions"] = { from: currentIds, to: desired };
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

  // H1.5: aplica o vínculo das sessões (desmarcada volta a "a agendar").
  if (sessionSync) {
    if (sessionSync.unlink.length > 0) {
      await supabase
        .from("treatment_sessions")
        .update({ status: "pending", appointment_id: null })
        .in("id", sessionSync.unlink);
    }
    if (sessionSync.link.length > 0) {
      await supabase
        .from("treatment_sessions")
        .update({ status: "scheduled", appointment_id: appointmentId })
        .in("id", sessionSync.link);
    }
    await supabase
      .from("appointments")
      .update({ treatment_session_id: sessionSync.desired[0] ?? null })
      .eq("id", appointmentId);
  }

  // H4.7: sincroniza os profissionais adicionais e avisa os recém-incluídos.
  if (participantSync !== null) {
    const added = await syncAppointmentParticipants(
      supabase,
      appointmentId,
      existing.clinic_id,
      session.userId,
      participantSync
    );
    if (added.length > 0) {
      const { error: partErr } = await supabase.rpc(
        "notify_appointment_participants",
        { p_appointment_id: appointmentId, p_provider_ids: added }
      );
      if (partErr) {
        console.error("notify_appointment_participants:", partErr.message);
      }
    }
  }

  // AJ2: se a alteração deixou o atendimento fora do horário, avisa o profissional.
  if (rule.warn) {
    const { error: notifyErr } = await supabase.rpc("notify_appointment_overrun", {
      p_appointment_id: appointmentId,
    });
    if (notifyErr) console.error("notify_appointment_overrun:", notifyErr.message);
  }

  await logAudit({
    action: "update",
    entityType: "appointment",
    entityId: appointmentId,
    clinicId: existing.clinic_id,
    details: { changes },
  });
  revalidatePath("/agenda");
  return { ok: true, warning: rule.warn };
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

  // H2.11: cancelamento/falta devolve as sessões do tratamento vinculadas para
  // "a agendar" (senão ficariam presas a um agendamento cancelado).
  if (status === "cancelled" || status === "no_show") {
    await supabase
      .from("treatment_sessions")
      .update({ status: "pending", appointment_id: null })
      .eq("appointment_id", appointmentId)
      .neq("status", "done");
    await supabase
      .from("appointments")
      .update({ treatment_session_id: null })
      .eq("id", appointmentId);
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

/** Professional calls the client (in_service), finishes the attendance (done)
 * or records that the client gave up waiting (gave_up — H3.4). */
export async function updateAttendance(
  appointmentId: string,
  state: "in_service" | "done" | "gave_up"
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
    if (error.message.includes("NOT_PROVIDER")) {
      return {
        ok: false,
        error:
          "Apenas o profissional do agendamento pode chamar este cliente.",
      };
    }
    if (error.message.includes("CLIENT_BUSY")) {
      return {
        ok: false,
        error:
          "Este cliente já está em atendimento com outro profissional. Conclua o atendimento atual antes de chamar.",
      };
    }
    if (error.message.includes("PROVIDER_BUSY")) {
      return {
        ok: false,
        error:
          "Este profissional já está em atendimento não concluído. Conclua o atendimento atual antes de chamar outro cliente.",
      };
    }
    if (error.message.includes("ROOM_BUSY")) {
      return {
        ok: false,
        error:
          "A sala/cadeira já está ocupada por um atendimento não concluído. Conclua-o antes de chamar outro cliente para esta sala.",
      };
    }
    if (error.message.includes("NOT_WAITING")) {
      return {
        ok: false,
        error:
          "Só é possível registrar desistência de quem está na sala de espera.",
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

/** H4.6 A1: o Dentista conclui o atendimento confirmando QUAIS sessões foram
 * feitas. As confirmadas são liquidadas (tempo real rateado só entre elas); as
 * não feitas voltam para "a agendar" (com motivo opcional) e a Recepção é
 * avisada. Só o Dentista (ou Admin) pode confirmar a baixa. */
export async function concludeAttendancePartial(
  appointmentId: string,
  doneSessionIds: string[],
  reasons: Record<string, string>
): Promise<ActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("conclude_attendance_partial", {
    p_appointment_id: appointmentId,
    p_done_ids: doneSessionIds,
    p_reasons: reasons,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Apenas o dentista que atendeu pode dar baixa nas sessões.",
      };
    }
    console.error("conclude_attendance_partial failed:", error.message);
    return { ok: false, error: "Não foi possível concluir o atendimento." };
  }
  revalidatePath("/atendimento");
  revalidatePath("/agenda");
  revalidatePath("/jornada");
  return { ok: true };
}

/** H3.6: troca o profissional de um atendimento de última hora (check-in/espera).
 * Recepção ou Gerente da unidade (ou Admin). Notifica os envolvidos. */
export async function swapAppointmentProvider(
  appointmentId: string,
  newProviderId: string,
  reason: string
): Promise<ActionResult> {
  await getSessionContext();
  if (!newProviderId) return { ok: false, error: "Escolha o novo profissional." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("swap_appointment_provider", {
    p_appointment_id: appointmentId,
    p_new_provider: newProviderId,
    p_reason: reason.trim() || null,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Apenas a Recepção ou a Gerente pode trocar o profissional.",
      };
    }
    if (error.message.includes("SAME_PROVIDER")) {
      return { ok: false, error: "Escolha um profissional diferente do atual." };
    }
    if (error.message.includes("NOT_SWAPPABLE")) {
      return {
        ok: false,
        error:
          "Só é possível trocar o profissional antes de concluir o atendimento.",
      };
    }
    if (error.message.includes("PROVIDER_TIME_CONFLICT")) {
      return {
        ok: false,
        error:
          "O profissional escolhido já tem outro atendimento neste horário.",
      };
    }
    console.error("swap_appointment_provider failed:", error.message);
    return { ok: false, error: "Não foi possível trocar o profissional." };
  }
  await logAudit({
    action: "update",
    entityType: "appointment",
    entityId: appointmentId,
    details: { changes: { provider_swap: true } },
  });
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
  if (endsAt.getTime() <= Date.now()) {
    return {
      ok: false,
      error: "Só é possível fechar a agenda em um período futuro.",
    };
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

export async function updateAgendaClosure(
  closureId: string,
  formData: FormData
): Promise<ActionResult> {
  await getSessionContext();

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
  if (endsAt.getTime() <= Date.now()) {
    return {
      ok: false,
      error: "Só é possível fechar a agenda em um período futuro.",
    };
  }
  if (scope === "rooms" && roomIds.length === 0) {
    return { ok: false, error: "Escolha ao menos uma sala." };
  }
  if (scope === "providers" && providerIds.length === 0) {
    return { ok: false, error: "Escolha ao menos um profissional." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_agenda_closure", {
    p_id: closureId,
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
      return { ok: false, error: "Sem permissão para editar o fechamento." };
    }
    if (error.message.includes("PERIOD_IN_PAST")) {
      return { ok: false, error: "Não é possível mover o fechamento para o passado." };
    }
    console.error("update_agenda_closure failed:", error.message);
    return { ok: false, error: "Não foi possível editar o fechamento." };
  }
  await logAudit({
    action: "update",
    entityType: "agenda_closure",
    entityId: closureId,
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
  startTime: string,
  endTime: string,
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
  if (!/^\d{2}:\d{2}$/.test(startTime)) {
    return { ok: false, error: "Informe o horário de início." };
  }

  const supabase = await createClient();
  const { data: settingRows } = await supabase
    .from("clinic_agenda_settings")
    .select("clinic_id, open_time, close_time, weekdays, chairs")
    .returns<AgendaSettingRow[]>();
  const cfg = resolveAgendaSettings(settingRows ?? [], clinicId);
  const normalOpen = timeToMinutes(cfg.openTime);
  const normalClose = timeToMinutes(cfg.closeTime);
  const startMin = timeToMinutes(startTime);

  // AJ7: fim opcional — sem fim, entende-se "até a abertura normal" (liberar
  // ANTES do expediente); nesse caso o início precisa ser antes da abertura.
  let end = endTime;
  if (!/^\d{2}:\d{2}$/.test(endTime)) {
    if (startMin >= normalOpen) {
      return {
        ok: false,
        error: `Sem horário de fim, o início precisa ser antes da abertura normal (${cfg.openTime}).`,
      };
    }
    end = cfg.openTime;
  }
  const endMin = timeToMinutes(end);
  if (endMin <= startMin) {
    return { ok: false, error: "O fim do atendimento deve ser depois do início." };
  }

  // AJ7: num dia NORMAL de atendimento, o período tem de EXTENDER além do
  // horário normal (começar antes ou terminar depois). Não adianta "liberar" o
  // que já é atendido normalmente.
  const noopDate = cleanDates.find((d) => {
    const wd = new Date(`${d}T00:00:00`).getDay();
    return cfg.weekdays.includes(wd) && startMin >= normalOpen && endMin <= normalClose;
  });
  if (noopDate) {
    const dd = new Date(`${noopDate}T00:00:00`).toLocaleDateString("pt-BR");
    return {
      ok: false,
      error: `Em ${dd} esse horário já é atendido normalmente. Para estender, comece antes de ${cfg.openTime} ou termine depois de ${cfg.closeTime}.`,
    };
  }

  const { error } = await supabase.rpc("open_special_days", {
    p_clinic_id: clinicId,
    p_dates: cleanDates,
    p_start_time: startTime,
    p_end_time: end,
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

export async function updateSpecialDay(
  openDayId: string,
  date: string,
  startTime: string,
  endTime: string,
  staffIds: string[],
  note: string
): Promise<ActionResult> {
  await getSessionContext();
  if (!date) return { ok: false, error: "Informe a data." };
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    return { ok: false, error: "O fim do atendimento deve ser depois do início." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_special_day", {
    p_id: openDayId,
    p_date: date,
    p_start_time: startTime,
    p_end_time: endTime,
    p_staff_ids: staffIds.filter(Boolean),
    p_note: note.trim() || null,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sem permissão para editar o dia." };
    }
    if (error.message.includes("PAST_DAY")) {
      return { ok: false, error: "Dias avulsos passados não podem ser editados." };
    }
    console.error("update_special_day failed:", error.message);
    return { ok: false, error: "Não foi possível editar o dia avulso." };
  }
  revalidatePath("/agenda");
  revalidatePath("/agenda/configuracao");
  return { ok: true };
}

/** Saves the unit's lunch break (Gerente/Admin). */
export async function saveLunchBreak(
  clinicId: string,
  input: { enabled: boolean; start: string; end: string }
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!hasRoleInClinic(session, clinicId, ["unit_manager"])) {
    return { ok: false, error: "Apenas a Gerente (ou Admin) configura o almoço." };
  }
  if (input.enabled && timeToMinutes(input.end) <= timeToMinutes(input.start)) {
    return { ok: false, error: "O fim do almoço deve ser depois do início." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("clinic_agenda_settings").upsert(
    {
      clinic_id: clinicId,
      lunch_enabled: input.enabled,
      lunch_start: input.start,
      lunch_end: input.end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );
  if (error) {
    console.error("saveLunchBreak failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o horário de almoço." };
  }
  await logAudit({
    action: "update",
    entityType: "agenda_settings",
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
    if (error.message.includes("PAST_DAY")) {
      return { ok: false, error: "Dias avulsos passados viram histórico (não removem)." };
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
      .select(
        "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end"
      )
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
      .select("date, start_time, end_time")
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
  const openDayHours = new Map<string, { open: number; close: number }>();
  for (const r of (openDayRows ?? []) as {
    date: string;
    start_time: string;
    end_time: string;
  }[]) {
    openDayHours.set(r.date, {
      open: timeToMinutes(r.start_time.slice(0, 5)),
      close: timeToMinutes(r.end_time.slice(0, 5)),
    });
  }
  const holidayDecision = new Map<string, boolean>();
  for (const r of (holidayRows ?? []) as {
    holiday_date: string;
    will_attend: boolean;
  }[]) {
    holidayDecision.set(r.holiday_date, r.will_attend);
  }
  const active = (s: string) => s !== "cancelled" && s !== "no_show";
  const appts = (apptRows ?? []).filter((a) => active(a.status));

  const lunchStart = cfg.lunchEnabled ? timeToMinutes(cfg.lunchStart) : -1;
  const lunchEnd = cfg.lunchEnabled ? timeToMinutes(cfg.lunchEnd) : -1;
  const nowMs = Date.now();
  const slots: AvailableSlot[] = [];

  for (let d = 0; d < DAYS_AHEAD && slots.length < limit; d++) {
    const day = new Date(winStart);
    day.setDate(day.getDate() + d);
    const dateOnly = toIsoDate(day);
    const hd = holidayDecision.get(dateOnly);
    if (hd === false) continue;
    const isWeekdayOpen = cfg.weekdays.includes(day.getDay());
    const special = openDayHours.get(dateOnly);
    const dayOpen = isWeekdayOpen || Boolean(special) || hd === true;
    if (!dayOpen) continue;
    // AJ7: dia avulso num dia NORMAL estende (une); em dia fechado usa a própria.
    const normalOpenMin = timeToMinutes(cfg.openTime);
    const normalCloseMin = timeToMinutes(cfg.closeTime);
    const isNormalDay = isWeekdayOpen || hd === true;
    const openMin = special
      ? isNormalDay
        ? Math.min(normalOpenMin, special.open)
        : special.open
      : normalOpenMin;
    const closeMin = special
      ? isNormalDay
        ? Math.max(normalCloseMin, special.close)
        : special.close
      : normalCloseMin;

    for (let m = openMin; m + durationMin <= closeMin && slots.length < limit; m += 15) {
      // Skip the lunch break (not online).
      if (
        cfg.lunchEnabled &&
        !isOnline &&
        m < lunchEnd &&
        m + durationMin > lunchStart
      ) {
        continue;
      }
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

// H3.2: situação de cada dia no pop-up "Ver agenda".
export type PeekDay = {
  /** Agendamentos ativos no dia (a unidade toda). */
  count: number;
  /** Horários livres p/ o contexto do formulário; null = dia sem atendimento. */
  free: number | null;
  /** Estado do dia (dirige a cor/rótulo da célula). */
  state:
    | "normal"
    | "closed"
    | "holiday_closed"
    | "holiday_pending"
    | "holiday_open"
    | "open_day"
    | "plan_block";
  /** Rótulo curto (nome do feriado, motivo do bloqueio, janela do dia avulso). */
  note: string | null;
};

/**
 * H3.2 — "Ver agenda" rica: por dia do mês, devolve nº de agendamentos, nº de
 * horários LIVRES para o contexto escolhido (profissional/sala/duração) e a
 * situação do dia (fechado, feriado, dia avulso, bloqueio do planejamento
 * anual), usando as MESMAS regras do servidor de agendamento.
 */
export async function getMonthAgendaPeek(params: {
  clinicId: string;
  monthRefIso: string;
  providerUserId: string | null;
  roomId: string | null;
  isOnline: boolean;
  durationMin: number;
}): Promise<Record<string, PeekDay>> {
  await getSessionContext();
  const { clinicId, providerUserId, roomId, isOnline } = params;
  const durationMin = Math.max(15, params.durationMin || 60);
  const ref = new Date(params.monthRefIso);
  if (!clinicId || Number.isNaN(ref.getTime())) return {};
  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  const startIso = monthStart.toISOString();
  const endIso = monthEnd.toISOString();

  const supabase = await createClient();
  const [
    { data: settingRows },
    { data: apptRows },
    { data: closureRows },
    { data: openDayRows },
    { data: holidayRows },
    { data: planRows },
  ] = await Promise.all([
    supabase
      .from("clinic_agenda_settings")
      .select(
        "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end"
      )
      .returns<AgendaSettingRow[]>(),
    supabase
      .from("appointments")
      .select("provider_user_id, room_id, starts_at, ends_at, status, type")
      .eq("clinic_id", clinicId)
      .gte("starts_at", startIso)
      .lt("starts_at", endIso),
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
      .select("date, start_time, end_time")
      .eq("clinic_id", clinicId)
      .gte("date", toIsoDate(monthStart))
      .lt("date", toIsoDate(monthEnd)),
    supabase
      .from("clinic_holiday_decisions")
      .select("holiday_date, will_attend")
      .eq("clinic_id", clinicId)
      .gte("holiday_date", toIsoDate(monthStart))
      .lt("holiday_date", toIsoDate(monthEnd)),
    supabase
      .from("agenda_plan_items")
      .select(
        "id, type, starts_date, ends_date, title, note, agenda_plan_item_people ( user_id )"
      )
      .eq("clinic_id", clinicId)
      .lte("starts_date", toIsoDate(monthEnd))
      .gte("ends_date", toIsoDate(monthStart)),
  ]);

  const cfg = resolveAgendaSettings(settingRows ?? [], clinicId);
  const closures = (closureRows ?? []).map((r) =>
    mapClosure(r as AgendaClosureRow)
  );
  const openDayHours = new Map<
    string,
    { open: number; close: number; label: string }
  >();
  for (const r of (openDayRows ?? []) as {
    date: string;
    start_time: string;
    end_time: string;
  }[]) {
    const start = r.start_time.slice(0, 5);
    const end = r.end_time.slice(0, 5);
    openDayHours.set(r.date, {
      open: timeToMinutes(start),
      close: timeToMinutes(end),
      label: `Dia avulso ${start}–${end}`,
    });
  }
  const holidayDecision = new Map<string, boolean>();
  for (const r of (holidayRows ?? []) as {
    holiday_date: string;
    will_attend: boolean;
  }[]) {
    holidayDecision.set(r.holiday_date, r.will_attend);
  }
  const planItems = (planRows ?? []).map((r) => mapPlanItem(r as PlanItemRow));
  const activeAppt = (s: string) => s !== "cancelled" && s !== "no_show";
  const appts = (apptRows ?? []).filter((a) => activeAppt(a.status));

  const lunchStart = cfg.lunchEnabled ? timeToMinutes(cfg.lunchStart) : -1;
  const lunchEnd = cfg.lunchEnabled ? timeToMinutes(cfg.lunchEnd) : -1;
  const nowMs = Date.now();
  const daysInMonth = new Date(
    ref.getFullYear(),
    ref.getMonth() + 1,
    0
  ).getDate();

  const out: Record<string, PeekDay> = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(ref.getFullYear(), ref.getMonth(), d);
    const dateOnly = toIsoDate(day);
    const count = appts.filter(
      (a) => toIsoDate(new Date(a.starts_at)) === dateOnly
    ).length;

    const holiday = holidayOn(dateOnly);
    const hd = holidayDecision.get(dateOnly);
    const special = openDayHours.get(dateOnly);
    const isWeekdayOpen = cfg.weekdays.includes(day.getDay());
    const dayPlanItems = planItems.filter(
      (i) => i.startsDate <= dateOnly && i.endsDate >= dateOnly
    );
    const unitBlock = dayPlanItems.find((i) => i.type !== "individual_vacation");
    const providerVacation = Boolean(
      providerUserId &&
        dayPlanItems.some(
          (i) =>
            i.type === "individual_vacation" &&
            i.userIds.includes(providerUserId)
        )
    );

    // Estado do dia — mesma precedência do checkAgendaRules.
    let state: PeekDay["state"] = "normal";
    let note: string | null = null;
    if (hd === false) {
      state = "holiday_closed";
      note = holiday?.name ?? "Feriado sem atendimento";
    } else if (unitBlock && !special) {
      state = "plan_block";
      note = unitBlock.title || PLAN_ITEM_LABELS[unitBlock.type];
    } else if (special) {
      state = "open_day";
      note = special.label;
    } else if (!isWeekdayOpen && hd !== true) {
      state = "closed";
      note = "Não atende";
    } else if (holiday && hd === true) {
      state = "holiday_open";
      note = `${holiday.name} (atende)`;
    } else if (holiday && hd === undefined) {
      state = "holiday_pending";
      note = `${holiday.name} — a confirmar`;
    }

    const dayOpen =
      state === "normal" ||
      state === "open_day" ||
      state === "holiday_open" ||
      state === "holiday_pending";
    let free: number | null = null;
    if (dayOpen) {
      free = 0;
      if (!providerVacation) {
        const openMin =
          special && !isWeekdayOpen ? special.open : timeToMinutes(cfg.openTime);
        const closeMin =
          special && !isWeekdayOpen
            ? special.close
            : timeToMinutes(cfg.closeTime);
        const overlap = (s: string, e: string, startMs: number, endMs: number) =>
          startMs < new Date(e).getTime() && endMs > new Date(s).getTime();
        for (let m = openMin; m + durationMin <= closeMin; m += 15) {
          if (
            cfg.lunchEnabled &&
            !isOnline &&
            m < lunchEnd &&
            m + durationMin > lunchStart
          ) {
            continue;
          }
          const startMs = new Date(
            `${dateOnly}T${minutesToHHMM(m)}:00`
          ).getTime();
          const endMs = startMs + durationMin * 60_000;
          if (startMs < nowMs) continue;
          if (
            closures.some((c) =>
              closureBlocks(c, {
                startMs,
                endMs,
                roomId: isOnline ? null : roomId,
                providerId: providerUserId,
              })
            )
          ) {
            continue;
          }
          if (
            providerUserId &&
            appts.some(
              (a) =>
                a.provider_user_id === providerUserId &&
                a.type !== "urgency" &&
                a.type !== "emergency" &&
                overlap(a.starts_at, a.ends_at, startMs, endMs)
            )
          ) {
            continue;
          }
          if (
            !isOnline &&
            roomId &&
            appts.some(
              (a) =>
                a.room_id === roomId &&
                overlap(a.starts_at, a.ends_at, startMs, endMs)
            )
          ) {
            continue;
          }
          free += 1;
        }
      } else {
        note = note ? `${note} · Profissional de férias` : "Profissional de férias";
      }
    }

    out[dateOnly] = { count, free, state, note };
  }
  return out;
}
