import type { Metadata } from "next";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CommercialRulesEditor, type RuleRowUi } from "./rules-editor";
import {
  FollowupCadenceEditor,
  type FollowupRowUi,
} from "./followup-editor";

export const metadata: Metadata = { title: "Regras Comerciais" };

export default async function CommercialRulesPage() {
  await requireAdminMaster();
  const supabase = await createClient();

  const [{ data: rows }, { data: followup }, { data: clinics }] =
    await Promise.all([
      supabase
        .from("commercial_rules")
        .select("id, clinic_id, max_discount_percent, max_installments, allowed_methods")
        .returns<RuleRowUi[]>(),
      supabase
        .from("commercial_followup_settings")
        .select("id, clinic_id, max_attempts, interval_days, max_days")
        .returns<FollowupRowUi[]>(),
      supabase
        .from("clinics")
        .select("id, name")
        .eq("type", "franchise_unit")
        .eq("is_active", true)
        .order("name"),
    ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Regras Comerciais
        </h1>
        <p className="text-sm text-muted-foreground">
          Limites que o Consultor Comercial pratica na negociação: desconto
          máximo, parcelamento e meios de pagamento. Negociação fora da regra
          exige autorização do Gerente da unidade.
        </p>
      </div>
      <CommercialRulesEditor rows={rows ?? []} clinics={clinics ?? []} />

      <div className="border-t pt-6">
        <FollowupCadenceEditor
          rows={followup ?? []}
          clinics={clinics ?? []}
        />
      </div>
    </div>
  );
}
