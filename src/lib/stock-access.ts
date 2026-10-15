import { hasRoleInClinic, pode, type SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";

// 0213 — quem enxerga e quem mexe no Estoque. Espelha os helpers de RLS
// (can_manage_stock / can_consume_stock). Isto é UX: a barreira real é o banco.
//
// Decisão do dono (11/08/2026): entrada e inventário são atos de GESTÃO
// (Gerente + Admin/Financeiro); consumo avulso é ato de ATENDIMENTO
// (coordenador, TSB, ASB). Recepção fica de fora — receber mercadoria e
// contar prateleira não é ato de balcão, pela mesma razão que contas a pagar
// não é.
//
// ⚠️ Dentista e Planner NÃO veem o Estoque (dono, 09/10/2026): a decisão de
// 11/08 os incluía no consumo avulso; a matriz de permissões os tirou do
// módulo em 28/09 e o dono confirmou que é de propósito.

function hasRoleAnywhere(session: SessionContext, role: UserRole): boolean {
  return Object.values(session.rolesByClinic).some((roles) =>
    roles.includes(role)
  );
}

function isFinanceFranchisor(session: SessionContext): boolean {
  return hasRoleAnywhere(session, "finance_franchisor");
}

// ⚠️ ESTAS REGRAS AGORA VÊM DA MATRIZ DE PERMISSÕES (migração 0246), editável
// em `/admin/permissoes`. As listas de papéis viraram a SEMENTE da tabela, em
// `src/lib/permissions.ts` — o comportamento do primeiro dia é idêntico.

/** Lança entrada, define mínimo e faz inventário. */
export function canManageStock(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (session.isAdminMaster || isFinanceFranchisor(session)) return true;
  // A tela segue o banco (OC-00097): `can_manage_stock` aceita, além dos dois
  // acima, só o GERENTE da unidade. Ligar "entrada e inventário" na matriz para
  // outra função abria o formulário e o banco recusava no Lançar.
  return (
    pode(session, "acao.estoque.gerir", clinicId) &&
    Boolean(clinicId) &&
    hasRoleInClinic(session, clinicId as string, ["unit_manager"])
  );
}

/**
 * Dá ENTRADA e faz o INVENTÁRIO — o espelho de `can_post_stock_entry` (0296).
 *
 * AP42 (decisão do dono, 15/10/2026): o ASB, que a matriz já ligava em
 * "Entrada e inventário", passa a poder de verdade na unidade dele. Fica de
 * fora o resto da gestão (compra com nota, mínimo, kits — `canManageStock`):
 * a nota cria conta a pagar, e isso não foi liberado.
 */
export function canPostStockEntry(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (canManageStock(session, clinicId)) return true;
  return (
    pode(session, "acao.estoque.gerir", clinicId) &&
    Boolean(clinicId) &&
    hasRoleInClinic(session, clinicId as string, ["asb"])
  );
}

/** Registra o consumo que fugiu do kit. */
export function canConsumeStock(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (canManageStock(session, clinicId)) return true;
  return pode(session, "acao.estoque.consumir", clinicId);
}

/** Quem pode ABRIR o módulo (a unidade ativa manda). */
export function canViewStock(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  if (session.isAdminMaster || isFinanceFranchisor(session)) return true;
  return pode(session, "modulo.estoque", clinicId);
}

/** Só a Franqueadora cadastra o item — o catálogo é da rede. */
export function canManageStockCatalog(session: SessionContext): boolean {
  // A tela segue o banco (OC-00097): `stock_items` só aceita Admin Master e
  // Financeiro da Franqueadora.
  return (
    pode(session, "acao.estoque.catalogo") &&
    (session.isAdminMaster || isFinanceFranchisor(session))
  );
}
