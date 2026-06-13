import type { SlaKey } from "@/lib/sla";
import type { UserRole } from "@/lib/roles";

// Must stay in sync with the `journey_phase` enum in the database.
export const JOURNEY_PHASES = [
  "acquisition",
  "clinical_conversion",
  "planning_center",
  "commercial_conversion",
  "treatment_start",
  "reevaluation",
  "follow_up",
] as const;

export type JourneyPhase = (typeof JOURNEY_PHASES)[number];

export const PHASE_LABELS: Record<JourneyPhase, string> = {
  acquisition: "Aquisição",
  clinical_conversion: "Conversão Clínica",
  planning_center: "Centro de Planejamento",
  commercial_conversion: "Conversão Comercial",
  treatment_start: "Início de Tratamento",
  reevaluation: "Reavaliação",
  follow_up: "Acompanhamento",
};

/** Which configured SLA applies to time spent in each phase (null = no SLA). */
export const PHASE_SLA_KEY: Record<JourneyPhase, SlaKey | null> = {
  acquisition: null,
  clinical_conversion: "evaluation_to_commercial_scheduling",
  planning_center: "planning",
  commercial_conversion: "presentation_to_closing",
  treatment_start: "closing_to_treatment_start",
  reevaluation: "evaluation",
  follow_up: null,
};

/**
 * Owner-defined transition matrix: who moves a client between phases.
 * The same matrix is enforced inside the database (move_client_phase);
 * here it only drives which buttons appear.
 * Note: planner_dentist works at the franchisor's Planning Center, so the
 * check for that role is "has the role anywhere", not "in this clinic".
 */
export const PHASE_TRANSITIONS: {
  from: JourneyPhase;
  to: JourneyPhase;
  roles: UserRole[];
}[] = [
  { from: "acquisition", to: "clinical_conversion", roles: ["receptionist", "sdr"] },
  { from: "clinical_conversion", to: "planning_center", roles: ["clinical_coordinator"] },
  { from: "planning_center", to: "commercial_conversion", roles: ["planner_dentist"] },
  { from: "planning_center", to: "clinical_conversion", roles: ["planner_dentist"] },
  { from: "commercial_conversion", to: "treatment_start", roles: ["commercial_consultant"] },
  { from: "treatment_start", to: "reevaluation", roles: ["receptionist"] },
  { from: "treatment_start", to: "follow_up", roles: ["receptionist"] },
  { from: "treatment_start", to: "planning_center", roles: ["clinical_coordinator"] },
  { from: "reevaluation", to: "follow_up", roles: ["clinical_coordinator"] },
  { from: "reevaluation", to: "planning_center", roles: ["clinical_coordinator"] },
  { from: "follow_up", to: "reevaluation", roles: ["sdr"] },
];

export function allowedNextPhases(
  phase: JourneyPhase,
  opts: {
    isAdminMaster: boolean;
    clinicRoles: UserRole[];
    isPlannerAnywhere: boolean;
  }
): JourneyPhase[] {
  if (opts.isAdminMaster) {
    return JOURNEY_PHASES.filter((p) => p !== phase);
  }
  return PHASE_TRANSITIONS.filter(
    (t) =>
      t.from === phase &&
      t.roles.some(
        (role) =>
          opts.clinicRoles.includes(role) ||
          (role === "planner_dentist" && opts.isPlannerAnywhere)
      )
  ).map((t) => t.to);
}

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
