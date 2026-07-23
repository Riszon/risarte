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
