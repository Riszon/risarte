import type { SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";

// FIN0 — quem enxerga e quem mexe no Financeiro. Espelha os helpers de RLS
// (is_finance_franchisor / finance_visible_clinic_ids / can_post_finance).
// Isto é UX: a barreira real é a RLS do banco.

function hasRoleAnywhere(session: SessionContext, role: UserRole): boolean {
  return Object.values(session.rolesByClinic).some((roles) =>
    roles.includes(role)
  );
}

/** Financeiro da Franqueadora — vê as unidades do escopo dele. */
export function isFinanceFranchisor(session: SessionContext): boolean {
  return hasRoleAnywhere(session, "finance_franchisor");
}

/**
 * Quem pode ABRIR o módulo. Gerente e Franqueado entram pela própria unidade;
 * recepção, dentistas e comercial não veem financeiro (regra do dono).
 */
export function canViewFinance(session: SessionContext): boolean {
  return (
    session.isAdminMaster ||
    isFinanceFranchisor(session) ||
    hasRoleAnywhere(session, "unit_manager") ||
    hasRoleAnywhere(session, "franchisee")
  );
}

/** Quem LANÇA/edita dinheiro na unidade (franqueado é somente leitura). */
export function canPostFinance(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (session.isAdminMaster || isFinanceFranchisor(session)) return true;
  if (!clinicId) return false;
  return (session.rolesByClinic[clinicId] ?? []).includes("unit_manager");
}

/**
 * Quem configura a REDE (plano de contas, centros padrão, multa/juros da rede).
 * Gerente de unidade não mexe no que vale para todo mundo.
 */
export function canConfigureFinanceNetwork(session: SessionContext): boolean {
  return session.isAdminMaster || isFinanceFranchisor(session);
}
