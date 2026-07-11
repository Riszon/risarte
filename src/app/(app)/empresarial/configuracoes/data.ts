import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { empresarialDb } from "@/lib/empresarial/db";
import {
  DEFAULT_ADHESION_PRICING,
  DEFAULT_SPLIT_RULES,
  type AdhesionPricing,
  type SplitRules,
} from "@/lib/empresarial/pricing";
import type { BenefitType } from "@/lib/empresarial/constants";
import type { BenefitView } from "./benefits-editor";

type Db = Awaited<ReturnType<typeof empresarialDb>>;

export async function loadPricing(
  db: Db,
  companyId: string | null
): Promise<{ pricing: AdhesionPricing; hasOverride: boolean }> {
  let q = db
    .from("adhesion_pricing")
    .select(
      "holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents, max_installments"
    );
  q = companyId === null ? q.is("company_id", null) : q.eq("company_id", companyId);
  const { data } = await q.maybeSingle();
  if (!data) return { pricing: DEFAULT_ADHESION_PRICING, hasOverride: false };
  return {
    hasOverride: true,
    pricing: {
      holderFeeCents: data.holder_fee_cents,
      dependentIndividualFeeCents: data.dependent_individual_fee_cents,
      dependentFamilyFeeCents: data.dependent_family_fee_cents,
      dependentFamilyExtraFeeCents: data.dependent_family_extra_fee_cents,
      maxInstallments: data.max_installments,
    },
  };
}

export async function loadSplit(
  db: Db,
  companyId: string | null
): Promise<{ split: SplitRules; hasOverride: boolean }> {
  let q = db
    .from("split_rules")
    .select(
      "first_payment_risarte_pct, first_payment_rislife_pct, recurring_risarte_pct, recurring_rislife_pct"
    );
  q = companyId === null ? q.is("company_id", null) : q.eq("company_id", companyId);
  const { data } = await q.maybeSingle();
  if (!data) return { split: DEFAULT_SPLIT_RULES, hasOverride: false };
  return {
    hasOverride: true,
    split: {
      firstPaymentRisartePct: Number(data.first_payment_risarte_pct),
      firstPaymentRislifePct: Number(data.first_payment_rislife_pct),
      recurringRisartePct: Number(data.recurring_risarte_pct),
      recurringRislifePct: Number(data.recurring_rislife_pct),
    },
  };
}

export async function loadBenefits(
  db: Db,
  companyId: string | null,
  procedureNames: Map<string, string>
): Promise<BenefitView[]> {
  let q = db
    .from("procedure_benefits")
    .select(
      "id, procedure_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months, max_installments"
    );
  q = companyId === null ? q.is("company_id", null) : q.eq("company_id", companyId);
  const { data } = await q.returns<
    {
      id: string;
      procedure_id: string;
      benefit_type: BenefitType;
      benefit_value: number | null;
      usage_limit_count: number | null;
      usage_period_months: number | null;
      grace_period_months: number;
      max_installments: number | null;
    }[]
  >();
  return (data ?? [])
    .map((b) => ({
      id: b.id,
      procedureId: b.procedure_id,
      procedureName: procedureNames.get(b.procedure_id) ?? "(procedimento)",
      benefitType: b.benefit_type,
      benefitValue: b.benefit_value,
      usageLimitCount: b.usage_limit_count,
      usagePeriodMonths: b.usage_period_months,
      gracePeriodMonths: b.grace_period_months,
      maxInstallments: b.max_installments,
    }))
    .sort((a, b) => a.procedureName.localeCompare(b.procedureName, "pt-BR"));
}

export async function loadProcedures(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("procedures")
    .select("id, name")
    .eq("is_active", true)
    .order("name")
    .returns<{ id: string; name: string }[]>();
  return data ?? [];
}
