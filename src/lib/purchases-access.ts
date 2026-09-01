import { pode, type SessionContext } from "@/lib/auth";

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
  // Vem da matriz de permissões (0246), editável em /admin/permissoes.
  return pode(session, "acao.compras.requisitar", clinicId);
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
    pode(session, "modulo.compras")
  );
}
