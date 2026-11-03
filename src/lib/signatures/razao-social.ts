import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O NOME QUE VAI NOS DOCUMENTOS ASSINADOS PELO CLIENTE É A RAZÃO SOCIAL DA
 * UNIDADE (decisão do dono, 03/11/2026 — 0350). Nunca o nome de fantasia
 * ("Risarte Cambé") e nunca o logotipo da Risarte: vale para o contrato, os
 * termos, a capa e o rodapé de cada página, B2B ou B2C.
 *
 * Sem razão social cadastrada, o envio é RECUSADO (decisão do dono): um
 * contrato com o nome de fantasia no lugar da empresa contratada não sai.
 */

export const SEM_RAZAO_SOCIAL =
  "A unidade não tem razão social cadastrada. Cadastre em Administração → Clínicas (botão Editar da unidade) e envie de novo: é ela que vai no contrato.";

export const SEM_COLUNA_RAZAO_SOCIAL =
  "O banco ainda não tem o campo de razão social da unidade (atualização 0350). Peça ao Admin para aplicá-la; até lá, os documentos não são enviados.";

/** A razão social que vale para o documento, ou a mensagem de por que não há. */
export function razaoSocialDoDocumento(legalName: string | null | undefined): { ok: true; nome: string } | { ok: false; error: string } {
  const nome = (legalName ?? "").trim();
  return nome ? { ok: true, nome } : { ok: false, error: SEM_RAZAO_SOCIAL };
}

/**
 * Lê a razão social da unidade À PARTE (a coluna chega com a 0350, que viaja
 * à mão): sem a coluna, a mensagem diz isso em vez de "não foi possível ler
 * a unidade".
 */
export async function lerRazaoSocial(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  clinicId: string
): Promise<{ ok: true; nome: string } | { ok: false; error: string }> {
  const { data, error } = await db.from("clinics").select("legal_name").eq("id", clinicId).maybeSingle<{ legal_name: string | null }>();
  if (error) {
    console.error("clinic legal_name:", error.message);
    return { ok: false, error: SEM_COLUNA_RAZAO_SOCIAL };
  }
  return razaoSocialDoDocumento(data?.legal_name);
}
