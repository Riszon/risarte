"use server";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CobrancasDaVenda } from "@/lib/asaas/cobrancas-da-venda";

/**
 * 4012 (spec 19.3): as Cobranças da venda, pela porta própria
 * `sale_charges_read` — quem fechou a venda, o Gerente da unidade, o Admin
 * Master e o Financeiro da Franqueadora. A regra de leitura das cobranças
 * (0403) não muda. Sem permissão ou banco sem a 4012: o bloco some.
 */
export async function lerCobrancasDaVenda(input: {
  negotiationId?: string | null;
  directSaleId?: string | null;
}): Promise<CobrancasDaVenda | null> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sale_charges_read", {
    p_negotiation_id: input.negotiationId ?? null,
    p_direct_sale_id: input.directSaleId ?? null,
  });
  if (error) {
    if (!/NOT_ALLOWED|does not exist|schema cache/i.test(error.message)) console.error("sale_charges_read failed:", error.message);
    return null;
  }
  return data as CobrancasDaVenda;
}

/** Cada envio pelo riSZon fica registrado (cobrança, canal, quem, quando). */
export async function registrarEnvio(chargeId: string, canal: "copiar_link" | "whatsapp" | "copiar_pix" | "linha_digitavel"): Promise<{ ok: boolean }> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("charge_link_sent", { p_charge_id: chargeId, p_channel: canal });
  if (error) console.error("charge_link_sent failed:", error.message);
  return { ok: !error };
}
