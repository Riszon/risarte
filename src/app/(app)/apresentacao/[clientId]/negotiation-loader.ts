import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  resolveCommercialRule,
  type CommercialRule,
  type CommercialRuleRow,
} from "@/lib/commercial";
import type { PlanEvent } from "@/lib/planning";
import { loadClientPrograms } from "@/lib/programs";
import type { ScheduleEntry } from "@/lib/payments";
import type {
  NegotiationData,
  NegotiationOption,
} from "./negotiation-panel";

export type SaleData = {
  contractSigned: boolean;
  paymentConfirmed: boolean;
  closedAt: string | null;
};

export type NegotiationBlock = {
  planId: string;
  options: NegotiationOption[];
  negotiation: NegotiationData | null;
  rule: CommercialRule;
  /** Histórico do plano em negociação (para o Consultor e o Gerente). */
  planEvents: PlanEvent[];
  /** Fechamento (COM4) — existe quando a negociação foi aceita. */
  sale: SaleData | null;
  /** Descrições dos itens não aprovados pelo cliente (aprovação parcial). */
  excludedDescriptions: string[];
  /** Resumo da apresentação (vai no contrato do fechamento). */
  presentationSummary: string | null;
  /**
   * PPR5b: condições de pagamento do PROGRAMA do cliente (PPR+). Ficam acima da
   * regra da rede/unidade — o desconto sai da tabela do plano.
   */
  programConditions: {
    label: string;
    cashDiscountPercent: number;
    maxInstallments: number;
    minInstallmentCents: number;
    tiers: { upToInstallments: number; discountPercent: number }[];
    /** Procedimentos já cobertos pelo plano (sem desconto adicional). */
    coveredProcedureIds: string[];
  } | null;
};

/**
 * Carrega o bloco da negociação de um cliente (COM1/COM2): plano aprovado mais
 * recente, opções aprovadas pelo Coordenador (principal + secundários), a
 * negociação existente e a regra comercial efetiva da unidade. Null quando não
 * há plano aprovado com opções. Usado pela tela de apresentação e pelo cockpit
 * do Consultor.
 */
export async function loadNegotiationBlock(
  clientId: string,
  clinicId: string
): Promise<NegotiationBlock | null> {
  const supabase = await createClient();

  const { data: planRows } = await supabase
    .from("treatment_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1);
  const planId = planRows?.[0]?.id as string | undefined;
  if (!planId) return null;

  const [{ data: optRows }, { data: negRows }, { data: ruleRows }] =
    await Promise.all([
      // Só opções APROVADAS pelo Coordenador (secundários = carta na manga).
      supabase
        .from("treatment_plan_options")
        .select(
          "id, is_primary, title, sort_order, treatment_plan_option_items ( id, description, quantity, unit_price_cents, procedure_id, sort_order, gut_gravity, gut_urgency, gut_tendency )"
        )
        .eq("plan_id", planId)
        .eq("review_status", "approved")
        .order("is_primary", { ascending: false })
        .order("sort_order")
        .returns<
          {
            id: string;
            is_primary: boolean;
            title: string;
            sort_order: number;
            treatment_plan_option_items: {
              id: string;
              description: string;
              quantity: number;
              unit_price_cents: number;
              procedure_id: string | null;
              sort_order: number;
              gut_gravity: number | null;
              gut_urgency: number | null;
              gut_tendency: number | null;
            }[];
          }[]
        >(),
      supabase
        .from("plan_negotiations")
        .select(
          "id, option_id, status, adjustment_cents, payment_method, installments, partial_reason, client_is_decider, decider_notes, notes, rule_violations, rule_authorized, authorization_note, final_cents, down_payment_cents, plan_negotiation_items ( item_id, included )"
        )
        .eq("plan_id", planId)
        .limit(1)
        .returns<
          {
            id: string;
            option_id: string;
            status: string;
            adjustment_cents: number;
            payment_method: string | null;
            installments: number;
            partial_reason: string | null;
            client_is_decider: boolean | null;
            decider_notes: string | null;
            notes: string | null;
            rule_violations: string | null;
            rule_authorized: boolean;
            authorization_note: string | null;
            final_cents: number;
            down_payment_cents: number;
            plan_negotiation_items: { item_id: string; included: boolean }[];
          }[]
        >(),
      supabase
        .from("commercial_rules")
        .select(
          "clinic_id, max_discount_percent, max_installments, allowed_methods, cash_discount_percent, min_installment_cents_by_method"
        )
        .returns<CommercialRuleRow[]>(),
    ]);

  const options: NegotiationOption[] = (optRows ?? []).map((o) => ({
    id: o.id,
    title: o.title,
    isPrimary: o.is_primary,
    items: [...(o.treatment_plan_option_items ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({
        id: i.id,
        description: i.description,
        quantity: i.quantity,
        unitPriceCents: i.unit_price_cents,
        procedureId: i.procedure_id ?? null,
        gutGravity: i.gut_gravity,
        gutUrgency: i.gut_urgency,
        gutTendency: i.gut_tendency,
      })),
  }));
  if (options.length === 0) return null;

  // Histórico do plano em negociação (linha do tempo com autores) — o Gerente
  // usa para entender o plano ao autorizar uma negociação fora da regra.
  const { data: eventRows } = await supabase
    .from("treatment_plan_events")
    .select("id, event_type, description, actor_id, created_at")
    .eq("plan_id", planId)
    .order("created_at");
  const actorIds = [
    ...new Set(
      (eventRows ?? [])
        .map((e) => e.actor_id as string | null)
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    for (const p of people ?? []) actorNames.set(p.id, p.full_name as string);
  }
  const planEvents: PlanEvent[] = (eventRows ?? []).map((e) => ({
    id: e.id as string,
    type: e.event_type as string,
    description: (e.description as string | null) ?? null,
    actorName: e.actor_id ? (actorNames.get(e.actor_id as string) ?? null) : null,
    at: e.created_at as string,
  }));

  const n = negRows?.[0];
  // J1: cobranças (entrada + parcelas) já salvas para esta negociação.
  let schedule: ScheduleEntry[] = [];
  if (n) {
    const { data: instRows } = await supabase
      .from("payment_installments")
      .select("seq, kind, due_date, amount_cents")
      .eq("negotiation_id", n.id)
      .order("seq");
    schedule = (instRows ?? []).map((r) => ({
      seq: r.seq as number,
      kind: (r.kind as ScheduleEntry["kind"]) ?? "parcela",
      dueDate: r.due_date as string,
      amountCents: r.amount_cents as number,
    }));
  }
  const negotiation: NegotiationData | null = n
    ? {
        id: n.id,
        optionId: n.option_id,
        status: n.status as NegotiationData["status"],
        adjustmentCents: n.adjustment_cents,
        paymentMethod:
          (n.payment_method as NegotiationData["paymentMethod"]) ?? null,
        installments: n.installments,
        partialReason: n.partial_reason,
        clientIsDecider: n.client_is_decider,
        deciderNotes: n.decider_notes,
        notes: n.notes,
        ruleViolations: n.rule_violations,
        ruleAuthorized: n.rule_authorized,
        authorizationNote: n.authorization_note,
        finalCents: n.final_cents,
        downPaymentCents: n.down_payment_cents ?? 0,
        schedule,
        excludedItemIds: (n.plan_negotiation_items ?? [])
          .filter((i) => !i.included)
          .map((i) => i.item_id),
      }
    : null;

  // Fechamento (COM4): existe quando a negociação foi aceita.
  let sale: SaleData | null = null;
  if (n) {
    const { data: saleRow } = await supabase
      .from("commercial_sales")
      .select("contract_signed, payment_confirmed, closed_at")
      .eq("negotiation_id", n.id)
      .maybeSingle();
    if (saleRow) {
      sale = {
        contractSigned: saleRow.contract_signed as boolean,
        paymentConfirmed: saleRow.payment_confirmed as boolean,
        closedAt: (saleRow.closed_at as string | null) ?? null,
      };
    }
  }

  // Itens não aprovados pelo cliente (aprovação parcial) — vão no contrato.
  const excludedSet = new Set(negotiation?.excludedItemIds ?? []);
  const excludedDescriptions = options
    .flatMap((o) => o.items)
    .filter((i) => excludedSet.has(i.id))
    .map((i) => i.description);

  // Resumo da apresentação (COM2) — embutido no contrato do fechamento.
  const { data: presRow } = await supabase
    .from("commercial_presentations")
    .select("summary")
    .eq("client_id", clientId)
    .maybeSingle();

  // J3: camada ÚNICA de programas do cliente (PPR+ E Risarte Empresarial) —
  // procedimento coberto por QUALQUER programa não recebe desconto manual de
  // novo, e o selo mostra o programa certo.
  const programs = await loadClientPrograms(clientId);
  const ppr = programs.ppr?.active ? programs.ppr : null;
  const coveredProcedureIds = Object.values(programs.byProcedure)
    .filter((b) => b.available && b.benefitType !== "NOT_COVERED")
    .map((b) => b.procedureId);
  const baseRule = resolveCommercialRule(ruleRows ?? [], clinicId);
  const programConditions =
    ppr && ppr.planName
      ? {
          label: `PPR+ ${ppr.planName}`,
          cashDiscountPercent: ppr.cashDiscountPercent,
          maxInstallments: ppr.maxInstallments,
          minInstallmentCents: ppr.minInstallmentCents,
          tiers: ppr.tiers.map((t) => ({
            upToInstallments: t.upToInstallments,
            discountPercent: t.discountPercent,
          })),
          coveredProcedureIds,
        }
      : programs.active
        ? {
            // Empresarial: benefício é POR PROCEDIMENTO (sem condições próprias
            // de parcelamento) — o teto/parcelas seguem a regra da unidade.
            label: programs.label ?? "Risarte Empresarial",
            cashDiscountPercent: 0,
            maxInstallments: 0,
            minInstallmentCents: 0,
            tiers: [] as { upToInstallments: number; discountPercent: number }[],
            coveredProcedureIds,
          }
        : null;

  return {
    planId,
    options,
    negotiation,
    // O PPR+ fica ACIMA da regra da rede/unidade (docs/PPR.md §7).
    rule: ppr
      ? {
          // I8: mantém os demais campos da regra (desconto à vista, parcela
          // mínima por meio) — o programa só AMPLIA teto e parcelas.
          ...baseRule,
          maxDiscountPercent: Math.max(
            baseRule.maxDiscountPercent ?? 0,
            ppr.cashDiscountPercent,
            ...ppr.tiers.map((t) => t.discountPercent)
          ),
          maxInstallments: Math.max(
            baseRule.maxInstallments ?? 1,
            ppr.maxInstallments
          ),
        }
      : baseRule,
    planEvents,
    sale,
    excludedDescriptions,
    presentationSummary: (presRow?.summary as string | null) ?? null,
    programConditions,
  };
}
