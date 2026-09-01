import { pode, type SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";

// 0213 — quem enxerga e quem mexe no Estoque. Espelha os helpers de RLS
// (can_manage_stock / can_consume_stock). Isto é UX: a barreira real é o banco.
//
// Decisão do dono (11/08/2026): entrada e inventário são atos de GESTÃO
// (Gerente + Admin/Financeiro); consumo avulso é ato de ATENDIMENTO (dentista,
// coordenador, planner, TSB, ASB). Recepção fica de fora — receber mercadoria e
// contar prateleira não é ato de balcão, pela mesma razão que contas a pagar
// não é.

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
  return pode(session, "acao.estoque.gerir", clinicId);
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
  return pode(session, "acao.estoque.catalogo");
}
