import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "MINHAS ASSINATURAS PENDENTES" (plano ZS0 §4.2): o que espera a assinatura
 * de quem está logado — como testemunha ou representante da Risarte — lido
 * pela porta `signature_my_pending()` (0343). Vale para QUALQUER pessoa do
 * sistema, tenha ou não o módulo no menu: ser chamado a assinar não depende
 * de permissão, depende de ter sido escolhido no envio.
 */

export type MinhaPendente = {
  package_id: string;
  number: string;
  client_name: string;
  documents: string | null;
  order_group: number;
  signer_status: "pending" | "link_opened";
  is_my_turn: boolean;
  sign_url: string | null;
  expires_at: string | null;
  sent_at: string | null;
  package_status: string;
  current_stage: string;
};

/** `null` = a porta não existe neste banco (falta a 0343) ou a leitura falhou. */
export async function minhasPendentes(supabase: SupabaseClient): Promise<MinhaPendente[] | null> {
  const { data, error } = await supabase.rpc("signature_my_pending");
  if (error) {
    console.error("signature_my_pending:", error.message);
    return null;
  }
  return (data ?? []) as MinhaPendente[];
}

export function papelDoGrupo(orderGroup: number): string {
  return orderGroup === 2 ? "testemunha" : orderGroup === 3 ? "representante da Risarte" : "cliente";
}
