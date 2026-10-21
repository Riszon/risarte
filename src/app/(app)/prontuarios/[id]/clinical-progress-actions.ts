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
 * ao recarregar / clicar em "Nova anotação". Grava: o Dentista; o Coordenador
 * só no atendimento em que ele é o profissional (OD5, H4); o titular (D6 — o
 * Admin que não é o titular só vê). O banco confere (0314). */
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
    Boolean(session.isOwner) ||
    hasRoleInClinic(session, input.clinicId, ["dentist"]) ||
    (Boolean(input.appointmentId) && hasRoleInClinic(session, input.clinicId, ["clinical_coordinator"]));
  if (!canWrite) {
    return {
      ok: false,
      error: "Apenas quem atendeu (o dentista, ou o Coordenador no atendimento dele) registra o desenvolvimento clínico.",
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
      // OD6 (J1): concluído o atendimento, a anotação tranca no banco.
      if (error.message.includes("NOTE_LOCKED")) {
        return {
          ok: false,
          error: "Esta anotação já foi trancada (atendimento concluído ou dia encerrado). Para corrigir, use o Adendo.",
        };
      }
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
 * OD6 (J1): o ADENDO — a correção de uma anotação trancada. A original não
 * muda; o adendo fica logo abaixo, com autor, data e motivo. Quem pode e se a
 * anotação está mesmo trancada, o banco confere (0315).
 */
export async function addProgressAddendum(input: {
  noteId: string;
  clientId: string;
  body: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_progress_addendum", {
    p_note: input.noteId,
    p_body: input.body,
    p_reason: input.reason,
  });
  if (error) {
    const mapa: [string, string][] = [
      ["ADDENDUM_REASON_REQUIRED", "Escreva o motivo do adendo (mínimo de 5 letras)."],
      ["ADDENDUM_BODY_REQUIRED", "Escreva o texto do adendo."],
      ["NOTE_STILL_OPEN", "Esta anotação ainda está aberta: corrija direto no texto."],
      ["ADDENDUM_OF_ADDENDUM", "O adendo é da anotação original — não de outro adendo."],
      ["NOTE_NOT_FOUND", "Anotação não encontrada. Atualize a tela."],
      ["NOT_ALLOWED", "Adendo é de quem registra evolução nesta unidade (o dentista, o Coordenador do atendimento ou o autor)."],
    ];
    const recado = mapa.find(([k]) => error.message.includes(k))?.[1];
    if (!recado) console.error("addProgressAddendum failed:", error.message);
    return { ok: false, error: recado ?? "Não foi possível registrar o adendo." };
  }
  await logAudit({
    action: "create",
    entityType: "clinical_progress_addendum",
    entityId: (data as string | null) ?? input.noteId,
  });
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true };
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
        error: "Apenas quem atendeu (o dentista ou o Coordenador do atendimento) pode concluir o atendimento.",
      };
    }
    if (error.message.includes("APPOINTMENT_NOT_FOUND")) {
      return {
        ok: false,
        error: "Agendamento não encontrado — atualize a tela e tente de novo.",
      };
    }
    console.error("concludeFromProgress failed:", error.message);
    return {
      ok: false,
      error:
        "Não foi possível concluir o atendimento. Atualize a tela e tente de novo; se continuar, avise o suporte.",
    };
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
