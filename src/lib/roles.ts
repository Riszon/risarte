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
  "rislife_consultant",
  "finance_franchisor",
  "purchaser",
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
  rislife_consultant: "Consultor Comercial Empresarial (RisLife)",
  finance_franchisor: "Financeiro da Franqueadora",
  purchaser: "Comprador da Franqueadora",
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
  "rislife_consultant",
  // FIN0: vê o financeiro das unidades do escopo, configura multa/juros e
  // centros de custo, e renegocia junto com o Gerente da unidade.
  "finance_franchisor",
  // Compras C1: negocia com fornecedor. De propósito NÃO é quem paga —
  // separar comprar de pagar é controle interno básico.
  "purchaser",
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

/**
 * AP115 (pedido do dono em 10/11/2026) — A FUNÇÃO NO GÊNERO DA PESSOA.
 *
 * Onde a tela fala de UMA pessoa (a ficha do Risartano, as funções dela, o
 * "Meu cadastro"), o rótulo segue o gênero da ficha (`staff_members.gender`):
 * "Coordenadora Clínica", "Consultora Comercial". Sem gênero, ou "outro" /
 * "prefiro não informar", vale o rótulo de sempre (`ROLE_LABELS`).
 *
 * Onde a tela fala da FUNÇÃO (filtros, matriz de permissões, listas de
 * funções), continua `ROLE_LABELS` — ali não há pessoa.
 */
const ROLE_LABELS_FEMININO: Partial<Record<UserRole, string>> = {
  sdr: "Encantadora (SDR)",
  clinical_coordinator: "Coordenadora Clínica",
  commercial_consultant: "Consultora Comercial",
  franchisee: "Franqueada",
  rislife_consultant: "Consultora Comercial Empresarial (RisLife)",
  purchaser: "Compradora da Franqueadora",
};

const ROLE_LABELS_MASCULINO: Partial<Record<UserRole, string>> = {
  sdr: "Encantador (SDR)",
  tsb: "TSB (Técnico em Saúde Bucal)",
};

export function rotuloDaFuncao(role: UserRole, genero: string | null | undefined): string {
  if (genero === "female") return ROLE_LABELS_FEMININO[role] ?? ROLE_LABELS[role];
  if (genero === "male") return ROLE_LABELS_MASCULINO[role] ?? ROLE_LABELS[role];
  return ROLE_LABELS[role];
}

/** O mesmo, para a função PREVISTA da ficha (texto livre que pode não ser uma função). */
export function rotuloDaFuncaoPrevista(
  roleTitle: string | null | undefined,
  genero: string | null | undefined
): string | null {
  if (!roleTitle) return null;
  return roleTitle in ROLE_LABELS ? rotuloDaFuncao(roleTitle as UserRole, genero) : roleTitle;
}
