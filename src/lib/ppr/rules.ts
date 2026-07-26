// Programa de Prevenção Riso+ (PPR+) — regras puras (sem banco, sem React).
// Dinheiro SEMPRE em centavos inteiros. Decisões do dono em docs/PPR.md §14.

import type { UserRole } from "@/lib/roles";
import {
  PPR_MANAGER_ROLES,
  PPR_SELLER_ROLES_COMERCIAL,
  PPR_SELLER_ROLES_DIRETA,
  type PprBenefitType,
  type PprChargeStatus,
  type PprSaleOrigin,
  type PprStatus,
} from "./constants";

// ---------------------------------------------------------------------------
// Formatos usados pelas regras (subconjunto das tabelas da migração 0162)
// ---------------------------------------------------------------------------

export type PprPlan = {
  id: string;
  name: string;
  monthlyCents: number;
  allowsDependents: boolean;
  includedDependents: number;
  allowsExtraDependents: boolean;
  extraDependentCents: number;
  /** null = sem limite de dependentes extras. */
  maxDependents: number | null;
  cashDiscountPercent: number;
  maxInstallments: number;
  /** Decisão 2: nenhuma parcela pode ficar abaixo deste valor. */
  minInstallmentCents: number;
  gracePeriodDays: number;
  socialEnabled: boolean;
  /** Decisão 12: 1 ponto a cada X centavos pagos. */
  socialPointsPerCents: number;
};

/** Faixa da tabela de desconto por parcelamento (decisão 3). */
export type PprInstallmentTier = {
  upToInstallments: number;
  discountPercent: number;
};

export type PprBenefit = {
  benefitType: PprBenefitType;
  benefitValue: number | null;
  gracePeriodDays: number;
  /** Libera de novo depois de N meses (limpeza a cada 4/6 meses). */
  frequencyMonths: number | null;
  giftLabel: string | null;
};

export type PprCharge = {
  dueDate: string;
  status: PprChargeStatus;
};

export type PprDelinquencySettings = {
  suspendAfterDays: number;
  cancelAfterDays: number;
};

// ---------------------------------------------------------------------------
// Quem pode o quê (decisão 10)
// ---------------------------------------------------------------------------

/**
 * Vende o PPR+: Consultor Comercial pelo fluxo comercial; Recepção, Gerente e
 * Coordenador Clínico pela venda direta. A SDR não vende.
 */
export function canSellPpr(
  roles: UserRole[],
  origin: PprSaleOrigin,
  isAdminMaster = false
): boolean {
  if (isAdminMaster) return true;
  const allowed =
    origin === "comercial"
      ? PPR_SELLER_ROLES_COMERCIAL
      : PPR_SELLER_ROLES_DIRETA;
  return roles.some((r) => allowed.includes(r));
}

/** Cancelar ou suspender uma adesão: Gerente de Unidade e Admin Master. */
export function canManagePpr(roles: UserRole[], isAdminMaster = false): boolean {
  if (isAdminMaster) return true;
  return roles.some((r) => PPR_MANAGER_ROLES.includes(r));
}

// ---------------------------------------------------------------------------
// Mensalidade e dependentes
// ---------------------------------------------------------------------------

/** Mensalidade total = valor do plano + dependentes extras (decisão 1). */
export function pprMonthlyCents(plan: PprPlan, extraDependents = 0): number {
  const extras = plan.allowsExtraDependents ? Math.max(0, extraDependents) : 0;
  return plan.monthlyCents + extras * plan.extraDependentCents;
}

/** Quantos dependentes o plano aceita ao todo (null = sem limite). */
export function maxDependentsOf(plan: PprPlan): number | null {
  if (!plan.allowsDependents) return 0;
  if (!plan.allowsExtraDependents) return plan.includedDependents;
  return plan.maxDependents;
}

/** Ainda cabe mais um dependente nesta adesão? */
export function canAddDependent(plan: PprPlan, currentCount: number): boolean {
  const max = maxDependentsOf(plan);
  if (max === null) return plan.allowsDependents;
  return currentCount < max;
}

/** Quantos dos dependentes atuais são EXTRAS (cobrados à parte). */
export function extraDependentCount(plan: PprPlan, currentCount: number): number {
  if (!plan.allowsExtraDependents) return 0;
  return Math.max(0, currentCount - plan.includedDependents);
}

// ---------------------------------------------------------------------------
// Parcelamento e descontos do programa
// ---------------------------------------------------------------------------

/**
 * Desconto do parcelado pela TABELA do plano (decisão 3): vale a menor faixa
 * que ainda comporta o número de parcelas. Sem faixa = sem desconto.
 */
export function installmentDiscountPercent(
  tiers: PprInstallmentTier[],
  installments: number
): number {
  if (installments <= 1) return 0;
  const tier = [...tiers]
    .sort((a, b) => a.upToInstallments - b.upToInstallments)
    .find((t) => installments <= t.upToInstallments);
  return tier ? tier.discountPercent : 0;
}

/**
 * Máximo de parcelas possível: o limite do plano, reduzido até que nenhuma
 * parcela fique abaixo do valor mínimo (decisão 2). Nunca menos que 1.
 */
export function maxInstallmentsFor(plan: PprPlan, totalCents: number): number {
  const limit = Math.max(1, plan.maxInstallments);
  if (plan.minInstallmentCents <= 0 || totalCents <= 0) return limit;
  const byMinimum = Math.floor(totalCents / plan.minInstallmentCents);
  return Math.max(1, Math.min(limit, byMinimum));
}

/** O parcelamento pedido cabe nas regras do plano? */
export function isInstallmentAllowed(
  plan: PprPlan,
  totalCents: number,
  installments: number
): boolean {
  if (installments < 1) return false;
  return installments <= maxInstallmentsFor(plan, totalCents);
}

export type PprPriceResult = {
  /** Preço de tabela. */
  baseCents: number;
  /** Quanto o benefício do procedimento tirou (isento ou %). */
  coverageCents: number;
  /** Quanto o desconto de pagamento (à vista ou parcelado) tirou. */
  paymentDiscountCents: number;
  /** Desconto total concedido pelo programa. */
  discountCents: number;
  finalCents: number;
  installments: number;
  installmentCents: number;
  appliedPaymentPercent: number;
};

/**
 * Preço final de um procedimento para o beneficiário: primeiro a cobertura do
 * procedimento (isento/%), depois o desconto da forma de pagamento (à vista ou
 * pela tabela de parcelas). Um benefício não anula o outro: o desconto de
 * pagamento incide sobre o que sobrou.
 */
export function pprPriceFor(opts: {
  plan: PprPlan;
  tiers: PprInstallmentTier[];
  benefit: PprBenefit | null;
  baseCents: number;
  installments?: number;
}): PprPriceResult {
  const { plan, tiers, benefit, baseCents } = opts;
  const installments = Math.max(1, opts.installments ?? 1);

  let coverageCents = 0;
  if (benefit && benefit.benefitType === "free") {
    coverageCents = baseCents;
  } else if (benefit && benefit.benefitType === "percent") {
    const pct = Math.max(0, Math.min(100, benefit.benefitValue ?? 0));
    coverageCents = Math.round((baseCents * pct) / 100);
  }
  const afterCoverage = Math.max(0, baseCents - coverageCents);

  const appliedPaymentPercent =
    installments > 1
      ? installmentDiscountPercent(tiers, installments)
      : plan.cashDiscountPercent;
  const paymentDiscountCents = Math.round(
    (afterCoverage * Math.max(0, appliedPaymentPercent)) / 100
  );
  const finalCents = Math.max(0, afterCoverage - paymentDiscountCents);

  return {
    baseCents,
    coverageCents,
    paymentDiscountCents,
    discountCents: coverageCents + paymentDiscountCents,
    finalCents,
    installments,
    installmentCents:
      installments > 1 ? Math.round(finalCents / installments) : finalCents,
    appliedPaymentPercent,
  };
}

// ---------------------------------------------------------------------------
// O plano vence a regra comercial da rede/unidade
// ---------------------------------------------------------------------------

/** Regra comercial no formato usado pela rede/unidade (src/lib/commercial). */
export type PlainCommercialRule = {
  maxDiscountPercent: number | null;
  maxInstallments: number | null;
  /** null = todas as formas liberadas. */
  allowedMethods: string[] | null;
};

/** Condições do plano que entram na regra (subconjunto de PprPlan + faixas). */
export type PprPlanConditions = {
  cashDiscountPercent: number;
  maxInstallments: number;
  allowedMethods: string[] | null;
  tiers: PprInstallmentTier[];
};

/**
 * Junta a regra da unidade/rede com as condições do plano do cliente. O PPR+
 * é SUPERIOR (decisão do dono, 25/07/2026): ele só amplia — mais parcelas,
 * mais formas de pagamento e um teto de desconto maior. Nunca reduz.
 */
export function effectiveRuleWithPpr(
  rule: PlainCommercialRule,
  plan: PprPlanConditions | null
): PlainCommercialRule {
  if (!plan) return rule;

  const maxInstallments = Math.max(rule.maxInstallments ?? 1, plan.maxInstallments);

  // null em qualquer um dos lados = "todas as formas"; senão, a união.
  const allowedMethods =
    rule.allowedMethods == null || plan.allowedMethods == null
      ? null
      : [...new Set([...rule.allowedMethods, ...plan.allowedMethods])];

  const planTop = Math.max(
    plan.cashDiscountPercent,
    ...plan.tiers.map((t) => t.discountPercent),
    0
  );
  const maxDiscountPercent =
    rule.maxDiscountPercent == null
      ? null
      : Math.max(rule.maxDiscountPercent, planTop);

  return { maxDiscountPercent, maxInstallments, allowedMethods };
}

/**
 * Base do desconto de pagamento: procedimento que JÁ recebe benefício do plano
 * não ganha desconto de novo (decisão do dono). Sobra só o que está sem
 * cobertura.
 */
export function discountableCents(
  items: { finalCents: number; programDiscountCents: number }[]
): number {
  return items
    .filter((i) => i.programDiscountCents <= 0)
    .reduce((s, i) => s + i.finalCents, 0);
}

// ---------------------------------------------------------------------------
// Carência, frequência e liberação do benefício
// ---------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Quando o benefício libera de novo depois de usado (ex.: limpeza + 4 meses). */
export function nextAvailableAt(
  usedAt: Date,
  frequencyMonths: number | null
): Date | null {
  if (!frequencyMonths || frequencyMonths <= 0) return null;
  return addMonths(usedAt, frequencyMonths);
}

export type PprAvailability = {
  available: boolean;
  reason: string | null;
  availableFrom: Date | null;
};

/**
 * O beneficiário pode usar este benefício agora? Considera a situação da
 * adesão, a carência (contada da ATIVAÇÃO — decisão 5) e a frequência do
 * benefício a partir do último uso.
 */
export function benefitAvailability(opts: {
  status: PprStatus;
  plan: PprPlan;
  benefit: PprBenefit | null;
  activatedAt: Date | null;
  lastUsedAt: Date | null;
  now?: Date;
}): PprAvailability {
  const now = opts.now ?? new Date();
  const { status, plan, benefit, activatedAt, lastUsedAt } = opts;

  if (status === "cancelado")
    return { available: false, reason: "Plano cancelado.", availableFrom: null };
  if (status === "suspenso")
    return {
      available: false,
      reason: "Plano suspenso por falta de pagamento.",
      availableFrom: null,
    };
  if (status === "aguardando_ativacao" || !activatedAt)
    return {
      available: false,
      reason: "Plano aguardando contrato assinado e primeira mensalidade.",
      availableFrom: null,
    };
  if (!benefit || benefit.benefitType === "none")
    return {
      available: false,
      reason: "Procedimento sem benefício neste plano.",
      availableFrom: null,
    };

  const graceDays = Math.max(plan.gracePeriodDays, benefit.gracePeriodDays);
  const graceEnd = addDays(activatedAt, graceDays);
  if (graceDays > 0 && now < graceEnd) {
    return {
      available: false,
      reason: `Em carência até ${graceEnd.toLocaleDateString("pt-BR")}.`,
      availableFrom: graceEnd,
    };
  }

  if (lastUsedAt) {
    const next = nextAvailableAt(lastUsedAt, benefit.frequencyMonths);
    if (next && now < next) {
      return {
        available: false,
        reason: `Já utilizado. Libera em ${next.toLocaleDateString("pt-BR")}.`,
        availableFrom: next,
      };
    }
  }

  return { available: true, reason: null, availableFrom: null };
}

// ---------------------------------------------------------------------------
// Inadimplência (decisão 6) e pontos do Riso+ Social (decisão 12)
// ---------------------------------------------------------------------------

/** Dias de atraso da mensalidade mais antiga ainda não paga (0 = em dia). */
export function daysOverdue(charges: PprCharge[], now = new Date()): number {
  const open = charges.filter(
    (c) => c.status === "em_aberto" || c.status === "atrasada"
  );
  let worst = 0;
  for (const c of open) {
    const due = new Date(`${c.dueDate}T00:00:00`);
    const diff = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
    if (diff > worst) worst = diff;
  }
  return Math.max(0, worst);
}

/**
 * Situação que a adesão DEVERIA ter pelas mensalidades: 30 dias de atraso
 * suspende, 90 cancela. Adesão ainda não ativada não muda por aqui.
 */
export function statusFromCharges(opts: {
  current: PprStatus;
  charges: PprCharge[];
  settings: PprDelinquencySettings;
  now?: Date;
}): PprStatus {
  const { current, charges, settings } = opts;
  if (current === "aguardando_ativacao" || current === "cancelado")
    return current;
  const overdue = daysOverdue(charges, opts.now);
  if (settings.cancelAfterDays > 0 && overdue >= settings.cancelAfterDays)
    return "cancelado";
  if (settings.suspendAfterDays > 0 && overdue >= settings.suspendAfterDays)
    return "suspenso";
  return "ativo";
}

/** Pontos do Riso+ Social gerados por um pagamento (Light não pontua). */
export function socialPointsFor(plan: PprPlan, paidCents: number): number {
  if (!plan.socialEnabled || paidCents <= 0) return 0;
  const per = Math.max(1, plan.socialPointsPerCents);
  return Math.floor(paidCents / per);
}

// ---------------------------------------------------------------------------
// Convivência com o Risarte Empresarial (decisão 4)
// ---------------------------------------------------------------------------

export type ProgramOffer = {
  program: "ppr" | "empresarial";
  benefitType: PprBenefitType;
  benefitValue: number | null;
};

/** Quanto (%) uma oferta representa de desconto — isento vale 100%. */
export function offerPercent(offer: ProgramOffer | null): number {
  if (!offer || offer.benefitType === "none") return 0;
  if (offer.benefitType === "free") return 100;
  return Math.max(0, Math.min(100, offer.benefitValue ?? 0));
}

/**
 * Cliente nos dois programas: vale o MELHOR benefício para ele, procedimento a
 * procedimento. Nunca soma os dois (decisão 4). Empate = PPR+ (é o programa
 * que ele paga do próprio bolso).
 */
export function bestProgramOffer(
  ppr: ProgramOffer | null,
  empresarial: ProgramOffer | null
): ProgramOffer | null {
  const a = offerPercent(ppr);
  const b = offerPercent(empresarial);
  if (a === 0 && b === 0) return ppr ?? empresarial;
  return a >= b ? ppr : empresarial;
}
