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
  /** Só no boleto e para quem pode pedir: o celular que irá ao Asaas (18.7.7). */
  boleto: { celular: string | null; email: string | null; termoDeclarado: boolean } | null;
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
  NO_MOBILE: "Falta o celular válido do pagador. Cadastre o celular na ficha antes de pedir o estorno do boleto.",
  NO_EMAIL: "Falta o e-mail válido do pagador. Cadastre o e-mail na ficha antes de pedir o estorno do boleto.",
  PRIVACY_NOT_DECLARED: "Falta o Admin Master declarar o termo de privacidade. Faça este estorno no painel do Asaas.",
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
  // 4020a (cuidado 1): o estorno de CARTÃO, mesmo o total, passa pela confirmação reforçada.
  if (c.billing_type === "CREDIT_CARD") {
    const r = await pedirEstornoComValor({ clientId: args.clientId, chargeId: c.charge_id, amountCents: null, motivo });
    return r.ok ? { ok: true, estado: r.aviso.startsWith("Pedido registrado") ? "aguardando_confirmacao" : "aguardando_autorizacao", link: null } : r;
  }
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

// ---- 4020a (spec 19.38): o estorno com valor, a confirmação do cartão e a parcela estornada ----

const MENSAGENS_4020A: [string, string][] = [
  ["NOT_ALLOWED", "Sua função não permite esta ação."],
  ["REASON_REQUIRED", "Escreva o motivo (pelo menos 5 letras)."],
  ["AMOUNT_OVER_BALANCE", "O valor passa do que ainda pode ser estornado."],
  ["NOTHING_TO_REFUND", "Não há mais nada a estornar nesta cobrança."],
  ["REFUND_PENDING", "Já há um estorno pendente nesta cobrança."],
  ["USE_O_PARCELAMENTO", "No cartão parcelado pelo Asaas, o estorno é pelo parcelamento."],
  ["BOLETO_PELO_ESTORNO_TOTAL", "O boleto só tem o estorno total, pelo pagador (o botão \"Pedir estorno\")."],
  ["NOT_REFUNDABLE", "Esta cobrança não pode ser estornada."],
  ["SELF_CONFIRM", "Quem pediu o estorno não confirma o próprio pedido: o Gerente ou o franqueado confirma."],
  ["REQUEST_NOT_WAITING", "Este pedido não está mais esperando."],
  ["NOT_REFUND_CLOSED", "Esta parcela não está encerrada por estorno."],
];
const mensagem4020a = (m: string) => MENSAGENS_4020A.find(([k]) => m.includes(k))?.[1] ?? "Não foi possível concluir. Tente de novo.";

export type PreviaDoEstornoParcial = {
  kind: "pix" | "cartao" | "boleto";
  left_cents: number;
  amount_cents: number;
  partial: boolean;
  patient: { code: string | null; name: string | null };
  needs_confirm: boolean;
  limit_cents: number | null;
  expected_split: { charge_id: string; numero: number; valor_cents: number; inteira: boolean }[] | null;
};

export async function previaDoEstornoParcial(args: { chargeId?: string | null; blockId?: string | null; amountCents?: number | null }): Promise<
  { ok: true; previa: PreviaDoEstornoParcial } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refund_request_preview", {
    p: { charge_id: args.chargeId ?? null, block_id: args.blockId ?? null, amount_cents: args.amountCents ?? null },
  });
  if (error) return { ok: false, error: mensagem4020a(error.message) };
  return { ok: true, previa: data as PreviaDoEstornoParcial };
}

/** O pedido (parcial ou total) de Pix ou cartão. O cartão acima do limite espera a confirmação. */
export async function pedirEstornoComValor(args: {
  clientId: string;
  chargeId?: string | null;
  blockId?: string | null;
  amountCents?: number | null;
  motivo: string;
}): Promise<{ ok: true; aviso: string } | { ok: false; error: string }> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refund_request_create", {
    p: { charge_id: args.chargeId ?? null, block_id: args.blockId ?? null, amount_cents: args.amountCents ?? null, reason: String(args.motivo ?? "").trim().slice(0, 300) },
  });
  if (error) return { ok: false, error: mensagem4020a(error.message) };
  const r = data as { id: string; needs_confirm: boolean };
  revalidatePath(`/prontuarios/${args.clientId}`);
  if (r.needs_confirm) return { ok: true, aviso: "Pedido registrado. O Gerente ou o franqueado confirma antes de ir ao Asaas." };
  const { enviarPedidoDeEstorno } = await import("@/lib/asaas/estorno-parcial");
  const e = await enviarPedidoDeEstorno(r.id, session.userId);
  revalidatePath(`/prontuarios/${args.clientId}`);
  if (!e.ok) return { ok: false, error: e.error };
  return {
    ok: true,
    aviso:
      e.estado === "concluido" ? "Estorno concluído no Asaas." : e.estado === "aguardando_autorizacao" ? "Pedido feito: espera a autorização do titular no painel do Asaas." : "Pedido feito: o estorno está em processamento no Asaas.",
  };
}

export async function confirmarEstorno(args: { clientId: string; requestId: string }): Promise<{ ok: true; aviso: string } | { ok: false; error: string }> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("refund_request_confirm", { p_id: args.requestId });
  if (error) return { ok: false, error: mensagem4020a(error.message) };
  const { enviarPedidoDeEstorno } = await import("@/lib/asaas/estorno-parcial");
  const e = await enviarPedidoDeEstorno(args.requestId, session.userId);
  revalidatePath(`/prontuarios/${args.clientId}`);
  if (!e.ok) return { ok: false, error: e.error };
  return { ok: true, aviso: e.estado === "concluido" ? "Estorno concluído no Asaas." : "Confirmado: o estorno foi pedido ao Asaas." };
}

export async function cancelarPedidoDeEstorno(args: { clientId: string; requestId: string; motivo: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("refund_request_cancel", { p_id: args.requestId, p_reason: args.motivo });
  if (error) return { ok: false, error: mensagem4020a(error.message) };
  revalidatePath(`/prontuarios/${args.clientId}`);
  return { ok: true };
}

export type PedidoDeEstorno = {
  id: string;
  charge_id: string | null;
  block: string | null;
  kind: string;
  amount_cents: number | null;
  partial: boolean;
  reason: string;
  status: string;
  requested_at: string;
  requested_by: string | null;
  confirmed_by: string | null;
  expected_split: { numero: number; valor_cents: number; inteira: boolean }[] | null;
  actual_split: { charge_id: string; amount_cents: number; inteira: boolean; asaas_status: string }[] | null;
  split_differs: boolean | null;
  can_confirm: boolean;
  can_cancel: boolean;
};

export async function lerPedidosDeEstorno(clientId: string): Promise<PedidoDeEstorno[]> {
  if (!UUID.test(clientId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refund_requests_read", { p_client_id: clientId });
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("refund requests read failed:", error.message);
    return [];
  }
  return (data ?? []) as PedidoDeEstorno[];
}

export async function reabrirParcelaEstornada(args: { clientId: string; installmentId: string; motivo: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("installment_refund_reopen", { p_installment_id: args.installmentId, p_reason: args.motivo });
  if (error) return { ok: false, error: mensagem4020a(error.message) };
  revalidatePath(`/prontuarios/${args.clientId}`);
  return { ok: true };
}

export type ParcelaEstornada = { id: string; seq: number; due_date: string; amount_cents: number; closed_at: string; can_reopen: boolean };

export async function lerParcelasEstornadas(clientId: string): Promise<ParcelaEstornada[]> {
  if (!UUID.test(clientId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("installments_refund_closed", { p_client_id: clientId });
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("refund closed installments read failed:", error.message);
    return [];
  }
  return (data ?? []) as ParcelaEstornada[];
}
