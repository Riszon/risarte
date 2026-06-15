"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  type AppointmentStatus,
  type AppointmentType,
} from "@/lib/appointments";
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
  const clinicId = session.activeClinic?.id;
  if (!clinicId) return { ok: false, error: "Nenhuma clínica selecionada." };
  if (session.activeClinic?.type === "franchisor") {
    return {
      ok: false,
      error: "A Franqueadora não tem agenda própria. Selecione uma unidade.",
    };
  }
  if (!hasRoleInClinic(session, clinicId, ["receptionist", "sdr"])) {
    return {
      ok: false,
      error: "Apenas a Recepção ou Encantador(a) pode agendar.",
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
      "clinic_id, client_id, type, starts_at, ends_at, provider_user_id, notes"
    )
    .eq("id", appointmentId)
    .single();

  if (!existing) return { ok: false, error: "Agendamento não encontrado." };
  if (!hasRoleInClinic(session, existing.clinic_id, ["receptionist", "sdr"])) {
    return {
      ok: false,
      error: "Apenas a Recepção ou Encantador(a) pode alterar agendamentos.",
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
    .select("clinic_id, status")
    .eq("id", appointmentId)
    .single();

  if (!appointment) return { ok: false, error: "Agendamento não encontrado." };
  if (
    !hasRoleInClinic(session, appointment.clinic_id, ["receptionist", "sdr"])
  ) {
    return {
      ok: false,
      error: "Apenas a Recepção ou Encantador(a) pode alterar o status.",
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
