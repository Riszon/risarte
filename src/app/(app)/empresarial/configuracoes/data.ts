import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { empresarialDb } from "@/lib/empresarial/db";
import {
  DEFAULT_ADHESION_PRICING,
  DEFAULT_SPLIT_RULES,
  ADHESION_PRICING_COLUMNS,
  pricingFromRow,
  type AdhesionPricingRow,
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
  // A peça única de leitura do preço (1032): esta era a oitava cópia, e a aba
  // Plano & Benefícios da empresa calculava a mensalidade sem o tamanho do
  // pacote nem o modo do dependente — discordando do boleto.
  let q = db.from("adhesion_pricing").select(ADHESION_PRICING_COLUMNS);
  q = companyId === null ? q.is("company_id", null) : q.eq("company_id", companyId);
  const { data } = await q.maybeSingle<AdhesionPricingRow>();
  if (!data) return { pricing: DEFAULT_ADHESION_PRICING, hasOverride: false };
  return { hasOverride: true, pricing: pricingFromRow(data) };
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

/**
 * Os procedimentos ativos, com o PREÇO PADRÃO DA REDE (o do cadastro de
 * Procedimentos) — a tela de benefícios mostra o preço normal e o preço com o
 * benefício ao lado de cada um. Nulo = sem preço cadastrado.
 */
export async function loadProcedures(): Promise<
  { id: string; name: string; priceCents: number | null; specialty: string | null }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("procedures")
    .select("id, name, default_price_cents, specialty")
    .eq("is_active", true)
    .order("name")
    .returns<
      { id: string; name: string; default_price_cents: number | null; specialty: string | null }[]
    >();
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    priceCents: p.default_price_cents != null ? Number(p.default_price_cents) : null,
    specialty: p.specialty,
  }));
}
