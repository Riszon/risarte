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
