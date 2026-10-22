"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { ApprovalMode } from "@/lib/finance/payables";
import { erroDaConta, portaAusente } from "@/lib/finance/conta-do-dinheiro";

export type PayableResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fornecedores");
}

/** Traduz o erro do banco — erro opaco já nos custou tempo neste projeto. */
function translate(message: string, fallback: string): string {
  const map: [string, string][] = [
    ["NOT_ALLOWED", "Sua função não permite mexer em contas a pagar."],
    ["INVALID_AMOUNT", "Informe um valor maior que zero."],
    ["DESCRIPTION_REQUIRED", "Descreva a despesa."],
    ["DUE_DATE_REQUIRED", "Informe o vencimento."],
    ["ACCOUNT_NOT_FOUND", "Conta do plano de contas não encontrada."],
    [
      "ACCOUNT_NOT_ANALYTIC",
      "Essa é uma conta de grupo: escolha uma conta analítica (a que recebe lançamento).",
    ],
    ["NOT_PENDING", "Esta conta já foi decidida."],
    [
      "SELF_APPROVAL",
      "Quem lançou não autoriza a própria conta — peça ao Financeiro da Franqueadora ou a outro Gerente.",
    ],
    ["NOT_APPROVED", "Esta conta ainda espera autorização."],
    ["PAYABLE_CLOSED", "Esta conta foi cancelada ou recusada."],
    ["AMOUNT_OVER_BALANCE", "O valor é maior que o saldo desta conta."],
    ["ALREADY_PAID", "Esta conta já tem pagamento: estorne antes de cancelar."],
    ["ALREADY_REVERSED", "Este pagamento já foi estornado."],
    ["CANNOT_REVERSE_REVERSAL", "Não se estorna um estorno."],
    ["REASON_REQUIRED", "Escreva o motivo."],
  ];
  for (const [code, text] of map) {
    if (message.includes(code)) return text;
  }
  return fallback;
}

/** FIN3 — lança a conta a pagar. A alçada é resolvida no banco. */
export async function savePayable(input: {
  clinicId: string;
  supplierId: string | null;
  accountCode: string;
  costCenterId: string | null;
  description: string;
  amountCents: number;
  dueDate: string;
  accrualDate: string;
  documentNumber: string;
  notes: string;
}): Promise<PayableResult & { pending?: boolean }> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("save_payable", {
    p_clinic_id: input.clinicId,
    p_supplier_id: input.supplierId,
    p_account_code: input.accountCode,
    p_cost_center_id: input.costCenterId,
    p_description: input.description,
    p_amount_cents: Math.round(input.amountCents),
    p_due_date: input.dueDate,
    p_accrual_date: input.accrualDate,
    p_document_number: input.documentNumber || null,
    p_notes: input.notes || null,
    p_recurrence_id: null,
  });
  if (error) {
    console.error("save_payable failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível lançar a conta."),
    };
  }

  await logAudit({ action: "create", entityType: "payable", entityId: input.clinicId });
  refresh();
  return { ok: true };
}

/** FIN3 — autoriza ou recusa. Quem lançou não decide a própria conta. */
export async function approvePayable(input: {
  payableId: string;
  approve: boolean;
  note: string;
}): Promise<PayableResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("approve_payable", {
    p_id: input.payableId,
    p_approve: input.approve,
    p_note: input.note || null,
  });
  if (error) {
    console.error("approve_payable failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível registrar a decisão."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "payable_approval",
    entityId: input.payableId,
  });
  refresh();
  return { ok: true };
}

/**
 * FIN3 — paga (total ou parcial). Multa e juros são INFORMADOS: quem define
 * é o fornecedor, não a nossa configuração. Eles vão para 4.2.01.
 */
export async function registerPayablePayment(input: {
  payableId: string;
  amountCents: number;
  feeCents: number;
  interestCents: number;
  /** Abatimento por pontualidade. O banco recusa acima do concedido. */
  discountCents?: number;
  paidAt: string;
  paymentMethod: string;
  reference: string;
  notes: string;
  clientToken: string;
  /** AP51: de qual conta o dinheiro saiu — id, 'caixa' ou vazio (a principal). */
  conta?: string;
}): Promise<PayableResult> {
  await getSessionContext();
  const supabase = await createClient();

  const args = {
    p_payable_id: input.payableId,
    p_amount_cents: Math.round(input.amountCents),
    p_paid_at: input.paidAt,
    p_payment_method: input.paymentMethod || null,
    p_fee_cents: Math.round(input.feeCents),
    p_interest_cents: Math.round(input.interestCents),
    p_discount_cents: Math.round(input.discountCents ?? 0),
    p_reference: input.reference || null,
    p_notes: input.notes || null,
    p_client_token: input.clientToken,
  };
  // AP51: a porta da 0317 grava a conta; antes de a 0317 rodar neste banco ela
  // não existe e o pagamento segue pela função de sempre.
  let { error } = await supabase.rpc("register_payable_payment_from", {
    p_conta: input.conta ?? "",
    ...args,
  });
  if (portaAusente(error)) {
    ({ error } = await supabase.rpc("register_payable_payment", args));
  }
  if (error) {
    const daConta = erroDaConta(error.message);
    if (daConta) return { ok: false, error: daConta };
    console.error("register_payable_payment failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível registrar o pagamento."),
    };
  }

  await logAudit({
    action: "create",
    entityType: "payable_payment",
    entityId: input.payableId,
  });
  refresh();
  return { ok: true };
}

/**
 * OC-00109 — PAGAR TODAS AS PARCELAS DA NOTA de uma vez. Quem paga cada uma é o
 * banco (`pay_stock_purchase`, 0300), parcela a parcela, pela MESMA porta do
 * botão Pagar — com permissão, razão contábil e período fechado. Tudo ou nada.
 */
export async function payStockPurchase(input: {
  purchaseId: string;
  paidAt: string;
  paymentMethod: string;
  reference: string;
  notes: string;
  /** AP51: de qual conta o dinheiro saiu — id, 'caixa' ou vazio (a principal). */
  conta?: string;
}): Promise<PayableResult & { pagas?: number; totalCents?: number; aguardando?: number }> {
  await getSessionContext();
  const supabase = await createClient();

  const args = {
    p_purchase_id: input.purchaseId,
    p_paid_at: input.paidAt,
    p_payment_method: input.paymentMethod || null,
    p_reference: input.reference || null,
    p_notes: input.notes || null,
  };
  let { data, error } = await supabase.rpc("pay_stock_purchase_from", {
    p_conta: input.conta ?? "",
    ...args,
  });
  if (portaAusente(error)) {
    ({ data, error } = await supabase.rpc("pay_stock_purchase", args));
  }
  if (error) {
    const daConta = erroDaConta(error.message);
    if (daConta) return { ok: false, error: daConta };
    console.error("pay_stock_purchase failed:", error.message);
    if (error.message.includes("NOTHING_TO_PAY")) {
      return { ok: false, error: "Esta nota não tem parcela em aberto para pagar." };
    }
    if (/could not find the function|schema cache/i.test(error.message)) {
      return { ok: false, error: "O banco ainda não recebeu a atualização 0300 — pague uma parcela por vez." };
    }
    return {
      ok: false,
      error: translate(error.message, "Não foi possível pagar as parcelas da nota."),
    };
  }

  const r = (data ?? {}) as { pagas?: number; total_cents?: number; aguardando?: number };
  await logAudit({
    action: "create",
    entityType: "payable_payment_batch",
    entityId: input.purchaseId,
    details: { parcelas: r.pagas ?? 0 },
  });
  refresh();
  return { ok: true, pagas: r.pagas ?? 0, totalCents: Number(r.total_cents ?? 0), aguardando: r.aguardando ?? 0 };
}

/** FIN3 — estorna um pagamento (contra-lançamento; o original fica). */
export async function reversePayablePayment(input: {
  paymentId: string;
  reason: string;
}): Promise<PayableResult> {
  await getSessionContext();
  const supabase = await createClient();

  if (!input.reason.trim()) {
    return { ok: false, error: "Escreva o motivo do estorno." };
  }
  const { error } = await supabase.rpc("reverse_payable_payment", {
    p_payment_id: input.paymentId,
    p_reason: input.reason,
  });
  if (error) {
    console.error("reverse_payable_payment failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível estornar."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "payable_payment_reversal",
    entityId: input.paymentId,
  });
  refresh();
  return { ok: true };
}

/** FIN3 — cancela a conta com motivo (nada se apaga). */
export async function cancelPayable(input: {
  payableId: string;
  reason: string;
}): Promise<PayableResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_payable", {
    p_id: input.payableId,
    p_reason: input.reason,
  });
  if (error) {
    console.error("cancel_payable failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível cancelar a conta."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "payable_cancel",
    entityId: input.payableId,
  });
  refresh();
  return { ok: true };
}

/** FIN3 — gera as contas do mês a partir das despesas recorrentes. */
export async function generateRecurringPayables(input: {
  clinicId: string;
  month: string;
}): Promise<PayableResult & { created?: number }> {
  await getSessionContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("generate_recurring_payables", {
    p_clinic_id: input.clinicId,
    p_month: input.month,
  });
  if (error) {
    console.error("generate_recurring_payables failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível gerar as contas."),
    };
  }

  refresh();
  return { ok: true, created: typeof data === "number" ? data : 0 };
}

/**
 * FIN3 — despesa recorrente (aluguel, software, contabilidade). Cadastra uma
 * vez e o sistema gera a conta do mês, em vez de alguém digitar 12 vezes.
 */
export async function saveRecurrence(input: {
  id: string | null;
  clinicId: string;
  supplierId: string | null;
  accountCode: string;
  costCenterId: string | null;
  description: string;
  amountCents: number;
  dueDay: number;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
}): Promise<PayableResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  if (!input.description.trim()) return { ok: false, error: "Descreva a despesa." };
  if (!input.accountCode) {
    return { ok: false, error: "Escolha a conta do plano de contas." };
  }
  if (input.amountCents <= 0) {
    return { ok: false, error: "Informe um valor maior que zero." };
  }
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) {
    return { ok: false, error: "O dia do vencimento vai de 1 a 31." };
  }

  const row = {
    clinic_id: input.clinicId,
    supplier_id: input.supplierId,
    account_code: input.accountCode,
    cost_center_id: input.costCenterId,
    description: input.description.trim(),
    amount_cents: Math.round(input.amountCents),
    due_day: input.dueDay,
    // Sempre o primeiro dia do mês: a competência é o mês, não o dia.
    start_month: input.startMonth.slice(0, 8) + "01",
    end_month: input.endMonth ? input.endMonth.slice(0, 8) + "01" : null,
    active: input.active,
  };

  const { error } = input.id
    ? await supabase.from("payable_recurrences").update(row).eq("id", input.id)
    : await supabase
        .from("payable_recurrences")
        .insert({ ...row, created_by: session.userId });
  if (error) {
    console.error("saveRecurrence failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a despesa recorrente." };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "payable_recurrence",
    entityId: input.id ?? input.clinicId,
  });
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fornecedores e alçada (escrita direta, protegida pela RLS)
// ---------------------------------------------------------------------------
export async function saveSupplier(input: {
  id: string | null;
  clinicId: string;
  name: string;
  document: string;
  kind: string;
  contactName: string;
  phone: string;
  email: string;
  paymentNotes: string;
  active: boolean;
}): Promise<PayableResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  if (!input.name.trim()) return { ok: false, error: "Informe o nome." };

  const row = {
    clinic_id: input.clinicId,
    name: input.name.trim(),
    document: input.document.replace(/\D/g, "") || null,
    kind: input.kind,
    contact_name: input.contactName || null,
    phone: input.phone || null,
    email: input.email || null,
    payment_notes: input.paymentNotes || null,
    active: input.active,
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };

  const { error } = input.id
    ? await supabase.from("suppliers").update(row).eq("id", input.id)
    : await supabase
        .from("suppliers")
        .insert({ ...row, created_by: session.userId });
  if (error) {
    console.error("saveSupplier failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o fornecedor." };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "supplier",
    entityId: input.id ?? input.clinicId,
  });
  refresh();
  return { ok: true };
}

/** Alçada: `clinicId` nulo grava o padrão da REDE; `accountCode` nulo, o geral. */
export async function saveApprovalRule(input: {
  clinicId: string | null;
  accountCode: string | null;
  mode: ApprovalMode;
  thresholdCents: number | null;
}): Promise<PayableResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.from("payable_approval_rules").upsert(
    {
      clinic_id: input.clinicId,
      account_code: input.accountCode,
      approval_mode: input.mode,
      threshold_cents: input.thresholdCents,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    },
    { onConflict: "clinic_id,account_code" }
  );
  if (error) {
    console.error("saveApprovalRule failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a regra de alçada." };
  }

  await logAudit({
    action: "update",
    entityType: "payable_approval_rule",
    entityId: input.accountCode ?? "geral",
  });
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}

export async function deleteApprovalRule(input: {
  clinicId: string | null;
  accountCode: string;
}): Promise<PayableResult> {
  await getSessionContext();
  const supabase = await createClient();

  let q = supabase
    .from("payable_approval_rules")
    .delete()
    .eq("account_code", input.accountCode);
  q = input.clinicId
    ? q.eq("clinic_id", input.clinicId)
    : q.is("clinic_id", null);
  const { error } = await q;
  if (error) {
    console.error("deleteApprovalRule failed:", error.message);
    return { ok: false, error: "Não foi possível remover a regra." };
  }

  await logAudit({
    action: "update",
    entityType: "payable_approval_rule",
    entityId: input.accountCode,
  });
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}
