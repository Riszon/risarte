import type { UserRole } from "@/lib/roles";

// Must stay in sync with the `appointment_type` / `appointment_status`
// enums in the database.
export const APPOINTMENT_TYPES = [
  "evaluation",
  "commercial_presentation",
  "treatment_start",
  "treatment_session",
  "reevaluation",
  "return_visit",
] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  evaluation: "Avaliação",
  commercial_presentation: "Apresentação Comercial",
  treatment_start: "Início de Tratamento",
  treatment_session: "Sessão de Tratamento",
  reevaluation: "Reavaliação",
  return_visit: "Retorno",
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
};

export type StaffOption = {
  userId: string;
  name: string;
  roles: UserRole[];
};
