import type { UserRole } from "@/lib/roles";
import type { JourneyPhase } from "@/lib/journey";

// Must stay in sync with the `appointment_type` / `appointment_status`
// enums in the database.
export const APPOINTMENT_TYPES = [
  "evaluation",
  "commercial_presentation",
  "treatment_start",
  "treatment_session",
  "reevaluation",
  "return_visit",
  "urgency",
  "emergency",
] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  evaluation: "Avaliação",
  commercial_presentation: "Apresentação Comercial",
  treatment_start: "Início de Tratamento",
  treatment_session: "Sessão de Tratamento",
  reevaluation: "Reavaliação",
  return_visit: "Retorno",
  urgency: "Urgência",
  emergency: "Emergência",
};

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  completed: "Realizado",
  cancelled: "Cancelado",
  no_show: "Faltou",
};

/** Which roles may be the assigned professional for each appointment type. */
export const TYPE_PROVIDER_ROLES: Record<AppointmentType, UserRole[]> = {
  evaluation: ["clinical_coordinator"],
  commercial_presentation: ["commercial_consultant"],
  treatment_start: ["dentist"],
  treatment_session: ["dentist"],
  reevaluation: ["clinical_coordinator"],
  return_visit: ["clinical_coordinator", "dentist"],
  urgency: ["clinical_coordinator", "dentist"],
  emergency: ["clinical_coordinator", "dentist"],
};

export type StaffOption = {
  userId: string;
  name: string;
  roles: UserRole[];
};

// Waiting-room attendance flow. Must match the `attendance_status` enum.
export const ATTENDANCE_STATUSES = [
  "waiting",
  "in_service",
  "done",
  "gave_up",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  waiting: "Em espera",
  in_service: "Em atendimento",
  done: "Atendimento concluído",
  gave_up: "Desistiu da espera",
};

/**
 * Scheduling follows the journey: the appointment type is derived from the
 * client's current phase (owner rule: first time = Avaliação; a returning
 * client = Reavaliação; never rewrite past appointments).
 */
export const PHASE_APPOINTMENT_TYPE: Record<JourneyPhase, AppointmentType> = {
  acquisition: "evaluation",
  clinical_conversion: "evaluation",
  planning_center: "commercial_presentation",
  commercial_conversion: "commercial_presentation",
  treatment_start: "treatment_start",
  reevaluation: "reevaluation",
  follow_up: "return_visit",
};

/** Exceptional types that may always be chosen, regardless of the phase. */
export const EXCEPTIONAL_TYPES: AppointmentType[] = [
  "return_visit",
  "urgency",
  "emergency",
];

/** Options offered in the scheduling dialog for a client in a given phase. */
export function appointmentTypeOptions(
  phase: JourneyPhase | null
): AppointmentType[] {
  if (!phase) return [...APPOINTMENT_TYPES];
  const auto = PHASE_APPOINTMENT_TYPE[phase];
  const options = [auto];
  if (phase === "treatment_start") options.push("treatment_session");
  for (const t of EXCEPTIONAL_TYPES) {
    if (!options.includes(t)) options.push(t);
  }
  return options;
}
