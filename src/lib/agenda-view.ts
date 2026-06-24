// Agenda views (B1): Dia / Semana / Mês. Shared range + navigation helpers used
// by the unit agenda and the consolidated network agenda.

export type AgendaView = "dia" | "semana" | "mes";

export const AGENDA_VIEWS: { key: AgendaView; label: string }[] = [
  { key: "dia", label: "Dia" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
];

export function isAgendaView(v: string): v is AgendaView {
  return v === "dia" || v === "semana" || v === "mes";
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Monday as the first day of the week. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** ISO 8601 week number (1–53). */
export function isoWeek(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export type AgendaRange = {
  start: Date;
  end: Date; // exclusive
  prev: Date;
  next: Date;
  /** Columns for the day/week grid (0 for the month view). */
  dayCount: number;
  label: string;
  weekNumber: number | null;
};

export function agendaRange(view: AgendaView, ref: Date): AgendaRange {
  if (view === "dia") {
    const start = new Date(ref);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const prev = new Date(start);
    prev.setDate(prev.getDate() - 1);
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    return {
      start,
      end,
      prev,
      next,
      dayCount: 1,
      label: start.toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
      weekNumber: isoWeek(start),
    };
  }
  if (view === "mes") {
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    const prev = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
    const next = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    return {
      start,
      end,
      prev,
      next,
      dayCount: 0,
      label: start.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      }),
      weekNumber: null,
    };
  }
  // semana
  const start = startOfWeek(ref);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const prev = new Date(start);
  prev.setDate(prev.getDate() - 7);
  const next = new Date(start);
  next.setDate(next.getDate() + 7);
  const last = new Date(end.getTime() - 86400000);
  return {
    start,
    end,
    prev,
    next,
    dayCount: 7,
    label: `${start.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    })} – ${last.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    })}`,
    weekNumber: isoWeek(start),
  };
}

/** Build the agenda URL for a view + reference date (preserving unit + rooms). */
export function agendaHref(
  view: AgendaView,
  refIso: string,
  unidade?: string,
  salas?: string
): string {
  const p = new URLSearchParams();
  p.set("vista", view);
  p.set("ref", refIso);
  if (unidade) p.set("unidade", unidade);
  if (salas) p.set("salas", salas);
  return `/agenda?${p.toString()}`;
}
