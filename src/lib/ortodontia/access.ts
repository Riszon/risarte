// Ortodontia — quem enxerga o quê. A barreira real é o banco (migração 0329:
// RLS + guardas das funções); aqui é UX (menu, botões, redirecionamentos).

import { hasRoleInClinic, pode, type SessionContext } from "@/lib/auth";
import {
  ORTHO_CLINICAL_ROLES,
  ORTHO_MANAGER_ROLES,
  ORTHO_MONEY_VIEW_ROLES,
  ORTHO_SETTLE_ROLES,
} from "./constants";

/** Vê o módulo (menu + lista de casos). */
export function canViewOrtho(session: SessionContext): boolean {
  return pode(session, "modulo.ortodontia");
}

/** Vê o Painel com os números (a Recepção não: ela cai na tela Atenção). */
export function canViewOrthoDashboard(session: SessionContext): boolean {
  return pode(session, "modulo.ortodontia.painel");
}

/**
 * Abre, edita, inicia, finaliza e interrompe o caso. A matriz pode desligar;
 * o banco (`ortho_can_manage`) só aceita Gerente e Coordenador da unidade.
 */
export function canManageOrtho(session: SessionContext, clinicId: string | null): boolean {
  if (session.isAdminMaster) return true;
  if (!clinicId) return false;
  return (
    pode(session, "acao.ortodontia.gerir", clinicId) &&
    hasRoleInClinic(session, clinicId, ORTHO_MANAGER_ROLES)
  );
}

/** Registra a manutenção e a evolução (o dentista só nos casos em que é o ortodontista). */
export function canEvolveOrtho(
  session: SessionContext,
  clinicId: string | null,
  orthodontistId: string | null
): boolean {
  if (session.isAdminMaster) return true;
  if (!clinicId) return false;
  if (!pode(session, "acao.ortodontia.evoluir", clinicId)) return false;
  if (hasRoleInClinic(session, clinicId, ["clinical_coordinator"])) return true;
  return (
    hasRoleInClinic(session, clinicId, ORTHO_CLINICAL_ROLES) &&
    orthodontistId === session.userId
  );
}

/**
 * Gera e dá baixa na mensalidade (decisão O2, 28/10/2026): o Gerente da
 * unidade e o Financeiro da Franqueadora (e a Franqueadora/Rede, o Admin).
 * O banco (`ortho_can_settle`) confere de novo.
 */
export function canSettleOrtho(session: SessionContext, clinicId: string | null): boolean {
  if (session.isAdminMaster) return true;
  if (!pode(session, "acao.ortodontia.financeiro", clinicId)) return false;
  if (clinicId && hasRoleInClinic(session, clinicId, ORTHO_SETTLE_ROLES)) return true;
  // Franqueadora/Rede e Financeiro da Franqueadora vivem na Franqueadora.
  return ehRede(session);
}

/**
 * Vê os números de DINHEIRO do módulo (mensalidades, receita, inadimplência).
 * Quem dá baixa vê; a Recepção, o Franqueado e o Coordenador (Q8) veem SEM dar
 * baixa (O2: a Recepção acompanha a situação do paciente para ajudar o Gerente
 * e o Financeiro). O dentista NÃO vê (R13) — e desde a 0332 o banco também não
 * lhe devolve valor nenhum (`ortho_can_see_money`): aqui é só a tela.
 */
export function canViewOrthoMoney(session: SessionContext, clinicId: string | null): boolean {
  if (canSettleOrtho(session, clinicId)) return true;
  if (!clinicId || !pode(session, "modulo.ortodontia", clinicId)) return false;
  return hasRoleInClinic(session, clinicId, ORTHO_MONEY_VIEW_ROLES);
}

/** Espelho de `is_network_viewer()`: Franqueadora/Rede ou Financeiro da Franqueadora. */
export function ehRede(session: SessionContext): boolean {
  if (session.isAdminMaster) return true;
  return session.clinics.some(
    (c) =>
      c.type === "franchisor" &&
      (session.rolesByClinic[c.id] ?? []).some((r) =>
        ["franchisor_staff", "finance_franchisor"].includes(r)
      )
  );
}

/**
 * O dentista "puro" só vê os casos em que é o ortodontista. Quem tem outro
 * papel de visão ampla na unidade (gerente, coordenador, recepção…) vê todos.
 */
export function orthoRestrictedToOwn(session: SessionContext, clinicId: string | null): boolean {
  if (session.isAdminMaster || !clinicId) return false;
  const roles = session.rolesByClinic[clinicId] ?? [];
  if (!roles.includes("dentist")) return false;
  return !roles.some((r) =>
    ["unit_manager", "clinical_coordinator", "receptionist", "franchisee"].includes(r)
  );
}
