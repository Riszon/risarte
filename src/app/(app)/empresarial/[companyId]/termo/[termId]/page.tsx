import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  canViewEmpresarial,
  isProgramManager,
  isRislifeConsultant,
} from "@/lib/empresarial/access";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/pricing";
import { formatBrDate, startOfDayInBrazil, todayInBrazil } from "@/lib/dates";
import { maskDocument } from "@/lib/empresarial/documents";
import { BotaoImprimir } from "../../../funil/[leadId]/botao-imprimir";

export const metadata: Metadata = {
  title: "Termo de inclusão · Risarte Empresarial",
};

type TermoRow = {
  id: string;
  code: string;
  holders: number;
  dependents: number;
  holder_fee_cents: number | null;
  dependent_fee_cents: number | null;
  fixed_cents: number | null;
  monthly_delta_cents: number;
  implantation_cents: number;
  status: "RASCUNHO" | "ACEITO" | "CANCELADO";
  accepted_at: string | null;
  notes: string | null;
  created_at: string;
  company_id: string;
};

/**
 * O TERMO DE INCLUSÃO — documento curto (OC-00083, I4).
 *
 * Decisão do dono (24/09/2026): *"gerando um documento mais simples que a
 * proposta inicial (mais curto), mas lembrando a empresa que o titular está
 * sendo cadastrado no programa e é referente ao acordo que já existe entre a
 * Risarte e a empresa."*
 *
 * ⚠️ ELE NÃO REPETE A PROPOSTA, e isso é o ponto. Benefícios, carência,
 * unidades e condições continuam sendo os do contrato — reescrevê-los aqui
 * criaria um segundo documento dizendo as mesmas coisas, e no dia em que os
 * dois discordassem ninguém saberia qual vale.
 */
export default async function TermoDeInclusaoPage({
  params,
}: {
  params: Promise<{ companyId: string; termId: string }>;
}) {
  const { companyId, termId } = await params;

  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  if (!isProgramManager(session) && !isRislifeConsultant(session)) {
    redirect("/empresarial");
  }

  const db = await empresarialDb();
  const { data: termo } = await db
    .from("company_inclusion_terms")
    .select("*")
    .eq("id", termId)
    .eq("company_id", companyId)
    .maybeSingle<TermoRow>();
  if (!termo) notFound();

  const { data: empresa } = await db
    .from("companies")
    .select("legal_name, trade_name, cnpj, responsible_name, contract_started_at")
    .eq("id", companyId)
    .maybeSingle<{
      legal_name: string | null;
      trade_name: string | null;
      cnpj: string | null;
      responsible_name: string | null;
      contract_started_at: string | null;
    }>();
  if (!empresa) notFound();

  const razao = empresa.legal_name || empresa.trade_name || "Empresa";
  const hoje = todayInBrazil();

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      {/* Some na impressão: o PDF que vai para a empresa não leva botões. */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href={`/empresarial/${companyId}?aba=colaboradores`} />}
        >
          ← Voltar à empresa
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {termo.status === "ACEITO"
              ? "Aceito"
              : termo.status === "CANCELADO"
                ? "Cancelado"
                : "Aguardando aceite"}
          </span>
          <BotaoImprimir tipo="proposta" companyName={razao} rotulo="Salvar em PDF" />
        </div>
      </div>

      <article className="space-y-6">
        <header className="space-y-1 border-b pb-5">
          <p className="text-xs tracking-wider text-muted-foreground uppercase">
            Termo de inclusão · {termo.code}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Risarte Empresarial
          </h1>
          <p className="pt-2 text-sm text-muted-foreground">
            <strong className="text-foreground">{razao}</strong>
            {empresa.cnpj && <> · CNPJ {maskDocument("CNPJ", empresa.cnpj)}</>}
          </p>
          <p className="text-sm text-muted-foreground">
            Emitido em {formatBrDate(startOfDayInBrazil(hoje))}
          </p>
        </header>

        {/* ⚠️ A FRASE QUE O DONO PEDIU, e ela é a razão de o documento ser
            curto: a empresa precisa reconhecer que isto não é um contrato
            novo, é gente entrando no que já foi combinado. */}
        <p className="leading-relaxed">
          As pessoas abaixo estão sendo <strong>cadastradas no programa</strong>{" "}
          Risarte Empresarial, <strong>referente ao acordo já existente</strong>{" "}
          entre a Risarte Odontologia e {razao}
          {empresa.contract_started_at && (
            <>, iniciado em {formatBrDate(empresa.contract_started_at)}</>
          )}
          . As condições, os benefícios, as carências e as unidades continuam
          sendo os do contrato — este termo trata apenas da inclusão e do valor
          correspondente.
        </p>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">Quem entra</h2>
          <ul className="space-y-0.5 text-muted-foreground">
            {termo.holders > 0 && (
              <li>
                <strong className="text-foreground">{termo.holders}</strong>{" "}
                titular(es)
                {termo.holder_fee_cents != null && (
                  <> · {formatBRL(termo.holder_fee_cents)} por mês cada</>
                )}
              </li>
            )}
            {termo.dependents > 0 && (
              <li>
                <strong className="text-foreground">{termo.dependents}</strong>{" "}
                dependente(s)
                {termo.dependent_fee_cents != null && (
                  <> · {formatBRL(termo.dependent_fee_cents)} por mês cada</>
                )}
              </li>
            )}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">O que muda no valor</h2>
          {termo.fixed_cents != null && (
            <p className="leading-relaxed text-muted-foreground">
              O acordo é de valor fixo: com esta inclusão, a mensalidade do
              pacote passa a ser{" "}
              <strong className="text-foreground">
                {formatBRL(termo.fixed_cents)}
              </strong>
              .
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
            <div>
              <p className="text-xs text-muted-foreground">A mais por mês</p>
              <p className="text-lg font-semibold">
                {formatBRL(termo.monthly_delta_cents)}
              </p>
            </div>
            {termo.implantation_cents > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">
                  Implantação (uma vez)
                </p>
                <p className="text-sm">{formatBRL(termo.implantation_cents)}</p>
              </div>
            )}
          </div>
          {/* Régua vazia grita: termo sem valor não pode sair parecendo de
              graça. */}
          {termo.monthly_delta_cents <= 0 && (
            <p className="text-sm text-destructive">
              ⚠️ Este termo está <strong>sem valor combinado</strong> — a regra
              do excedente não foi definida na proposta. Ele não deve ser
              enviado à empresa assim.
            </p>
          )}
        </section>

        {termo.notes && (
          <section className="space-y-1">
            <h2 className="text-lg font-medium">Observação</h2>
            <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {termo.notes}
            </p>
          </section>
        )}

        <footer className="space-y-1 border-t pt-5 text-sm text-muted-foreground">
          {empresa.responsible_name && (
            <p>
              Aos cuidados de{" "}
              <strong className="text-foreground">{empresa.responsible_name}</strong>
            </p>
          )}
          {termo.status === "ACEITO" && termo.accepted_at && (
            <p>Aceito em {formatBrDate(termo.accepted_at)}.</p>
          )}
          <p className="pt-2">Risarte Odontologia · Risarte Empresarial</p>
        </footer>
      </article>
    </div>
  );
}
