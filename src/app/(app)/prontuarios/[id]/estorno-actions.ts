"use server";

// ASA3, entrega 2 (4009): o histórico do split e o pedido de estorno da
// cobrança, na ficha. O BANCO decide quem pode (`charge_refund_check`: o Admin
// Master, ou quem tem a permissão E o papel que a unidade indicou como titular
// do acesso de autorização do Asaas). O código de autorização NUNCA passa aqui.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SplitDaCobranca = {
  updates: { at: string; reasons: string[]; outcome: string }[];
  naFila: boolean;
  refundState: "aguardando_autorizacao" | "aguardando_pagador" | null;
  refund: {
    kind: "pix" | "cartao" | "boleto";
    reason: string;
    requested_at: string;
    request_url: string | null;
    status: string;
    status_note: string | null;
  } | null;
  podePedirEstorno: boolean;
};

export async function lerSplitDaCobranca(chargeId: string): Promise<SplitDaCobranca | null> {
  if (!UUID.test(chargeId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("charge_split_history", { p_charge_id: chargeId });
  if (error) return null;
  return data as SplitDaCobranca;
}

const MENSAGENS: Record<string, string> = {
  NOT_ALLOWED: "Você não está entre as pessoas que esta unidade indicou para pedir estorno.",
  REASON_REQUIRED: "Escreva o motivo do estorno.",
  NOT_REFUNDABLE: "Esta cobrança não pode ser estornada pelo riSZon (não está paga pelo Asaas).",
  REFUND_PENDING: "Já existe um pedido de estorno para esta cobrança.",
};

export async function pedirEstorno(args: { clientId: string; chargeId: string; motivo: string }): Promise<
  { ok: true; estado: string; link: string | null } | { ok: false; error: string }
> {
  if (!UUID.test(args.chargeId) || !UUID.test(args.clientId)) return { ok: false, error: "Cobrança não encontrada." };
  const motivo = String(args.motivo ?? "").trim().slice(0, 300);
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("charge_refund_check", { p_charge_id: args.chargeId, p_reason: motivo });
  if (error) {
    const m = Object.entries(MENSAGENS).find(([k]) => error.message.includes(k));
    return { ok: false, error: m ? m[1] : "Não foi possível pedir o estorno." };
  }
  const c = (Array.isArray(data) ? data[0] : data) as {
    charge_id: string;
    account_id: string;
    asaas_payment_id: string;
    billing_type: string;
  } | null;
  if (!c) return { ok: false, error: "Cobrança não encontrada." };
  const { pedirEstornoNoAsaas } = await import("@/lib/asaas/split-servidor");
  const r = await pedirEstornoNoAsaas({
    chargeId: c.charge_id,
    accountId: c.account_id,
    asaasPaymentId: c.asaas_payment_id,
    billingType: c.billing_type,
    actorId: session.userId,
    reason: motivo,
  });
  revalidatePath(`/prontuarios/${args.clientId}`);
  return r.ok ? { ok: true, estado: r.estado, link: r.link } : { ok: false, error: r.error };
}
