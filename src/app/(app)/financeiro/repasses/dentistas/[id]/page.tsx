import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { formatBRL } from "@/lib/pricing";
import { formatIsoMonthBr, todayInBrazil } from "@/lib/dates";
import {
  liquido,
  mesesDoPeriodo,
  percentualDoRepasse,
  periodoDoEndereco,
  porMes,
  somar,
  textoDoPercentual,
} from "@/lib/finance/payout-visoes";
import { carregarHistorico } from "@/lib/finance/payout-visoes-db";
import { BarrasDoRepasse } from "@/components/repasse/barras-do-repasse";
import { BotaoImprimir } from "./botao-imprimir";

/**
 * Repasse, Etapa 5 (0401) — a EVOLUÇÃO DE UM DENTISTA na unidade: produção e
 * repasse mês a mês (gráfico e tabela), o quanto o repasse representa da
 * produção, os descontos e o pago. Para quem lê o financeiro da unidade; o
 * dentista vê a dele em Meus repasses, sem a produção (decisão V3).
 */
export default async function EvolucaoDoDentistaPage(
  props: PageProps<"/financeiro/repasses/dentistas/[id]">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");
  const clinic = session.activeClinic;
  const { id } = await props.params;
  if (!clinic || !/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const { de, ate } = periodoDoEndereco(pick("de"), pick("ate"), todayInBrazil());
  const supabase = await createClient();
  const lido = await carregarHistorico(supabase, clinic.id, de, ate, id);
  if (!lido.ok) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{lido.erro}</p>
      </div>
    );
  }
  const rows = lido.dados;
  const nome = rows[0]?.providerName ?? "Dentista";
  const nivel = rows[rows.length - 1]?.levelName ?? null;
  const mensal = porMes(rows, mesesDoPeriodo(de, ate));
  const t = somar(rows);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <Link
        href={`/financeiro/repasses/historico?de=${de}&ate=${ate}`}
        className="inline-flex text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        ← Histórico de repasse
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{nome}</h1>
          <p className="text-sm text-muted-foreground">
            {clinic.name} · nível {nivel ?? "não definido"} ·{" "}
            {formatIsoMonthBr(`${de}-01`)} a {formatIsoMonthBr(`${ate}-01`)}
          </p>
        </div>
        <BotaoImprimir />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Nenhum repasse deste dentista nesta unidade no período.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Produção", formatBRL(t.producedCents)],
              ["Repasse", formatBRL(t.payoutCents)],
              ["% da produção", textoDoPercentual(percentualDoRepasse(t))],
              ["Pago", formatBRL(t.paidCents)],
            ].map(([r, v]) => (
              <div key={r} className="rounded-lg border p-3">
                <p className="text-[11px] text-muted-foreground">{r}</p>
                <p className="text-lg font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>

          <BarrasDoRepasse
            comProducao
            meses={mensal.map(({ month, t: m }) => ({
              month,
              producao: m.producedCents,
              repasse: m.payoutCents,
            }))}
          />

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-normal">Mês</th>
                  <th className="px-3 py-2 text-right font-normal">Procedimentos</th>
                  <th className="px-3 py-2 text-right font-normal">Produção</th>
                  <th className="px-3 py-2 text-right font-normal">Repasse</th>
                  <th className="px-3 py-2 text-right font-normal">%</th>
                  <th className="px-3 py-2 text-right font-normal">Descontos</th>
                  <th className="px-3 py-2 text-right font-normal">Líquido</th>
                  <th className="px-3 py-2 text-right font-normal">Pago</th>
                </tr>
              </thead>
              <tbody>
                {mensal.map(({ month, t: m }) => (
                  <tr key={month} className="border-b border-dashed last:border-0">
                    <td className="px-3 py-1.5">{formatIsoMonthBr(month)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m.procedures}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(m.producedCents)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(m.payoutCents)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{textoDoPercentual(percentualDoRepasse(m))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m.discountCents ? formatBRL(m.discountCents) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(liquido(m))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(m.paidCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Produção = valor vendido do procedimento (preço do plano com o desconto da
            negociação; na venda direta, o valor final).
            {t.orthoCount > 0 && " Manutenções de Ortodontia entram no repasse; a produção delas não se aplica."}
            {t.producedMissing > 0 &&
              ` ${t.producedMissing} procedimento${t.producedMissing === 1 ? "" : "s"} sem preço para ler.`}
          </p>
        </>
      )}
    </div>
  );
}
