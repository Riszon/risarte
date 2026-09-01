// PPR+ — quem enxerga a seção e quem configura o programa.
// A barreira real é a RLS (migração 0162); aqui é UX (menu e telas).

import { pode, type SessionContext } from "@/lib/auth";

// Vem da matriz de permissões (0246), editável em /admin/permissoes.

/**
 * Vê a seção /ppr: por padrão, todo mundo da operação — a equipe precisa saber
 * se o cliente na frente dela é do programa.
 */
export function canViewPpr(session: SessionContext): boolean {
  return pode(session, "modulo.ppr");
}

/**
 * Configura planos, valores e benefícios.
 *
 * Padrão: só o Admin Master (decisão 9) — a capacidade nasce com nenhum papel
 * marcado, e o Admin passa por cima da matriz de qualquer forma. Se um dia o
 * dono quiser delegar, é só marcar o papel na tela.
 */
export function canConfigurePpr(session: SessionContext): boolean {
  return pode(session, "acao.ppr.configurar");
}
