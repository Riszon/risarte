import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Settings } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigurePpr } from "@/lib/ppr/access";
import { Button } from "@/components/ui/button";
import { PprPlansList, type PprPlanRow } from "./plans-list";
import { PprSettingsEditor, type PprSettingsRow } from "./settings-editor";

export const metadata: Metadata = { title: "Configurar o PPR+" };

export default async function PprConfigPage() {
  const session = await getSessionContext();
  if (!canConfigurePpr(session)) redirect("/ppr");

  const supabase = await createClient();
  const [{ data: planRows }, { data: settingRows }, { data: clinicRows }] =
    await Promise.all([
      supabase
        .from("ppr_plans")
        .select(
          "id, name, description, monthly_cents, allows_dependents, included_dependents, allows_extra_dependents, extra_dependent_cents, max_dependents, cash_discount_percent, max_installments, min_installment_cents, is_active, sort_order, social_enabled"
        )
        .order("sort_order"),
      supabase
        .from("ppr_settings")
        .select("id, clinic_id, suspend_after_days, cancel_after_days"),
      supabase
        .from("clinics")
        .select("id, name")
        .eq("type", "franchise_unit")
        .eq("is_active", true)
        .order("name"),
    ]);

  const plans = (planRows ?? []) as PprPlanRow[];
  const settings = (settingRows ?? []) as PprSettingsRow[];
  const clinics = (clinicRows ?? []) as { id: string; name: string }[];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <Settings className="size-3.5" />
            PPR+
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Configurar o programa
          </h1>
          <p className="text-sm text-muted-foreground">
            Planos, valores, vantagens, benefícios por procedimento e regras de
            pagamento. Os valores valem para toda a rede.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/ppr" />}
        >
          <ArrowLeft className="mr-1 size-3.5" />
          Voltar ao programa
        </Button>
      </div>

      <PprPlansList plans={plans} />

      <PprSettingsEditor rows={settings} clinics={clinics} />
    </div>
  );
}
