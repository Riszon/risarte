// SLA keys must stay in sync with seed data in migration 0002.
export const SLA_KEYS = [
  "evaluation",
  "planning",
  "evaluation_to_commercial_scheduling",
  "presentation_to_closing",
  "closing_to_treatment_start",
] as const;

export type SlaKey = (typeof SLA_KEYS)[number];

export const SLA_LABELS: Record<SlaKey, string> = {
  evaluation: "Realizar avaliação/reavaliação",
  planning: "Planejamento (Centro de Planejamento)",
  evaluation_to_commercial_scheduling:
    "Avaliação → apresentação comercial agendada",
  presentation_to_closing: "Apresentação → fechamento",
  closing_to_treatment_start: "Fechamento → início do tratamento",
};

/**
 * Unidade de tempo dos prazos (I3). O sistema guarda tudo em MINUTOS
 * (`total_minutes`); a unidade existe para a tela mostrar do jeito que o dono
 * configurou ("2 dias" em vez de "2880 minutos"). 1 mês = 30 dias.
 */
export const TIME_UNITS = ["minutes", "hours", "days", "months"] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

export const TIME_UNIT_LABELS: Record<TimeUnit, string> = {
  minutes: "minuto(s)",
  hours: "hora(s)",
  days: "dia(s)",
  months: "mês(es)",
};

export const TIME_UNIT_MINUTES: Record<TimeUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  months: 43200,
};

/** Converte quantidade + unidade para minutos (mesma conta do banco). */
export function toMinutes(amount: number, unit: TimeUnit): number {
  return Math.max(1, Math.round(amount * TIME_UNIT_MINUTES[unit]));
}

/** "2 dias", "90 minutos", "3 meses" — como o prazo foi configurado. */
export function formatDuration(
  amount: number | null | undefined,
  unit: TimeUnit | null | undefined
): string {
  if (!amount) return "—";
  const u = unit ?? "hours";
  const plural = amount !== 1;
  const label: Record<TimeUnit, [string, string]> = {
    minutes: ["minuto", "minutos"],
    hours: ["hora", "horas"],
    days: ["dia", "dias"],
    months: ["mês", "meses"],
  };
  return `${amount} ${label[u][plural ? 1 : 0]}`;
}

export type SlaSettingRow = {
  id: string;
  clinic_id: string | null;
  sla_key: SlaKey;
  /** Compatibilidade — o valor oficial é `total_minutes`. */
  hours: number;
  amount: number | null;
  unit: TimeUnit | null;
  total_minutes: number | null;
};

// Inactivity thresholds (in days). Must stay in sync with migration 0020 seed.
export const INACTIVITY_KEYS = [
  "phase1_max_days",
  "phase2_max_days",
  "phase4_max_days",
  "phase5_6_no_appt_days",
  "phase7_inactivity_days",
  "no_attendance_days",
] as const;

export type InactivityKey = (typeof INACTIVITY_KEYS)[number];

export const INACTIVITY_LABELS: Record<InactivityKey, string> = {
  phase1_max_days: "Fase 1 (Aquisição): dias máx. sem ir à Fase 2",
  phase2_max_days: "Fase 2 (Conversão Clínica): dias máx. sem ir à Fase 4",
  phase4_max_days: "Fase 4 (Conversão Comercial): dias máx. sem ir à Fase 5",
  phase5_6_no_appt_days:
    "Fases 5 e 6: dias sem agendamento (e sem agendamento futuro)",
  phase7_inactivity_days: "Fase 7 (Acompanhamento): dias sem atividade",
  no_attendance_days: "Sem atendimento (geral): dias",
};

export type InactivitySettingRow = {
  id: string;
  clinic_id: string | null;
  setting_key: InactivityKey;
  /** Compatibilidade — o valor oficial é `total_minutes`. */
  value_days: number;
  amount: number | null;
  unit: TimeUnit | null;
  total_minutes: number | null;
};

export function resolveInactivity(
  rows: InactivitySettingRow[],
  clinicId: string | null
): Record<InactivityKey, number | null> {
  const result = {} as Record<InactivityKey, number | null>;
  for (const key of INACTIVITY_KEYS) {
    const override = clinicId
      ? rows.find((r) => r.clinic_id === clinicId && r.setting_key === key)
      : undefined;
    const networkDefault = rows.find(
      (r) => r.clinic_id === null && r.setting_key === key
    );
    result[key] = override?.value_days ?? networkDefault?.value_days ?? null;
  }
  return result;
}

/** Prazos de inatividade em MINUTOS (unidade sobrescreve o padrão da rede). */
export function resolveInactivityMinutes(
  rows: InactivitySettingRow[],
  clinicId: string | null
): Record<InactivityKey, number | null> {
  const result = {} as Record<InactivityKey, number | null>;
  const minutesOf = (r: InactivitySettingRow | undefined) =>
    r ? (r.total_minutes ?? r.value_days * TIME_UNIT_MINUTES.days) : undefined;
  for (const key of INACTIVITY_KEYS) {
    const override = clinicId
      ? rows.find((r) => r.clinic_id === clinicId && r.setting_key === key)
      : undefined;
    const networkDefault = rows.find(
      (r) => r.clinic_id === null && r.setting_key === key
    );
    result[key] = minutesOf(override) ?? minutesOf(networkDefault) ?? null;
  }
  return result;
}

/**
 * SLA efetivo de uma clínica, **em minutos** (unidade sobrescreve a rede).
 * I3: passou a ser minutos porque agora o prazo pode ser menor que uma hora.
 */
export function resolveSla(
  rows: SlaSettingRow[],
  clinicId: string | null
): Record<SlaKey, number | null> {
  const result = {} as Record<SlaKey, number | null>;
  const minutesOf = (r: SlaSettingRow | undefined) =>
    r ? (r.total_minutes ?? r.hours * TIME_UNIT_MINUTES.hours) : undefined;
  for (const key of SLA_KEYS) {
    const override = clinicId
      ? rows.find((r) => r.clinic_id === clinicId && r.sla_key === key)
      : undefined;
    const networkDefault = rows.find(
      (r) => r.clinic_id === null && r.sla_key === key
    );
    result[key] = minutesOf(override) ?? minutesOf(networkDefault) ?? null;
  }
  return result;
}
