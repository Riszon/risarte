"use server";

// A aba Empresarial da Central (ASA5, 4023). O BANCO decide de verdade: a porta
// `corporate_settings_save` confere quem pode (Admin Master e Financeiro da
// Franqueadora), que a conta é uma carteira de repasse e que ela está pronta
// (ativa, com chave, carteira e webhook) antes de ligar.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";

export type ResultadoDoEmpresarial = { ok: boolean; error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RECUSA: Record<string, string> = {
  NOT_ALLOWED: "Só o Admin Master e o Financeiro da Franqueadora mexem aqui.",
  RISLIFE_ACCOUNT_INVALID: "Escolha uma carteira de repasse (a conta da RisLife).",
  RISLIFE_ACCOUNT_REQUIRED: "Para ligar, escolha a conta da RisLife.",
  RISLIFE_ACCOUNT_NOT_READY:
    "A conta da RisLife não está pronta: precisa estar ativa, com a chave de API, a carteira e o webhook (aba Conta e tarifas).",
  ROOT_ACCOUNT_MISSING: "A conta raiz da franqueadora não está ativa (aba Conta e tarifas).",
};

export async function salvarEmpresarialNoAsaas(input: {
  ligadoDesde: string | null;
  contaRislife: string | null;
}): Promise<ResultadoDoEmpresarial> {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) return { ok: false, error: RECUSA.NOT_ALLOWED };
  const data = input.ligadoDesde && /^\d{4}-\d{2}-\d{2}$/.test(input.ligadoDesde) ? input.ligadoDesde : null;
  const conta = input.contaRislife && UUID.test(input.contaRislife) ? input.contaRislife : null;
  const { error } = await (await createClient()).rpc("corporate_settings_save", {
    p_enabled_from: data,
    p_rislife_account_id: conta,
  });
  if (error) {
    const chave = Object.keys(RECUSA).find((k) => error.message.includes(k));
    if (!chave) console.error("corporate settings save failed:", error.message);
    return { ok: false, error: chave ? RECUSA[chave] : "Não foi possível salvar." };
  }
  revalidatePath("/central/rede/empresarial");
  revalidatePath("/empresarial/cobrancas");
  return { ok: true };
}
