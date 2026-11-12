"use server";

// ASA2, entrega 3 (4007) — "Não receber avisos de cobrança" (D5, D7).
// O banco decide quem pode (`gateway_optout_set`): desligam a Recepcionista,
// o Gerente, o Financeiro da Franqueadora e o Admin Master; religam só o
// Gerente, o Financeiro e o Admin. Vale para o CPF do pagador na rede toda.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MENSAGENS: Record<string, string> = {
  NOT_ALLOWED: "Você não pode mudar isto. Desligar: Recepção, Gerente, Financeiro e Admin. Religar: Gerente, Financeiro e Admin.",
  REASON_REQUIRED: "Diga o motivo em poucas palavras.",
  PAYER_CPF_INVALID: "O pagador (o paciente ou o responsável financeiro) está sem CPF válido.",
};

export async function mudarAvisosDeCobranca(
  clientId: string,
  naoReceber: boolean,
  motivo: string
): Promise<{ ok: boolean; error?: string }> {
  if (!UUID.test(clientId)) return { ok: false, error: "Paciente inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("gateway_optout_set", {
    p_client_id: clientId,
    p_opt_out: !!naoReceber,
    p_reason: String(motivo ?? "").slice(0, 300),
  });
  if (error) {
    const m = error.message ?? "";
    for (const [codigo, texto] of Object.entries(MENSAGENS)) if (m.includes(codigo)) return { ok: false, error: texto };
    return { ok: false, error: "Não foi possível gravar. Tente de novo." };
  }
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}
