import { pode, type SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";

function allRoles(session: SessionContext): UserRole[] {
  return Object.values(session.rolesByClinic).flat();
}

/**
 * Gere o programa por inteiro (parte comercial): Admin, Franqueadora (rede) ou
 * Consultor RisLife. Espelha `empresarial.is_program_manager()` da RLS.
 */
export function isProgramManager(session: SessionContext): boolean {
  if (session.isAdminMaster) return true;
  return allRoles(session).some(
    (r) => r === "franchisor_staff" || r === "rislife_consultant"
  );
}

/**
 * CUIDA DO FINANCEIRO DO PROGRAMA (OC-00105, decisão do dono 16/10/2026): o
 * gestor do programa OU o Financeiro da Franqueadora. O Financeiro faz SÓ o
 * financeiro — gerar mensalidade e implantação (também em lote), dar baixa,
 * editar, cancelar, estornar, checar inadimplência e o Acordo de cobrança.
 * Funil, proposta, contrato, termos e configurações seguem com o gestor.
 * Espelha `empresarial.is_program_finance()` (1029) — a tela segue o banco.
 */
export function isProgramFinance(session: SessionContext): boolean {
  if (isProgramManager(session)) return true;
  return allRoles(session).includes("finance_franchisor");
}

/**
 * Vê o módulo Empresarial: gestores do programa + gestão/atendimento da unidade
 * (que enxergam as empresas com titulares na sua unidade).
 */
export function canViewEmpresarial(session: SessionContext): boolean {
  // Vem da matriz de permissões (0246), editável em /admin/permissoes.
  if (isProgramFinance(session)) return true;
  return pode(session, "modulo.empresarial");
}

/** Consultor RisLife "puro" (sem papéis de gestão da rede) — foco no funil/agenda. */
export function isRislifeConsultant(session: SessionContext): boolean {
  return allRoles(session).includes("rislife_consultant");
}
