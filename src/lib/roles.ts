// Roles a user can hold per clinic (user_clinic_roles.role).
// Must stay in sync with the `user_role` enum in the database.
export const USER_ROLES = [
  "receptionist",
  "clinical_coordinator",
  "planner_dentist",
  "dentist",
  "commercial_consultant",
  "commercial_assistant",
  "unit_manager",
  "franchisor_staff",
  "franchisee",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  receptionist: "Recepcionista",
  clinical_coordinator: "Coordenador Clínico",
  planner_dentist: "Dentista Planner",
  dentist: "Dentista",
  commercial_consultant: "Consultor Comercial",
  commercial_assistant: "Assistente Comercial",
  unit_manager: "Gerente de Unidade",
  franchisor_staff: "Franqueadora/Rede",
  franchisee: "Franqueado",
};

export const CLINIC_TYPES = ["franchisor", "franchise_unit"] as const;
export type ClinicType = (typeof CLINIC_TYPES)[number];

export const CLINIC_TYPE_LABELS: Record<ClinicType, string> = {
  franchisor: "Franqueadora",
  franchise_unit: "Unidade Franqueada",
};
