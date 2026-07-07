"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { agendaHref } from "@/lib/agenda-view";

export type StripState =
  | "normal"
  | "closed"
  | "holiday_closed"
  | "holiday_pending"
  | "holiday_open"
  | "open_day"
  | "plan_block";

export type StripDay = {
  iso: string;
  state: StripState;
  note: string | null;
  count: number;
  /** null = dia sem cálculo de vaga (passado / distante / fechado). */
  hasFree: boolean | null;
  /** AJ10: motivo quando a agenda está TODA fechada neste dia. */
  closedReason: string | null;
  /** AJ10: há fechamento PARCIAL (sala/profissional/período) — pede atenção. */
  attention: boolean;
  isPast: boolean;
};

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * AJ10: régua de dias rolável. Passado (histórico) + ~1 ano à frente; navega com
 * o scroll do mouse; abre no dia de hoje. Mês só no 1º dia do mês. Dia fechado
 * mostra o motivo (não "lotado"); fechamento parcial vira alerta de atenção.
 */
export function DayStripView({
  days,
  selectedIso,
  todayIso,
  salas,
}: {
  days: StripDay[];
  selectedIso: string | null;
  todayIso: string;
  salas?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Abre centralizado no dia de hoje.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const el = node.querySelector<HTMLElement>('[data-today="1"]');
    if (el) {
      node.scrollLeft = el.offsetLeft - node.clientWidth / 2 + el.clientWidth / 2;
    }
  }, []);

  // Scroll do mouse (vertical) rola a régua na horizontal.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      node.scrollLeft += e.deltaY;
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="rounded-lg border bg-card p-2">
      <div
        ref={scrollRef}
        className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]"
      >
        {days.map((d) => {
          const date = new Date(`${d.iso}T00:00:00`);
          const blocked =
            d.state === "closed" ||
            d.state === "holiday_closed" ||
            d.state === "plan_block" ||
            Boolean(d.closedReason);
          const isSelected = d.iso === selectedIso;
          const isToday = d.iso === todayIso;
          const showMonth = date.getDate() === 1 || d.iso === days[0].iso;
          const tooltip = [
            d.closedReason ? `Fechado: ${d.closedReason}` : d.note,
            d.attention ? "Atenção: há fechamento parcial neste dia" : null,
            d.count > 0
              ? `${d.count} agendamento${d.count === 1 ? "" : "s"}`
              : null,
            d.hasFree === true
              ? "Tem horários livres"
              : d.hasFree === false
                ? "Sem horários livres"
                : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Link
              key={d.iso}
              data-today={isToday ? "1" : undefined}
              href={agendaHref("dia", d.iso, undefined, salas)}
              title={tooltip || undefined}
              className={cn(
                "flex min-w-12 shrink-0 flex-col items-center rounded-lg border px-1.5 py-1 text-center transition-colors",
                blocked
                  ? "bg-muted/60 text-muted-foreground"
                  : "hover:border-primary hover:bg-primary/5",
                d.closedReason ||
                  d.state === "holiday_closed" ||
                  d.state === "plan_block"
                  ? "bg-red-50 text-red-700"
                  : d.state === "holiday_pending"
                    ? "bg-amber-50"
                    : d.state === "open_day"
                      ? "border-gold/60 bg-gold/10"
                      : "",
                d.isPast && !isSelected && "opacity-70",
                isSelected && "border-primary ring-2 ring-primary/40",
                isToday && !isSelected && "border-primary/60"
              )}
            >
              <span className="text-[10px] uppercase leading-tight text-muted-foreground">
                {WEEKDAY_SHORT[date.getDay()]}
              </span>
              <span className="text-sm font-semibold leading-tight">
                {date.getDate()}
              </span>
              {showMonth && (
                <span className="text-[9px] capitalize leading-tight text-muted-foreground">
                  {date.toLocaleDateString("pt-BR", { month: "short" })}
                </span>
              )}
              {blocked ? (
                <span className="mt-0.5 max-w-[3.2rem] truncate text-[9px] font-medium leading-tight">
                  {d.closedReason
                    ? d.closedReason
                    : d.state === "closed"
                      ? "Fechado"
                      : "Sem atend."}
                </span>
              ) : (
                <span className="mt-0.5 flex items-center gap-0.5 text-[9px] leading-tight">
                  {d.attention ? (
                    <AlertTriangle className="size-2.5 text-amber-600" />
                  ) : (
                    d.hasFree !== null && (
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          d.hasFree ? "bg-emerald-500" : "bg-red-500"
                        )}
                      />
                    )
                  )}
                  {d.count > 0 && (
                    <span className="text-muted-foreground">{d.count}</span>
                  )}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-emerald-500" /> tem horário
          livre
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-red-500" /> lotado
        </span>
        <span className="inline-flex items-center gap-1">
          <AlertTriangle className="size-2.5 text-amber-600" /> fechamento parcial
        </span>
        <span>número = agendamentos · role o mouse para navegar · clique abre o dia</span>
      </p>
    </div>
  );
}
