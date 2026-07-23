"use server";

import { revalidatePath } from "next/cache";
import {
  getSessionContext,
  hasRoleInClinic,
  hasRoleWithScopeForClinic,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { PaymentMethod } from "@/lib/commercial";

export type NegotiationActionResult = {
  ok: boolean;
  error?: string;
  /** Violações da regra comercial (quando salvou fora da regra). */
  violations?: string[];
};

/** Salva a negociação do Consultor sobre um plano aprovado (COM1). */
export async function savePlanNegotiation(
  clientId: string,
  input: {
    planId: string;
    optionId: string;
    allItemIds: string[];
    excludedItemIds: string[];
    adjustmentCents: number;
    paymentMethod: PaymentMethod | null;
    installments: number;
    partialReason: string;
    clientIsDecider: boolean | null;
    deciderNotes: string;
    notes: string;
  }
): Promise<NegotiationActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, clinic_id, journey_phase")
    .eq("id", clientId)
    .single();
  if (!client) return { ok: false, error: "Cliente não encontrado." };
  // Negociação só acontece com o cliente na Fase 4 (Conversão Comercial).
  if (client.journey_phase !== "commercial_conversion") {
    return {
      ok: false,
      error: "O cliente não está na Conversão Comercial — negociação indisponível.",
    };
  }

  const allowed =
    session.isAdminMaster ||
    hasRoleInClinic(session, client.clinic_id, ["unit_manager"]) ||
    (await hasRoleWithScopeForClinic(session, client.clinic_id, [
      "commercial_consultant",
    ]));
  if (!allowed) {
    return { ok: false, error: "Apenas o Consultor Comercial pode negociar." };
  }

  if (!Number.isFinite(input.adjustmentCents)) {
    return { ok: false, error: "Ajuste inválido." };
  }
  const installments =
    Number.isFinite(input.installments) && input.installments >= 1
      ? Math.floor(input.installments)
      : 1;

  const { data: saved, error } = await supabase
    .from("plan_negotiations")
    .upsert(
      {
        plan_id: input.planId,
        option_id: input.optionId,
        client_id: clientId,
        clinic_id: client.clinic_id,
        adjustment_cents: Math.round(input.adjustmentCents),
        payment_method: input.paymentMethod,
        installments,
        partial_reason: input.partialReason.trim() || null,
        client_is_decider: input.clientIsDecider,
        decider_notes: input.deciderNotes.trim() || null,
        notes: input.notes.trim() || null,
        created_by: session.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "plan_id" }
    )
    .select("id")
    .single();
  if (error || !saved) {
    console.error("savePlanNegotiation failed:", error?.message);
    return { ok: false, error: "Não foi possível salvar a negociação." };
  }

  // Itens: regrava o espelho da opção (incluído × excluído pelo cliente).
  const excluded = new Set(input.excludedItemIds);
  await supabase
    .from("plan_negotiation_items")
    .delete()
    .eq("negotiation_id", saved.id);
  if (input.allItemIds.length > 0) {
    const { error: itemsError } = await supabase
      .from("plan_negotiation_items")
      .insert(
        input.allItemIds.map((itemId) => ({
          negotiation_id: saved.id,
          item_id: itemId,
          included: !excluded.has(itemId),
        }))
      );
    if (itemsError) {
      console.error("savePlanNegotiation items failed:", itemsError.message);
      return { ok: false, error: "Não foi possível salvar os procedimentos." };
    }
  }

  // Recalcula totais + valida contra a regra comercial (fora → Gerente autoriza).
  const { data: violations, error: evalError } = await supabase.rpc(
    "evaluate_negotiation_rules",
    { p_negotiation_id: saved.id, p_from_consultant: true }
  );
  if (evalError) {
    console.error("evaluate_negotiation_rules failed:", evalError.message);
    return { ok: false, error: "Não foi possível validar a regra comercial." };
  }

  revalidatePath(`/apresentacao/${clientId}`);
  revalidatePath(`/comercial/${clientId}`);
  revalidatePath("/notificacoes");
  return { ok: true, violations: (violations as string[] | null) ?? [] };
}

/** Consultor marca que o CLIENTE ACEITOU as condições. */
export async function acceptNegotiation(
  clientId: string,
  negotiationId: string
): Promise<NegotiationActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_negotiation", {
    p_negotiation_id: negotiationId,
  });
  if (error) {
    const m = error.message;
    if (m.includes("AWAITING_AUTHORIZATION"))
      return { ok: false, error: "Aguardando a autorização do Gerente da unidade." };
    if (m.includes("NEEDS_AUTHORIZATION"))
      return { ok: false, error: "Negociação fora da regra — precisa da autorização do Gerente." };
    if (m.includes("PARTIAL_REASON_REQUIRED"))
      return { ok: false, error: "Informe o motivo da aprovação parcial." };
    if (m.includes("PAYMENT_REQUIRED"))
      return { ok: false, error: "Defina o meio de pagamento antes de aceitar." };
    if (m.includes("ROUND_CLOSED"))
      return {
        ok: false,
        error:
          "Esta rodada foi devolvida ao planejamento — salve a negociação (nova rodada) antes de registrar o aceite.",
      };
    if (m.includes("WRONG_PHASE"))
      return { ok: false, error: "O cliente não está na Conversão Comercial." };
    if (m.includes("NOT_ALLOWED"))
      return { ok: false, error: "Apenas o Consultor Comercial pode aceitar." };
    console.error("accept_negotiation failed:", m);
    return { ok: false, error: "Não foi possível registrar o aceite." };
  }
  revalidatePath(`/apresentacao/${clientId}`);
  revalidatePath(`/comercial/${clientId}`);
  revalidatePath("/notificacoes");
  return { ok: true };
}

/** Gerente autoriza (ou nega) a negociação fora da regra comercial. */
export async function reviewNegotiationAction(
  clientId: string,
  negotiationId: string,
  approve: boolean,
  note: string
): Promise<NegotiationActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_negotiation", {
    p_negotiation_id: negotiationId,
    p_approve: approve,
    p_note: note.trim() || null,
  });
  if (error) {
    const m = error.message;
    if (m.includes("NOT_PENDING"))
      return { ok: false, error: "Esta negociação não está aguardando autorização." };
    if (m.includes("NOTE_REQUIRED"))
      return { ok: false, error: "Informe o motivo ao negar a autorização." };
    if (m.includes("NOT_ALLOWED"))
      return { ok: false, error: "Apenas o Gerente da unidade pode autorizar." };
    console.error("review_negotiation failed:", m);
    return { ok: false, error: "Não foi possível registrar a decisão." };
  }
  revalidatePath(`/apresentacao/${clientId}`);
  revalidatePath(`/comercial/${clientId}`);
  revalidatePath("/notificacoes");
  return { ok: true };
}

/** Devolve o cliente ao Centro de Planejamento com considerações obrigatórias. */
export async function returnToPlanning(
  clientId: string,
  considerations: string
): Promise<NegotiationActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_commercial_to_planning", {
    p_client_id: clientId,
    p_considerations: considerations,
  });
  if (error) {
    const m = error.message;
    if (m.includes("CONSIDERATIONS_REQUIRED"))
      return { ok: false, error: "Escreva as considerações para o Planner." };
    if (m.includes("WRONG_PHASE"))
      return { ok: false, error: "O cliente não está na Conversão Comercial." };
    if (m.includes("NOT_ALLOWED"))
      return { ok: false, error: "Apenas o Consultor Comercial pode devolver." };
    console.error("return_commercial_to_planning failed:", m);
    return { ok: false, error: "Não foi possível devolver ao planejamento." };
  }
  revalidatePath(`/apresentacao/${clientId}`);
  revalidatePath(`/comercial/${clientId}`);
  revalidatePath(`/prontuarios/${clientId}`);
  revalidatePath("/jornada");
  revalidatePath("/planejamento");
  revalidatePath("/notificacoes");
  return { ok: true };
}
