import { Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinutes, formatSessions, type BudgetItem } from "@/lib/pricing";
import type { PlanOption, PlanStage } from "@/lib/planning";

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
        <div className="flex flex-wrap gap-2 text-sm">
          {totalSessions > 0 && (
            <span className="rounded-md bg-muted/50 px-2 py-1">
              <strong>{formatSessions(totalSessions)}</strong> no total
            </span>
          )}
          {totalMinutes > 0 && (
            <span className="rounded-md bg-muted/50 px-2 py-1">
              <strong>{formatMinutes(totalMinutes)}</strong> de cadeira
            </span>
          )}
          {stages.length > 0 && (
            <span className="rounded-md bg-muted/50 px-2 py-1">
              <strong>{stages.length}</strong>{" "}
              {stages.length === 1 ? "etapa" : "etapas"}
            </span>
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
