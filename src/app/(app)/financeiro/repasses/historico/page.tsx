import Link from "next/link";
import { redirect } from "next/navigation";
import { History, Sheet } from "lucide-react";
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
  porDentista,
  porMes,
  somar,
  textoDoPercentual,
} from "@/lib/finance/payout-visoes";
import { carregarHistorico } from "@/lib/finance/payout-visoes-db";

/**
 * Repasse, Etapa 5 (0401) — o HISTÓRICO DA UNIDADE.
 *
 * Mês a mês (pelo mês em que o procedimento foi finalizado) e dentista a
 * dentista, lado a lado em ordem de nome — sem ranking (decisão V4). Quem lê
 * o financeiro da unidade vê (Franqueadora, Gerente, franqueado); o banco
 * recusa os outros. Planilha pela rota ao lado.
 */
export default async function HistoricoDoRepassePage(
  props: PageProps<"/financeiro/repasses/historico">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");
  const clinicId = session.activeClinic?.id ?? null;
  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const hoje = todayInBrazil();
  const { de, ate } = periodoDoEndereco(pick("de"), pick("ate"), hoje);
  const supabase = await createClient();
  const lido = await carregarHistorico(supabase, clinicId, de, ate);
  const rows = lido.ok ? lido.dados : [];
  const meses = mesesDoPeriodo(de, ate);
  const mensal = porMes(rows, meses);
  const dentistas = porDentista(rows);
  const t = somar(rows);
  const semPreco = t.producedMissing;
  const q = `de=${de}&ate=${ate}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <History className="size-6 text-primary" />
          Histórico de repasse
        </h1>
        <p className="text-sm text-muted-foreground">
          {session.activeClinic?.name} — o que cada dentista produziu e recebeu, mês a
          mês. O mês é o da <strong>finalização do procedimento</strong>; o desconto por
          falha entra no mês em que foi decidido.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border p-3 text-sm" method="get">
        <label className="block">
          <span className="block text-[11px] text-muted-foreground">De</span>
          <input type="month" name="de" defaultValue={de} max={hoje.slice(0, 7)} className="h-8 rounded-md border bg-background px-2" />
        </label>
        <label className="block">
          <span className="block text-[11px] text-muted-foreground">Até</span>
          <input type="month" name="ate" defaultValue={ate} max={hoje.slice(0, 7)} className="h-8 rounded-md border bg-background px-2" />
        </label>
        <button type="submit" className="h-8 rounded-md border px-3 hover:bg-muted">
          Ver
        </button>
        <a
          href={`/financeiro/repasses/historico/planilha?${q}`}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border px-3 hover:bg-muted"
        >
          <Sheet className="size-4" />
          Baixar planilha
        </a>
      </form>

      {!lido.ok && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{lido.erro}</p>
      )}

      {lido.ok && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Produção", formatBRL(t.producedCents)],
              ["Repasse", formatBRL(t.payoutCents)],
              ["Descontos", formatBRL(t.discountCents)],
              ["Pago", formatBRL(t.paidCents)],
            ].map(([r, v]) => (
              <div key={r} className="rounded-lg border p-3">
                <p className="text-[11px] text-muted-foreground">{r}</p>
                <p className="text-lg font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Repasse sobre a produção no período:{" "}
            <strong>{textoDoPercentual(percentualDoRepasse(t))}</strong>. Programado:{" "}
            {formatBRL(t.scheduledCents)} · esperando relatório ou aprovação:{" "}
            {formatBRL(t.waitingCents)}.
            {semPreco > 0 &&
              ` ${semPreco} procedimento${semPreco === 1 ? "" : "s"} sem preço para ler (a produção fica a menos).`}
            {t.orthoCount > 0 &&
              ` ${t.orthoCount} manutenç${t.orthoCount === 1 ? "ão" : "ões"} de Ortodontia: repasse sem produção (não se aplica).`}
          </p>

          <section className="space-y-2">
            <h2 className="font-medium">Mês a mês</h2>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-normal">Mês</th>
                    <th className="px-3 py-2 text-right font-normal">Produção</th>
                    <th className="px-3 py-2 text-right font-normal">Repasse</th>
                    <th className="px-3 py-2 text-right font-normal">Descontos</th>
                    <th className="px-3 py-2 text-right font-normal">Líquido</th>
                    <th className="px-3 py-2 text-right font-normal">Pago</th>
                    <th className="px-3 py-2 text-right font-normal">A pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {mensal.map(({ month, t: m }) => (
                    <tr key={month} className="border-b border-dashed last:border-0">
                      <td className="px-3 py-1.5">{formatIsoMonthBr(month)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(m.producedCents)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(m.payoutCents)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m.discountCents ? formatBRL(m.discountCents) : "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(liquido(m))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(m.paidCents)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatBRL(m.scheduledCents + m.waitingCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="font-medium">Dentistas lado a lado</h2>
            <p className="text-xs text-muted-foreground">
              Em ordem de nome. Abra um dentista para ver a evolução mês a mês, com o gráfico.
            </p>
            {dentistas.length === 0 ? (
              <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                Nenhum repasse no período.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-normal">Dentista</th>
                      <th className="px-3 py-2 text-right font-normal">Procedimentos</th>
                      <th className="px-3 py-2 text-right font-normal">Produção</th>
                      <th className="px-3 py-2 text-right font-normal">Repasse</th>
                      <th className="px-3 py-2 text-right font-normal">% da produção</th>
                      <th className="px-3 py-2 text-right font-normal">Descontos</th>
                      <th className="px-3 py-2 text-right font-normal">Pago</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dentistas.map((d) => (
                      <tr key={d.providerId} className="border-b border-dashed last:border-0">
                        <td className="px-3 py-1.5">
                          <Link
                            href={`/financeiro/repasses/dentistas/${d.providerId}?${q}`}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {d.providerName}
                          </Link>
                          <span className="ml-2 text-xs text-muted-foreground">{d.levelName ?? "sem nível"}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{d.t.procedures}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(d.t.producedCents)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(d.t.payoutCents)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {textoDoPercentual(percentualDoRepasse(d.t))}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {d.t.discountCents ? formatBRL(d.t.discountCents) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(d.t.paidCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
