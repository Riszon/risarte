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

export type SlaSettingRow = {
  id: string;
  clinic_id: string | null;
  sla_key: SlaKey;
  hours: number;
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
  value_days: number;
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

/** Resolves the effective SLA for a clinic: unit override > network default. */
export function resolveSla(
  rows: SlaSettingRow[],
  clinicId: string | null
): Record<SlaKey, number | null> {
  const result = {} as Record<SlaKey, number | null>;
  for (const key of SLA_KEYS) {
    const override = clinicId
      ? rows.find((r) => r.clinic_id === clinicId && r.sla_key === key)
      : undefined;
    const networkDefault = rows.find(
      (r) => r.clinic_id === null && r.sla_key === key
    );
    result[key] = override?.hours ?? networkDefault?.hours ?? null;
  }
  return result;
}
