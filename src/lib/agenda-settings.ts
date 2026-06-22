// Per-unit agenda configuration (B2/B3): working hours, open weekdays and the
// number of chairs, in the cascade pattern (network default → unit override).

export type AgendaSettingRow = {
  clinic_id: string | null;
  open_time: string; // "HH:MM[:SS]"
  close_time: string;
  weekdays: number[]; // 0 = Sunday … 6 = Saturday
  chairs: number;
};

export type AgendaSettings = {
  openTime: string; // "HH:MM"
  closeTime: string;
  weekdays: number[];
  chairs: number;
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
  };
}

export function timeToMinutes(time: string): number {
  const [h, m] = hhmm(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
