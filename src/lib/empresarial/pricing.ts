// Módulo Risarte Empresarial — cálculo de mensalidade e aplicação de benefício.
// Tudo em CENTAVOS inteiros. Regras: Adendo 01 + Seção 5 do briefing.
import type { BenefitType, DependentPlan } from "./constants";

export type AdhesionPricing = {
  holderFeeCents: number;
  dependentIndividualFeeCents: number;
  dependentFamilyFeeCents: number;
  dependentFamilyExtraFeeCents: number;
  maxInstallments: number;
};

export type SplitRules = {
  firstPaymentRisartePct: number;
  firstPaymentRislifePct: number;
  recurringRisartePct: number;
  recurringRislifePct: number;
};

export const DEFAULT_ADHESION_PRICING: AdhesionPricing = {
  holderFeeCents: 3990,
  dependentIndividualFeeCents: 3990,
  dependentFamilyFeeCents: 5990,
  dependentFamilyExtraFeeCents: 1990,
  maxInstallments: 24,
};

export const DEFAULT_SPLIT_RULES: SplitRules = {
  firstPaymentRisartePct: 0,
  firstPaymentRislifePct: 100,
  recurringRisartePct: 50,
  recurringRislifePct: 50,
};

/** Custo mensal do plano de dependentes de UM colaborador. */
export function dependentPlanCostCents(
  pricing: AdhesionPricing,
  plan: DependentPlan,
  activeDependentCount: number
): number {
  switch (plan) {
    case "NONE":
      return 0;
    case "INDIVIDUAL":
      return pricing.dependentIndividualFeeCents;
    case "FAMILY":
      return pricing.dependentFamilyFeeCents;
    case "FAMILY_EXTRA": {
      const extras = Math.max(0, activeDependentCount - 3);
      return (
        pricing.dependentFamilyFeeCents +
        extras * pricing.dependentFamilyExtraFeeCents
      );
    }
    default:
      return 0;
  }
}

export type MonthlyEmployee = {
  status: "ACTIVE" | "INACTIVE";
  dependentPlan: DependentPlan;
  activeDependentCount: number;
};

/**
 * Mensalidade da empresa (Seção 5.1): Σ (titular + custo do plano de dependentes)
 * de cada colaborador ATIVO. Devolve o total e o detalhamento.
 */
export function computeMonthlyCents(
  pricing: AdhesionPricing,
  employees: MonthlyEmployee[]
): {
  totalCents: number;
  holdersCount: number;
  holdersCents: number;
  dependentsCents: number;
} {
  let holdersCount = 0;
  let holdersCents = 0;
  let dependentsCents = 0;
  for (const e of employees) {
    if (e.status !== "ACTIVE") continue;
    holdersCount++;
    holdersCents += pricing.holderFeeCents;
    dependentsCents += dependentPlanCostCents(
      pricing,
      e.dependentPlan,
      e.activeDependentCount
    );
  }
  return {
    totalCents: holdersCents + dependentsCents,
    holdersCount,
    holdersCents,
    dependentsCents,
  };
}

export type ProcedureBenefit = {
  benefitType: BenefitType;
  benefitValue: number | null; // % (0-100) p/ PERCENT; centavos p/ AMOUNT
};

/**
 * Aplica o benefício a um preço cheio (centavos). Devolve quanto o cliente paga
 * e quanto economiza. NOT_COVERED = paga cheio; FREE = zero.
 */
export function applyBenefit(
  benefit: ProcedureBenefit | null,
  fullPriceCents: number
): { chargedCents: number; savedCents: number } {
  if (!benefit || benefit.benefitType === "NOT_COVERED") {
    return { chargedCents: fullPriceCents, savedCents: 0 };
  }
  if (benefit.benefitType === "FREE") {
    return { chargedCents: 0, savedCents: fullPriceCents };
  }
  if (benefit.benefitType === "DISCOUNT_PERCENT") {
    const pct = Math.min(100, Math.max(0, benefit.benefitValue ?? 0));
    const saved = Math.round((fullPriceCents * pct) / 100);
    return { chargedCents: fullPriceCents - saved, savedCents: saved };
  }
  // DISCOUNT_AMOUNT
  const saved = Math.min(fullPriceCents, Math.max(0, benefit.benefitValue ?? 0));
  return { chargedCents: fullPriceCents - saved, savedCents: saved };
}

/** Split de um valor conforme o tipo de cobrança (Seção 5.2). */
export function computeSplitCents(
  rules: SplitRules,
  amountCents: number,
  billingType: "IMPLANTATION" | "MONTHLY"
): { risarteCents: number; rislifeCents: number } {
  const risartePct =
    billingType === "IMPLANTATION"
      ? rules.firstPaymentRisartePct
      : rules.recurringRisartePct;
  const risarteCents = Math.round((amountCents * risartePct) / 100);
  return { risarteCents, rislifeCents: amountCents - risarteCents };
}
