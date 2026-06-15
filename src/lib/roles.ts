// Roles a user can hold per clinic (user_clinic_roles.role).
// Must stay in sync with the `user_role` enum in the database.
export const USER_ROLES = [
  "receptionist",
  "sdr",
  "clinical_coordinator",
  "planner_dentist",
  "dentist",
  "commercial_consultant",
  "commercial_assistant",
  "unit_manager",
  "franchisor_staff",
  "franchisee",
  "tsb",
  "asb",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  receptionist: "Recepcionista",
  sdr: "Encantador(a) (SDR)",
  clinical_coordinator: "Coordenador Clínico",
  planner_dentist: "Dentista Planner",
  dentist: "Dentista",
  commercial_consultant: "Consultor Comercial",
  commercial_assistant: "Assistente Comercial",
  unit_manager: "Gerente de Unidade",
  franchisor_staff: "Franqueadora/Rede",
  franchisee: "Franqueado",
  tsb: "TSB (Técnica em Saúde Bucal)",
  asb: "ASB (Auxiliar em Saúde Bucal)",
};

export const CLINIC_TYPES = ["franchisor", "franchise_unit"] as const;
export type ClinicType = (typeof CLINIC_TYPES)[number];

export const CLINIC_TYPE_LABELS: Record<ClinicType, string> = {
  franchisor: "Franqueadora",
  franchise_unit: "Unidade Franqueada",
};

// Which roles belong to which environment (owner rule). A role can only be
// assigned to a clinic whose type matches. Enforced in the DB (trigger) and
// in the UI. Admin Master is a global profile flag, not in this list.
export const FRANCHISOR_ROLES: UserRole[] = [
  "sdr",
  "planner_dentist",
  "commercial_consultant",
  "commercial_assistant",
  "franchisor_staff",
];

export const UNIT_ROLES: UserRole[] = [
  "receptionist",
  "clinical_coordinator",
  "dentist",
  "unit_manager",
  "tsb",
  "asb",
  "franchisee",
];

export function rolesForClinicType(type: ClinicType): UserRole[] {
  return type === "franchisor" ? FRANCHISOR_ROLES : UNIT_ROLES;
}

// Scope of franchise units a franchisor-role user can access.
export const UNIT_SCOPES = ["all", "specific", "none"] as const;
export type UnitScope = (typeof UNIT_SCOPES)[number];

export const UNIT_SCOPE_LABELS: Record<UnitScope, string> = {
  all: "Todas as unidades",
  specific: "Unidades específicas",
  none: "Nenhuma unidade",
};

export function isRoleAllowedForClinicType(
  role: UserRole,
  type: ClinicType
): boolean {
  return rolesForClinicType(type).includes(role);
}
