// Agenda views (B1): Dia / Semana / Mês. Shared range + navigation helpers used
// by the unit agenda and the consolidated network agenda.
//
// ⚠️ OS RÓTULOS SAEM NO FUSO DE BRASÍLIA, sempre. Este módulo roda nos dois
// lados: no navegador (fuso da pessoa) e no servidor (UTC, na Vercel). Sem o
// `timeZone` explícito o mesmo período viraria dois textos diferentes — e foi
// assim que a Auditoria mostrou "15:07" às 12:07 (05/09/2026).
//
// As FRONTEIRAS de dia/semana/mês também são brasileiras. Antes vinham de
// `setHours(0,0,0,0)`, que zera o relógio da máquina: no servidor em UTC a
// janela do dia ia das 21h de ontem às 21h de hoje, então um atendimento às
// 21h30 não aparecia na agenda daquele dia. No navegador da equipe o valor não
// muda — meia-noite em Brasília é a mesma meia-noite —, então o desenho da
// grade continua idêntico.

import {
  BRAZIL_TIME_ZONE,
  addDaysIso,
  isoDateIn,
  startOfDayInBrazil,
  weekdayOf,
} from "@/lib/dates";

export type AgendaView = "dia" | "semana" | "mes";

export const AGENDA_VIEWS: { key: AgendaView; label: string }[] = [
  { key: "dia", label: "Dia" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
];

export function isAgendaView(v: string): v is AgendaView {
  return v === "dia" || v === "semana" || v === "mes";
}

/** A data civil BRASILEIRA deste instante, "AAAA-MM-DD". */
export function toIsoDate(d: Date): string {
  return isoDateIn(d);
}

/** Monday as the first day of the week — em dias brasileiros. */
export function startOfWeek(date: Date): Date {
  const iso = isoDateIn(date);
  const dia = weekdayOf(iso); // 0 = domingo
  return startOfDayInBrazil(addDaysIso(iso, dia === 0 ? -6 : 1 - dia));
}

/** Total de semanas ISO no ano (52 ou 53). 28/dez está sempre na última semana. */
export function isoWeeksInYear(year: number): number {
  return isoWeek(new Date(year, 11, 28));
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
  const meiaNoite = (iso: string) => startOfDayInBrazil(iso);

  if (view === "dia") {
    const iso = isoDateIn(ref);
    const start = meiaNoite(iso);
    const end = meiaNoite(addDaysIso(iso, 1));
    const prev = meiaNoite(addDaysIso(iso, -1));
    const next = meiaNoite(addDaysIso(iso, 1));
    return {
      start,
      end,
      prev,
      next,
      dayCount: 1,
      label: start.toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
      weekNumber: isoWeek(start),
    };
  }
  if (view === "mes") {
    // O dia 1 do mês, do anterior e do seguinte — sempre em data brasileira.
    // Somar 31 dias e voltar ao dia 1 acerta em qualquer mês, fevereiro
    // inclusive; recuar 1 dia a partir do dia 1 cai no mês anterior.
    const primeiro = `${isoDateIn(ref).slice(0, 7)}-01`;
    const seguinte = `${addDaysIso(primeiro, 31).slice(0, 7)}-01`;
    const anterior = `${addDaysIso(primeiro, -1).slice(0, 7)}-01`;
    const start = meiaNoite(primeiro);
    const end = meiaNoite(seguinte);
    const prev = meiaNoite(anterior);
    const next = meiaNoite(seguinte);
    return {
      start,
      end,
      prev,
      next,
      dayCount: 0,
      label: start.toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
        month: "long",
        year: "numeric",
      }),
      weekNumber: null,
    };
  }
  // semana
  const segunda = isoDateIn(startOfWeek(ref));
  const start = meiaNoite(segunda);
  const end = meiaNoite(addDaysIso(segunda, 7));
  const prev = meiaNoite(addDaysIso(segunda, -7));
  const next = meiaNoite(addDaysIso(segunda, 7));
  const last = meiaNoite(addDaysIso(segunda, 6));
  return {
    start,
    end,
    prev,
    next,
    dayCount: 7,
    label: `${start.toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
      day: "2-digit",
      month: "short",
    })} – ${last.toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
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
