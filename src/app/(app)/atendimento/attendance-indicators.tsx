"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  ChartNoAxesColumn,
  ChevronRight,
  UserRoundX,
  CalendarX,
  DoorOpen,
  Repeat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Uma pessoa nas listas detalhadas (falta/cancelamento/desistência/troca). */
export type MetricPerson = {
  id: string | null;
  name: string;
  detail?: string | null;
};

export type AttendanceMetrics = {
  scheduled: number;
  completed: number;
  /** % de comparecimento (concluídos ÷ agendados) ou null se sem agendados. */
  attendanceRate: number | null;
  /** Sessões/procedimentos finalizados no período. */
  productivity: number;
  /** Tempo médio de espera (min) ou null se ninguém esperou/foi atendido. */
  avgWaitMin: number | null;
  noShows: MetricPerson[];
  cancellations: MetricPerson[];
  giveUps: MetricPerson[];
  swaps: MetricPerson[];
};

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ClickStat({
  label,
  count,
  icon,
  tint,
  onOpen,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  tint: string;
  onOpen: () => void;
}) {
  const disabled = count === 0;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className="flex items-center gap-2 rounded-lg border bg-card p-3 text-left transition-colors enabled:hover:bg-accent disabled:opacity-60"
    >
      <span className={tint}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="text-xl font-semibold tabular-nums">{count}</span>
      </span>
      {!disabled && (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

function PeopleList({
  title,
  people,
  onBack,
}: {
  title: string;
  people: MetricPerson[];
  onBack: () => void;
}) {
  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="size-4" /> Voltar aos indicadores
      </Button>
      <p className="text-sm font-medium">
        {title} <span className="text-muted-foreground">({people.length})</span>
      </p>
      <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
        {people.map((p, i) => (
          <li
            key={`${p.id ?? "x"}-${i}`}
            className="rounded-md border bg-card p-2.5 text-sm"
          >
            {p.id ? (
              <Link
                href={`/prontuarios/${p.id}`}
                className="font-medium hover:underline"
              >
                {p.name}
              </Link>
            ) : (
              <span className="font-medium">{p.name}</span>
            )}
            {p.detail && (
              <span className="ml-2 text-xs text-muted-foreground">
                {p.detail}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** H4.15: indicadores do Atendimento num popup, no período selecionado. */
export function AttendanceIndicators({
  metrics,
  periodLabel,
  scopeNote,
}: {
  metrics: AttendanceMetrics;
  periodLabel: string;
  /** Aviso do escopo (ex.: "somente os seus clientes" para o dentista). */
  scopeNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ title: string; people: MetricPerson[] } | null>(
    null
  );

  const rate =
    metrics.attendanceRate === null ? "—" : `${metrics.attendanceRate}%`;
  const wait =
    metrics.avgWaitMin === null
      ? "—"
      : metrics.avgWaitMin < 60
        ? `${metrics.avgWaitMin} min`
        : `${Math.floor(metrics.avgWaitMin / 60)}h ${metrics.avgWaitMin % 60}min`;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setList(null);
          setOpen(true);
        }}
      >
        <ChartNoAxesColumn className="size-4" /> Indicadores
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setList(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Indicadores — {periodLabel}</DialogTitle>
          </DialogHeader>
          {scopeNote && !list && (
            <p className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
              {scopeNote}
            </p>
          )}
          {list ? (
            <PeopleList
              title={list.title}
              people={list.people}
              onBack={() => setList(null)}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="Comparecimento"
                value={rate}
                sub="concluídos ÷ agendados"
              />
              <StatCard
                label="Produtividade"
                value={String(metrics.productivity)}
                sub="sessões finalizadas"
              />
              <StatCard label="Tempo médio de espera" value={wait} />
              <StatCard
                label="Concluídos"
                value={String(metrics.completed)}
                sub={`de ${metrics.scheduled} agendados`}
              />
              <ClickStat
                label="Faltas"
                count={metrics.noShows.length}
                icon={<UserRoundX className="size-5" />}
                tint="text-red-600"
                onOpen={() =>
                  setList({ title: "Faltas", people: metrics.noShows })
                }
              />
              <ClickStat
                label="Cancelamentos"
                count={metrics.cancellations.length}
                icon={<CalendarX className="size-5" />}
                tint="text-zinc-600"
                onOpen={() =>
                  setList({
                    title: "Cancelamentos",
                    people: metrics.cancellations,
                  })
                }
              />
              <ClickStat
                label="Desistiu de esperar"
                count={metrics.giveUps.length}
                icon={<DoorOpen className="size-5" />}
                tint="text-amber-600"
                onOpen={() =>
                  setList({
                    title: "Desistiu de esperar",
                    people: metrics.giveUps,
                  })
                }
              />
              <ClickStat
                label="Troca de profissional"
                count={metrics.swaps.length}
                icon={<Repeat className="size-5" />}
                tint="text-violet-600"
                onOpen={() =>
                  setList({
                    title: "Troca de profissional",
                    people: metrics.swaps,
                  })
                }
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
