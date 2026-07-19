"use client";

import { useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  ListChecks,
  Star,
  Stethoscope,
} from "lucide-react";
import { GutAverageBadge, GutBadge } from "@/components/gut-badge";
import { sortByGutDesc } from "@/lib/gut";
import { formatMinutes, formatSessions, type BudgetItem } from "@/lib/pricing";
import type { PlanOption, PlanStage } from "@/lib/planning";

/** Mini-cartão de número (procedimentos / sessões / cadeira / etapas) no topo. */
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
 * H4.5 Lote 2: projeção do tratamento no cockpit do Planner. Navega entre TODAS
 * as opções do plano (setas), e por opção agrupa por etapa mostrando esforço
 * planejado + prioridade média. As DATAS só existem ao agendar (Fase 5).
 */
export function TreatmentSummary({ options }: { options: PlanOption[] }) {
  const usable = options.filter((o) => o.items.length > 0);
  const [idx, setIdx] = useState(0);
  if (usable.length === 0) return null;

  const i = Math.min(idx, usable.length - 1);
  const option = usable[i];

  const stages = [...option.stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const stageIds = new Set(stages.map((s) => s.id));
  const groups: { stage: PlanStage | null; items: BudgetItem[] }[] = [
    ...stages.map((stage) => ({
      stage: stage as PlanStage | null,
      items: sortByGutDesc(option.items.filter((it) => it.stageId === stage.id)),
    })),
    {
      stage: null,
      items: sortByGutDesc(
        option.items.filter((it) => !it.stageId || !stageIds.has(it.stageId))
      ),
    },
  ];
  const totalSessions = sumSessions(option.items);
  const totalMinutes = sumMinutes(option.items);

  return (
    <div className="space-y-3">
      {/* Navegação entre os planos (opções). */}
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          {option.isPrimary && (
            <Star className="size-3.5 shrink-0 fill-gold text-gold" />
          )}
          <span className="truncate">{option.title}</span>
          {option.isPrimary && (
            <span className="shrink-0 rounded-full bg-gold px-2 py-0.5 text-[10px] font-medium text-gold-foreground">
              Principal
            </span>
          )}
        </p>
        {usable.length > 1 && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="Plano anterior"
              disabled={i === 0}
              onClick={() => setIdx(i - 1)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {i + 1}/{usable.length}
            </span>
            <button
              type="button"
              aria-label="Próximo plano"
              disabled={i === usable.length - 1}
              onClick={() => setIdx(i + 1)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          icon={<Stethoscope className="size-4" />}
          value={String(option.items.length)}
          label={option.items.length === 1 ? "procedimento" : "procedimentos"}
        />
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

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <GutAverageBadge items={option.items} />
        <span>
          As datas são definidas ao agendar (Início de Tratamento).
        </span>
      </div>

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
                    <li
                      key={it.id}
                      className="flex flex-wrap items-center gap-x-1.5"
                    >
                      <span>
                        {it.quantity}× {it.description}
                        {itemPlanned(it) && (
                          <span className="text-xs"> — {itemPlanned(it)}</span>
                        )}
                      </span>
                      <GutBadge item={it} />
                    </li>
                  ))}
                </ul>
              </div>
            )
        )}
      </div>
    </div>
  );
}
