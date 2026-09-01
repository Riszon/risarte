import { pode, type SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";

// FIN0 — quem enxerga e quem mexe no Financeiro.
//
// ⚠️ ESTAS REGRAS AGORA VÊM DA MATRIZ DE PERMISSÕES (migração 0246), editável em
// `/admin/permissoes`. As listas de papéis que ficavam aqui viraram a SEMENTE
// da tabela, em `src/lib/permissions.ts` — o comportamento do primeiro dia é
// idêntico ao de antes.
//
// Isto continua sendo UX: a barreira real é a RLS do banco. Ligar uma
// permissão aqui abre a tela; o que a pessoa consegue ler lá dentro continua
// decidido pelo banco. A tela de permissões avisa quais capacidades estão nessa
// situação.

function hasRoleAnywhere(session: SessionContext, role: UserRole): boolean {
  return Object.values(session.rolesByClinic).some((roles) =>
    roles.includes(role)
  );
}

/** O Financeiro da Franqueadora tem tratamento próprio em várias telas. */
export function isFinanceFranchisor(session: SessionContext): boolean {
  return hasRoleAnywhere(session, "finance_franchisor");
}

/** Quem pode ABRIR o módulo. */
export function canViewFinance(session: SessionContext): boolean {
  return pode(session, "modulo.financeiro");
}

/** Quem LANÇA/edita dinheiro na unidade. */
export function canPostFinance(
  session: SessionContext,
  clinicId: string | null | undefined
): boolean {
  // O Financeiro da Franqueadora lança em qualquer unidade do escopo dele; os
  // demais só na unidade em que têm o papel — daí a pergunta com `clinicId`.
  if (session.isAdminMaster || isFinanceFranchisor(session)) return true;
  return pode(session, "acao.financeiro.lancar", clinicId);
}

/**
 * Quem configura a REDE (plano de contas, centros padrão, multa/juros da rede).
 * Gerente de unidade não mexe no que vale para todo mundo.
 */
export function canConfigureFinanceNetwork(session: SessionContext): boolean {
  return pode(session, "acao.financeiro.configurar_rede");
}
