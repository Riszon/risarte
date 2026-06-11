import type { SlaKey } from "@/lib/sla";

// Must stay in sync with the `journey_phase` enum in the database.
export const JOURNEY_PHASES = [
  "clinical_conversion",
  "planning_center",
  "commercial_conversion",
  "treatment_start",
  "reevaluation",
  "follow_up",
] as const;

export type JourneyPhase = (typeof JOURNEY_PHASES)[number];

export const PHASE_LABELS: Record<JourneyPhase, string> = {
  clinical_conversion: "Conversão Clínica",
  planning_center: "Centro de Planejamento",
  commercial_conversion: "Conversão Comercial",
  treatment_start: "Início de Tratamento",
  reevaluation: "Reavaliação",
  follow_up: "Acompanhamento",
};

/** Which configured SLA applies to time spent in each phase (null = no SLA). */
export const PHASE_SLA_KEY: Record<JourneyPhase, SlaKey | null> = {
  clinical_conversion: "evaluation_to_commercial_scheduling",
  planning_center: "planning",
  commercial_conversion: "presentation_to_closing",
  treatment_start: "closing_to_treatment_start",
  reevaluation: "evaluation",
  follow_up: null,
};

/**
 * Suggested next steps shown in the UI (the business flow). The database
 * function accepts any transition by an allowed role; this map only drives
 * which buttons appear.
 */
export const NEXT_PHASES: Record<JourneyPhase, JourneyPhase[]> = {
  clinical_conversion: ["planning_center"],
  planning_center: ["commercial_conversion"],
  commercial_conversion: ["treatment_start", "follow_up"],
  treatment_start: ["reevaluation", "follow_up"],
  reevaluation: ["planning_center", "follow_up"],
  follow_up: ["clinical_conversion", "reevaluation"],
};

// Must stay in sync with the `methodology_pillar` enum in the database.
export const METHODOLOGY_PILLARS = [
  "diagnosis",
  "planning",
  "health",
  "function",
  "aesthetics",
  "prevention",
] as const;

export type MethodologyPillar = (typeof METHODOLOGY_PILLARS)[number];

export const PILLAR_LABELS: Record<MethodologyPillar, string> = {
  diagnosis: "Diagnóstico",
  planning: "Planejamento",
  health: "Saúde",
  function: "Função",
  aesthetics: "Estética",
  prevention: "Prevenção",
};

/** Hours elapsed since a timestamp. */
export function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

/** "3d 4h" / "5h" — how long a client has been in the current phase. */
export function formatTimeInPhase(iso: string): string {
  const hours = Math.floor(hoursSince(iso));
  if (hours < 1) return "menos de 1h";
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (days === 0) return `${hours}h`;
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}

export function isSlaExceeded(
  phaseEnteredAt: string,
  slaHours: number | null | undefined
): boolean {
  if (!slaHours) return false;
  return hoursSince(phaseEnteredAt) > slaHours;
}
