import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/commercial";
import { formatBRL } from "@/lib/pricing";
import { FollowupCadenceEditor, type FollowupRowUi } from "../admin/regras-comerciais/followup-editor";
import { CommercialRulesEditor, type RuleRowUi } from "../admin/regras-comerciais/rules-editor";

/**
 * A ABA COMERCIAL (ASA1, entrega 1), nos dois níveis. Era Administração ›
 * Regras Comerciais: as tabelas (`commercial_rules`,
 * `commercial_followup_settings`) e quem grava (só o Admin Master) são os
 * mesmos. A herança campo a campo já existia: campo vazio na unidade segue a
 * rede.
 *
 * As condições dos PROGRAMAS (PPR+ e Empresarial) aparecem só para leitura,
 * com o caminho de onde se editam hoje. Movê-las para cá fica para depois (a
 * do Empresarial é da ASA5).
 */

async function lerRegras(supabase: SupabaseClient) {
  const [{ data: rows }, { data: followup }, validade] = await Promise.all([
    supabase
      .from("commercial_rules")
      .select("id, clinic_id, max_discount_percent, max_installments, allowed_methods, cash_discount_percent, min_installment_cents_by_method")
      .returns<RuleRowUi[]>(),
    supabase
      .from("commercial_followup_settings")
      .select("id, clinic_id, max_attempts, interval_days, max_days")
      .returns<FollowupRowUi[]>(),
    supabase
      .from("commercial_rules")
      .select("clinic_id, budget_validity_days")
      .returns<{ clinic_id: string | null; budget_validity_days: number | null }[]>(),
  ]);
  const comValidade: RuleRowUi[] = (rows ?? []).map((r) => ({
    ...r,
    budget_validity_days: validade.data?.find((v) => v.clinic_id === r.clinic_id)?.budget_validity_days ?? null,
  }));
  return { regras: comValidade, cadencia: followup ?? [], validadePronta: !validade.error };
}

type Plano = {
  id: string;
  name: string;
  cash_discount_percent: number | null;
  max_installments: number | null;
  min_installment_cents: number | null;
  allowed_methods: string[] | null;
  is_active?: boolean | null;
};

async function CondicoesDosProgramas({ supabase }: { supabase: SupabaseClient }) {
  const { data: planos } = await supabase
    .from("ppr_plans")
    .select("id, name, cash_discount_percent, max_installments, min_installment_cents, allowed_methods")
    .order("name")
    .returns<Plano[]>();
  const metodos = (lista: string[] | null) =>
    lista && lista.length > 0
      ? lista.map((m) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m).join(", ")
      : "os da regra da rede";
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Condições dos programas (só leitura)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Os programas podem ampliar a regra acima para o cliente que participa deles. Estas condições ainda se editam
          na tela de cada programa.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="font-medium">PPR+</p>
          {(planos ?? []).length === 0 ? (
            <p className="text-muted-foreground">Nenhum plano cadastrado (ou sem acesso a ler).</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {(planos ?? []).map((p) => (
                <li key={p.id} className="text-muted-foreground">
                  <span className="text-foreground">{p.name}</span>: até {p.max_installments ?? 1}x
                  {p.min_installment_cents ? `, parcela mínima ${formatBRL(p.min_installment_cents)}` : ""}
                  {p.cash_discount_percent ? `, ${String(p.cash_discount_percent).replace(".", ",")}% à vista` : ""}; meios:{" "}
                  {metodos(p.allowed_methods)}.
                </li>
              ))}
            </ul>
          )}
          <Link href="/ppr/configuracao" className="text-xs text-primary underline-offset-2 hover:underline">
            Editar em PPR+ › Configuração
          </Link>
        </div>
        <div>
          <p className="font-medium">Risarte Empresarial</p>
          <p className="text-muted-foreground">
            O parcelamento e os meios de pagamento de cada empresa ficam no cadastro dela; o padrão do programa, nas
            configurações do Empresarial.
          </p>
          <Link href="/empresarial/configuracoes" className="text-xs text-primary underline-offset-2 hover:underline">
            Editar em Empresarial › Configurações
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export async function AbaComercialDaRede({ supabase }: { supabase: SupabaseClient }) {
  const { regras, cadencia, validadePronta } = await lerRegras(supabase);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Limites que o Consultor Comercial pratica na negociação: desconto máximo, parcelamento e meios de pagamento.
        Negociação fora da regra exige autorização do Gerente da unidade. Aqui também fica a validade do orçamento
        impresso.
      </p>
      <CommercialRulesEditor rows={regras} clinics={[]} validadePronta={validadePronta} escopo="rede" />
      <div className="border-t pt-6">
        <FollowupCadenceEditor rows={cadencia} clinics={[]} escopo="rede" />
      </div>
      <CondicoesDosProgramas supabase={supabase} />
    </div>
  );
}

export async function AbaComercialDaUnidade({
  supabase,
  clinicId,
  clinicName,
}: {
  supabase: SupabaseClient;
  clinicId: string;
  clinicName: string;
}) {
  const { regras, cadencia, validadePronta } = await lerRegras(supabase);
  const escopo = { clinicId, nome: clinicName };
  return (
    <div className="space-y-6">
      <CommercialRulesEditor rows={regras} clinics={[]} validadePronta={validadePronta} escopo={escopo} />
      <div className="border-t pt-6">
        <FollowupCadenceEditor rows={cadencia} clinics={[]} escopo={escopo} />
      </div>
      <CondicoesDosProgramas supabase={supabase} />
    </div>
  );
}
