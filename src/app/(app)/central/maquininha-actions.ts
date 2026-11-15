"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * ASA4 (4013, 19.19.7 item 6): a chave "maquininha no cartão parcelado da venda
 * direta". Só o Admin Master muda (a porta `sale_method_settings_set` da 4011
 * confere e grava na auditoria). Desligada, a venda direta nova deixa de
 * oferecer a maquininha; as vendas antigas continuam até a última parcela.
 */
export async function salvarMaquininhaDaVendaDireta(ligada: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sale_method_settings_set", { p: { card_machine_direct_sale: ligada } });
  if (error) {
    if (/NOT_ALLOWED/.test(error.message)) return { ok: false, error: "Só o Admin Master muda esta chave." };
    console.error("sale_method_settings_set failed:", error.message);
    return { ok: false, error: "Não foi possível salvar." };
  }
  revalidatePath("/central", "layout");
  return { ok: true };
}
