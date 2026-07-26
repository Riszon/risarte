import "server-only";
import { createClient } from "@/lib/supabase/server";
import { benefitAvailability, type PprInstallmentTier, type PprPlan } from "./rules";
import type { PprStatus } from "./constants";

/**
 * Benefício do PPR+ já resolvido para um procedimento. O vocabulário
 * (FREE/DISCOUNT_PERCENT) é o mesmo do Risarte Empresarial de propósito: assim
 * os dois programas passam pelo MESMO caminho no orçamento e na venda direta.
 */
export type PprProgramBenefit = {
  procedureId: string;
  benefitType: "FREE" | "DISCOUNT_PERCENT";
  benefitValue: number | null;
  available: boolean;
  blockedReason: string | null;
  /** Brinde entregue junto (ex.: escova a cada limpeza). */
  giftLabel: string | null;
  /** Quando libera de novo (frequência do plano). */
  nextAvailableAt: string | null;
  benefitId: string;
  frequencyMonths: number | null;
};

export type PprProgram = {
  active: boolean;
  membershipId: string | null;
  beneficiaryId: string | null;
  planId: string | null;
  planName: string | null;
  status: PprStatus | null;
  /** Unidade dona do plano (o beneficiário usa em qualquer unidade da rede). */
  clinicId: string | null;
  /** Condições de pagamento do plano — ficam ACIMA da regra da rede/unidade. */
  cashDiscountPercent: number;
  maxInstallments: number;
  minInstallmentCents: number;
  allowedMethods: string[] | null;
  tiers: PprInstallmentTier[];
  byProcedure: Record<string, PprProgramBenefit>;
};

const EMPTY: PprProgram = {
  active: false,
  membershipId: null,
  beneficiaryId: null,
  planId: null,
  planName: null,
  status: null,
  clinicId: null,
  cashDiscountPercent: 0,
  maxInstallments: 1,
  minInstallmentCents: 0,
  allowedMethods: null,
  tiers: [],
  byProcedure: {},
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** Condições de pagamento do plano — o que amplia a regra da unidade. */
export type PprConditions = {
  cashDiscountPercent: number;
  maxInstallments: number;
  allowedMethods: string[] | null;
  tiers: PprInstallmentTier[];
};

/**
 * Condições do PPR+ de VÁRIOS clientes de uma vez (listas de venda direta).
 * Só entra quem tem plano ATIVO — plano suspenso não amplia nada.
 */
export async function loadPprConditionsForClients(
  clientIds: string[]
): Promise<Map<string, PprConditions>> {
  const out = new Map<string, PprConditions>();
  const ids = [...new Set(clientIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("ppr_beneficiaries")
    .select(
      "client_id, left_at, membership:ppr_memberships ( status, plan:ppr_plans ( id, cash_discount_percent, max_installments, allowed_methods ) )"
    )
    .in("client_id", ids)
    .is("left_at", null);

  type PlanEmbed = {
    id: string;
    cash_discount_percent: number;
    max_installments: number;
    allowed_methods: string[] | null;
  };
  const byClientPlan = new Map<string, PlanEmbed>();
  for (const r of (rows ?? []) as {
    client_id: string;
    membership:
      | { status: string; plan: PlanEmbed | PlanEmbed[] | null }
      | { status: string; plan: PlanEmbed | PlanEmbed[] | null }[]
      | null;
  }[]) {
    const m = one(r.membership);
    if (!m || m.status !== "ativo") continue;
    const plan = one(m.plan);
    if (plan) byClientPlan.set(r.client_id, plan);
  }
  if (byClientPlan.size === 0) return out;

  const planIds = [...new Set([...byClientPlan.values()].map((p) => p.id))];
  const { data: tierRows } = await supabase
    .from("ppr_plan_installment_tiers")
    .select("plan_id, up_to_installments, discount_percent")
    .in("plan_id", planIds);
  const tiersByPlan = new Map<string, PprInstallmentTier[]>();
  for (const t of (tierRows ?? []) as {
    plan_id: string;
    up_to_installments: number;
    discount_percent: number;
  }[]) {
    const list = tiersByPlan.get(t.plan_id) ?? [];
    list.push({
      upToInstallments: t.up_to_installments,
      discountPercent: Number(t.discount_percent),
    });
    tiersByPlan.set(t.plan_id, list);
  }

  for (const [clientId, plan] of byClientPlan) {
    out.set(clientId, {
      cashDiscountPercent: Number(plan.cash_discount_percent ?? 0),
      maxInstallments: Number(plan.max_installments ?? 1),
      allowedMethods: plan.allowed_methods ?? null,
      tiers: tiersByPlan.get(plan.id) ?? [],
    });
  }
  return out;
}

/**
 * Resolve o PPR+ do cliente: plano, condições de pagamento e o benefício de
 * cada procedimento, já com carência (da ativação) e frequência (do último
 * uso) aplicadas. Vale em qualquer unidade da rede.
 */
export async function loadPprProgram(clientId: string): Promise<PprProgram> {
  const supabase = await createClient();

  const { data: benRow } = await supabase
    .from("ppr_beneficiaries")
    .select(
      "id, membership_id, left_at, membership:ppr_memberships ( id, status, clinic_id, activated_at, plan_id )"
    )
    .eq("client_id", clientId)
    .is("left_at", null)
    .limit(5);

  type MembershipEmbed = {
    id: string;
    status: string;
    clinic_id: string;
    activated_at: string | null;
    plan_id: string;
  };
  type Row = {
    id: string;
    membership_id: string;
    membership: MembershipEmbed | MembershipEmbed[] | null;
  };
  let live: { row: Row; m: MembershipEmbed } | null = null;
  for (const r of (benRow ?? []) as Row[]) {
    const m = one(r.membership);
    if (!m || m.status === "cancelado") continue;
    live = { row: r, m };
    break;
  }
  if (!live) return EMPTY;

  const { data: planRow } = await supabase
    .from("ppr_plans")
    .select(
      "id, name, cash_discount_percent, max_installments, min_installment_cents, allowed_methods, grace_period_days"
    )
    .eq("id", live.m.plan_id)
    .maybeSingle();
  if (!planRow) return EMPTY;

  const [{ data: tierRows }, { data: benefitRows }, { data: usageRows }] =
    await Promise.all([
      supabase
        .from("ppr_plan_installment_tiers")
        .select("up_to_installments, discount_percent")
        .eq("plan_id", live.m.plan_id)
        .order("up_to_installments"),
      supabase
        .from("ppr_plan_benefits")
        .select(
          "id, procedure_id, specialty, benefit_type, benefit_value, grace_period_days, frequency_months, gift_label"
        )
        .eq("plan_id", live.m.plan_id),
      supabase
        .from("ppr_benefit_usages")
        .select("procedure_id, used_at")
        .eq("client_id", clientId)
        .order("used_at", { ascending: false }),
    ]);

  type BenefitRow = {
    id: string;
    procedure_id: string | null;
    specialty: string | null;
    benefit_type: "free" | "percent" | "none";
    benefit_value: number | null;
    grace_period_days: number;
    frequency_months: number | null;
    gift_label: string | null;
  };
  const benefits = (benefitRows ?? []) as BenefitRow[];

  // Benefício por especialidade vale para todos os procedimentos dela.
  const specialties = [
    ...new Set(
      benefits
        .filter((b) => !b.procedure_id && b.specialty)
        .map((b) => b.specialty as string)
    ),
  ];
  const bySpecialtyProcedures = new Map<string, string[]>();
  if (specialties.length > 0) {
    const { data: procRows } = await supabase
      .from("procedures")
      .select("id, specialty")
      .in("specialty", specialties);
    for (const p of (procRows ?? []) as { id: string; specialty: string }[]) {
      const list = bySpecialtyProcedures.get(p.specialty) ?? [];
      list.push(p.id);
      bySpecialtyProcedures.set(p.specialty, list);
    }
  }

  const lastUse = new Map<string, string>();
  for (const u of (usageRows ?? []) as {
    procedure_id: string | null;
    used_at: string;
  }[]) {
    if (u.procedure_id && !lastUse.has(u.procedure_id))
      lastUse.set(u.procedure_id, u.used_at);
  }

  const plan: PprPlan = {
    id: planRow.id as string,
    name: planRow.name as string,
    monthlyCents: 0,
    allowsDependents: false,
    includedDependents: 0,
    allowsExtraDependents: false,
    extraDependentCents: 0,
    maxDependents: 0,
    cashDiscountPercent: Number(planRow.cash_discount_percent ?? 0),
    maxInstallments: Number(planRow.max_installments ?? 1),
    minInstallmentCents: Number(planRow.min_installment_cents ?? 0),
    gracePeriodDays: Number(planRow.grace_period_days ?? 0),
    socialEnabled: false,
    socialPointsPerCents: 5000,
  };
  const status = live.m.status as PprStatus;
  const activatedAt = live.m.activated_at ? new Date(live.m.activated_at) : null;

  const byProcedure: Record<string, PprProgramBenefit> = {};
  const push = (procedureId: string, b: BenefitRow) => {
    if (b.benefit_type === "none") return;
    // Benefício direto no procedimento vence o da especialidade.
    const existing = byProcedure[procedureId];
    if (existing && b.specialty && !b.procedure_id) return;

    const lastUsed = lastUse.get(procedureId) ?? null;
    const avail = benefitAvailability({
      status,
      plan,
      benefit: {
        benefitType: b.benefit_type,
        benefitValue: b.benefit_value,
        gracePeriodDays: b.grace_period_days,
        frequencyMonths: b.frequency_months,
        giftLabel: b.gift_label,
      },
      activatedAt,
      lastUsedAt: lastUsed ? new Date(lastUsed) : null,
    });
    byProcedure[procedureId] = {
      procedureId,
      benefitType: b.benefit_type === "free" ? "FREE" : "DISCOUNT_PERCENT",
      benefitValue: b.benefit_type === "free" ? null : (b.benefit_value ?? 0),
      available: avail.available,
      blockedReason: avail.reason,
      giftLabel: b.gift_label,
      nextAvailableAt: avail.availableFrom
        ? avail.availableFrom.toISOString()
        : null,
      benefitId: b.id,
      frequencyMonths: b.frequency_months,
    };
  };

  // Primeiro as especialidades, depois os procedimentos (que sobrescrevem).
  for (const b of benefits.filter((x) => !x.procedure_id && x.specialty)) {
    for (const pid of bySpecialtyProcedures.get(b.specialty as string) ?? [])
      push(pid, b);
  }
  for (const b of benefits.filter((x) => x.procedure_id)) {
    push(b.procedure_id as string, b);
  }

  return {
    active: status === "ativo",
    membershipId: live.m.id,
    beneficiaryId: live.row.id,
    planId: plan.id,
    planName: plan.name,
    status,
    clinicId: live.m.clinic_id,
    cashDiscountPercent: plan.cashDiscountPercent,
    maxInstallments: plan.maxInstallments,
    minInstallmentCents: plan.minInstallmentCents,
    allowedMethods: (planRow.allowed_methods as string[] | null) ?? null,
    tiers: ((tierRows ?? []) as {
      up_to_installments: number;
      discount_percent: number;
    }[]).map((t) => ({
      upToInstallments: t.up_to_installments,
      discountPercent: Number(t.discount_percent),
    })),
    byProcedure,
  };
}
