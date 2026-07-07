// Per-unit agenda configuration (B2/B3): working hours, open weekdays and the
// number of chairs, in the cascade pattern (network default → unit override).

export type AgendaSettingRow = {
  clinic_id: string | null;
  open_time: string; // "HH:MM[:SS]"
  close_time: string;
  weekdays: number[]; // 0 = Sunday … 6 = Saturday
  chairs: number;
  lunch_enabled?: boolean | null;
  lunch_start?: string | null;
  lunch_end?: string | null;
  /** H3.4: minutos de espera que disparam o alerta de espera longa. */
  waiting_alert_minutes?: number | null;
};

export type AgendaSettings = {
  openTime: string; // "HH:MM"
  closeTime: string;
  weekdays: number[];
  chairs: number;
  lunchEnabled: boolean;
  lunchStart: string;
  lunchEnd: string;
  waitingAlertMinutes: number;
};

export const WEEKDAY_NAMES = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

export const AGENDA_DEFAULTS: AgendaSettings = {
  openTime: "08:00",
  closeTime: "18:00",
  weekdays: [1, 2, 3, 4, 5, 6],
  chairs: 3,
  lunchEnabled: false,
  lunchStart: "12:00",
  lunchEnd: "13:00",
  waitingAlertMinutes: 20,
};

/** "HH:MM:SS" → "HH:MM". */
export function hhmm(time: string): string {
  return (time ?? "").slice(0, 5);
}

/** Effective settings for a clinic: unit override > network default > code default. */
export function resolveAgendaSettings(
  rows: AgendaSettingRow[],
  clinicId: string | null
): AgendaSettings {
  const override = clinicId
    ? rows.find((r) => r.clinic_id === clinicId)
    : undefined;
  const network = rows.find((r) => r.clinic_id === null);
  const row = override ?? network;
  if (!row) return AGENDA_DEFAULTS;
  return {
    openTime: hhmm(row.open_time) || AGENDA_DEFAULTS.openTime,
    closeTime: hhmm(row.close_time) || AGENDA_DEFAULTS.closeTime,
    weekdays:
      row.weekdays && row.weekdays.length > 0
        ? row.weekdays
        : AGENDA_DEFAULTS.weekdays,
    chairs: row.chairs ?? AGENDA_DEFAULTS.chairs,
    lunchEnabled: row.lunch_enabled ?? AGENDA_DEFAULTS.lunchEnabled,
    lunchStart: hhmm(row.lunch_start ?? "") || AGENDA_DEFAULTS.lunchStart,
    lunchEnd: hhmm(row.lunch_end ?? "") || AGENDA_DEFAULTS.lunchEnd,
    waitingAlertMinutes:
      row.waiting_alert_minutes ??
      network?.waiting_alert_minutes ??
      AGENDA_DEFAULTS.waitingAlertMinutes,
  };
}

export function timeToMinutes(time: string): number {
  const [h, m] = hhmm(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * AJ7: janela de atendimento efetiva de um dia. Sem "dia avulso" = horário
 * normal. Num dia NORMAL com dia avulso = EXTENSÃO (une o horário normal com o
 * avulso — começa antes / termina depois). Num dia FECHADO com dia avulso =
 * usa só a janela do avulso (abre um dia que não atende normalmente).
 */
export function effectiveDayHours(
  normalOpen: string,
  normalClose: string,
  openDay: { start: string; end: string } | null,
  isNormalDay: boolean
): { open: string; close: string } {
  if (!openDay) return { open: hhmm(normalOpen), close: hhmm(normalClose) };
  const start = hhmm(openDay.start);
  const end = hhmm(openDay.end);
  if (!isNormalDay) return { open: start, close: end };
  const open =
    timeToMinutes(start) < timeToMinutes(normalOpen) ? start : hhmm(normalOpen);
  const close =
    timeToMinutes(end) > timeToMinutes(normalClose) ? end : hhmm(normalClose);
  return { open, close };
}
