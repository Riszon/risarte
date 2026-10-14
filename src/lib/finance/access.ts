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

/**
 * O BANCO só aceita GRAVAR a configuração da rede (multa e juros, centros de
 * custo, catálogo de estoque) de duas funções: Admin Master e Financeiro da
 * Franqueadora — `is_admin_master() or is_finance_franchisor()` nas regras de
 * `finance_settings`, `cost_centers` e `stock_items`.
 *
 * ⚠️ A TELA SEGUE O BANCO (relatos OC-00094 a OC-00099, decisão do dono em
 * 14/10/2026). Ligar uma dessas ações na matriz para outra função (a
 * Franqueadora/Rede, por exemplo) ABRE a tela, mas o banco recusa no Salvar —
 * e a pessoa preenchia tudo para ouvir "não". Agora quem o banco recusa vê só
 * consulta, com o aviso de quem faz. Desligar na matriz continua funcionando.
 *
 * Só para GRAVAR: `canConfigureFinanceNetwork` sozinho continua abrindo as
 * telas de CONSULTA da rede (consolidado, painel) para quem a matriz liberou.
 */
export function bancoAceitaGravarNaRede(session: SessionContext): boolean {
  return session.isAdminMaster || isFinanceFranchisor(session);
}

/** Pode EDITAR a configuração da rede: a matriz libera E o banco aceita. */
export function canEditFinanceNetwork(session: SessionContext): boolean {
  return canConfigureFinanceNetwork(session) && bancoAceitaGravarNaRede(session);
}

/** A frase de quem faz, para a tela de quem só consulta. */
export const QUEM_GRAVA_NA_REDE = "o Admin Master ou o Financeiro da Franqueadora";
