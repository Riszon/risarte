import { CalendarClock, Clock, Layers, ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinutes, formatSessions, type BudgetItem } from "@/lib/pricing";
import type { PlanOption, PlanStage } from "@/lib/planning";

/** Mini-cartão de número (sessões / cadeira / etapas) no topo do resumo. */
function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-foreground">
        {icon}
      </span>
      <div className="leading-tight">
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/** "3 sessões · 2h" a partir do que o Planner planejou no item. */
function itemPlanned(it: BudgetItem): string | null {
  const parts: string[] = [];
  if (it.plannedSessions) parts.push(formatSessions(it.plannedSessions));
  if (it.plannedMinutes) parts.push(formatMinutes(it.plannedMinutes));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function sumSessions(items: BudgetItem[]): number {
  return items.reduce((s, i) => s + (i.plannedSessions ?? 0), 0);
}
function sumMinutes(items: BudgetItem[]): number {
  return items.reduce((s, i) => s + (i.plannedMinutes ?? 0), 0);
}

/**
 * H4.5 Lote 2: projeção do tratamento no cockpit do Planner — a partir da opção
 * escolhida (principal), agrupa por etapa e mostra sessões + tempo de cadeira por
 * etapa e no total. As DATAS só existem ao agendar (Fase 5); aqui é a estrutura
 * e o esforço planejado.
 */
export function TreatmentSummary({ option }: { option: PlanOption }) {
  if (option.items.length === 0) return null;

  const stages = [...option.stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const stageIds = new Set(stages.map((s) => s.id));
  const groups: { stage: PlanStage | null; items: BudgetItem[] }[] = [
    ...stages.map((stage) => ({
      stage: stage as PlanStage | null,
      items: option.items.filter((i) => i.stageId === stage.id),
    })),
    {
      stage: null,
      items: option.items.filter(
        (i) => !i.stageId || !stageIds.has(i.stageId)
      ),
    },
  ];
  const totalSessions = sumSessions(option.items);
  const totalMinutes = sumMinutes(option.items);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Resumo do tratamento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {totalSessions > 0 && (
            <StatCard
              icon={<CalendarClock className="size-4" />}
              value={formatSessions(totalSessions)}
              label="no total"
            />
          )}
          {totalMinutes > 0 && (
            <StatCard
              icon={<Clock className="size-4" />}
              value={formatMinutes(totalMinutes)}
              label="de cadeira"
            />
          )}
          {stages.length > 0 && (
            <StatCard
              icon={<ListChecks className="size-4" />}
              value={String(stages.length)}
              label={stages.length === 1 ? "etapa" : "etapas"}
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Baseado no plano{" "}
          {option.isPrimary ? "principal" : `“${option.title}”`}. As datas são
          definidas ao agendar (Início de Tratamento).
        </p>
        <div className="space-y-2">
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <div key={g.stage?.id ?? "none"} className="rounded-md border p-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <p className="flex items-center gap-1 text-sm font-medium">
                      {(g.stage || stages.length > 0) && (
                        <Layers className="size-3.5 text-muted-foreground" />
                      )}
                      {g.stage ? g.stage.name : "Sem etapa"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatSessions(sumSessions(g.items))} ·{" "}
                      {formatMinutes(sumMinutes(g.items))}
                    </p>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                    {g.items.map((it) => (
                      <li key={it.id}>
                        {it.quantity}× {it.description}
                        {itemPlanned(it) && (
                          <span className="text-xs"> — {itemPlanned(it)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )
          )}
        </div>
      </CardContent>
    </Card>
  );
}
