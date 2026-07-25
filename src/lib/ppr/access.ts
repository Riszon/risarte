// PPR+ — quem enxerga a seção e quem configura o programa.
// A barreira real é a RLS (migração 0162); aqui é UX (menu e telas).

import type { SessionContext } from "@/lib/auth";

/**
 * Vê a seção /ppr: praticamente todo mundo da operação — a equipe precisa saber
 * se o cliente na frente dela é do programa. Fora: ninguém sem clínica.
 */
export function canViewPpr(session: SessionContext): boolean {
  if (session.isAdminMaster) return true;
  return Object.values(session.rolesByClinic).flat().length > 0;
}

/** Configura planos, valores e benefícios: só o Admin Master (decisão 9). */
export function canConfigurePpr(session: SessionContext): boolean {
  return session.isAdminMaster;
}
