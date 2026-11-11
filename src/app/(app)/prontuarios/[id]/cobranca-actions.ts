"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, pode } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { cancelarNoAsaas, emitirNoAsaas } from "@/lib/asaas/cobranca";
import { mensagemDaCobranca, type MeioDaCobranca } from "@/lib/cobrancas";

/**
 * AS AÇÕES DA COBRANÇA NA FICHA (ASA1, entrega 2).
 *
 * Duas portas em cada ação: a permissão da TELA (`acao.cobranca.*`, que nasce
 * só com o Admin Master) e a do BANCO (`charge_*`, que confere papel, unidade,
 * prontidão, pagador e valor). A chamada ao Asaas sai daqui, pelo servidor,
 * com a chave da conta da unidade lida do Vault.
 */

export type ResultadoDaCobranca = { ok: true } | { ok: false; error: string };

export type PreviaDaCobranca =
  | {
      ok: true;
      valueCents: number;
      discountCents: number;
      finePercent: number;
      interestPercent: number;
      dueDate: string;
      isOverdueReissue: boolean;
      maxReissueDays: number;
      payerKind: string;
      payerName: string;
    }
  | { ok: false; error: string; maxReissueDays?: number };

async function clinicaDaParcela(installmentId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_installments")
    .select("clinic_id")
    .eq("id", installmentId)
    .maybeSingle<{ clinic_id: string }>();
  return data?.clinic_id ?? null;
}

async function clinicaDaCobranca(chargeId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("charges").select("clinic_id").eq("id", chargeId).maybeSingle<{ clinic_id: string }>();
  return data?.clinic_id ?? null;
}

const SEM_PERMISSAO = { ok: false as const, error: "Você não tem permissão para esta ação." };

export async function previaDaCobranca(input: {
  installmentId: string;
  billingType: MeioDaCobranca;
  dueDate: string | null;
}): Promise<PreviaDaCobranca> {
  const session = await getSessionContext();
  const clinicId = await clinicaDaParcela(input.installmentId);
  if (!clinicId || !pode(session, "acao.cobranca.emitir", clinicId)) return SEM_PERMISSAO;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("charge_preview", {
    p_installment_id: input.installmentId,
    p_billing_type: input.billingType,
    p_due_date: input.dueDate,
  });
  if (error) return { ok: false, error: mensagemDaCobranca(error.message) };
  const r = (Array.isArray(data) ? data[0] : data) as {
    error_code: string | null;
    value_cents: number | null;
    discount_cents: number | null;
    fine_percent: number | null;
    interest_percent: number | null;
    due_date: string | null;
    is_overdue_reissue: boolean | null;
    max_reissue_days: number | null;
    payer_kind: string | null;
    payer_name: string | null;
  } | null;
  if (!r) return { ok: false, error: mensagemDaCobranca(null) };
  if (r.error_code) {
    return { ok: false, error: mensagemDaCobranca(r.error_code), maxReissueDays: r.max_reissue_days ?? undefined };
  }
  return {
    ok: true,
    valueCents: Number(r.value_cents),
    discountCents: Number(r.discount_cents ?? 0),
    finePercent: Number(r.fine_percent ?? 0),
    interestPercent: Number(r.interest_percent ?? 0),
    dueDate: String(r.due_date),
    isOverdueReissue: Boolean(r.is_overdue_reissue),
    maxReissueDays: Number(r.max_reissue_days ?? 7),
    payerKind: String(r.payer_kind),
    payerName: String(r.payer_name ?? ""),
  };
}

export async function emitirCobranca(input: {
  clientId: string;
  installmentId: string;
  billingType: MeioDaCobranca;
  dueDate: string | null;
}): Promise<ResultadoDaCobranca> {
  const session = await getSessionContext();
  const clinicId = await clinicaDaParcela(input.installmentId);
  if (!clinicId || !pode(session, "acao.cobranca.emitir", clinicId)) return SEM_PERMISSAO;
  const supabase = await createClient();
  const { data: chargeId, error } = await supabase.rpc("charge_prepare", {
    p_installment_id: input.installmentId,
    p_billing_type: input.billingType,
    p_due_date: input.dueDate,
  });
  if (error || typeof chargeId !== "string") return { ok: false, error: mensagemDaCobranca(error?.message) };

  const r = await emitirNoAsaas(chargeId, session.userId);
  await logAudit({
    action: "create",
    entityType: "charge",
    entityId: chargeId,
    clinicId,
    details: { installmentId: input.installmentId, billingType: input.billingType, ok: r.ok },
  });
  revalidatePath(`/prontuarios/${input.clientId}`);
  return r;
}

export async function tentarDeNovo(input: { clientId: string; chargeId: string }): Promise<ResultadoDaCobranca> {
  const session = await getSessionContext();
  const clinicId = await clinicaDaCobranca(input.chargeId);
  if (!clinicId || !pode(session, "acao.cobranca.emitir", clinicId)) return SEM_PERMISSAO;
  const supabase = await createClient();
  const { error } = await supabase.rpc("charge_retry_prepare", { p_charge_id: input.chargeId });
  if (error) return { ok: false, error: mensagemDaCobranca(error.message) };
  const r = await emitirNoAsaas(input.chargeId, session.userId);
  revalidatePath(`/prontuarios/${input.clientId}`);
  return r;
}

/**
 * Cancelar (`cancel`: Gerente, Financeiro, Admin) ou "recebeu no balcão"
 * (`counter`: quem recebe). Cancela no Asaas e só então grava; a cobrança paga
 * no Asaas é recusada.
 */
export async function cancelarCobranca(input: {
  clientId: string;
  chargeId: string;
  purpose: "cancel" | "counter";
  reason: string;
}): Promise<ResultadoDaCobranca & { jaPaga?: boolean }> {
  const session = await getSessionContext();
  const clinicId = await clinicaDaCobranca(input.chargeId);
  const cap = input.purpose === "cancel" ? "acao.cobranca.cancelar" : "acao.cobranca.ver";
  if (!clinicId || !pode(session, cap, clinicId)) return SEM_PERMISSAO;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("charge_cancel_check", {
    p_charge_id: input.chargeId,
    p_purpose: input.purpose,
  });
  if (error) return { ok: false, error: mensagemDaCobranca(error.message) };
  const chk = (Array.isArray(data) ? data[0] : data) as {
    asaas_payment_id: string | null;
    gateway_account_id: string | null;
  } | null;
  const r = await cancelarNoAsaas({
    chargeId: input.chargeId,
    accountId: chk?.gateway_account_id ?? null,
    asaasPaymentId: chk?.asaas_payment_id ?? null,
    actorId: session.userId,
    reason: input.reason || (input.purpose === "counter" ? "pagou no balcão" : "cancelada"),
  });
  await logAudit({
    action: "update",
    entityType: "charge",
    entityId: input.chargeId,
    clinicId,
    details: { cancel: input.purpose, ok: r.ok },
  });
  revalidatePath(`/prontuarios/${input.clientId}`);
  return r;
}

export async function marcarCobrancaExterna(input: {
  clientId: string;
  installmentId: string;
  note: string;
}): Promise<ResultadoDaCobranca> {
  const session = await getSessionContext();
  const clinicId = await clinicaDaParcela(input.installmentId);
  if (!clinicId || !pode(session, "acao.cobranca.cancelar", clinicId)) return SEM_PERMISSAO;
  const supabase = await createClient();
  const { error } = await supabase.rpc("charge_mark_external", {
    p_installment_id: input.installmentId,
    p_note: input.note,
  });
  if (error) return { ok: false, error: mensagemDaCobranca(error.message) };
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true };
}

export async function desfazerCobrancaExterna(input: {
  clientId: string;
  chargeId: string;
  reason: string;
}): Promise<ResultadoDaCobranca> {
  const session = await getSessionContext();
  const clinicId = await clinicaDaCobranca(input.chargeId);
  if (!clinicId || !pode(session, "acao.cobranca.cancelar", clinicId)) return SEM_PERMISSAO;
  const supabase = await createClient();
  const { error } = await supabase.rpc("charge_unmark_external", {
    p_charge_id: input.chargeId,
    p_reason: input.reason,
  });
  if (error) return { ok: false, error: mensagemDaCobranca(error.message) };
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true };
}
