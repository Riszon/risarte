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

/** A unidade é a própria Franqueadora? (Lida da lista de unidades da sessão.) */
function eAFranqueadora(session: SessionContext, clinicId: string | null | undefined): boolean {
  return Boolean(clinicId) && (session.clinics ?? []).some((c) => c.id === clinicId && c.type === "franchisor");
}

/**
 * Quem APROVA a parte da unidade na rodada — o espelho de
 * `can_decide_purchase` (0294). Quem aprova é quem PAGA: o gerente da unidade
 * (e o Admin). Na compra da PRÓPRIA Franqueadora, que não tem gerente, o
 * Financeiro da Franqueadora (decisão do dono, OC-00102). Ele NÃO decide a
 * compra de uma unidade — é dinheiro dela.
 */
export function canDecidePurchaseAllocations(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  // A JANELA DA MIGRAÇÃO (CLAUDE.md §0b): o código chega aos dois ambientes
  // antes de a 0294 ser rodada, e com a matriz gravada no banco permissão sem
  // linha não alcança ninguém — o gerente perderia os botões nesse intervalo.
  // Sem a permissão no banco, vale a regra de antes ("Criar requisição").
  const semAprovarNoBanco = !(session.permissoes ?? {})["acao.compras.aprovar"];
  const capacidade = semAprovarNoBanco ? "acao.compras.requisitar" : "acao.compras.aprovar";
  if (!pode(session, capacidade, clinicId)) return false;
  if (session.isAdminMaster) return true;
  if (!clinicId) return false;
  if (hasRoleInClinic(session, clinicId, ["unit_manager"])) return true;
  return eAFranqueadora(session, clinicId) && hasRoleInClinic(session, clinicId, ["finance_franchisor"]);
}

/** Quem decide, em palavras — a tela diz isso a quem não decide (OC-00102). */
export function quemDecideACompra(session: SessionContext, clinicId: string | null | undefined): string {
  return eAFranqueadora(session, clinicId)
    ? "o Financeiro da Franqueadora ou o Admin"
    : "o gerente da unidade ou o Admin";
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
