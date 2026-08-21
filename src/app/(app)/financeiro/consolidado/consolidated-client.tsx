"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { verticalPercent } from "@/lib/finance/dre";
import {
  unitMargin,
  versusAverage,
  type Consolidated,
  type ConsolidationScope,
  type NetworkTotals,
  type UnitSummary,
} from "@/lib/finance/consolidation";
import {
  loadClinicBreakdown,
  setClinicOwnership,
  type ClinicBreakdown,
} from "./actions";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

function pct(v: number | null, digits = 1): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(digits).replace(".", ",")}%`;
}

/** Uma linha de subtotal. */
function Total({
  label,
  value,
  base,
  strong,
}: {
  label: string;
  value: number;
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
        <span className="w-32 text-right">{formatBRL(value)}</span>
      </span>
    </div>
  );
}

export function ConsolidatedView({
  from,
  to,
  scope,
  consolidated,
  units,
  totals,
  clinics,
}: {
  from: string;
  to: string;
  scope: ConsolidationScope;
  consolidated: Consolidated;
  units: UnitSummary[];
  totals: NetworkTotals;
  clinics: { id: string; name: string; ownership: "own" | "franchised" }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, ClinicBreakdown[]>>({});

  function apply(next: Partial<{ de: string; ate: string; vista: string }>) {
    const params = new URLSearchParams({
      de: next.de ?? from,
      ate: next.ate ?? to,
      vista: next.vista ?? scope,
    });
    startTransition(() => router.push(`/financeiro/consolidado?${params}`));
  }

  function toggle(accountCode: string) {
    if (open === accountCode) {
      setOpen(null);
      return;
    }
    setOpen(accountCode);
    if (rows[accountCode]) return;
    startTransition(async () => {
      const r = await loadClinicBreakdown({ from, to, scope, accountCode });
      if (r.ok && r.rows) setRows((v) => ({ ...v, [accountCode]: r.rows! }));
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function changeOwnership(clinicId: string, ownership: "own" | "franchised") {
    startTransition(async () => {
      const r = await setClinicOwnership({ clinicId, ownership });
      if (r.ok) toast.success("Marcação salva.");
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const { dre } = consolidated;
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
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant={scope === "grupo" ? "default" : "outline"}
              onClick={() => apply({ vista: "grupo" })}
            >
              Resultado do Grupo
            </Button>
            <Button
              size="sm"
              variant={scope === "rede" ? "default" : "outline"}
              onClick={() => apply({ vista: "rede" })}
            >
              Faturamento da Rede
            </Button>
          </div>
        </CardContent>
      </Card>

      {scope === "grupo" ? (
        <>
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Receita líquida
                </p>
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
                  Lucro líquido do grupo
                </p>
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    dre.lucroLiquidoCents < 0
                      ? "text-destructive"
                      : "text-emerald-700"
                  )}
                >
                  {formatBRL(dre.lucroLiquidoCents)}
                </p>
              </div>
            </CardContent>
          </Card>

          {consolidated.fullyEliminated.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2 text-xs">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Contas eliminadas por inteiro:{" "}
                <strong>{consolidated.fullyEliminated.join(", ")}</strong>. Era
                dinheiro trocando de bolso dentro do grupo — sai do faturamento e
                do custo <strong>sem mexer no lucro</strong>, que é o que
                consolidar significa.
              </span>
            </p>
          )}

          <Card>
            <CardContent className="space-y-1 p-4 text-sm">
              <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
                <span>Conta</span>
                <span className="flex gap-4">
                  <span className="w-16 text-right">% RL</span>
                  <span className="w-32 text-right">Grupo</span>
                  <span className="w-28 text-right">Eliminado</span>
                </span>
              </div>

              {dre.sections.map((section) => (
                <div key={section.block}>
                  <Total
                    base={base}
                    label={section.label}
                    value={section.totalCents}
                  />

                  {section.lines.map((l) => {
                    const full = consolidated.lines.find(
                      (x) => x.accountCode === l.accountCode
                    );
                    const isOpen = open === l.accountCode;
                    const detail = rows[l.accountCode] ?? [];
                    return (
                      <div key={l.accountCode}>
                        <button
                          type="button"
                          onClick={() => toggle(l.accountCode)}
                          className="flex w-full flex-wrap items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/60"
                        >
                          <span className="flex items-center gap-1 text-muted-foreground">
                            {isOpen ? (
                              <ChevronDown className="size-3" />
                            ) : (
                              <ChevronRight className="size-3" />
                            )}
                            {l.accountCode} {l.accountName}
                          </span>
                          <span className="flex gap-4 tabular-nums">
                            <span className="w-16 text-right text-muted-foreground">
                              {verticalPercent(l.amountCents, base) ?? "—"}%
                            </span>
                            <span className="w-32 text-right">
                              {formatBRL(l.amountCents)}
                            </span>
                            <span className="w-28 text-right text-muted-foreground">
                              {full && full.eliminatedCents !== 0
                                ? formatBRL(full.eliminatedCents)
                                : "—"}
                            </span>
                          </span>
                        </button>

                        {isOpen && (
                          <div className="ml-4 rounded-lg border bg-muted/20 p-2 text-[11px]">
                            {detail.length === 0 ? (
                              <p className="text-muted-foreground">
                                {isPending ? "Carregando…" : "Nada nesta conta."}
                              </p>
                            ) : (
                              <ul className="space-y-0.5">
                                {detail.map((d) => (
                                  <li
                                    key={d.clinicName}
                                    className="flex justify-between gap-2"
                                  >
                                    <span>
                                      {d.clinicName}{" "}
                                      <span className="text-muted-foreground">
                                        ·{" "}
                                        {d.ownership === "franqueadora"
                                          ? "franqueadora"
                                          : d.ownership === "own"
                                            ? "própria"
                                            : "franqueada"}
                                      </span>
                                    </span>
                                    <span className="tabular-nums">
                                      {formatBRL(d.amountCents)}
                                      {d.eliminatedCents !== 0 && (
                                        <span className="ml-1 text-muted-foreground">
                                          (elim. {formatBRL(d.eliminatedCents)})
                                        </span>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {section.block === "deducoes" && (
                    <Total
                      base={base}
                      label="= Receita líquida"
                      value={dre.receitaLiquidaCents}
                      strong
                    />
                  )}
                  {section.block === "custos_diretos" && (
                    <Total
                      base={base}
                      label="= Lucro bruto"
                      value={dre.lucroBrutoCents}
                      strong
                    />
                  )}
                  {section.block === "despesas_operacionais" && (
                    <Total
                      base={base}
                      label="= EBITDA"
                      value={dre.ebitdaCents}
                      strong
                    />
                  )}
                </div>
              ))}

              <Total
                base={base}
                label="= Lucro líquido do grupo"
                value={dre.lucroLiquidoCents}
                strong
              />

              <p className="pt-2 text-[10px] text-muted-foreground">
                Cada linha abre por <strong>unidade</strong>, não por lançamento:
                aqui a pergunta é quem trouxe o número. O caminho até o documento
                continua na DRE da unidade. Lançamento entre empresas feito à mão,
                sem origem em conta de taxa,{" "}
                <strong>não é eliminado automaticamente</strong>.
              </p>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-muted-foreground">Unidades</p>
                <p className="text-lg font-semibold tabular-nums">
                  {totals.units}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({totals.ownUnits} própria{totals.ownUnits === 1 ? "" : "s"})
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Faturamento da rede
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatBRL(totals.grossRevenueCents)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Média por unidade
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatBRL(totals.averageGrossCents)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Resultado somado
                </p>
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    totals.resultCents < 0 && "text-destructive"
                  )}
                >
                  {formatBRL(totals.resultCents)}
                </p>
              </div>
            </CardContent>
          </Card>

          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
            <Info className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <span>
              Aqui <strong>nada é eliminado</strong> — é comparação entre
              unidades, não soma de grupo. Este resultado{" "}
              <strong>não é de ninguém</strong>: somá-lo ao da franqueadora é o
              erro que faz uma rede parecer dez vezes maior do que é.
            </span>
          </p>

          <Card>
            <CardContent className="space-y-1 p-4 text-sm">
              <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
                <span>Unidade</span>
                <span className="flex gap-4">
                  <span className="w-32 text-right">Faturamento</span>
                  <span className="w-20 text-right">vs média</span>
                  <span className="w-28 text-right">Resultado</span>
                  <span className="w-16 text-right">Margem</span>
                </span>
              </div>
              {units.length === 0 ? (
                <p className="py-3 text-muted-foreground">
                  Nenhuma unidade com movimento no período.
                </p>
              ) : (
                units.map((u) => {
                  const vs = versusAverage(u, totals);
                  return (
                    <div
                      key={u.clinicId}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1.5 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        {u.clinicName}
                        {u.ownership === "own" && (
                          <span className="rounded bg-primary/10 px-1 text-[10px] text-primary">
                            própria
                          </span>
                        )}
                      </span>
                      <span className="flex gap-4 tabular-nums">
                        <span className="w-32 text-right">
                          {formatBRL(u.grossRevenueCents)}
                        </span>
                        <span
                          className={cn(
                            "w-20 text-right text-xs",
                            vs !== null && vs < 0
                              ? "text-destructive"
                              : "text-emerald-700"
                          )}
                        >
                          {vs === null
                            ? "—"
                            : `${vs > 0 ? "+" : ""}${pct(vs, 0)}`}
                        </span>
                        <span
                          className={cn(
                            "w-28 text-right",
                            u.resultCents < 0 && "text-destructive"
                          )}
                        >
                          {formatBRL(u.resultCents)}
                        </span>
                        <span className="w-16 text-right text-xs text-muted-foreground">
                          {pct(unitMargin(u))}
                        </span>
                      </span>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* -- PRÓPRIA OU FRANQUEADA --------------------------------------- */}
      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold">Própria ou franqueada</h2>
          <p className="pb-1 text-[11px] text-muted-foreground">
            É esta marcação que decide quem entra no{" "}
            <strong>Resultado do Grupo</strong>. Unidade franqueada fica de fora:
            a franqueadora ganha o royalty dela, não a receita.
          </p>
          {clinics.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 border-t py-1.5 text-sm"
            >
              <span>{c.name}</span>
              <select
                value={c.ownership}
                onChange={(e) =>
                  changeOwnership(
                    c.id,
                    e.target.value === "own" ? "own" : "franchised"
                  )
                }
                className={cn(selectClass, "w-40")}
              >
                <option value="franchised">Franqueada</option>
                <option value="own">Própria (entra no grupo)</option>
              </select>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
