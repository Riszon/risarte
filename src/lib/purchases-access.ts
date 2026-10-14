import { hasRoleInClinic, pode, type SessionContext } from "@/lib/auth";

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

/** Comprador da Franqueadora — negocia com fornecedor. */
export function isPurchaser(session: SessionContext): boolean {
  return pode(session, "acao.compras.negociar");
}

/** Quem MONTA e envia a lista da unidade. */
export function canManagePurchaseRequests(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  // Vem da matriz de permissões (0246), editável em /admin/permissoes — E do
  // banco: `build_purchase_request`, `send_purchase_request` e
  // `receive_purchase_order` só aceitam Admin Master, Financeiro da
  // Franqueadora e o GERENTE da unidade (`can_manage_stock`). A tela segue o
  // banco (OC-00096): antes o botão aparecia e a recusa vinha no clique.
  return (
    pode(session, "acao.compras.requisitar", clinicId) &&
    bancoAceitaEstoqueDaUnidade(session, clinicId)
  );
}

/** O espelho de `can_manage_stock(clinic)` no banco. */
function bancoAceitaEstoqueDaUnidade(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (session.isAdminMaster) return true;
  if (Object.values(session.rolesByClinic).some((r) => r.includes("finance_franchisor"))) return true;
  return Boolean(clinicId) && hasRoleInClinic(session, clinicId as string, ["unit_manager"]);
}

/**
 * Quem APROVA a parte da unidade na rodada. O banco (`decide_allocation`) é
 * mais estreito que a lista: só Admin Master e o GERENTE da unidade — quem
 * paga é a unidade, e o Financeiro da Franqueadora não decide por ela.
 */
export function canDecidePurchaseAllocations(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (!pode(session, "acao.compras.requisitar", clinicId)) return false;
  if (session.isAdminMaster) return true;
  return Boolean(clinicId) && hasRoleInClinic(session, clinicId as string, ["unit_manager"]);
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
  // ABRIR segue a matriz; GRAVAR segue o banco (OC-00096). Quem a matriz liga
  // em "criar requisição" e o banco não aceita continua vendo a tela — só que
  // em consulta, com o aviso de quem monta a lista. Usar o
  // `canManagePurchaseRequests` aqui tiraria a leitura dessa pessoa.
  return (
    pode(session, "acao.compras.requisitar", clinicId) ||
    isPurchaser(session) ||
    pode(session, "modulo.compras")
  );
}
