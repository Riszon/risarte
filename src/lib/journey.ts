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
  { from: "planning_center", to: "reevaluation", roles: ["planner_dentist"] },
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

/**
 * The "treatment pillar" is the subset the Dentista Planner chooses (the
 * client's stored `methodology_pillar` holds this). The displayed pillar is
 * mostly automatic by phase; the treatment pillar shows from phase 4 on.
 */
export const TREATMENT_PILLARS = [
  "health",
  "function",
  "aesthetics",
  "prevention",
] as const;

export type TreatmentPillar = (typeof TREATMENT_PILLARS)[number];

/** Pillar shown for a client, computed from phase + Planner's treatment pillar. */
export function displayedPillar(
  phase: JourneyPhase,
  treatmentPillar: MethodologyPillar | null
): MethodologyPillar | null {
  switch (phase) {
    case "acquisition":
      return null; // a definir
    case "clinical_conversion":
    case "reevaluation":
      return "diagnosis";
    case "planning_center":
      return "planning";
    case "commercial_conversion":
    case "treatment_start":
      return treatmentPillar; // null = a definir
    case "follow_up":
      return treatmentPillar ?? "prevention";
  }
}

// Sub-status within a phase. Must stay in sync with the `journey_status` enum.
export const JOURNEY_STATUSES = [
  "awaiting_send_to_planning",
  "in_planning",
  "awaiting_plan_approval",
  "revision_with_coordinator",
  "awaiting_treatment_start",
  "in_treatment",
  "treatment_finished",
  "treatment_cancelled",
  "treatment_partially_cancelled",
] as const;

export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export const STATUS_LABELS: Record<JourneyStatus, string> = {
  awaiting_send_to_planning: "Aguardando Envio para Planejamento",
  in_planning: "Em Planejamento",
  awaiting_plan_approval: "Aguardando Aprovação do Planejamento",
  revision_with_coordinator: "Revisão com Coordenador Clínico",
  awaiting_treatment_start: "Aguardando Iniciar Tratamento",
  in_treatment: "Em Tratamento",
  treatment_finished: "Tratamento Finalizado",
  treatment_cancelled: "Tratamento Cancelado",
  treatment_partially_cancelled: "Tratamento Cancelado Parcialmente",
};

/** Statuses the responsible role can set while the client is in each phase. */
export const STATUS_BY_PHASE: Partial<Record<JourneyPhase, JourneyStatus[]>> = {
  clinical_conversion: ["awaiting_send_to_planning"],
  reevaluation: ["awaiting_send_to_planning"],
  planning_center: [
    "in_planning",
    "awaiting_plan_approval",
    "revision_with_coordinator",
  ],
  treatment_start: [
    "awaiting_treatment_start",
    "in_treatment",
    "treatment_finished",
    "treatment_cancelled",
    "treatment_partially_cancelled",
  ],
};

/** Roles that may set sub-statuses while in a given phase. */
export function canSetStatusInPhase(
  phase: JourneyPhase,
  opts: { isAdminMaster: boolean; clinicRoles: UserRole[]; isPlannerAnywhere: boolean }
): boolean {
  if (opts.isAdminMaster) return Boolean(STATUS_BY_PHASE[phase]);
  if (phase === "planning_center") return opts.isPlannerAnywhere;
  if (phase === "clinical_conversion" || phase === "reevaluation") {
    return opts.clinicRoles.includes("clinical_coordinator");
  }
  if (phase === "treatment_start") {
    return ["clinical_coordinator", "dentist", "receptionist"].some((r) =>
      opts.clinicRoles.includes(r as UserRole)
    );
  }
  return false;
}

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
