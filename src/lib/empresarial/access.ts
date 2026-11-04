import { pode, type SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";

function allRoles(session: SessionContext): UserRole[] {
  return Object.values(session.rolesByClinic).flat();
}

/**
 * Gere o programa por inteiro (parte comercial, toda a rede): Admin ou
 * Franqueadora (rede). Espelha `empresarial.is_program_manager()` da RLS.
 *
 * ⚠️ O Consultor RisLife NÃO é gestor (AP95, decisão do dono, 03/11/2026;
 * 1039): ele trabalha só nas empresas e nos leads em que é o responsável. Para
 * deixar o consultor agir numa empresa ou num lead, use
 * `canWorkOnCompanies` — o banco limita às dele.
 */
export function isProgramManager(session: SessionContext): boolean {
  if (session.isAdminMaster) return true;
  return allRoles(session).includes("franchisor_staff");
}

/**
 * Pode mexer nos dados de uma empresa ou de um lead: o gestor (todas) ou o
 * Consultor RisLife (o banco só deixa as dele — `is_my_company`,
 * `can_access_lead`). As configurações da REDE seguem com `isProgramManager`.
 */
export function canWorkOnCompanies(session: SessionContext): boolean {
  return isProgramManager(session) || isRislifeConsultant(session);
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
