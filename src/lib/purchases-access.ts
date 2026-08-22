import type { SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";

// COMPRAS — quem enxerga e quem mexe.
//
// Espelha as policies do banco (0239). Isto é UX: a barreira real é a RLS.
//
// A LISTA É DE QUEM CUIDA DO ESTOQUE. Quem sabe o que está faltando é quem
// mexe na prateleira, não quem paga a conta — por isso o gerente da unidade
// monta e envia, e o Financeiro da unidade não entra aqui.
//
// O COMPRADOR DA FRANQUEADORA é papel próprio (decisão do dono): quem compra
// não é quem paga, e separar as duas funções é controle interno básico.

function hasRoleAnywhere(session: SessionContext, role: UserRole): boolean {
  return Object.values(session.rolesByClinic).some((roles) =>
    roles.includes(role)
  );
}

/** Comprador da Franqueadora — negocia com fornecedor. */
export function isPurchaser(session: SessionContext): boolean {
  return session.isAdminMaster || hasRoleAnywhere(session, "purchaser");
}

/** Quem MONTA e envia a lista da unidade. */
export function canManagePurchaseRequests(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (session.isAdminMaster) return true;
  if (!clinicId) return false;
  return (session.rolesByClinic[clinicId] ?? []).includes("unit_manager");
}

/**
 * Quem ABRE o módulo.
 *
 * Gerente da unidade (monta a lista), franqueado (acompanha o que a unidade
 * dele vai pagar), comprador e financeiro da franqueadora (recebem as listas).
 */
export function canViewPurchases(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  return (
    canManagePurchaseRequests(session, clinicId) ||
    isPurchaser(session) ||
    hasRoleAnywhere(session, "franchisee") ||
    hasRoleAnywhere(session, "finance_franchisor")
  );
}
