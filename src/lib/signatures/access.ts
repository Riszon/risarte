import { pode, type SessionContext } from "@/lib/auth";

/**
 * Quem pode o quê nas ASSINATURAS DIGITAIS — espelho de `signature_can` (0340).
 *
 * Diferente dos outros módulos, aqui o banco LÊ A MESMA MATRIZ que a tela
 * (exceção à 0246, restrita ao módulo): o que `pode()` responde é o que a RLS
 * responde. Admin Master sempre pode (a flag passa por cima da matriz nos dois
 * lugares). A trava do Consultor RisLife (só as empresas/leads em que é o
 * responsável) fica no banco e não precisa de espelho na tela — a lista que
 * ele vê já vem filtrada.
 *
 * `clinicId` restringe a pergunta à unidade emissora; sem ele vale ter o papel
 * em qualquer unidade (é como o menu pergunta).
 */

export function canViewSignatures(session: SessionContext): boolean {
  return pode(session, "modulo.assinaturas");
}

export function canSendSignatures(session: SessionContext, clinicId?: string | null): boolean {
  return pode(session, "acao.assinaturas.enviar", clinicId);
}

export function canCancelSignatures(session: SessionContext, clinicId?: string | null): boolean {
  return pode(session, "acao.assinaturas.cancelar", clinicId);
}

export function canViewSignaturePackages(session: SessionContext, clinicId?: string | null): boolean {
  return (
    pode(session, "acao.assinaturas.visualizar", clinicId) ||
    canViewSignatureNetworkDashboard(session)
  );
}

export function canDownloadSignatures(session: SessionContext, clinicId?: string | null): boolean {
  return pode(session, "acao.assinaturas.baixar", clinicId);
}

export function canViewSignatureUnitDashboard(session: SessionContext, clinicId?: string | null): boolean {
  return pode(session, "acao.assinaturas.painel_unidade", clinicId);
}

/** O painel da rede libera todas as unidades (como no banco). */
export function canViewSignatureNetworkDashboard(session: SessionContext): boolean {
  return pode(session, "acao.assinaturas.painel_rede");
}

/** Nasce só com o Admin Master (a capacidade não tem papel por padrão). */
export function canConfigureSignatures(session: SessionContext): boolean {
  return pode(session, "acao.assinaturas.configurar");
}
