"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  netMarginPercent,
  variation,
  verticalPercent,
  type Dre,
} from "@/lib/finance/dre";
import { loadDreEntries, type DreEntry } from "./actions";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * A variação, com cor.
 *
 * Não existe "esta linha é boa quando sobe e aquela quando desce": como o sinal
 * já vem da direção, TODA linha é contribuição para o lucro. Receita subindo dá
 * delta positivo; custo caindo (de −1.200 para −1.000) também. Verde é sempre
 * "melhorou o resultado" — uma regra só, sem tabela de exceções para manter.
 */
function VarBadge({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  const v = variation(current, previous);
  if (v.percent === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const better = v.deltaCents > 0;
  return (
    <span
      className={cn(
        "tabular-nums",
        v.deltaCents === 0
          ? "text-muted-foreground"
          : better
            ? "text-emerald-700"
            : "text-destructive"
      )}
    >
      {v.percent > 0 ? "+" : ""}
      {v.percent}%
    </span>
  );
}

/** Uma linha de subtotal — as que realmente se lê. */
function Total({
  label,
  value,
  before,
  base,
  strong,
}: {
  label: string;
  value: number;
  before: number;
  /** Receita líquida do período — a base da análise vertical. */
  base: number;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-2 border-t py-1.5",
        strong && "border-t-2 font-semibold"
      )}
    >
      <span>{label}</span>
      <span className="flex items-center gap-4 text-sm tabular-nums">
        <span className="w-16 text-right text-xs text-muted-foreground">
          {verticalPercent(value, base) ?? "—"}%
        </span>
        <span className="w-28 text-right">{formatBRL(value)}</span>
        <span className="w-16 text-right text-xs">
          <VarBadge current={value} previous={before} />
        </span>
      </span>
    </div>
  );
}

export function DreView({
  from,
  to,
  previousFrom,
  previousTo,
  costCenterId,
  costCenters,
  dre,
  previousDre,
  clinicId,
  periodClosed,
}: {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  costCenterId: string;
  costCenters: { id: string; name: string }[];
  dre: Dre;
  previousDre: Dre;
  clinicId: string;
  /** FIN7.4 — o mês do início do período está fechado. */
  periodClosed?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, DreEntry[]>>({});

  function apply(next: Partial<{ de: string; ate: string; centro: string }>) {
    const params = new URLSearchParams({
      de: next.de ?? from,
      ate: next.ate ?? to,
      centro: next.centro ?? costCenterId,
    });
    startTransition(() => router.push(`/financeiro/dre?${params}`));
  }

  function toggle(accountCode: string) {
    if (open === accountCode) {
      setOpen(null);
      return;
    }
    setOpen(accountCode);
    if (entries[accountCode]) return;

    startTransition(async () => {
      const r = await loadDreEntries({
        clinicId,
        from,
        to,
        accountCode,
        costCenterId,
      });
      if (r.ok && r.entries) {
        setEntries((e) => ({ ...e, [accountCode]: r.entries! }));
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const margin = netMarginPercent(dre);
  const marginBefore = netMarginPercent(previousDre);
  const base = dre.receitaLiquidaCents;

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* -- FILTROS ------------------------------------------------------ */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="block">
            <Label className="text-[11px]">De</Label>
            <Input
              className="h-8 w-40"
              type="date"
              value={from}
              onChange={(e) => apply({ de: e.target.value })}
            />
          </label>
          <label className="block">
            <Label className="text-[11px]">Até</Label>
            <Input
              className="h-8 w-40"
              type="date"
              value={to}
              onChange={(e) => apply({ ate: e.target.value })}
            />
          </label>
          <label className="block">
            <Label className="text-[11px]">Centro de custo</Label>
            <select
              value={costCenterId}
              onChange={(e) => apply({ centro: e.target.value })}
              className={cn(selectClass, "w-48")}
            >
              <option value="">Todos</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className="ml-auto text-[11px] text-muted-foreground">
            comparando com {fmtDate(previousFrom)} a {fmtDate(previousTo)}
            <br />
            <span>
              (mesmo número de dias — senão a comparação viraria calendário)
            </span>
          </p>
        </CardContent>
      </Card>

      {periodClosed && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-50 p-2 text-xs text-emerald-900">
          <Lock className="size-3.5 shrink-0" />
          <span>
            <strong>Período fechado.</strong> Estes números não mudam mais —
            lançamento novo de competência neste mês é recusado.
          </span>
        </p>
      )}

      {/* -- O RESUMO ----------------------------------------------------- */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-muted-foreground">Receita líquida</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatBRL(dre.receitaLiquidaCents)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Lucro bruto</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatBRL(dre.lucroBrutoCents)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">EBITDA</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatBRL(dre.ebitdaCents)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">
              Lucro líquido
              {margin !== null && (
                <span className="ml-1">
                  ({margin}%
                  {marginBefore !== null && ` · antes ${marginBefore}%`})
                </span>
              )}
            </p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                dre.lucroLiquidoCents < 0 ? "text-destructive" : "text-emerald-700"
              )}
            >
              {formatBRL(dre.lucroLiquidoCents)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* -- A DRE -------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
            <span>Conta</span>
            <span className="flex gap-4">
              <span className="w-16 text-right">% RL</span>
              <span className="w-28 text-right">Valor</span>
              <span className="w-16 text-right">vs anterior</span>
            </span>
          </div>

          {dre.sections.map((section) => {
            const before =
              previousDre.sections.find((s) => s.block === section.block)
                ?.totalCents ?? 0;

            return (
              <div key={section.block}>
                <Total
                  base={base}
                  label={section.label}
                  value={section.totalCents}
                  before={before}
                 
                />

                {section.lines.map((line) => {
                  const isOpen = open === line.accountCode;
                  const rows = entries[line.accountCode] ?? [];
                  return (
                    <div key={line.accountCode}>
                      <button
                        type="button"
                        onClick={() => toggle(line.accountCode)}
                        className="flex w-full flex-wrap items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/60"
                      >
                        <span className="flex items-center gap-1 text-muted-foreground">
                          {isOpen ? (
                            <ChevronDown className="size-3" />
                          ) : (
                            <ChevronRight className="size-3" />
                          )}
                          {line.accountCode} {line.accountName}
                        </span>
                        <span className="flex gap-4 tabular-nums">
                          <span className="w-16 text-right text-muted-foreground">
                            {verticalPercent(
                              line.amountCents,
                              dre.receitaLiquidaCents
                            ) ?? "—"}
                            %
                          </span>
                          <span className="w-28 text-right">
                            {formatBRL(line.amountCents)}
                          </span>
                          <span className="w-16" />
                        </span>
                      </button>

                      {isOpen && (
                        <div className="ml-4 rounded-lg border bg-muted/20 p-2 text-[11px]">
                          {rows.length === 0 ? (
                            <p className="text-muted-foreground">
                              {isPending ? "Carregando…" : "Nenhum lançamento."}
                            </p>
                          ) : (
                            <ul className="space-y-0.5">
                              {rows.map((e) => (
                                <li
                                  key={e.id}
                                  className="flex flex-wrap justify-between gap-2"
                                >
                                  <span className="min-w-0">
                                    <span className="text-muted-foreground">
                                      {fmtDate(e.accrualDate)}
                                    </span>{" "}
                                    {e.description || e.sourceType}
                                    {e.costCenterName && (
                                      <span className="ml-1 text-muted-foreground">
                                        · {e.costCenterName}
                                      </span>
                                    )}
                                    {e.status === "open" && (
                                      <span className="ml-1 text-amber-700">
                                        · em aberto
                                      </span>
                                    )}
                                  </span>
                                  <span className="tabular-nums">
                                    {formatBRL(e.amountCents)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="mt-1 border-t pt-1 text-[10px] text-muted-foreground">
                            Mostrando até 300 lançamentos do período.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Os subtotais que se lê de verdade, na ordem da estrutura. */}
                {section.block === "deducoes" && (
                  <Total
                    base={base}
                    label="= Receita líquida"
                    value={dre.receitaLiquidaCents}
                    before={previousDre.receitaLiquidaCents}
                    strong
                  />
                )}
                {section.block === "custos_diretos" && (
                  <Total
                    base={base}
                    label="= Lucro bruto"
                    value={dre.lucroBrutoCents}
                    before={previousDre.lucroBrutoCents}
                    strong
                  />
                )}
                {section.block === "despesas_operacionais" && (
                  <Total
                    base={base}
                    label="= EBITDA"
                    value={dre.ebitdaCents}
                    before={previousDre.ebitdaCents}
                    strong
                  />
                )}
              </div>
            );
          })}

          <Total
            base={base}
            label="= Lucro líquido"
            value={dre.lucroLiquidoCents}
            before={previousDre.lucroLiquidoCents}
            strong
          />

          <p className="pt-2 text-[10px] text-muted-foreground">
            <strong>% RL</strong> = a linha como percentual da receita líquida —
            é assim que se enxerga que o material subiu de 8% para 13% mesmo com
            o faturamento crescendo. Compra de bens e de estoque{" "}
            <strong>não aparecem aqui</strong>: viram ativo e entram no resultado
            aos poucos, pela depreciação e pelo consumo. Recebimentos e
            pagamentos também não: a venda já contou quando foi feita — quem
            mostra o dinheiro entrando é o fluxo de caixa.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
