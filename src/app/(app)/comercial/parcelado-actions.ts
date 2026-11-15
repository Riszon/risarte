"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, pode } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { cancelarParcelamentoNoAsaas, emitirParcelamentoNoAsaas, estornarParcelamentoNoAsaas } from "@/lib/asaas/parcelamento";
import { mensagemDaCobranca } from "@/lib/cobrancas";
import { mensagemDoErroDoParcelado } from "@/lib/venda-direta-meios";
import type { FaixaDoParcelado } from "@/lib/asaas/parcelado";

/**
 * ASA4 (4013, spec 19.19): as ações do CARTÃO PARCELADO PELO ASAAS — o
 * parcelamento inteiro, nunca uma parcela sozinha. Quem pode é conferido pelo
 * banco (com a sessão da pessoa) antes de qualquer chamada ao Asaas; toda ação
 * fica na auditoria.
 */

type Resultado = { ok: true } | { ok: false; error: string };
const SEM_PERMISSAO: Resultado = { ok: false, error: "Você não tem permissão para isto." };
const mensagem = (m: string | null | undefined) => mensagemDoErroDoParcelado(m ?? "") ?? mensagemDaCobranca(m ?? undefined);
const mensagemDoEstorno = (m: string) => {
  if (m.includes("NOT_ALLOWED")) return "Você não está entre as pessoas que esta unidade indicou para pedir estorno.";
  if (m.includes("REASON_REQUIRED")) return "Escreva o motivo do estorno (pelo menos 5 letras).";
  if (m.includes("NOT_REFUNDABLE")) return "O parcelamento só pode ser estornado com todas as parcelas pagas pelo Asaas.";
  if (m.includes("REFUND_PENDING")) return "Já existe um pedido de estorno para este parcelamento.";
  return mensagem(m);
};

/** As tarifas do parcelado da unidade e a soma das taxas da rede (tabela do fechamento). */
export async function lerTabelaDoParcelado(clinicId: string): Promise<{ faixas: FaixaDoParcelado[]; rede_percent: number } | null> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("card_block_fee_table", { p_clinic_id: clinicId });
  if (error) {
    if (!/NOT_ALLOWED|does not exist|schema cache/i.test(error.message)) console.error("card_block_fee_table failed:", error.message);
    return null;
  }
  const d = data as { faixas: FaixaDoParcelado[]; rede_percent: number };
  return { faixas: (d.faixas ?? []).map((f) => ({ de: Number(f.de), ate: Number(f.ate), pct: Number(f.pct), fixo: Number(f.fixo) })), rede_percent: Number(d.rede_percent ?? 0) };
}

async function clinicaDoBloco(blockId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("charges").select("clinic_id").eq("installment_block", blockId).limit(1).maybeSingle();
  return (data?.clinic_id as string | undefined) ?? null;
}

/** Cria à mão o parcelamento da venda (venda assinada antes de ligar a unidade, ou depois de cancelado). */
export async function gerarParcelamento(input: { negotiationId?: string | null; directSaleId?: string | null }): Promise<Resultado> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: block, error } = await supabase.rpc("charge_block_prepare", {
    p_negotiation_id: input.negotiationId ?? null,
    p_direct_sale_id: input.directSaleId ?? null,
  });
  if (error || typeof block !== "string") return { ok: false, error: mensagem(error?.message) };
  const r = await emitirParcelamentoNoAsaas(block, session.userId);
  await logAudit({
    action: "create",
    entityType: "charge_block",
    entityId: block,
    clinicId: (await clinicaDoBloco(block)) ?? undefined,
    details: { negotiationId: input.negotiationId ?? null, directSaleId: input.directSaleId ?? null, ok: r.ok },
  });
  revalidatePath("/comercial", "layout");
  return r;
}

export async function tentarDeNovoParcelamento(blockId: string): Promise<Resultado> {
  const session = await getSessionContext();
  const clinicId = await clinicaDoBloco(blockId);
  if (!clinicId || !pode(session, "acao.cobranca.emitir", clinicId)) return SEM_PERMISSAO;
  const supabase = await createClient();
  const { error } = await supabase.rpc("charge_block_retry", { p_block: blockId });
  if (error) return { ok: false, error: mensagem(error.message) };
  const r = await emitirParcelamentoNoAsaas(blockId, session.userId);
  await logAudit({ action: "update", entityType: "charge_block", entityId: blockId, clinicId, details: { retry: true, ok: r.ok } });
  revalidatePath("/comercial", "layout");
  return r;
}

/** Cancela o parcelamento NÃO pago, inteiro. */
export async function cancelarParcelamento(input: { blockId: string; reason: string }): Promise<Resultado> {
  const session = await getSessionContext();
  const clinicId = await clinicaDoBloco(input.blockId);
  if (!clinicId || !pode(session, "acao.cobranca.cancelar", clinicId)) return SEM_PERMISSAO;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("card_block_cancel_check", { p_block: input.blockId, p_reason: input.reason });
  if (error) return { ok: false, error: mensagem(error.message) };
  const chk = (Array.isArray(data) ? data[0] : data) as { account_id: string | null; asaas_installment_id: string | null; charge_ids: string[] } | null;
  const r = await cancelarParcelamentoNoAsaas({
    blockId: input.blockId,
    accountId: chk?.account_id ?? null,
    asaasInstallmentId: chk?.asaas_installment_id ?? null,
    chargeIds: chk?.charge_ids ?? [],
    actorId: session.userId,
    reason: input.reason,
  });
  await logAudit({ action: "update", entityType: "charge_block", entityId: input.blockId, clinicId, details: { cancel: true, reason: input.reason, ok: r.ok } });
  revalidatePath("/comercial", "layout");
  return r;
}

/**
 * 4014 (19.20, 1a): o pedido de DEVOLUÇÃO POR PIX na desistência. O termo
 * assinado já foi enviado à pasta privada `devolucoes` (o banco confere que ele
 * existe e é da unidade). Só o Financeiro da Franqueadora ou o Admin Master autorizam.
 */
export async function pedirDevolucao(input: { blockId: string; amountCents: number; reason: string; termPath: string; termName: string }): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("card_block_return_request", {
    p: { block: input.blockId, amount_cents: input.amountCents, reason: input.reason, term_path: input.termPath, term_name: input.termName },
  });
  if (error) return { ok: false, error: mensagemDaDevolucao(error.message) };
  revalidatePath("/comercial", "layout");
  return { ok: true };
}

export async function decidirDevolucao(input: { id: string; approve: boolean; note: string }): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("card_block_return_decide", { p_id: input.id, p_approve: input.approve, p_note: input.note });
  if (error) return { ok: false, error: mensagemDaDevolucao(error.message) };
  revalidatePath("/comercial", "layout");
  return { ok: true };
}

/** Link curto (10 min) para abrir o termo; a regra da pasta decide quem vê. */
export async function linkDoTermo(path: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("devolucoes").createSignedUrl(path, 600);
  if (error || !data) return { ok: false, error: "Não foi possível abrir o termo." };
  await logAudit({ action: "view", entityType: "card_block_return_term", entityId: path });
  return { ok: true, url: data.signedUrl };
}

const mensagemDaDevolucao = (m: string) => {
  if (m.includes("TERM_REQUIRED")) return "Anexe o distrato ou o termo de devolução assinado. Sem o anexo, a devolução não é registrada.";
  if (m.includes("AMOUNT_OVER_BALANCE")) return "O valor passa do que ainda pode ser devolvido neste parcelamento.";
  if (m.includes("PARCELADO_ASAAS_NAO_PAGO")) return "A devolução por Pix é só para o parcelamento já pago no cartão.";
  if (m.includes("RETURN_ALREADY_DECIDED")) return "Este pedido já foi decidido.";
  if (m.includes("REASON_REQUIRED")) return "Escreva o motivo (pelo menos 5 letras).";
  if (m.includes("NOT_ALLOWED")) return "Você não tem permissão para isto (pedir: Gerente; autorizar: Financeiro da Franqueadora ou Admin Master).";
  return mensagem(m);
};

export type PreviaDoEstorno = {
  parcelas: number;
  creditadas: number;
  a_creditar: number;
  devolvido_cents: number;
  tarifa_que_nao_volta_cents: number;
  taxa_devida_cents: number;
  estornavel: boolean;
};

/** O que a unidade perde no estorno inteiro, ANTES de confirmar (19.20, 2a). */
export async function previaDoEstorno(blockId: string): Promise<{ ok: true; previa: PreviaDoEstorno } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("card_block_refund_preview", { p_block: blockId });
  if (error) return { ok: false, error: mensagemDoEstorno(error.message) };
  return { ok: true, previa: data as PreviaDoEstorno };
}

/** Estorna o parcelamento INTEIRO. A taxa da rede continua devida (dispensa só à mão). */
export async function estornarParcelamento(input: { blockId: string; reason: string }): Promise<Resultado> {
  const session = await getSessionContext();
  const clinicId = await clinicaDoBloco(input.blockId);
  if (!clinicId) return { ok: false, error: "Parcelamento não encontrado." };
  // Quem pode pedir estorno é a regra da 4009 (`_charge_refund_can`), conferida no banco.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("card_block_refund_check", { p_block: input.blockId, p_reason: input.reason });
  if (error) return { ok: false, error: mensagemDoEstorno(error.message) };
  const chk = (Array.isArray(data) ? data[0] : data) as { account_id: string; asaas_installment_id: string; charge_ids: string[] } | null;
  if (!chk) return { ok: false, error: "Parcelamento não encontrado." };
  const r = await estornarParcelamentoNoAsaas({
    accountId: chk.account_id,
    asaasInstallmentId: chk.asaas_installment_id,
    chargeIds: chk.charge_ids,
    actorId: session.userId,
    reason: input.reason,
  });
  await logAudit({ action: "update", entityType: "charge_block", entityId: input.blockId, clinicId, details: { refund: true, reason: input.reason, ok: r.ok } });
  revalidatePath("/comercial", "layout");
  return r;
}
