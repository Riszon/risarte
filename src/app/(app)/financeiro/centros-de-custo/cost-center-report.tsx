import { FileBarChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterForm } from "@/components/filter-form";
import { formatBRL } from "@/lib/pricing";
import { buildCostCenterTree, type CostCenter } from "@/lib/finance/accounts";

export type CenterTotals = {
  centerId: string;
  entries: number;
  inflowCents: number;
  outflowCents: number;
};

/**
 * FIN0 — relatório do movimento da unidade por centro de custo (competência).
 * É a tela que a unidade usa no lugar da configuração: ela não define a árvore,
 * mas precisa acompanhar onde o dinheiro dela está indo.
 */
export function CostCenterReport({
  centers,
  totals,
  month,
  clinicName,
}: {
  centers: CostCenter[];
  totals: CenterTotals[];
  month: string;
  clinicName: string;
}) {
  const byId = new Map(totals.map((t) => [t.centerId, t]));
  const tree = buildCostCenterTree(centers.filter((c) => c.active));
  const semCentro = byId.get("sem-centro");

  const totalOut = totals.reduce((s, t) => s + t.outflowCents, 0);
  const totalIn = totals.reduce((s, t) => s + t.inflowCents, 0);
  const [year, m] = month.split("-");

  /** Soma o centro + todos os filhos (o pai mostra o consolidado da área). */
  function subtree(centerId: string): CenterTotals {
    const acc: CenterTotals = {
      centerId,
      entries: 0,
      inflowCents: 0,
      outflowCents: 0,
    };
    const walk = (id: string) => {
      const own = byId.get(id);
      if (own) {
        acc.entries += own.entries;
        acc.inflowCents += own.inflowCents;
        acc.outflowCents += own.outflowCents;
      }
      for (const c of centers.filter((x) => x.parentId === id)) walk(c.id);
    };
    walk(centerId);
    return acc;
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileBarChart className="size-4 text-primary" />
            Movimento por centro de custo
          </CardTitle>
          <FilterForm className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">Mês</label>
            <input
              type="month"
              name="mes"
              defaultValue={month}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            />
          </FilterForm>
        </div>
        <p className="text-xs text-muted-foreground">
          {clinicName ? `${clinicName} — ` : ""}
          {m}/{year}, por competência (a data do fato, não a do pagamento).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Centro</th>
                <th className="px-2 py-1.5 text-right font-medium">
                  Lançamentos
                </th>
                <th className="px-2 py-1.5 text-right font-medium">Entradas</th>
                <th className="px-2 py-1.5 text-right font-medium">Saídas</th>
              </tr>
            </thead>
            <tbody>
              {tree.map((node) => {
                const t = subtree(node.id);
                return (
                  <tr key={node.id} className="border-b last:border-b-0">
                    <td className="px-2 py-1.5">
                      <span className="font-mono text-xs text-muted-foreground">
                        {node.code}
                      </span>{" "}
                      {node.name}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {t.entries}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {t.inflowCents > 0 ? formatBRL(t.inflowCents) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {t.outflowCents > 0 ? formatBRL(t.outflowCents) : "—"}
                    </td>
                  </tr>
                );
              })}
              {semCentro && semCentro.entries > 0 && (
                <tr className="border-b bg-amber-50/60 last:border-b-0">
                  <td className="px-2 py-1.5 text-amber-900">
                    Sem centro de custo
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {semCentro.entries}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatBRL(semCentro.inflowCents)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatBRL(semCentro.outflowCents)}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t font-semibold">
              <tr>
                <td className="px-2 py-1.5">Total</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {totals.reduce((s, t) => s + t.entries, 0)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatBRL(totalIn)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatBRL(totalOut)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {totals.length === 0 && (
          <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            Nenhum lançamento neste mês. Os números aparecem aqui conforme as
            receitas e despesas forem registradas — as contas a receber entram
            na próxima fase e as contas a pagar na seguinte.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
