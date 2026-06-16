"use server";

import { revalidatePath } from "next/cache";
import {
  getSessionContext,
  hasRoleInClinic,
  type SessionContext,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

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
import type { JourneyPhase } from "@/lib/journey";

export type ActionResult = { ok: boolean; error?: string };

type ParsedAppointment = {
  client_id: string;
  type: AppointmentType;
  starts_at: string;
  ends_at: string;
  provider_user_id: string | null;
  notes: string | null;
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
    },
  };
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
      "clinic_id, client_id, type, starts_at, ends_at, provider_user_id, notes, created_by"
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

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of [
    "type",
    "starts_at",
    "ends_at",
    "provider_user_id",
    "notes",
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
    })
    .eq("id", appointmentId);

  if (error) {
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

export type UnitSchedulingData = {
  clients: { id: string; full_name: string }[];
  staff: StaffOption[];
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
      supabase
        .from("clients")
        .select("id, full_name")
        .or(`clinic_id.eq.${clinicId},preferred_clinic_id.eq.${clinicId}`)
        .eq("status", "active")
        .order("full_name")
        .limit(300),
      supabase
        .from("user_clinic_roles")
        .select("user_id, role, profiles ( full_name )")
        .eq("clinic_id", clinicId)
        .returns<
          { user_id: string; role: string; profiles: { full_name: string } | null }[]
        >(),
      supabase.rpc("providers_with_access", {
        p_clinic_id: clinicId,
        p_role: "commercial_consultant",
      }),
    ]);

  const staffMap = new Map<string, StaffOption>();
  for (const row of staffRows ?? []) {
    const entry = staffMap.get(row.user_id) ?? {
      userId: row.user_id,
      name: row.profiles?.full_name ?? "—",
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

  return {
    clients: (clientRows ?? []) as { id: string; full_name: string }[],
    staff: [...staffMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
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
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite esta ação." };
    }
    console.error("update_attendance failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar o atendimento." };
  }
  revalidatePath("/atendimento");
  return { ok: true };
}

export type SchedulingInfo = {
  phase: JourneyPhase;
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
      .select("journey_phase")
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
    lastAppointment: lastAppointments?.[0] ?? null,
  };
}
