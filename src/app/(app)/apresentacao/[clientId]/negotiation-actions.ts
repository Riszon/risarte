"use server";

import { revalidatePath } from "next/cache";
import {
  getSessionContext,
  hasRoleInClinic,
  hasRoleWithScopeForClinic,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  automaticDiscountPercent,
  resolveCommercialRule,
  type CommercialRuleRow,
  type PaymentMethod,
} from "@/lib/commercial";
import { loadClientPrograms } from "@/lib/programs";
import { applyBenefit } from "@/lib/empresarial/pricing";

export type NegotiationActionResult = {
  ok: boolean;
  error?: string;
  /** Violações da regra comercial (quando salvou fora da regra). */
  violations?: string[];
  /** J1: id da negociação salva (para gravar as cobranças em seguida). */
  negotiationId?: string;
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

  // J7: BENEFÍCIO DO PROGRAMA por item (Empresarial/PPR+). Calculado AQUI, no
  // servidor, pelo mesmo motor da venda direta — a tela não manda valor de
  // dinheiro. É isso que faz o benefício entrar no valor final (antes o
  // orçamento do plano ia cheio para a negociação).
  const programDiscountByItem = new Map<string, number>();
  const excluded = new Set(input.excludedItemIds);
  let discountableCents = 0;
  const programs = await loadClientPrograms(clientId);
  if (input.allItemIds.length > 0) {
    const { data: itemRows } = await supabase
      .from("treatment_plan_option_items")
      .select("id, option_id, procedure_id, quantity, unit_price_cents")
      .in("id", input.allItemIds);
    for (const it of itemRows ?? []) {
      const itemId = it.id as string;
      const lineFull =
        (it.quantity as number) * (it.unit_price_cents as number);
      const procedureId = it.procedure_id as string | null;
      const benefit = procedureId ? programs.byProcedure[procedureId] : null;
      const benefitCents =
        benefit && benefit.available
          ? applyBenefit(
              {
                benefitType: benefit.benefitType,
                benefitValue: benefit.benefitValue,
              },
              lineFull
            ).savedCents
          : 0;
      if (benefitCents > 0) programDiscountByItem.set(itemId, benefitCents);
      // Base do desconto de pagamento: itens da opção em negociação, incluídos
      // e SEM benefício por procedimento (não descontam duas vezes).
      if (
        (it.option_id as string) === input.optionId &&
        !excluded.has(itemId) &&
        benefitCents === 0
      ) {
        discountableCents += lineFull;
      }
    }
  }

  /**
   * J7: para cliente de PROGRAMA o desconto de pagamento é do SISTEMA, não da
   * tela — recalculado aqui a cada salvamento pelo parcelamento escolhido
   * (mesma regra da venda direta). PPR+ usa a faixa do plano; Empresarial não
   * tem faixa (o benefício dele é por procedimento). O valor vindo da tela é
   * ignorado de propósito, para nunca congelar um desconto antigo.
   */
  const ppr = programs.ppr?.active ? programs.ppr : null;
  // 0205: plano de tratamento não tem acréscimo — o preço vem do orçamento
  // aprovado pelo Coordenador. O banco também recusa (SURCHARGE_NOT_ALLOWED);
  // aqui só evitamos mandar o que já se sabe inválido.
  let adjustmentCents = Math.min(0, Math.round(input.adjustmentCents));
  if (ppr) {
    const pct =
      installments <= 1
        ? ppr.cashDiscountPercent
        : ([...ppr.tiers]
            .sort((a, b) => a.upToInstallments - b.upToInstallments)
            .find((t) => installments <= t.upToInstallments)?.discountPercent ??
          0);
    adjustmentCents = -Math.round(
      (discountableCents * Math.max(0, pct)) / 100
    );
  } else if (programs.active) {
    // Empresarial: benefício automático por procedimento, sem desconto manual.
    adjustmentCents = 0;
  } else if (installments <= 1 && adjustmentCents <= 0) {
    /**
     * PARIDADE COM A VENDA DIRETA (06/08/2026). Cliente SEM programa pagando à
     * vista tem direito ao desconto automático da regra comercial (ex.: 5%).
     *
     * Isso já acontecia — mas quem calculava era a TELA, e o servidor só
     * conferia o teto. Se a tela deixasse de mandar, o cliente perderia o
     * desconto **em silêncio**, sem erro nenhum aparecer. Agora o servidor
     * garante o piso, como na venda direta.
     *
     * O desconto manual MAIOR prevalece (o teto continua sendo validado por
     * `evaluate_negotiation_rules`). Acréscimo — ajuste positivo — não é
     * tocado: quem lançou quis somar, e o automático não deve virar isso do
     * avesso.
     */
    const { data: ruleRows } = await supabase
      .from("commercial_rules")
      .select(
        "clinic_id, max_discount_percent, max_installments, allowed_methods, cash_discount_percent, min_installment_cents_by_method"
      )
      .returns<CommercialRuleRow[]>();
    const rule = resolveCommercialRule(ruleRows ?? [], client.clinic_id);
    const auto = automaticDiscountPercent(rule, installments);
    if (auto > 0) {
      const autoCents = -Math.round((discountableCents * auto) / 100);
      // Ambos negativos: o mais negativo é o desconto maior.
      adjustmentCents = Math.min(adjustmentCents, autoCents);
    }
  }

  const { data: saved, error } = await supabase
    .from("plan_negotiations")
    .upsert(
      {
        plan_id: input.planId,
        option_id: input.optionId,
        client_id: clientId,
        clinic_id: client.clinic_id,
        adjustment_cents: adjustmentCents,
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
          program_discount_cents: programDiscountByItem.get(itemId) ?? 0,
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
  return {
    ok: true,
    violations: (violations as string[] | null) ?? [],
    negotiationId: saved.id,
  };
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
