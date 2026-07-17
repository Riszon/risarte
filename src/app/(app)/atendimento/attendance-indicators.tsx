"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  CalendarX,
  ChartNoAxesColumn,
  ChevronRight,
  Clock,
  DoorOpen,
  ListChecks,
  Repeat,
  Timer,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  /** Quem apareceu na clínica (fez check-in) no período. */
  attended: number;
  completed: number;
  /** % de comparecimento (apareceram ÷ agendados) ou null se sem agendados. */
  attendanceRate: number | null;
  /** % de conclusão (concluídos ÷ agendados) ou null se sem agendados. */
  completionRate: number | null;
  /** Sessões/procedimentos finalizados no período. */
  productivity: number;
  /** Tempo médio de espera (min) ou null se ninguém esperou. */
  avgWaitMin: number | null;
  /** Tempo médio de atendimento (min) ou null se ninguém foi atendido. */
  avgServiceMin: number | null;
  noShows: MetricPerson[];
  cancellations: MetricPerson[];
  giveUps: MetricPerson[];
  swaps: MetricPerson[];
};

const RATE_TONE = {
  emerald: {
    card: "border-emerald-200 bg-emerald-50/60",
    bar: "bg-emerald-500",
    val: "text-emerald-800",
  },
  navy: {
    card: "border-primary/25 bg-primary/5",
    bar: "bg-primary",
    val: "text-primary",
  },
} as const;

/** Cartão principal: % grande + barra de progresso na cor da métrica. */
function RateCard({
  label,
  pct,
  caption,
  tone,
}: {
  label: string;
  pct: number | null;
  caption: string;
  tone: keyof typeof RATE_TONE;
}) {
  const t = RATE_TONE[tone];
  return (
    <div className={cn("rounded-xl border p-3.5", t.card)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-3xl font-semibold tabular-nums", t.val)}>
        {pct === null ? "—" : `${pct}%`}
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/5">
        <div
          className={cn("h-full rounded-full", t.bar)}
          style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{caption}</p>
    </div>
  );
}

/** Indicador compacto (com ícone) para a linha do meio. */
function MiniStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-2.5 text-center">
      <Icon className="mx-auto size-4 text-muted-foreground" />
      <p className="mt-1 text-lg font-semibold leading-tight tabular-nums">
        {value}
      </p>
      <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
      {sub && (
        <p className="text-[10px] leading-tight text-muted-foreground/80">
          {sub}
        </p>
      )}
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

  const fmtMin = (m: number | null) =>
    m === null
      ? "—"
      : m < 60
        ? `${m} min`
        : `${Math.floor(m / 60)}h ${m % 60}min`;
  const wait = fmtMin(metrics.avgWaitMin);
  const service = fmtMin(metrics.avgServiceMin);

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
        <DialogContent className="sm:max-w-xl">
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
            <div className="space-y-3">
              {/* Métricas principais: taxas com barra de progresso. */}
              <div className="grid grid-cols-2 gap-2">
                <RateCard
                  label="Comparecimento"
                  pct={metrics.attendanceRate}
                  caption={`${metrics.attended} de ${metrics.scheduled} apareceram`}
                  tone="emerald"
                />
                <RateCard
                  label="Taxa de conclusão"
                  pct={metrics.completionRate}
                  caption={`${metrics.completed} de ${metrics.scheduled} concluídos`}
                  tone="navy"
                />
              </div>
              {/* Indicadores rápidos. */}
              <div className="grid grid-cols-3 gap-2">
                <MiniStat icon={Clock} label="Espera média" value={wait} />
                <MiniStat
                  icon={Timer}
                  label="Atendimento médio"
                  value={service}
                />
                <MiniStat
                  icon={ListChecks}
                  label="Produtividade"
                  value={String(metrics.productivity)}
                  sub="sessões"
                />
              </div>
              {/* Ocorrências (2×2, com lista ao clicar). */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Ocorrências no período
                </p>
                <div className="grid grid-cols-2 gap-2">
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
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
