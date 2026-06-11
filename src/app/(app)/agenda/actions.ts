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

export type ActionResult = { ok: boolean; error?: string };

export async function createAppointment(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id;
  if (!clinicId) return { ok: false, error: "Nenhuma clínica selecionada." };
  if (!hasRoleInClinic(session, clinicId, ["receptionist"])) {
    return { ok: false, error: "Apenas a Recepção pode agendar." };
  }

  const clientId = String(formData.get("client_id") ?? "");
  const type = String(formData.get("type") ?? "") as AppointmentType;
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const durationMinutes = Number(formData.get("duration") ?? 60);
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!clientId) return { ok: false, error: "Escolha o cliente." };
  if (!APPOINTMENT_TYPES.includes(type)) {
    return { ok: false, error: "Tipo de compromisso inválido." };
  }
  if (!date || !time) return { ok: false, error: "Informe data e horário." };
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15) {
    return { ok: false, error: "Duração mínima de 15 minutos." };
  }

  const startsAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(startsAt.getTime())) {
    return { ok: false, error: "Data ou horário inválido." };
  }
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      client_id: clientId,
      type,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      notes,
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
    .select("clinic_id")
    .eq("id", appointmentId)
    .single();

  if (!appointment) return { ok: false, error: "Agendamento não encontrado." };
  if (!hasRoleInClinic(session, appointment.clinic_id, ["receptionist"])) {
    return {
      ok: false,
      error: "Apenas a Recepção pode alterar o status do agendamento.",
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
    details: { status },
  });
  revalidatePath("/agenda");
  return { ok: true };
}
