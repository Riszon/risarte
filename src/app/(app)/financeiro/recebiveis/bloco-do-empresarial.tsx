import "server-only";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { empresarialDb } from "@/lib/empresarial/db";
import { BILLING_TYPE_LABELS } from "@/lib/empresarial/constants";
import { formatBRL } from "@/lib/pricing";
import { formatBrDate, todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  recebiveisDoEmpresarial,
  type CobrancaDaEmpresa,
} from "@/lib/finance/recebiveis-do-empresarial";

/**
 * AP147 — "EMPRESAS (EMPRESARIAL)" NOS RECEBÍVEIS DA FRANQUEADORA E DA REDE.
 *
 * Bloco próprio por decisão do dono: os números daqui NÃO entram no % de
 * inadimplência dos pacientes. A regra da conta é `recebiveisDoEmpresarial`.
 *
 * A leitura é a do usuário (regra de linha de `adhesion_billing`): quem chega
 * aqui é o Admin ou o Financeiro da Franqueadora, que leem todas as empresas.
 *
 * ⚠️ LEITURA QUE FALHA DIZ QUE FALHOU. Mostrar R$ 0,00 quando a consulta não
 * voltou seria afirmar que as empresas estão em dia.
 */

type LinhaBruta = {
  id: string;
  company_id: string;
  billing_type: CobrancaDaEmpresa["tipo"];
  reference_month: string | null;
  total_amount_cents: number | null;
  status: CobrancaDaEmpresa["situacao"];
  due_date: string | null;
  companies: { legal_name: string; trade_name: string | null } | null;
};

function mesDe(iso: string | null): string {
  if (!iso) return "";
  const [ano, mes] = iso.split("-");
  return `${mes}/${ano}`;
}

export async function BlocoDoEmpresarial() {
  const db = await empresarialDb();
  const { data, error } = await db
    .from("adhesion_billing")
    .select(
      "id, company_id, billing_type, reference_month, total_amount_cents, status, due_date, companies ( legal_name, trade_name )"
    )
    .in("status", ["PENDING", "OVERDUE"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .returns<LinhaBruta[]>();

  const titulo = (
    <h2 className="flex items-center gap-2 text-lg font-semibold">
      <Building2 className="size-5 text-primary print:hidden" />
      Empresas (Empresarial)
    </h2>
  );

  if (error) {
    console.error("recebíveis — empresarial:", error.message);
    return (
      <section className="space-y-2">
        {titulo}
        <p className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
          Não foi possível ler as cobranças das empresas agora. Os valores do
          Empresarial não estão nesta tela.
        </p>
      </section>
    );
  }

  const hoje = todayInBrazil();
  const { linhas, resumo } = recebiveisDoEmpresarial(
    (data ?? []).map((r) => ({
      id: r.id,
      companyId: r.company_id,
      empresa: r.companies?.trade_name || r.companies?.legal_name || "—",
      tipo: r.billing_type,
      mesReferencia: r.reference_month,
      valorCents: Number(r.total_amount_cents ?? 0),
      situacao: r.status,
      vencimento: r.due_date,
    })),
    hoje
  );

  return (
    <section className="space-y-3">
      <div>
        {titulo}
        <p className="text-sm text-muted-foreground">
          Mensalidades e implantações das empresas do programa ainda não pagas.
          São da Franqueadora e ficam <strong>fora</strong> do % de
          inadimplência dos pacientes. A baixa é feita em{" "}
          <Link href="/empresarial/cobrancas" className="underline">
            Empresarial → Cobranças
          </Link>
          .
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            A receber das empresas
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {formatBRL(resumo.abertoCents)}
          </p>
          <p className="text-xs text-muted-foreground">
            {resumo.abertoQuantidade} cobrança(s) em aberto
            {resumo.semVencimento > 0 && ` · ${resumo.semVencimento} sem vencimento`}
          </p>
        </div>
        <div
          className={cn(
            "rounded-xl border bg-card p-4",
            resumo.vencidoCents > 0 && "border-destructive/40"
          )}
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Vencido das empresas
          </p>
          <p
            className={cn(
              "mt-1 text-xl font-semibold tabular-nums",
              resumo.vencidoCents > 0 && "text-destructive"
            )}
          >
            {formatBRL(resumo.vencidoCents)}
          </p>
          <p className="text-xs text-muted-foreground">
            {resumo.vencidoQuantidade} cobrança(s) · valor da cobrança, sem multa
            nem juros
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Inadimplência das empresas
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {resumo.taxaPercent === null
              ? "—"
              : `${resumo.taxaPercent.toLocaleString("pt-BR")}%`}
          </p>
          <p className="text-xs text-muted-foreground">
            {resumo.taxaPercent === null
              ? "Nenhuma cobrança de empresa em aberto."
              : "Vencido ÷ a receber, só das empresas."}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Empresa</th>
              <th className="px-2 py-2 font-medium">Cobrança</th>
              <th className="px-2 py-2 font-medium">Vencimento</th>
              <th className="px-2 py-2 text-right font-medium">Valor</th>
              <th className="px-2 py-2 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="px-2 py-2">
                  <Link href={`/empresarial/${l.companyId}`} className="hover:underline">
                    {l.empresa}
                  </Link>
                </td>
                <td className="px-2 py-2 text-xs">
                  {BILLING_TYPE_LABELS[l.tipo] ?? l.tipo}
                  {l.tipo === "MONTHLY" && l.mesReferencia && (
                    <span className="ml-1 text-muted-foreground">{mesDe(l.mesReferencia)}</span>
                  )}
                </td>
                <td
                  className={cn(
                    "px-2 py-2 tabular-nums",
                    l.vencida && "font-semibold text-destructive"
                  )}
                >
                  {l.vencimento ? formatBrDate(`${l.vencimento}T12:00:00`) : "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatBRL(l.valorCents)}
                </td>
                <td className="px-2 py-2 text-xs text-muted-foreground">
                  {l.vencida
                    ? `${l.diasDeAtraso} dia(s) em atraso`
                    : l.vencimento
                      ? "Em dia"
                      : "Sem vencimento"}
                </td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  Nenhuma cobrança de empresa em aberto.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
