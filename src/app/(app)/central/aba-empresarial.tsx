import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Building2, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIsoDateBr } from "@/lib/dates";
import { FormularioDoEmpresarial } from "./empresarial-form";

/**
 * A ABA EMPRESARIAL (ASA5, 4023; spec seção 22). Só no nível da Rede.
 *
 * - Ligar (decisão 7b): a rede inteira, com a data de início. Toda cobrança
 *   gerada desde a data sai no Asaas; as abertas de antes ganham "Emitir no Asaas".
 * - A conta da RisLife: fatura a implantação (decisão 1) e recebe o split da
 *   mensalidade (50% do líquido, decisão 2b).
 * - Antes de ligar: as pendências do cadastro (documento aceito e contato).
 * - Depois: a divergência de atraso entre o Empresarial e o Asaas (decisão 5c).
 * Os percentuais da RisLife e as exceções continuam em Empresarial › Configurações.
 */

type ContaRislife = {
  id: string;
  label: string;
  environment: string;
  status: string;
  tem_chave: boolean;
  tem_carteira: boolean;
  tem_webhook: boolean;
};

type Leitura = {
  enabled_from: string | null;
  ligado: boolean;
  rislife_account_id: string | null;
  rislife_pronta: boolean;
  pode_configurar: boolean;
  contas_rislife: ContaRislife[];
  conta_raiz: { id: string; label: string; environment: string } | null;
  regra: { implantacao_rislife: number; mensalidade_rislife: number } | null;
  excecoes: number;
  pendencias: { company_id: string; empresa: string; problema: string; detalhe: string }[];
  divergencias_de_atraso: { billing_id: string; company_id: string; empresa: string; vencimento: string; no_empresarial: string; no_asaas: string }[];
  cobrancas: { emitidas: number; com_erro: number; pagas: number };
  abertas_antes_da_data: number;
};

const PROBLEMA: Record<string, string> = {
  sem_documento_aceito: "CAEPF, CNO ou NIF sem o CNPJ da matriz e sem o CPF do responsável",
  sem_contato: "sem e-mail e sem celular do responsável",
  outro_pagador_sem_contato: "titular com outro pagador dos dependentes, sem e-mail e sem celular",
};

export async function AbaEmpresarialDaRede({ supabase }: { supabase: SupabaseClient }) {
  const { data, error } = await supabase.rpc("corporate_settings_read");
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">O Empresarial pelo Asaas ainda não existe neste banco (falta a migração 4023).</p>;
    return <p className="text-sm text-destructive">Não foi possível ler a configuração do Empresarial.</p>;
  }
  const l = data as Leitura;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" /> O Empresarial pelo Asaas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            {l.ligado ? (
              <>
                <strong className="text-emerald-700 dark:text-emerald-400">Ligado</strong> desde{" "}
                {formatIsoDateBr(l.enabled_from)}: toda cobrança gerada desde a data sai no Asaas na hora.
              </>
            ) : l.enabled_from ? (
              <>
                Liga em <strong>{formatIsoDateBr(l.enabled_from)}</strong>.
              </>
            ) : (
              <>
                <strong>Desligado.</strong> As cobranças do Empresarial ficam registradas aqui, e a baixa é manual.
              </>
            )}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <strong className="text-foreground">Implantação:</strong> faturada pela RisLife, na conta Asaas dela (100%
              dela, sem split).
            </li>
            <li>
              <strong className="text-foreground">Mensalidade:</strong> pela conta raiz da franqueadora
              {l.conta_raiz ? ` (${l.conta_raiz.label})` : ""}, com split de{" "}
              {l.regra ? `${Number(l.regra.mensalidade_rislife)}%` : "—"} do líquido para a RisLife
              {l.excecoes > 0 ? ` (e ${l.excecoes} exceção(ões) por empresa)` : ""}.
            </li>
            <li>
              Os percentuais e as exceções ficam em{" "}
              <Link href="/empresarial/configuracoes" className="underline">
                Empresarial › Configurações
              </Link>
              .
            </li>
          </ul>
          <FormularioDoEmpresarial
            podeConfigurar={l.pode_configurar}
            ligadoDesde={l.enabled_from}
            contaRislife={l.rislife_account_id}
            contas={l.contas_rislife}
          />
          {l.ligado && (
            <p className="text-xs text-muted-foreground">
              No Asaas: {l.cobrancas.emitidas} em aberto, {l.cobrancas.pagas} paga(s)
              {l.cobrancas.com_erro > 0 ? `, ${l.cobrancas.com_erro} que não saíram (use “Tentar de novo” na ficha da empresa)` : ""}.
              {l.abertas_antes_da_data > 0
                ? ` ${l.abertas_antes_da_data} cobrança(s) em aberto de antes da data continuam manuais (“Emitir no Asaas” na ficha da empresa).`
                : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Antes de ligar: o cadastro das empresas</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {l.pendencias.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma pendência: toda empresa ativa tem documento aceito e contato.</p>
          ) : (
            <ul className="space-y-1">
              {l.pendencias.map((p, i) => (
                <li key={`${p.company_id}-${p.problema}-${i}`} className="flex flex-wrap justify-between gap-2">
                  <Link href={`/empresarial/${p.company_id}`} className="font-medium underline">
                    {p.empresa}
                  </Link>
                  <span className="text-muted-foreground">
                    {PROBLEMA[p.problema] ?? p.problema}
                    {p.detalhe ? ` — ${p.detalhe}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {l.divergencias_de_atraso.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-600" /> Atraso diferente no Empresarial e no Asaas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-xs text-muted-foreground">
              Quem marca o atraso e suspende a empresa é a rotina do Empresarial; o Asaas só confirma. Confira estas:
            </p>
            {l.divergencias_de_atraso.map((d) => (
              <p key={d.billing_id} className="flex flex-wrap justify-between gap-2">
                <Link href={`/empresarial/${d.company_id}?aba=financeiro`} className="font-medium underline">
                  {d.empresa}
                </Link>
                <span className="text-muted-foreground">
                  venc. {formatIsoDateBr(d.vencimento)} · Empresarial: {d.no_empresarial === "OVERDUE" ? "em atraso" : "em dia"} ·
                  Asaas: {d.no_asaas === "vencida" ? "vencida" : "em aberto"}
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
