"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type SaveProgressResult = {
  ok: boolean;
  id?: string;
  savedAt?: string;
  error?: string;
};

/** H4.6 A2: salva (cria ou atualiza) a anotação de Desenvolvimento Clínico do
 * dentista. Chamada em segundo plano pelo salvamento automático da UI — por isso
 * NÃO faz revalidatePath (não atrapalha a digitação); a linha do tempo se atualiza
 * ao recarregar / clicar em "Nova anotação". Só o Dentista (ou Admin) grava. */
export async function saveProgressNote(input: {
  id: string | null;
  clientId: string;
  clinicId: string;
  body: string;
  /** I7b: uma anotação por ATENDIMENTO (o banco garante com índice único). */
  appointmentId?: string | null;
}): Promise<SaveProgressResult> {
  const session = await getSessionContext();
  const canWrite =
    session.isAdminMaster ||
    hasRoleInClinic(session, input.clinicId, ["dentist"]);
  if (!canWrite) {
    return {
      ok: false,
      error: "Apenas o dentista pode registrar o desenvolvimento clínico.",
    };
  }

  const body = input.body ?? "";
  const supabase = await createClient();

  if (input.id) {
    const savedAt = new Date().toISOString();
    const { error } = await supabase
      .from("clinical_progress_notes")
      .update({ body, updated_at: savedAt })
      .eq("id", input.id);
    if (error) {
      console.error("progress note update failed:", error.message);
      return { ok: false, error: "Não foi possível salvar." };
    }
    return { ok: true, id: input.id, savedAt };
  }

  // Só cria a anotação quando já houver conteúdo (evita anotações vazias).
  if (body.trim() === "") return { ok: true };

  const { data, error } = await supabase
    .from("clinical_progress_notes")
    .insert({
      client_id: input.clientId,
      clinic_id: input.clinicId,
      author_id: session.userId,
      appointment_id: input.appointmentId ?? null,
      body,
    })
    .select("id, updated_at")
    .single();
  if (error || !data) {
    console.error("progress note insert failed:", error?.message);
    return { ok: false, error: "Não foi possível salvar." };
  }
  await logAudit({
    action: "create",
    entityType: "clinical_progress_note",
    entityId: data.id,
    clinicId: input.clinicId,
  });
  return { ok: true, id: data.id, savedAt: data.updated_at };
}

/**
 * I7b: conclui o atendimento direto do Desenvolvimento Clínico — confirmando o
 * que foi feito, o que não foi (com motivo) e sessões EXTRAS executadas fora do
 * programado. O banco só deixa concluir depois que a anotação foi escrita.
 */
export async function concludeFromProgress(input: {
  appointmentId: string;
  clientId: string;
  doneSessionIds: string[];
  extraSessionIds: string[];
  reasons: Record<string, string>;
}): Promise<{ ok: boolean; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("conclude_attendance_partial", {
    p_appointment_id: input.appointmentId,
    p_done_ids: input.doneSessionIds,
    p_reasons: input.reasons,
    p_extra_ids: input.extraSessionIds,
  });
  if (error) {
    if (error.message.includes("NOTE_REQUIRED")) {
      return {
        ok: false,
        error:
          "Descreva o Desenvolvimento Clínico antes de concluir o atendimento.",
      };
    }
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Apenas o dentista que atendeu pode concluir o atendimento.",
      };
    }
    console.error("concludeFromProgress failed:", error.message);
    return { ok: false, error: "Não foi possível concluir o atendimento." };
  }
  await logAudit({
    action: "update",
    entityType: "appointment",
    entityId: input.appointmentId,
    details: { concluded_from: "clinical_progress" },
  });
  revalidatePath(`/prontuarios/${input.clientId}`);
  revalidatePath("/atendimento");
  revalidatePath("/agenda");
  return { ok: true };
}
