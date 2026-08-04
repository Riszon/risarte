import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Installment } from "@/lib/finance/receivables";
import type { RenegotiationStatus } from "@/lib/finance/renegotiation";

export type ReceiptRow = {
  id: string;
  installmentId: string;
  amountCents: number;
  /** Composição da baixa (0188): a soma das quatro bate com amountCents. */
  principalCents: number;
  benefitCents: number;
  lateFeeCents: number;
  interestCents: number;
  receivedAt: string;
  paymentMethod: string | null;
  reference: string | null;
  reversed: boolean;
  reversalOf: string | null;
  reversalReason: string | null;
  byName: string | null;
  createdAt: string;
};

export type ReceivablesData = {
  installments: Installment[];
  receipts: ReceiptRow[];
  renegotiations: RenegotiationRow[];
  /** Teto de desconto da unidade — o MESMO da regra comercial (FIN2). */
  maxDiscountPercent: number | null;
  /** Recebido no período consultado (baixas ativas). */
  receivedInPeriodCents: number;
  periodStart: string;
  periodEnd: string;
};

type InstallmentRow = {
  id: string;
  seq: number;
  kind: "entrada" | "parcela";
  due_date: string;
  amount_cents: number;
  benefit_discount_cents: number | null;
  paid_amount_cents: number;
  paid_benefit_cents: number | null;
  paid_fee_cents: number | null;
  paid_interest_cents: number | null;
  status: Installment["status"];
  payment_method: string | null;
  late_fee_percent: number | null;
  monthly_interest_percent: number | null;
  grace_days: number | null;
  was_overdue: boolean;
  negotiation_id: string | null;
  direct_sale_id: string | null;
  renegotiation_id: string | null;
};

/** FIN2 — uma renegociação do cliente (documento, não cobrança). */
export type RenegotiationRow = {
  id: string;
  createdAt: string;
  status: RenegotiationStatus;
  originalPrincipalCents: number;
  originalBenefitCents: number;
  originalFeeCents: number;
  originalInterestCents: number;
  originalTotalCents: number;
  discountCents: number;
  discountPercent: number;
  newTotalCents: number;
  reason: string | null;
  requiresAuthorization: boolean;
  authorizationNote: string | null;
  byName: string | null;
  authorizedByName: string | null;
};

/**
 * FIN1 — cobranças do cliente + baixas. A RLS já limita o que este usuário pode
 * ver; aqui só montamos a visão.
 */
export async function loadClientReceivables(
  clientId: string,
  clinicId?: string,
  period?: { start: string; end: string }
): Promise<ReceivablesData> {
  const supabase = await createClient();

  const now = new Date();
  const start =
    period?.start ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const [py, pm] = start.split("-").map(Number);
  const end =
    period?.end ??
    `${pm === 12 ? py + 1 : py}-${String(pm === 12 ? 1 : pm + 1).padStart(2, "0")}-01`;

  const { data: instRows } = await supabase
    .from("payment_installments")
    .select(
      "id, seq, kind, due_date, amount_cents, benefit_discount_cents, paid_amount_cents, paid_benefit_cents, paid_fee_cents, paid_interest_cents, status, payment_method, late_fee_percent, monthly_interest_percent, grace_days, was_overdue, negotiation_id, direct_sale_id, renegotiation_id"
    )
    .eq("client_id", clientId)
    .order("due_date")
    .returns<InstallmentRow[]>();

  const installments: Installment[] = (instRows ?? []).map((r) => ({
    id: r.id,
    seq: r.seq,
    kind: r.kind,
    dueDate: r.due_date,
    amountCents: r.amount_cents,
    benefitDiscountCents: r.benefit_discount_cents ?? 0,
    paidAmountCents: r.paid_amount_cents ?? 0,
    paidBenefitCents: r.paid_benefit_cents ?? 0,
    paidFeeCents: r.paid_fee_cents ?? 0,
    paidInterestCents: r.paid_interest_cents ?? 0,
    status: r.status,
    paymentMethod: r.payment_method,
    terms: {
      lateFeePercent: r.late_fee_percent ?? 2,
      monthlyInterestPercent: r.monthly_interest_percent ?? 1,
      graceDays: r.grace_days ?? 0,
    },
    origin: r.renegotiation_id
      ? "renegotiation"
      : r.direct_sale_id
        ? "direct_sale"
        : "negotiation",
    wasOverdue: r.was_overdue,
  }));

  const renegotiations = await loadRenegotiations(supabase, clientId);
  const maxDiscountPercent = await loadMaxDiscountPercent(supabase, clinicId);

  if (installments.length === 0) {
    return {
      installments: [],
      receipts: [],
      renegotiations,
      maxDiscountPercent,
      receivedInPeriodCents: 0,
      periodStart: start,
      periodEnd: end,
    };
  }

  const ids = installments.map((i) => i.id);
  const { data: recRows } = await supabase
    .from("payment_receipts")
    .select(
      "id, installment_id, amount_cents, principal_cents, benefit_cents, late_fee_cents, interest_cents, received_at, payment_method, reference, reversed, reversal_of, reversal_reason, created_at, profiles:profiles!payment_receipts_created_by_fkey ( full_name )"
    )
    .in("installment_id", ids)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        installment_id: string;
        amount_cents: number;
        principal_cents: number | null;
        benefit_cents: number | null;
        late_fee_cents: number | null;
        interest_cents: number | null;
        received_at: string;
        payment_method: string | null;
        reference: string | null;
        reversed: boolean;
        reversal_of: string | null;
        reversal_reason: string | null;
        created_at: string;
        profiles: { full_name: string } | null;
      }[]
    >();

  const receipts: ReceiptRow[] = (recRows ?? []).map((r) => ({
    id: r.id,
    installmentId: r.installment_id,
    amountCents: r.amount_cents,
    principalCents: r.principal_cents ?? 0,
    benefitCents: r.benefit_cents ?? 0,
    lateFeeCents: r.late_fee_cents ?? 0,
    interestCents: r.interest_cents ?? 0,
    receivedAt: r.received_at,
    paymentMethod: r.payment_method,
    reference: r.reference,
    reversed: r.reversed,
    reversalOf: r.reversal_of,
    reversalReason: r.reversal_reason,
    byName: r.profiles?.full_name ?? null,
    createdAt: r.created_at,
  }));

  // "Recebido no período": baixas ATIVAS (não estornadas, não estornos).
  const receivedInPeriodCents = receipts
    .filter(
      (r) =>
        !r.reversed &&
        !r.reversalOf &&
        r.receivedAt >= start &&
        r.receivedAt < end
    )
    .reduce((s, r) => s + r.amountCents, 0);

  return {
    installments,
    receipts,
    renegotiations,
    maxDiscountPercent,
    receivedInPeriodCents,
    periodStart: start,
    periodEnd: end,
  };
}

/** Cascata rede → unidade, como no resto do sistema. */
async function loadMaxDiscountPercent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId?: string
): Promise<number | null> {
  const { data } = await supabase
    .from("commercial_rules")
    .select("clinic_id, max_discount_percent")
    .returns<{ clinic_id: string | null; max_discount_percent: number | null }[]>();
  const unit = (data ?? []).find((r) => clinicId && r.clinic_id === clinicId);
  const network = (data ?? []).find((r) => r.clinic_id === null);
  const value = unit?.max_discount_percent ?? network?.max_discount_percent;
  return value === null || value === undefined ? null : Number(value);
}

/** FIN2 — histórico de renegociações do cliente (a RLS já limita o acesso). */
async function loadRenegotiations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string
): Promise<RenegotiationRow[]> {
  const { data } = await supabase
    .from("payment_renegotiations")
    .select(
      "id, created_at, status, original_principal_cents, original_benefit_cents, original_fee_cents, original_interest_cents, original_total_cents, discount_cents, discount_percent, new_total_cents, reason, requires_authorization, authorization_note, author:profiles!payment_renegotiations_created_by_fkey ( full_name ), approver:profiles!payment_renegotiations_authorized_by_fkey ( full_name )"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        created_at: string;
        status: RenegotiationStatus;
        original_principal_cents: number;
        original_benefit_cents: number;
        original_fee_cents: number;
        original_interest_cents: number;
        original_total_cents: number;
        discount_cents: number;
        discount_percent: number;
        new_total_cents: number;
        reason: string | null;
        requires_authorization: boolean;
        authorization_note: string | null;
        author: { full_name: string } | null;
        approver: { full_name: string } | null;
      }[]
    >();

  return (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    originalPrincipalCents: r.original_principal_cents,
    originalBenefitCents: r.original_benefit_cents,
    originalFeeCents: r.original_fee_cents,
    originalInterestCents: r.original_interest_cents,
    originalTotalCents: r.original_total_cents,
    discountCents: r.discount_cents,
    discountPercent: Number(r.discount_percent ?? 0),
    newTotalCents: r.new_total_cents,
    reason: r.reason,
    requiresAuthorization: r.requires_authorization,
    authorizationNote: r.authorization_note,
    byName: r.author?.full_name ?? null,
    authorizedByName: r.approver?.full_name ?? null,
  }));
}
