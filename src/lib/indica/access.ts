import { hasRoleInClinic, pode, type SessionContext } from "@/lib/auth";

/**
 * Espelho de `indica.eh_franqueadora()`: Admin Master ou visão da rede
 * (franchisor_staff). Serve para a TELA esconder o que o banco recusaria.
 */
export function ehFranqueadoraIndica(session: SessionContext): boolean {
  return (
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((r) => r.includes("franchisor_staff"))
  );
}

/** Espelho de `indica.eh_gestor(unidade)`: gerente/franqueado da unidade, ou a rede. */
export function ehGestorIndica(session: SessionContext, unidadeId: string | null | undefined): boolean {
  return (
    ehFranqueadoraIndica(session) ||
    hasRoleInClinic(session, unidadeId, ["unit_manager", "franchisee"])
  );
}

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
