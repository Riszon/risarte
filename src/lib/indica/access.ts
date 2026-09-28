import { pode, type SessionContext } from "@/lib/auth";

/**
 * Quem vê o módulo Indica +Risos (menu e telas). Vem da matriz de permissões;
 * nasce escondido — só o Admin Master — até o dono ligar em /admin/permissoes.
 * Quem PODE mexer em cada indicação o banco decide (RLS + guarda das funções).
 */
export function canViewIndica(session: SessionContext): boolean {
  return pode(session, "modulo.indica");
}

/**
 * Quem pode pedir e registrar indicação a partir da ficha do cliente. Quem vê o
 * módulo pode; a permissão própria existe para o clínico que só pede.
 */
export function canIndicar(session: SessionContext): boolean {
  return canViewIndica(session) || pode(session, "acao.indica.indicar");
}
