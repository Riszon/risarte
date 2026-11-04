import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * NÃO DÁ PARA ASSINAR DUAS VEZES O MESMO DOCUMENTO (AP108, decisão do dono,
 * 04/11/2026). Visto no teste real da ZS8: com um pacote aguardando
 * assinatura, mandar de novo o mesmo documento criava um SEGUNDO documento na
 * ZapSign — assinar um não trava o outro.
 *
 *  - Pacote AGUARDANDO (enviado / parcialmente assinado) com o mesmo modelo
 *    para a mesma parte: BLOQUEIA. O banco garante (0361, gatilhos na criação
 *    e no envio, com trava por parte); aqui é só para a tela explicar antes e
 *    oferecer "Cancelar o anterior e enviar este".
 *  - O mesmo modelo JÁ ASSINADO: AVISA e pede confirmação (um contrato novo
 *    para um tratamento novo é legítimo).
 *
 * PDF avulso (sem modelo) não entra na conta.
 */

export type Parte = { clientId: string } | { companyId: string | null; leadId: string | null };

export type PacoteAberto = { packageId: string; number: string };
export type PacoteAssinado = { packageId: string; number: string; completedAt: string | null };

type Linha = {
  id: string;
  number: string;
  status: string;
  completed_at: string | null;
  signature_package_items: { template_id: string | null }[];
};

async function pacotesDaParte(db: SupabaseClient, parte: Parte, statuses: string[]): Promise<Linha[]> {
  let q = db
    .from("signature_packages")
    .select("id, number, status, completed_at, signature_package_items ( template_id )")
    .in("status", statuses)
    .order("created_at", { ascending: false });
  if ("clientId" in parte) q = q.eq("client_id", parte.clientId);
  else if (parte.companyId && parte.leadId) q = q.or(`company_id.eq.${parte.companyId},lead_id.eq.${parte.leadId}`);
  else if (parte.companyId) q = q.eq("company_id", parte.companyId);
  else if (parte.leadId) q = q.eq("lead_id", parte.leadId);
  else return [];
  const { data, error } = await q.returns<Linha[]>();
  if (error) {
    console.error("signature duplicate check:", error.message);
    return [];
  }
  return data ?? [];
}

const temAlgum = (linha: Linha, modelos: Set<string>) =>
  linha.signature_package_items.some((i) => i.template_id && modelos.has(i.template_id));

/** O pacote aguardando assinatura que já tem algum destes modelos. */
export async function pacoteAbertoComOsMesmos(db: SupabaseClient, parte: Parte, templateIds: string[]): Promise<PacoteAberto | null> {
  const modelos = new Set(templateIds.filter(Boolean));
  if (modelos.size === 0) return null;
  const achado = (await pacotesDaParte(db, parte, ["sent", "partially_signed"])).find((l) => temAlgum(l, modelos));
  return achado ? { packageId: achado.id, number: achado.number } : null;
}

/** O pacote mais recente, já assinado, que tem algum destes modelos. */
export async function pacoteAssinadoComOsMesmos(db: SupabaseClient, parte: Parte, templateIds: string[]): Promise<PacoteAssinado | null> {
  const modelos = new Set(templateIds.filter(Boolean));
  if (modelos.size === 0) return null;
  const achado = (await pacotesDaParte(db, parte, ["signed"])).find((l) => temAlgum(l, modelos));
  return achado ? { packageId: achado.id, number: achado.number, completedAt: achado.completed_at } : null;
}

/** O número do pacote aberto na recusa do banco (`OPEN_PACKAGE_EXISTS:ASS-000049`). */
export function numeroDoConflito(msg: string | null | undefined): string | null {
  return /OPEN_PACKAGE_EXISTS:(\S+)/.exec(msg ?? "")?.[1] ?? null;
}

export function mensagemDoConflito(number: string): string {
  return `Já existe o pacote ${number} aguardando assinatura com este documento. Para não haver duas assinaturas do mesmo documento, cancele o anterior antes de enviar de novo.`;
}
