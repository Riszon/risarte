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

  const [{ data: rows }, { data: followup }, { data: clinics }, validade] =
    await Promise.all([
      supabase
        .from("commercial_rules")
        .select("id, clinic_id, max_discount_percent, max_installments, allowed_methods, cash_discount_percent, min_installment_cents_by_method")
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
      // OD4 (G2): consulta à parte — antes da 0313 a coluna não existe e a
      // tela segue funcionando, só sem o campo da validade.
      supabase
        .from("commercial_rules")
        .select("clinic_id, budget_validity_days")
        .returns<{ clinic_id: string | null; budget_validity_days: number | null }[]>(),
    ]);
  const validadePronta = !validade.error;
  const comValidade: RuleRowUi[] = (rows ?? []).map((r) => ({
    ...r,
    budget_validity_days:
      validade.data?.find((v) => v.clinic_id === r.clinic_id)?.budget_validity_days ?? null,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Regras Comerciais
        </h1>
        <p className="text-sm text-muted-foreground">
          Limites que o Consultor Comercial pratica na negociação: desconto
          máximo, parcelamento e meios de pagamento. Negociação fora da regra
          exige autorização do Gerente da unidade. Aqui também fica a
          validade do orçamento impresso.
        </p>
      </div>
      <CommercialRulesEditor
        rows={comValidade}
        clinics={clinics ?? []}
        validadePronta={validadePronta}
      />

      <div className="border-t pt-6">
        <FollowupCadenceEditor
          rows={followup ?? []}
          clinics={clinics ?? []}
        />
      </div>
    </div>
  );
}
