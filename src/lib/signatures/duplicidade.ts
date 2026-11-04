import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBrDateTime } from "@/lib/dates";
import { qualificacaoDoTipo } from "./qualificacao";

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
 *
 * O PACOTE ABERTO DIZ QUEM JÁ ASSINOU (pedido do dono, 04/11/2026, depois do
 * primeiro TCLE real): com o paciente (ou a empresa) já tendo assinado e só a
 * Risarte faltando, cancelar faria o cliente assinar o mesmo documento duas
 * vezes. O aviso mostra quem assinou e quando, quem falta, e o cancelar passa
 * a pedir confirmação.
 */

export type Parte = { clientId: string } | { companyId: string | null; leadId: string | null };

/** Um signatário do pacote aberto, como o aviso mostra. */
export type AssinaturaDoPacote = {
  name: string;
  qualificacao: string;
  /** Grupo 1: o paciente, o responsável legal ou o representante da empresa. */
  ladoDoCliente: boolean;
  assinouEm: string | null;
  /** É quem está enviando agora (para oferecer "Assinar agora"). */
  souEu: boolean;
};

export type PacoteAberto = {
  packageId: string;
  number: string;
  assinaram: AssinaturaDoPacote[];
  faltam: AssinaturaDoPacote[];
};

type LinhaDoSignatario = {
  name: string;
  signer_type: string;
  order_group: number;
  status: string;
  signed_at: string | null;
  user_id: string | null;
};

/** Quem já assinou e quem falta, na ordem do pacote (regra pura). */
export function situacaoDasAssinaturas(
  linhas: LinhaDoSignatario[],
  meuUserId: string | null,
): Pick<PacoteAberto, "assinaram" | "faltam"> {
  const como = (l: LinhaDoSignatario): AssinaturaDoPacote => ({
    name: l.name,
    qualificacao: qualificacaoDoTipo(l.signer_type),
    ladoDoCliente: l.order_group === 1,
    assinouEm: l.status === "signed" ? l.signed_at : null,
    souEu: Boolean(meuUserId) && l.user_id === meuUserId,
  });
  return {
    assinaram: linhas.filter((l) => l.status === "signed").map(como),
    faltam: linhas.filter((l) => l.status !== "signed").map(como),
  };
}

/** "Representante da Risarte" no meio da frase: só a primeira letra muda. */
export function qualificacaoNoTexto(q: string): string {
  return q.charAt(0).toLowerCase() + q.slice(1);
}

/** O lado do cliente já assinou: cancelar faria ele assinar de novo. */
export function clienteJaAssinou(p: Pick<PacoteAberto, "assinaram">): boolean {
  return p.assinaram.some((a) => a.ladoDoCliente);
}

async function assinaturasDoPacote(db: SupabaseClient, packageId: string, meuUserId: string | null) {
  const { data, error } = await db
    .from("signature_signers")
    .select("name, signer_type, order_group, status, signed_at, user_id")
    .eq("package_id", packageId)
    .order("order_group")
    .order("sort_order")
    .returns<LinhaDoSignatario[]>();
  if (error) console.error("signature duplicate signers:", error.message);
  return situacaoDasAssinaturas(data ?? [], meuUserId);
}

/** O pacote aberto pelo número que veio na recusa do banco. */
export async function pacoteAbertoPeloNumero(db: SupabaseClient, number: string, meuUserId: string | null): Promise<PacoteAberto> {
  const { data } = await db.from("signature_packages").select("id").eq("number", number).maybeSingle<{ id: string }>();
  if (!data) return { packageId: "", number, assinaram: [], faltam: [] };
  return { packageId: data.id, number, ...(await assinaturasDoPacote(db, data.id, meuUserId)) };
}
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
export async function pacoteAbertoComOsMesmos(
  db: SupabaseClient,
  parte: Parte,
  templateIds: string[],
  meuUserId: string | null,
): Promise<PacoteAberto | null> {
  const modelos = new Set(templateIds.filter(Boolean));
  if (modelos.size === 0) return null;
  const achado = (await pacotesDaParte(db, parte, ["sent", "partially_signed"])).find((l) => temAlgum(l, modelos));
  if (!achado) return null;
  return { packageId: achado.id, number: achado.number, ...(await assinaturasDoPacote(db, achado.id, meuUserId)) };
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

export function mensagemDoConflito(number: string, pacote?: Pick<PacoteAberto, "assinaram" | "faltam">): string {
  if (pacote && clienteJaAssinou(pacote)) {
    const quem = pacote.assinaram
      .filter((a) => a.ladoDoCliente)
      .map((a) => `${a.name} (${qualificacaoNoTexto(a.qualificacao)})${a.assinouEm ? ` em ${formatBrDateTime(a.assinouEm)}` : ""}`)
      .join(", ");
    const falta = pacote.faltam.map((a) => `${a.name} (${qualificacaoNoTexto(a.qualificacao)})`).join(", ");
    return `O pacote ${number} com este documento já foi assinado por ${quem}${falta ? `; falta ${falta}` : ""}. Abra o pacote para concluir — cancelar faria o cliente assinar de novo.`;
  }
  return `Já existe o pacote ${number} aguardando assinatura com este documento. Para não haver duas assinaturas do mesmo documento, cancele o anterior antes de enviar de novo.`;
}
