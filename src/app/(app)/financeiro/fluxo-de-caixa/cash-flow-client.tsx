"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  periodLabel,
  type CashGroupBy,
  type CashPeriod,
  type CashTotals,
} from "@/lib/finance/cash-flow";
import { loadCashDetail, type CashDetailRow } from "./actions";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

const GROUP_LABELS: { value: CashGroupBy; label: string }[] = [
  { value: "dia", label: "Por dia" },
  { value: "semana", label: "Por semana" },
  { value: "mes", label: "Por mês" },
];

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "positivo" | "negativo" | "neutro";
}) {
  const color =
    tone === "negativo" || (tone !== "neutro" && value < 0)
      ? "text-destructive"
      : tone === "positivo"
        ? "text-emerald-700"
        : "";
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", color)}>
        {formatBRL(value)}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function CashFlowView({
  clinicId,
  from,
  to,
  today,
  groupBy,
  periods,
  totals,
  openingCents,
  todayBalanceCents,
  negative,
  overdue,
  hasBankAccount,
}: {
  clinicId: string;
  from: string;
  to: string;
  today: string;
  groupBy: CashGroupBy;
  periods: CashPeriod[];
  totals: CashTotals;
  openingCents: number;
  todayBalanceCents: number;
  negative: { day: string; balanceCents: number } | null;
  overdue: {
    receivableCents: number;
    receivableCount: number;
    payableCents: number;
    payableCount: number;
  };
  hasBankAccount: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, CashDetailRow[]>>({});

  function apply(
    next: Partial<{ de: string; ate: string; agrupar: CashGroupBy }>
  ) {
    const params = new URLSearchParams({
      de: next.de ?? from,
      ate: next.ate ?? to,
      agrupar: next.agrupar ?? groupBy,
    });
    startTransition(() =>
      router.push(`/financeiro/fluxo-de-caixa?${params}`)
    );
  }

  function toggle(p: CashPeriod) {
    if (open === p.key) {
      setOpen(null);
      return;
    }
    setOpen(p.key);
    if (detail[p.key]) return;

    startTransition(async () => {
      const r = await loadCashDetail({
        clinicId,
        from: p.start,
        to: p.end,
      });
      if (r.ok && r.rows) {
        setDetail((d) => ({ ...d, [p.key]: r.rows! }));
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

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
            <Label className="text-[11px]">Agrupar</Label>
            <select
              value={groupBy}
              onChange={(e) =>
                apply({ agrupar: e.target.value as CashGroupBy })
              }
              className={cn(selectClass, "w-32")}
            >
              {GROUP_LABELS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <p className="ml-auto max-w-xs text-[11px] text-muted-foreground">
            Saldo de partida em {fmtDate(from)}:{" "}
            <strong className="tabular-nums">{formatBRL(openingCents)}</strong>
            {!hasBankAccount && (
              <>
                <br />
                Nenhuma conta bancária cadastrada — o saldo conta só o que passou
                pelo sistema.
              </>
            )}
          </p>
        </CardContent>
      </Card>

      {/* -- O AVISO QUE JUSTIFICA A TELA --------------------------------- */}
      {negative && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>
            <strong>O caixa fica negativo em {fmtDate(negative.day)}</strong> —
            faltam {formatBRL(Math.abs(negative.balanceCents))} naquele dia.
            Antecipar um recebimento ou empurrar um pagamento resolve; descobrir
            no dia, não.
          </p>
        </div>
      )}

      {(overdue.receivableCents > 0 || overdue.payableCents > 0) && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <Clock className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>
            <strong>Vencido, e fora da projeção:</strong>{" "}
            {overdue.receivableCount > 0 && (
              <>
                {formatBRL(overdue.receivableCents)} a receber (
                {overdue.receivableCount}{" "}
                {overdue.receivableCount === 1 ? "parcela" : "parcelas"})
              </>
            )}
            {overdue.receivableCount > 0 && overdue.payableCount > 0 && " · "}
            {overdue.payableCount > 0 && (
              <>
                {formatBRL(overdue.payableCents)} a pagar (
                {overdue.payableCount}{" "}
                {overdue.payableCount === 1 ? "conta" : "contas"})
              </>
            )}
            . Não somamos no saldo: a data já falhou uma vez, e contar de novo é
            como uma projeção de caixa mente para o lado otimista.
          </p>
        </div>
      )}

      {/* -- O RESUMO ----------------------------------------------------- */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <SummaryCard
            label="Saldo hoje"
            value={todayBalanceCents}
            hint="o que já é dinheiro"
          />
          <SummaryCard
            label="Entradas previstas"
            value={totals.expectedInflowCents}
            tone="neutro"
            hint="no período escolhido"
          />
          <SummaryCard
            label="Saídas previstas"
            value={totals.expectedOutflowCents}
            tone="neutro"
            hint="no período escolhido"
          />
          <SummaryCard
            label={`Saldo em ${fmtDate(to)}`}
            value={totals.endBalanceCents}
            hint="se tudo acontecer como está previsto"
          />
        </CardContent>
      </Card>

      {/* -- A LINHA DO TEMPO --------------------------------------------- */}
      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
            <span>Período</span>
            <span className="flex gap-3">
              <span className="w-24 text-right">Entradas</span>
              <span className="w-24 text-right">Saídas</span>
              <span className="w-24 text-right">Resultado</span>
              <span className="w-28 text-right">Saldo</span>
            </span>
          </div>

          {periods.map((p) => {
            const isOpen = open === p.key;
            const rows = detail[p.key] ?? [];
            const isPast = p.end < today;
            return (
              <div key={p.key}>
                <button
                  type="button"
                  onClick={() => toggle(p)}
                  className={cn(
                    "flex w-full flex-wrap items-baseline justify-between gap-2 rounded border-t px-1 py-1 text-left hover:bg-muted/60",
                    p.balanceCents < 0 && "bg-destructive/5"
                  )}
                >
                  <span className="flex items-center gap-1">
                    {isOpen ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {periodLabel(p, groupBy)}
                    {p.hasExpected && (
                      <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        {isPast ? "previsto" : "a acontecer"}
                      </span>
                    )}
                  </span>
                  <span className="flex gap-3 tabular-nums">
                    <span className="w-24 text-right">
                      {p.inflowCents ? formatBRL(p.inflowCents) : "—"}
                    </span>
                    <span className="w-24 text-right">
                      {p.outflowCents ? formatBRL(p.outflowCents) : "—"}
                    </span>
                    <span
                      className={cn(
                        "w-24 text-right",
                        p.netCents < 0 && "text-destructive"
                      )}
                    >
                      {p.netCents ? formatBRL(p.netCents) : "—"}
                    </span>
                    <span
                      className={cn(
                        "w-28 text-right font-medium",
                        p.balanceCents < 0 && "text-destructive"
                      )}
                    >
                      {formatBRL(p.balanceCents)}
                    </span>
                  </span>
                </button>

                {isOpen && (
                  <div className="ml-4 rounded-lg border bg-muted/20 p-2 text-[11px]">
                    {rows.length === 0 ? (
                      <p className="text-muted-foreground">
                        {isPending ? "Carregando…" : "Nenhum movimento."}
                      </p>
                    ) : (
                      <ul className="space-y-0.5">
                        {rows.map((r, i) => (
                          <li
                            key={`${r.sourceType}-${i}`}
                            className="flex flex-wrap justify-between gap-2"
                          >
                            <span className="min-w-0">
                              <span className="text-muted-foreground">
                                {fmtDate(r.refDate)}
                              </span>{" "}
                              {r.description || r.sourceType}
                              {r.kind === "previsto" && (
                                <span className="ml-1 text-amber-700">
                                  · previsto
                                </span>
                              )}
                            </span>
                            <span
                              className={cn(
                                "tabular-nums",
                                r.direction === "outflow" && "text-destructive"
                              )}
                            >
                              {r.direction === "outflow" ? "−" : "+"}
                              {formatBRL(r.amountCents)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 border-t pt-1 text-[10px] text-muted-foreground">
                      Mostrando até 300 movimentos do período.
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {/* -- POR ATIVIDADE ------------------------------------------- */}
          <div className="mt-3 grid gap-2 border-t pt-3 text-xs sm:grid-cols-3">
            <p>
              <span className="text-muted-foreground">Operacional</span>
              <br />
              <strong
                className={cn(
                  "tabular-nums",
                  totals.activityCents.operacional < 0 && "text-destructive"
                )}
              >
                {formatBRL(totals.activityCents.operacional)}
              </strong>
            </p>
            <p>
              <span className="text-muted-foreground">Investimento</span>
              <br />
              <strong className="tabular-nums">
                {formatBRL(totals.activityCents.investimento)}
              </strong>
            </p>
            <p>
              <span className="text-muted-foreground">Financiamento</span>
              <br />
              <strong className="tabular-nums">
                {formatBRL(totals.activityCents.financiamento)}
              </strong>
            </p>
          </div>

          <p className="pt-2 text-[10px] text-muted-foreground">
            <strong>Operacional</strong> é o caixa que o atendimento gera —
            fechar no azul por ter vendido uma cadeira (investimento) ou por ter
            pego empréstimo (financiamento) é outra coisa, e por isso ficam
            separados. A projeção é <strong>bruta</strong>: a taxa da adquirente
            aparece quando o dinheiro entra, então o previsto de cartão é um
            pouco otimista. Fim de semana e feriado não empurram vencimento, e
            conta recorrente só entra depois de gerada.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
