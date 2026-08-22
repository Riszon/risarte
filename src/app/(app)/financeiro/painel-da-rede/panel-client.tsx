"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Lock, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  averagePerUnit,
  byAttention,
  monthOverMonth,
  statusReasons,
  unitStatus,
  type MonthPoint,
  type PanelTotals,
  type UnitPanelRow,
  type UnitStatus,
} from "@/lib/finance/network-panel";
import { checkAllAlerts } from "./actions";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const DOT: Record<UnitStatus, string> = {
  vermelho: "bg-destructive",
  amarelo: "bg-amber-500",
  verde: "bg-emerald-600",
};

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;
}

function fmtMonth(iso: string): string {
  const [y, m] = iso.slice(0, 7).split("-");
  return `${m}/${y}`;
}

export function NetworkPanelView({
  year,
  month,
  rows,
  totals,
  points,
}: {
  year: number;
  month: number;
  rows: UnitPanelRow[];
  totals: PanelTotals;
  points: MonthPoint[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);

  function apply(next: Partial<{ ano: number; mes: number }>) {
    const params = new URLSearchParams({
      ano: String(next.ano ?? year),
      mes: String(next.mes ?? month),
    });
    startTransition(() => router.push(`/financeiro/painel-da-rede?${params}`));
  }

  function apurar() {
    startTransition(async () => {
      const r = await checkAllAlerts();
      if (r.ok) {
        toast.success(
          r.count
            ? `${r.count} ${r.count === 1 ? "alerta enviado" : "alertas enviados"}.`
            : "Nada novo a avisar."
        );
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const ordered = [...rows].sort(byAttention);

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* -- FILTROS ------------------------------------------------------ */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="block">
            <Label className="text-[11px]">Ano</Label>
            <Input
              className="h-8 w-24"
              type="number"
              value={year}
              onChange={(e) => apply({ ano: Number(e.target.value) })}
            />
          </label>
          <label className="block">
            <Label className="text-[11px]">Mês (taxas)</Label>
            <select
              value={month}
              onChange={(e) => apply({ mes: Number(e.target.value) })}
              className={cn(selectClass, "w-36")}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={apurar}
          >
            <RefreshCw className="mr-1 size-3" /> Apurar alertas agora
          </Button>
        </CardContent>
      </Card>

      {/* -- O RESUMO ----------------------------------------------------- */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-muted-foreground">Unidades</p>
            <p className="flex items-center gap-2 text-lg font-semibold">
              {totals.units}
              <span className="flex items-center gap-1 text-xs font-normal">
                <span className={cn("size-2 rounded-full", DOT.vermelho)} />
                {totals.red}
                <span className={cn("ml-1 size-2 rounded-full", DOT.amarelo)} />
                {totals.yellow}
                <span className={cn("ml-1 size-2 rounded-full", DOT.verde)} />
                {totals.green}
              </span>
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">
              Taxas do mês — em aberto
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {formatBRL(totals.feesOpenCents)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              de {formatBRL(totals.feesDueCents)} apurados
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Taxas vencidas</p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                totals.feesOverdueCents > 0 && "text-destructive"
              )}
            >
              {formatBRL(totals.feesOverdueCents)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">
              Mês anterior em aberto
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {totals.notClosed}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {totals.notClosed === 1 ? "unidade" : "unidades"}
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* -- O SEMÁFORO --------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
            <span>Unidade</span>
            <span className="flex gap-3">
              <span className="w-28 text-right">Taxa em aberto</span>
              <span className="w-28 text-right">A receber vencido</span>
              <span className="w-16 text-right">Fech.</span>
            </span>
          </div>

          {ordered.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">
              Nenhuma unidade ativa.
            </p>
          ) : (
            ordered.map((u) => {
              const status = unitStatus(u);
              const reasons = statusReasons(u);
              const isOpen = open === u.clinicId;
              return (
                <div key={u.clinicId}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : u.clinicId)}
                    className="flex w-full flex-wrap items-baseline justify-between gap-2 border-t py-1.5 text-left hover:bg-muted/60"
                  >
                    <span className="flex items-center gap-2">
                      {isOpen ? (
                        <ChevronDown className="size-3" />
                      ) : (
                        <ChevronRight className="size-3" />
                      )}
                      <span
                        className={cn("size-2 rounded-full", DOT[status])}
                        title={status}
                      />
                      {u.clinicName}
                      {u.ownership === "own" && (
                        <span className="rounded bg-primary/10 px-1 text-[10px] text-primary">
                          própria
                        </span>
                      )}
                      {reasons.length > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                          {reasons.join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="flex gap-3 tabular-nums">
                      <span
                        className={cn(
                          "w-28 text-right",
                          u.feesOverdueCents > 0 && "text-destructive"
                        )}
                      >
                        {u.feesOpenCents ? formatBRL(u.feesOpenCents) : "—"}
                      </span>
                      <span className="w-28 text-right text-muted-foreground">
                        {u.overdueCents ? formatBRL(u.overdueCents) : "—"}
                      </span>
                      <span className="w-16 text-right">
                        {u.prevMonthClosed ? (
                          <Lock className="ml-auto size-3 text-emerald-700" />
                        ) : (
                          <span className="text-[10px] text-amber-700">
                            aberto
                          </span>
                        )}
                      </span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="ml-4 space-y-1 rounded-lg border bg-muted/20 p-2 text-[11px]">
                      {u.alerts === 0 ? (
                        <p className="text-muted-foreground">
                          Nenhum alerta ativo nesta unidade.
                        </p>
                      ) : (
                        <>
                          {u.alertCaixa && (
                            <p>
                              <strong>Caixa:</strong> {u.alertCaixa}
                            </p>
                          )}
                          {u.alertOrcamento && (
                            <p>
                              <strong>Orçamento:</strong> {u.alertOrcamento}
                            </p>
                          )}
                          {u.alertEquilibrio && (
                            <p>
                              <strong>Ponto de equilíbrio:</strong>{" "}
                              {u.alertEquilibrio}
                            </p>
                          )}
                          {u.alertAtraso && (
                            <p>
                              <strong>Atraso:</strong> {u.alertAtraso}
                            </p>
                          )}
                        </>
                      )}
                      <p className="border-t pt-1 text-muted-foreground">
                        Taxas de {MONTHS[month - 1]}: apurado{" "}
                        {formatBRL(u.feesDueCents)} · recebido{" "}
                        {formatBRL(u.feesPaidCents)} · em aberto{" "}
                        {formatBRL(u.feesOpenCents)}
                        {u.feesOverdueCents > 0 && (
                          <strong className="text-destructive">
                            {" "}
                            · vencido {formatBRL(u.feesOverdueCents)}
                          </strong>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              );
            })
          )}

          <p className="pt-2 text-[10px] text-muted-foreground">
            <strong>Vermelho</strong> é só o que já dói: caixa negativo previsto
            ou taxa da rede vencida. <strong>Amarelo</strong> é o que ainda dá
            para resolver. Se tudo fosse vermelho, o painel deixaria de ordenar
            prioridade. Os alertas vêm da <strong>última apuração</strong> (o
            sistema roda às 9h) — use o botão acima para apurar na hora.
          </p>
        </CardContent>
      </Card>

      {/* -- A EVOLUÇÃO --------------------------------------------------- */}
      <Card>
        <CardContent className="p-4 text-sm">
          <h2 className="pb-1 text-sm font-semibold">
            Faturamento da rede, mês a mês
          </h2>
          <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
            <span>Mês</span>
            <span className="flex gap-3">
              <span className="w-32 text-right">Faturamento</span>
              <span className="w-16 text-right">vs mês ant.</span>
              <span className="w-16 text-right">Unidades</span>
              <span className="w-28 text-right">Média/unidade</span>
            </span>
          </div>
          {points.map((p, i) => (
            <div
              key={p.month}
              className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1 text-xs"
            >
              <span>{fmtMonth(p.month)}</span>
              <span className="flex gap-3 tabular-nums">
                <span className="w-32 text-right">
                  {formatBRL(p.grossCents)}
                </span>
                <span
                  className={cn(
                    "w-16 text-right",
                    (monthOverMonth(points, i) ?? 0) < 0 && "text-destructive"
                  )}
                >
                  {pct(monthOverMonth(points, i))}
                </span>
                <span className="w-16 text-right text-muted-foreground">
                  {p.units || "—"}
                </span>
                <span className="w-28 text-right text-muted-foreground">
                  {formatBRL(averagePerUnit(p))}
                </span>
              </span>
            </div>
          ))}
          <p className="pt-2 text-[10px] text-muted-foreground">
            Faturamento das unidades, sem eliminação — é a rede se comparando com
            ela mesma. Não é o resultado do grupo: para isso, o{" "}
            <strong>Consolidado</strong>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
