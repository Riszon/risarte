import "server-only";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  montarRegras,
  type DadosDasRegras,
  type DivisaoDoPagamento,
  type EmpresaDasRegras,
  type PrecoDaAdesao,
} from "@/lib/empresarial/regras-combinadas";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatBrDateTime } from "@/lib/dates";
import { AbrirRevisao } from "./abrir-revisao";

/**
 * Aba "Regras combinadas" da empresa (pedido do dono, 18/11/2026; plano
 * REVISAR-CONTRATO-PLANO.md, Etapa 1). Só leitura: tudo o que foi combinado,
 * num lugar só. A revisão do contrato (Etapa 2) muda estas regras.
 *
 * ⚠️ Falha de leitura NÃO vira "sem regra": a aba diz que não conseguiu ler,
 * em vez de mostrar "padrão da rede" ou "não combinado" que não é verdade.
 */

const PRECO =
  "holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents, dependent_family_size, dependent_mode, max_installments";
const DIVISAO =
  "first_payment_risarte_pct, first_payment_rislife_pct, recurring_risarte_pct, recurring_rislife_pct";

async function carregar(companyId: string): Promise<DadosDasRegras | null> {
  const db = await empresarialDb();
  const supabase = await createClient();

  const { data: empresa, error: erroDaEmpresa } = await db
    .from("companies")
    .select(
      "payment_model, company_subsidy_type, company_subsidy_value, due_day, billing_model, payment_methods, default_max_installments, contract_started_at, grace_period_days, employee_grace_period_days, special_agreements, min_adhesions, max_adhesions, adhesion_limit_target, origin_lead_id, main_clinic_id, contracted_holders, contracted_dependents, excess_mode, excess_fixed_cents, excess_holder_fee_cents, excess_dependent_fee_cents, billing_basis, fixed_monthly_cents, implantation_includes_dependents, implantation_dependents_cents, social_participates, implantation_status, implantation_prepaid_holders, min_term_months, early_exit_fee_cents"
    )
    .eq("id", companyId)
    .maybeSingle<EmpresaDasRegras & { main_clinic_id: string | null }>();
  if (erroDaEmpresa || !empresa) return null;

  const [
    precoEmpresa,
    precoRede,
    faixas,
    termos,
    limite,
    implantacoes,
    beneficiosProprios,
    beneficiosRede,
    vantagens,
    unidadesDaParceria,
    divisaoEmpresa,
    divisaoRede,
    lead,
    qualificacao,
  ] = await Promise.all([
    db.from("adhesion_pricing").select(PRECO).eq("company_id", companyId).maybeSingle<PrecoDaAdesao>(),
    db.from("adhesion_pricing").select(PRECO).is("company_id", null).maybeSingle<PrecoDaAdesao>(),
    db
      .from("company_price_tiers")
      .select("min_quantity, price_cents")
      .eq("company_id", companyId)
      .returns<{ min_quantity: number; price_cents: number }[]>(),
    db
      .from("company_inclusion_terms")
      .select("holders, dependents")
      .eq("company_id", companyId)
      .eq("status", "ACEITO")
      .returns<{ holders: number; dependents: number }[]>(),
    db.rpc("limite_de_titulares", { p_company_id: companyId }),
    db
      .from("adhesion_billing")
      .select("status, total_amount_cents, holders_covered")
      .eq("company_id", companyId)
      .eq("billing_type", "IMPLANTATION")
      .neq("status", "CANCELLED")
      .returns<{ status: string; total_amount_cents: number; holders_covered: number | null }[]>(),
    db.from("procedure_benefits").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    db.from("procedure_benefits").select("id", { count: "exact", head: true }).is("company_id", null),
    db
      .from("company_perks")
      .select("name, status")
      .eq("company_id", companyId)
      .order("sort_order")
      .returns<{ name: string; status: string }[]>(),
    db
      .from("company_clinics")
      .select("clinic_id")
      .eq("company_id", companyId)
      .returns<{ clinic_id: string }[]>(),
    db.from("split_rules").select(DIVISAO).eq("company_id", companyId).maybeSingle<DivisaoDoPagamento>(),
    db.from("split_rules").select(DIVISAO).is("company_id", null).maybeSingle<DivisaoDoPagamento>(),
    empresa.origin_lead_id
      ? db
          .from("commercial_leads")
          .select("contract_signed_at")
          .eq("id", empresa.origin_lead_id)
          .maybeSingle<{ contract_signed_at: string | null }>()
      : Promise.resolve({ data: null, error: null }),
    empresa.origin_lead_id
      ? db
          .from("lead_qualification")
          .select("min_term_months, early_exit_fee_cents")
          .eq("lead_id", empresa.origin_lead_id)
          .maybeSingle<{ min_term_months: number | null; early_exit_fee_cents: number | null }>()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const falhou = [
    precoEmpresa.error,
    precoRede.error,
    faixas.error,
    termos.error,
    limite.error,
    implantacoes.error,
    beneficiosProprios.error,
    beneficiosRede.error,
    vantagens.error,
    unidadesDaParceria.error,
    divisaoEmpresa.error,
    divisaoRede.error,
    lead.error,
    qualificacao.error,
  ].find(Boolean);
  if (falhou) {
    console.error("regras combinadas:", falhou.message);
    return null;
  }

  // Nomes das unidades (public.clinics): a principal e as da parceria.
  const ids = [
    ...new Set([empresa.main_clinic_id, ...(unidadesDaParceria.data ?? []).map((u) => u.clinic_id)].filter(Boolean)),
  ] as string[];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data: clinicas, error } = await supabase.from("clinics").select("id, name").in("id", ids);
    if (error) {
      console.error("regras combinadas (unidades):", error.message);
      return null;
    }
    for (const c of clinicas ?? []) nomes.set(c.id, c.name);
  }

  const limiteRow = limite.data as unknown;
  return {
    empresa,
    precoDaEmpresa: precoEmpresa.data ?? null,
    precoDaRede: precoRede.data ?? null,
    faixas: faixas.data ?? [],
    termosAceitos: termos.data ?? [],
    limiteDeTitulares: typeof limiteRow === "number" ? limiteRow : null,
    implantacoes: implantacoes.data ?? [],
    beneficiosProprios: beneficiosProprios.count ?? 0,
    beneficiosDaRede: beneficiosRede.count ?? 0,
    vantagens: vantagens.data ?? [],
    unidadePrincipal: empresa.main_clinic_id ? (nomes.get(empresa.main_clinic_id) ?? null) : null,
    unidades: (unidadesDaParceria.data ?? []).map((u) => nomes.get(u.clinic_id)).filter(Boolean) as string[],
    divisaoDaEmpresa: divisaoEmpresa.data ?? null,
    divisaoDaRede: divisaoRede.data ?? null,
    proposta: empresa.origin_lead_id
      ? {
          contratoAssinadoEm: lead.data?.contract_signed_at ?? null,
          prazoMinimoMeses: qualificacao.data?.min_term_months ?? null,
          multaDeSaidaCents: qualificacao.data?.early_exit_fee_cents ?? null,
        }
      : null,
  };
}

type RevisaoDaLista = {
  id: string;
  code: string;
  status: "RASCUNHO" | "APLICADA" | "CANCELADA";
  reason: string;
  created_at: string;
  applied_at: string | null;
};

const SITUACAO_DA_REVISAO: Record<RevisaoDaLista["status"], string> = {
  RASCUNHO: "Em revisão",
  APLICADA: "Aplicada",
  CANCELADA: "Cancelada",
};

export async function RegrasCombinadas({ companyId, podeRevisar }: { companyId: string; podeRevisar: boolean }) {
  const db = await empresarialDb();
  const [dados, { data: revisoes }] = await Promise.all([
    carregar(companyId),
    db
      .from("contract_revisions")
      .select("id, code, status, reason, created_at, applied_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .returns<RevisaoDaLista[]>(),
  ]);
  const aberta = (revisoes ?? []).find((r) => r.status === "RASCUNHO");
  if (!dados) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Não foi possível ler as regras combinadas desta empresa agora. Tente de novo em instantes.
        </CardContent>
      </Card>
    );
  }
  const blocos = montarRegras(dados);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Tudo o que foi combinado com esta empresa. <span className="font-medium">Padrão da rede</span> = a
          empresa não tem regra própria e vale a da rede. Para mudar, use <span className="font-medium">Revisar contrato</span>:
          a mudança vale com o aditivo assinado.
        </p>
        {podeRevisar &&
          (aberta ? (
            <Link
              href={`/empresarial/${companyId}/revisao/${aberta.id}`}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Continuar a revisão {aberta.code}
            </Link>
          ) : (
            <AbrirRevisao companyId={companyId} />
          ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {blocos.map((b) => (
          <Card key={b.chave}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{b.titulo}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {b.aviso && (
                <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{b.aviso}</span>
                </p>
              )}
              <dl className="divide-y text-sm">
                {b.linhas.map((l) => (
                  <div key={l.rotulo} className="grid gap-1 py-1.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
                    <dt className="text-muted-foreground">{l.rotulo}</dt>
                    <dd className="min-w-0 break-words">
                      {l.valor}
                      {l.padraoDaRede && (
                        <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          Padrão da rede
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
      {(revisoes ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revisões do contrato</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {(revisoes ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <Link href={`/empresarial/${companyId}/revisao/${r.id}`} className="font-medium hover:underline">
                      {r.code}
                    </Link>{" "}
                    <span className="text-muted-foreground">· {SITUACAO_DA_REVISAO[r.status]} · {r.reason}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatBrDateTime(r.applied_at ?? r.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
