import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigurePpr } from "@/lib/ppr/access";
import { Button } from "@/components/ui/button";
import { PprPlanForm, type PprPlanFull } from "./plan-form";
import { PprPerksEditor, type PprPerkRow } from "./perks-editor";
import { PprTiersEditor, type PprTierRow } from "./tiers-editor";
import { PprBenefitsEditor, type PprBenefitRow } from "./benefits-editor";

export const metadata: Metadata = { title: "Plano do PPR+" };

export default async function PprPlanConfigPage(
  props: PageProps<"/ppr/configuracao/[planId]">
) {
  const session = await getSessionContext();
  if (!canConfigurePpr(session)) redirect("/ppr");
  const { planId } = await props.params;

  const supabase = await createClient();
  const [
    { data: plan },
    { data: perkRows },
    { data: tierRows },
    { data: benefitRows },
    { data: procRows },
  ] = await Promise.all([
    supabase.from("ppr_plans").select("*").eq("id", planId).maybeSingle(),
    supabase
      .from("ppr_plan_perks")
      .select("id, label, sort_order")
      .eq("plan_id", planId)
      .order("sort_order"),
    supabase
      .from("ppr_plan_installment_tiers")
      .select("id, up_to_installments, discount_percent")
      .eq("plan_id", planId)
      .order("up_to_installments"),
    supabase
      .from("ppr_plan_benefits")
      .select(
        "id, procedure_id, specialty, benefit_type, benefit_value, grace_period_days, frequency_months, usage_limit_count, usage_period_months, gift_label"
      )
      .eq("plan_id", planId),
    supabase
      .from("procedures")
      .select("id, name, specialty")
      .eq("is_active", true)
      .order("name"),
  ]);

  if (!plan) notFound();

  const procedures = (procRows ?? []) as {
    id: string;
    name: string;
    specialty: string | null;
  }[];
  const specialties = [
    ...new Set(
      procedures.map((p) => p.specialty).filter((s): s is string => Boolean(s))
    ),
  ].sort();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            PPR+ · configuração do plano
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {plan.name as string}
          </h1>
        </div>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/ppr/configuracao" />}
        >
          <ArrowLeft className="mr-1 size-3.5" />
          Todos os planos
        </Button>
      </div>

      <PprPlanForm plan={plan as unknown as PprPlanFull} />
      <PprPerksEditor planId={planId} perks={(perkRows ?? []) as PprPerkRow[]} />
      <PprTiersEditor planId={planId} tiers={(tierRows ?? []) as PprTierRow[]} />
      <PprBenefitsEditor
        planId={planId}
        benefits={(benefitRows ?? []) as PprBenefitRow[]}
        procedures={procedures}
        specialties={specialties}
      />
    </div>
  );
}
