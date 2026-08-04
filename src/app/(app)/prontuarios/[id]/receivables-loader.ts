import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Installment } from "@/lib/finance/receivables";

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
};

/**
 * FIN1 — cobranças do cliente + baixas. A RLS já limita o que este usuário pode
 * ver; aqui só montamos a visão.
 */
export async function loadClientReceivables(
  clientId: string,
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
      "id, seq, kind, due_date, amount_cents, benefit_discount_cents, paid_amount_cents, paid_benefit_cents, paid_fee_cents, paid_interest_cents, status, payment_method, late_fee_percent, monthly_interest_percent, grace_days, was_overdue, negotiation_id, direct_sale_id"
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
    origin: r.direct_sale_id ? "direct_sale" : "negotiation",
    wasOverdue: r.was_overdue,
  }));

  if (installments.length === 0) {
    return {
      installments: [],
      receipts: [],
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
    receivedInPeriodCents,
    periodStart: start,
    periodEnd: end,
  };
}
