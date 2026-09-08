"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CardStage } from "@/lib/commercial";

export type CardActionResult = {
  ok: boolean;
  error?: string;
  escalated?: boolean;
};

function mapError(m: string): string {
  if (m.includes("NOT_ALLOWED"))
    return "Você não tem permissão para mover este cliente no funil.";
  if (m.includes("REASON_REQUIRED"))
    return "Informe o motivo (cancelamento/perda).";
  if (m.includes("INVALID_STAGE")) return "Etapa inválida.";
  if (m.includes("CLIENT_NOT_FOUND")) return "Cliente não encontrado.";
  if (m.includes("INVALID_KIND")) return "Tipo de acontecimento inválido.";
  if (m.includes("NOTE_REQUIRED"))
    return "Escreva o que aconteceu — a observação sozinha não diz nada.";
  if (m.includes("CARD_NOT_FOUND"))
    return "Este cliente ainda não tem cartão no funil comercial.";
  if (m.includes("42883"))
    return "Esta tela precisa da migração 0248, ainda não aplicada neste banco.";
  return "Não foi possível concluir a ação.";
}

function revalidate(clientId: string) {
  revalidatePath("/comercial");
  revalidatePath(`/comercial/${clientId}`);
  revalidatePath("/notificacoes");
}

/** Move o cartão do cliente para uma etapa manual do funil comercial. */
export async function setCardStage(
  clientId: string,
  stage: CardStage,
  reason?: string
): Promise<CardActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("commercial_set_stage", {
    p_client_id: clientId,
    p_stage: stage,
    p_reason: reason?.trim() || null,
  });
  if (error) {
    console.error("commercial_set_stage failed:", error.message);
    return { ok: false, error: mapError(error.message) };
  }
  revalidate(clientId);
  return { ok: true };
}

/** Libera (ou retoma) o follow-up para a clínica — decisão do Comercial. */
export async function transferFollowup(
  clientId: string,
  toClinic: boolean
): Promise<CardActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("commercial_transfer_followup", {
    p_client_id: clientId,
    p_to_clinic: toClinic,
  });
  if (error) {
    console.error("commercial_transfer_followup failed:", error.message);
    return { ok: false, error: mapError(error.message) };
  }
  revalidate(clientId);
  return { ok: true };
}

/** Abre o follow-up do cliente (cadência configurada da unidade). */
export async function startFollowup(
  clientId: string
): Promise<CardActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("commercial_start_followup", {
    p_client_id: clientId,
  });
  if (error) {
    console.error("commercial_start_followup failed:", error.message);
    return { ok: false, error: mapError(error.message) };
  }
  revalidate(clientId);
  return { ok: true };
}

// ⚠️ As listas de tipos de acontecimento moram em `src/lib/commercial.ts`, e
// NÃO aqui. Um arquivo "use server" só pode exportar FUNÇÕES ASSÍNCRONAS —
// exportar uma constante daqui derruba a montagem inteira com
// "a use server file can only export async functions, found object".
// Ver o comentário lá.

export async function logPresentationEvent(
  clientId: string,
  kind: string,
  note: string
): Promise<CardActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_presentation_event", {
    p_client_id: clientId,
    p_kind: kind,
    p_note: note.trim() || null,
  });
  if (error) {
    console.error("log_presentation_event failed:", error.message);
    return { ok: false, error: mapError(error.message) };
  }
  revalidate(clientId);
  return { ok: true };
}

/** Pede à Recepção da unidade DO CLIENTE um novo agendamento de apresentação. */
export async function requestPresentationScheduling(
  clientId: string,
  reason: string
): Promise<CardActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_presentation_scheduling", {
    p_client_id: clientId,
    p_reason: reason.trim() || null,
  });
  if (error) {
    console.error("request_presentation_scheduling failed:", error.message);
    return { ok: false, error: mapError(error.message) };
  }
  revalidate(clientId);
  return { ok: true };
}

/** Registra uma tentativa de follow-up; retorna se escalou à Gerente. */
export async function logFollowupAttempt(
  clientId: string,
  input: { channel: string; outcome: string; notes: string }
): Promise<CardActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("commercial_log_followup_attempt", {
    p_client_id: clientId,
    p_channel: input.channel,
    p_outcome: input.outcome,
    p_notes: input.notes.trim() || null,
  });
  if (error) {
    console.error("commercial_log_followup_attempt failed:", error.message);
    return { ok: false, error: mapError(error.message) };
  }
  revalidate(clientId);
  const escalated = Boolean(
    (data as { escalated?: boolean } | null)?.escalated
  );
  return { ok: true, escalated };
}
