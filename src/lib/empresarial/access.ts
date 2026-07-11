import type { SessionContext } from "@/lib/auth";
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
 * Vê o módulo Empresarial: gestores do programa + gestão/atendimento da unidade
 * (que enxergam as empresas com colaboradores na sua unidade).
 */
export function canViewEmpresarial(session: SessionContext): boolean {
  if (isProgramManager(session)) return true;
  return allRoles(session).some((r) =>
    ["unit_manager", "franchisee", "sdr", "receptionist"].includes(r)
  );
}

/** Consultor RisLife "puro" (sem papéis de gestão da rede) — foco no funil/agenda. */
export function isRislifeConsultant(session: SessionContext): boolean {
  return allRoles(session).includes("rislife_consultant");
}
