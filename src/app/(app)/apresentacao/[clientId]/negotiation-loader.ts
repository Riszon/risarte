import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  resolveCommercialRule,
  ruleWithProgramConditions,
  type CommercialRule,
  type CommercialRuleRow,
} from "@/lib/commercial";
import { effectiveRuleWithPpr } from "@/lib/ppr/rules";
import { loadEmpresarialConditions } from "@/lib/empresarial/conditions";
import type { PlanEvent } from "@/lib/planning";
import { loadClientPrograms } from "@/lib/programs";
import { applyBenefit } from "@/lib/empresarial/pricing";
import type { ScheduleEntry } from "@/lib/payments";
import { carregarOdontoDaApresentacao } from "@/lib/odontograma/carregar";
import { pacoteDosItens } from "@/lib/procedimentos/grupos-db";
import { carregarCustosDaMargem } from "@/lib/finance/custos-da-margem-db";
import type { CustosDaMargem } from "@/lib/finance/custos-da-margem";
import { planoDaNegociacao, type OdontoDaApresentacao } from "@/lib/odontograma/aceite";
import type {
  NegotiationData,
  NegotiationOption,
} from "./negotiation-panel";

export type SaleData = {
  contractSigned: boolean;
  /** 0202: cobrança gerada — informativo; quem conclui é o pagamento. */
  paymentIssued: boolean;
  paymentConfirmed: boolean;
  closedAt: string | null;
};

export type NegotiationBlock = {
  planId: string;
  options: NegotiationOption[];
  negotiation: NegotiationData | null;
  /** OD4: o desenho do aceite (nulo = não carregou; o painel segue sem ele). */
  odonto: OdontoDaApresentacao | null;
  rule: CommercialRule;
  /** Histórico do plano em negociação (para o Consultor e o Gerente). */
  planEvents: PlanEvent[];
  /** Fechamento (COM4) — existe quando a negociação foi aceita. */
  sale: SaleData | null;
  /**
   * As cobranças desta venda já receberam (ou foram renegociadas): o plano de
   * cobrança não pode mais ser reescrito. A tela precisa DIZER isso — antes o
   * consultor só descobria pelo erro ao salvar.
   */
  scheduleLocked: boolean;
  /** FIN5: repasse estimado por opção + margem mínima da unidade. */
  payoutByOption: Record<string, number>;
  minMarginPercent: number | null;
  /**
   * Os custos da unidade para a margem (pedido do dono, 27/10/2026: a mesma
   * conta da Precificação). Nulo = não deu para ler: a tela avisa.
   */
  custosDaMargem: CustosDaMargem | null;
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

  // OD4: o plano aprovado mais novo QUE VALE. Versão substituída só entra se
  // foi vendida — a negociação aberta dela a 0313 encerra ("substituída").
  const { data: planRows } = await supabase
    .from("treatment_plans")
    .select("id, created_at, superseded_at, plan_negotiations ( status )")
    .eq("client_id", clientId)
    .eq("status", "approved")
    .returns<
      {
        id: string;
        created_at: string;
        superseded_at: string | null;
        plan_negotiations: { status: string }[] | { status: string } | null;
      }[]
    >();
  const planId =
    planoDaNegociacao(
      (planRows ?? []).map((p) => {
        const n = Array.isArray(p.plan_negotiations) ? p.plan_negotiations[0] : p.plan_negotiations;
        return {
          id: p.id,
          createdAt: p.created_at,
          supersededAt: p.superseded_at,
          negociacao: n?.status ?? null,
        };
      })
    ) ?? undefined;
  if (!planId) return null;

  const [{ data: optRows }, { data: negRows }, { data: ruleRows }] =
    await Promise.all([
      // Só opções APROVADAS pelo Coordenador (secundários = carta na manga).
      supabase
        .from("treatment_plan_options")
        .select(
          "id, is_primary, title, sort_order, treatment_plan_option_items ( id, description, quantity, unit_price_cents, procedure_id, sort_order, gut_gravity, gut_urgency, gut_tendency, tooth_code, face_codes, region_code, planned_total_minutes )"
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
              tooth_code: string | null;
              face_codes: string[] | null;
              region_code: string | null;
              planned_total_minutes: number | null;
            }[];
          }[]
        >(),
      supabase
        .from("plan_negotiations")
        .select(
          "id, code, option_id, status, adjustment_cents, payment_method, installments, partial_reason, client_is_decider, decider_notes, notes, rule_violations, rule_authorized, authorization_note, final_cents, down_payment_cents, plan_negotiation_items ( item_id, included )"
        )
        .eq("plan_id", planId)
        .limit(1)
        .returns<
          {
            id: string;
            code: string | null;
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

  // J7: benefício do programa por PROCEDIMENTO (Empresarial/PPR+) aplicado aos
  // itens do orçamento — é o desconto que o cliente tem direito, e ele tem de
  // aparecer no valor (antes o plano ia cheio para a negociação).
  const [programs, empresarialConditions] = await Promise.all([
    loadClientPrograms(clientId),
    loadEmpresarialConditions(clientId),
  ]);
  const benefitFor = (procedureId: string | null, lineFull: number): number => {
    if (!procedureId) return 0;
    const b = programs.byProcedure[procedureId];
    if (!b || !b.available) return 0;
    return applyBenefit(
      { benefitType: b.benefitType, benefitValue: b.benefitValue },
      lineFull
    ).savedCents;
  };

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
        programDiscountCents: benefitFor(
          i.procedure_id ?? null,
          i.quantity * i.unit_price_cents
        ),
        gutGravity: i.gut_gravity,
        gutUrgency: i.gut_urgency,
        gutTendency: i.gut_tendency,
        toothCode: i.tooth_code ?? null,
        faceCodes: i.face_codes ?? [],
        regionCode: i.region_code ?? null,
      })),
  }));
  if (options.length === 0) return null;

  // 0326 (GP7): de que grupo veio cada item, o preço de tabela e o MÍNIMO do
  // grupo — para o painel avisar antes de salvar (quem trava é o banco). À
  // parte: sem a 0325/0326, a leitura falha e o painel segue sem o aviso.
  {
    const pacoteDe = await pacoteDosItens(
      supabase,
      options.flatMap((o) => o.items.map((i) => i.id))
    );
    const grupoIds = [...new Set([...pacoteDe.values()].map((p) => p.grupo.id))];
    const minimoDe = new Map<string, number | null>();
    if (grupoIds.length > 0) {
      const { data: minRows, error: minErro } = await supabase
        .from("procedure_groups")
        .select("id, min_price_percent")
        .in("id", grupoIds)
        .returns<{ id: string; min_price_percent: number | string | null }[]>();
      if (minErro) console.error("negotiation-loader (mínimo do pacote) failed:", minErro.message);
      for (const m of minRows ?? []) {
        minimoDe.set(m.id, m.min_price_percent === null ? null : Number(m.min_price_percent));
      }
    }
    for (const o of options) {
      for (const i of o.items) {
        const p = pacoteDe.get(i.id);
        if (!p) continue;
        i.pacote = { id: p.grupo.id, nome: p.grupo.nome, minimoPercent: minimoDe.get(p.grupo.id) ?? null };
        i.precoDeTabelaCents = p.precoDeTabelaCents;
      }
    }
  }

  // 0327: o mínimo de cada PROCEDIMENTO — para o painel avisar antes de salvar
  // (quem trava é o banco). Leitura que falha deixa o painel sem o aviso.
  {
    const procIds = [
      ...new Set(options.flatMap((o) => o.items.map((i) => i.procedureId).filter((x): x is string => Boolean(x)))),
    ];
    if (procIds.length > 0) {
      const { data: minRows, error: minErro } = await supabase
        .from("procedures")
        .select("id, name, min_price_cents")
        .in("id", procIds)
        .not("min_price_cents", "is", null)
        .returns<{ id: string; name: string; min_price_cents: number }[]>();
      if (minErro) console.error("negotiation-loader (mínimo do procedimento) failed:", minErro.message);
      const minimoDoProc = new Map((minRows ?? []).map((m) => [m.id, m]));
      for (const o of options) {
        for (const i of o.items) {
          const m = i.procedureId ? minimoDoProc.get(i.procedureId) : undefined;
          if (m) i.minimo = { id: m.id, nome: m.name, minimoCents: m.min_price_cents };
        }
      }
    }
  }

  // OD4: o desenho do aceite (o mesmo da apresentação).
  const { data: cliRow } = await supabase
    .from("clients")
    .select("birth_date")
    .eq("id", clientId)
    .maybeSingle();
  const odonto = await carregarOdontoDaApresentacao(
    clientId,
    (cliRow?.birth_date as string | null) ?? null
  );

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
        code: (n.code as string | null) ?? null,
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
      .select("contract_signed, payment_issued, payment_confirmed, closed_at")
      .eq("negotiation_id", n.id)
      .maybeSingle();
    if (saleRow) {
      sale = {
        contractSigned: saleRow.contract_signed as boolean,
        paymentIssued: Boolean(saleRow.payment_issued),
        paymentConfirmed: saleRow.payment_confirmed as boolean,
        closedAt: (saleRow.closed_at as string | null) ?? null,
      };
    }
  }

  // A cobrança já andou? Mesma condição do SCHEDULE_LOCKED no banco.
  let scheduleLocked = false;
  if (n) {
    const { data: instRows } = await supabase
      .from("payment_installments")
      .select("id, status, paid_amount_cents")
      .eq("negotiation_id", n.id);
    scheduleLocked = (instRows ?? []).some(
      (i) =>
        ["paga", "parcial", "renegociada"].includes(i.status as string) ||
        Number(i.paid_amount_cents ?? 0) > 0
    );
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
            // Empresarial: o desconto é POR PROCEDIMENTO (não há faixas de
            // parcelamento), mas a empresa parceira define formas de pagamento
            // e parcelamento próprios (J5).
            label: programs.label ?? "Risarte Empresarial",
            cashDiscountPercent: 0,
            maxInstallments: empresarialConditions?.maxInstallments ?? 0,
            minInstallmentCents: 0,
            tiers: [] as { upToInstallments: number; discountPercent: number }[],
            coveredProcedureIds,
          }
        : null;

  // FIN5: quanto cada opção custa em repasse — base do alerta de margem.
  const payoutByOption: Record<string, number> = {};
  for (const o of options) {
    const { data } = await supabase.rpc("estimated_option_payout", {
      p_option_id: o.id,
      p_clinic_id: clinicId,
    });
    payoutByOption[o.id] = Number(data ?? 0);
  }
  const { data: minMargin } = await supabase.rpc("min_margin_percent", {
    p_clinic: clinicId,
  });

  // A margem com os custos da Precificação: cadeira (minutos planejados do
  // item; sem eles, os do cadastro × quantidade), material e laboratório.
  const custosDaMargem = await carregarCustosDaMargem(
    supabase,
    clinicId,
    (optRows ?? []).flatMap((o) =>
      (o.treatment_plan_option_items ?? []).map((i) => ({
        itemId: i.id,
        procedureId: i.procedure_id,
        quantidade: i.quantity,
        minutosPlanejados: i.planned_total_minutes,
      }))
    )
  );

  return {
    planId,
    options,
    negotiation,
    odonto,
    payoutByOption,
    minMarginPercent: minMargin === null ? null : Number(minMargin),
    custosDaMargem,
    // J4b/J5: MESMA regra da venda direta — o PPR+ amplia teto/parcelas e as
    // formas de pagamento pelo plano, e o Empresarial pela condição da empresa
    // parceira (boleto + parcelamento próprio).
    rule: ruleWithProgramConditions(
      effectiveRuleWithPpr(
        baseRule,
        ppr
          ? {
              cashDiscountPercent: ppr.cashDiscountPercent,
              maxInstallments: ppr.maxInstallments,
              allowedMethods: ppr.allowedMethods,
              tiers: ppr.tiers,
            }
          : null
      ),
      empresarialConditions
    ),
    planEvents,
    sale,
    scheduleLocked,
    excludedDescriptions,
    presentationSummary: (presRow?.summary as string | null) ?? null,
    programConditions,
  };
}
