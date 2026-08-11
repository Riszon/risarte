import type { SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";

// 0213 — quem enxerga e quem mexe no Estoque. Espelha os helpers de RLS
// (can_manage_stock / can_consume_stock). Isto é UX: a barreira real é o banco.
//
// Decisão do dono (11/08/2026): entrada e inventário são atos de GESTÃO
// (Gerente + Admin/Financeiro); consumo avulso é ato de ATENDIMENTO (dentista,
// coordenador, planner, TSB, ASB). Recepção fica de fora — receber mercadoria e
// contar prateleira não é ato de balcão, pela mesma razão que contas a pagar
// não é.

const CLINICAL_ROLES: UserRole[] = [
  "dentist",
  "clinical_coordinator",
  "planner_dentist",
  "tsb",
  "asb",
];

function hasRoleAnywhere(session: SessionContext, role: UserRole): boolean {
  return Object.values(session.rolesByClinic).some((roles) =>
    roles.includes(role)
  );
}

function isFinanceFranchisor(session: SessionContext): boolean {
  return hasRoleAnywhere(session, "finance_franchisor");
}

/** Lança entrada, define mínimo e faz inventário. */
export function canManageStock(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (session.isAdminMaster || isFinanceFranchisor(session)) return true;
  if (!clinicId) return false;
  return (session.rolesByClinic[clinicId] ?? []).includes("unit_manager");
}

/** Registra o consumo que fugiu do kit. */
export function canConsumeStock(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (canManageStock(session, clinicId)) return true;
  if (!clinicId) return false;
  const roles = session.rolesByClinic[clinicId] ?? [];
  return CLINICAL_ROLES.some((r) => roles.includes(r));
}

/** Quem pode ABRIR o módulo (a unidade ativa manda). */
export function canViewStock(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (session.isAdminMaster || isFinanceFranchisor(session)) return true;
  if (!clinicId) return false;
  const roles = session.rolesByClinic[clinicId] ?? [];
  return (
    roles.includes("unit_manager") ||
    roles.includes("franchisee") ||
    CLINICAL_ROLES.some((r) => roles.includes(r))
  );
}

/** Só a Franqueadora cadastra o item — o catálogo é da rede. */
export function canManageStockCatalog(session: SessionContext): boolean {
  return session.isAdminMaster || isFinanceFranchisor(session);
}
