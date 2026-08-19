"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  variance,
  type BudgetReport,
  type VarianceStatus,
} from "@/lib/finance/budget";
import {
  copyBudgetYear,
  fillBudgetFromActual,
  saveBudgetLine,
} from "./actions";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const STATUS_STYLE: Record<VarianceStatus, string> = {
  sem_meta: "text-muted-foreground",
  melhor: "text-emerald-700",
  no_alvo: "text-muted-foreground",
  atencao: "text-amber-700",
  estourou: "text-destructive",
};

const STATUS_LABEL: Record<VarianceStatus, string> = {
  sem_meta: "sem meta",
  melhor: "melhor",
  no_alvo: "no alvo",
  atencao: "atenção",
  estourou: "fora",
};

/** Centavos a partir do que a pessoa digitou ("1.234,56" ou "1234.56"). */
function parseCents(text: string): number {
  const clean = text.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : 0;
}

function VarianceCell({
  actualCents,
  budgetCents,
}: {
  actualCents: number;
  budgetCents: number;
}) {
  const v = variance(actualCents, budgetCents);
  return (
    <span className={cn("tabular-nums", STATUS_STYLE[v.status])}>
      {v.percent === null
        ? "—"
        : `${v.deltaCents > 0 ? "+" : ""}${(v.percent * 100).toFixed(0)}%`}
    </span>
  );
}

export function BudgetView({
  clinicId,
  year,
  month,
  view,
  report,
  accounts,
  currentBudget,
  canEdit,
}: {
  clinicId: string;
  year: number;
  month: number;
  view: "planejar" | "comparar";
  report: BudgetReport;
  accounts: { code: string; name: string }[];
  currentBudget: Record<string, number>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [percent, setPercent] = useState("0");
  const [sourceYear, setSourceYear] = useState(String(year - 1));

  function apply(
    next: Partial<{ ano: number; mes: number; vista: string }>
  ) {
    const params = new URLSearchParams({
      ano: String(next.ano ?? year),
      mes: String(next.mes ?? month),
      vista: next.vista ?? view,
    });
    startTransition(() => router.push(`/financeiro/orcamento?${params}`));
  }

  function save(accountCode: string, text: string) {
    const cents = parseCents(text);
    if (cents === (currentBudget[accountCode] ?? 0)) return;
    startTransition(async () => {
      const r = await saveBudgetLine({
        clinicId,
        year,
        month,
        accountCode,
        amountCents: cents,
      });
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function runCopy() {
    startTransition(async () => {
      const r = await copyBudgetYear({
        clinicId,
        fromYear: Number(sourceYear),
        toYear: year,
        percent: Number(percent.replace(",", ".")) || 0,
        overwrite: false,
      });
      if (r.ok) toast.success(`${r.count ?? 0} metas copiadas.`);
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function runSuggest() {
    startTransition(async () => {
      const r = await fillBudgetFromActual({
        clinicId,
        toYear: year,
        monthsBack: 3,
        percent: Number(percent.replace(",", ".")) || 0,
        overwrite: false,
      });
      if (r.ok) toast.success(`${r.count ?? 0} metas sugeridas.`);
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const resultVar = variance(
    report.resultActualCents,
    report.resultBudgetCents
  );

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
            <Label className="text-[11px]">Mês</Label>
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
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant={view === "comparar" ? "default" : "outline"}
              onClick={() => apply({ vista: "comparar" })}
            >
              Comparar
            </Button>
            <Button
              size="sm"
              variant={view === "planejar" ? "default" : "outline"}
              onClick={() => apply({ vista: "planejar" })}
            >
              Planejar
            </Button>
          </div>
        </CardContent>
      </Card>

      {view === "comparar" ? (
        <>
          {/* -- RESUMO -------------------------------------------------- */}
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Resultado orçado
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatBRL(report.resultBudgetCents)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Resultado realizado
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatBRL(report.resultActualCents)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Diferença</p>
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    STATUS_STYLE[resultVar.status]
                  )}
                >
                  {formatBRL(resultVar.deltaCents)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {STATUS_LABEL[resultVar.status]}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Acumulado do ano
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatBRL(report.ytdActualCents)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  meta {formatBRL(report.ytdBudgetCents)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* -- A TABELA ------------------------------------------------ */}
          <Card>
            <CardContent className="space-y-1 p-4 text-sm">
              <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
                <span>Conta</span>
                <span className="flex gap-3">
                  <span className="w-24 text-right">Orçado</span>
                  <span className="w-24 text-right">Realizado</span>
                  <span className="w-24 text-right">Diferença</span>
                  <span className="w-12 text-right">%</span>
                  <span className="w-28 text-right">Acum. × meta</span>
                </span>
              </div>

              {report.sections.map((s) => (
                <div key={s.block}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1.5 font-semibold">
                    <span>{s.label}</span>
                    <span className="flex gap-3 tabular-nums">
                      <span className="w-24 text-right">
                        {formatBRL(s.budgetCents)}
                      </span>
                      <span className="w-24 text-right">
                        {formatBRL(s.actualCents)}
                      </span>
                      <span className="w-24 text-right">
                        {formatBRL(s.actualCents - s.budgetCents)}
                      </span>
                      <span className="w-12 text-right text-xs">
                        <VarianceCell
                          actualCents={s.actualCents}
                          budgetCents={s.budgetCents}
                        />
                      </span>
                      <span className="w-28 text-right text-xs text-muted-foreground">
                        {formatBRL(s.ytdActualCents)}
                      </span>
                    </span>
                  </div>

                  {s.rows.map((r) => (
                    <div
                      key={r.accountCode}
                      className="flex flex-wrap items-baseline justify-between gap-2 px-1 py-0.5 text-xs"
                    >
                      <span className="text-muted-foreground">
                        {r.accountCode} {r.accountName}
                      </span>
                      <span className="flex gap-3 tabular-nums">
                        <span className="w-24 text-right">
                          {r.budgetCents ? formatBRL(r.budgetCents) : "—"}
                        </span>
                        <span className="w-24 text-right">
                          {formatBRL(r.actualCents)}
                        </span>
                        <span className="w-24 text-right">
                          {formatBRL(r.actualCents - r.budgetCents)}
                        </span>
                        <span className="w-12 text-right">
                          <VarianceCell
                            actualCents={r.actualCents}
                            budgetCents={r.budgetCents}
                          />
                        </span>
                        <span className="w-28 text-right text-muted-foreground">
                          {formatBRL(r.ytdActualCents)} ·{" "}
                          {r.ytdBudgetCents ? formatBRL(r.ytdBudgetCents) : "—"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ))}

              {report.sections.length === 0 && (
                <p className="py-4 text-center text-muted-foreground">
                  Nada lançado nem orçado neste mês.
                </p>
              )}

              <p className="pt-2 text-[10px] text-muted-foreground">
                <strong>Diferença positiva é sempre melhor que o previsto</strong>{" "}
                — receita acima da meta e despesa abaixo dela dão o mesmo sinal,
                porque a meta é guardada com o mesmo sinal do realizado. A
                coluna do acumulado compara o ano até este mês, não o ano
                inteiro: senão março pareceria 75% abaixo do orçado sempre.
              </p>
            </CardContent>
          </Card>
        </>
      ) : (
        /* -- PLANEJAR ---------------------------------------------------- */
        <>
          {canEdit && (
            <Card>
              <CardContent className="flex flex-wrap items-end gap-3 p-4">
                <label className="block">
                  <Label className="text-[11px]">Copiar do ano</Label>
                  <Input
                    className="h-8 w-24"
                    type="number"
                    value={sourceYear}
                    onChange={(e) => setSourceYear(e.target.value)}
                  />
                </label>
                <label className="block">
                  <Label className="text-[11px]">Reajuste %</Label>
                  <Input
                    className="h-8 w-24"
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                  />
                </label>
                <Button size="sm" variant="outline" onClick={runCopy}>
                  Copiar ano
                </Button>
                <Button size="sm" variant="outline" onClick={runSuggest}>
                  Sugerir pela média de 3 meses
                </Button>
                <p className="ml-auto max-w-sm text-[11px] text-muted-foreground">
                  As duas opções <strong>não sobrescrevem</strong> meta já
                  preenchida. A sugestão pela média é rascunho: ela achata o
                  sazonal — janeiro nunca é igual a dezembro.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4">
              <h2 className="pb-1 text-sm font-semibold">
                Metas de {MONTHS[month - 1]} de {year}
              </h2>
              <p className="pb-2 text-[11px] text-muted-foreground">
                Digite o valor <strong>positivo</strong> — o sistema sabe se a
                conta soma ou subtrai. Deixe em branco (ou zero) para não ter
                meta.
              </p>
              {accounts.map((a) => (
                <div
                  key={a.code}
                  className="flex items-center justify-between gap-2 border-t py-1 text-xs"
                >
                  <span>
                    <span className="text-muted-foreground">{a.code}</span>{" "}
                    {a.name}
                  </span>
                  {/* Não controlado de propósito: a meta é salva ao sair do
                      campo. A `key` inclui o valor do servidor para o campo se
                      recarregar sozinho depois de copiar ou sugerir o ano. */}
                  <Input
                    key={`${a.code}-${currentBudget[a.code] ?? 0}`}
                    className="h-7 w-32 text-right tabular-nums"
                    disabled={!canEdit}
                    defaultValue={
                      currentBudget[a.code]
                        ? (currentBudget[a.code] / 100)
                            .toFixed(2)
                            .replace(".", ",")
                        : ""
                    }
                    placeholder="—"
                    onBlur={(e) => save(a.code, e.target.value)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
