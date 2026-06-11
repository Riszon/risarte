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
