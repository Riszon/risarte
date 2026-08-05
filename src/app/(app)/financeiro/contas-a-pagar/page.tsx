import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { sortAccounts, type ChartAccount } from "@/lib/finance/accounts";
import type {
  ApprovalMode,
  ApprovalRule,
  Payable,
  PayablePaymentEntry,
} from "@/lib/finance/payables";
import { PayablesBoard, type PaymentRow } from "./payables-board";

/** FIN3 — contas a pagar da unidade: o outro lado do caixa. */
export default async function PayablesPage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const clinicId = session.activeClinic?.id ?? null;
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const [
    { data: payableRows },
    { data: paymentRows },
    { data: supplierRows },
    { data: accountRows },
    { data: centerRows },
    { data: ruleRows },
  ] = await Promise.all([
    supabase
      .from("payables")
      .select(
        "id, clinic_id, supplier_id, account_code, cost_center_id, description, document_number, accrual_date, due_date, amount_cents, paid_amount_cents, paid_fee_cents, paid_interest_cents, status, approval_mode, requires_approval, approval_note, cancel_reason, notes, recurrence_id, created_by, supplier:suppliers ( name ), account:chart_of_accounts!payables_account_code_fkey ( name ), center:cost_centers ( name ), author:profiles!payables_created_by_fkey ( full_name ), approver:profiles!payables_approved_by_fkey ( full_name )"
      )
      .eq("clinic_id", clinicId)
      .order("due_date"),
    supabase
      .from("payable_payments")
      .select(
        "id, payable_id, amount_cents, fee_cents, interest_cents, paid_at, payment_method, reference, reversed, reversal_of, reversal_reason, author:profiles!payable_payments_created_by_fkey ( full_name )"
      )
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false }),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("chart_of_accounts")
      .select("code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic, fiscal_account_code, active")
      .eq("active", true),
    supabase
      .from("cost_centers")
      .select("id, name, scope, clinic_id")
      .eq("active", true)
      .order("code"),
    supabase
      .from("payable_approval_rules")
      .select("clinic_id, account_code, approval_mode, threshold_cents"),
  ]);

  type Embed = { name: string } | { name: string }[] | null;
  const one = (v: Embed): string | null =>
    Array.isArray(v) ? (v[0]?.name ?? null) : (v?.name ?? null);
  type PersonEmbed =
    | { full_name: string }
    | { full_name: string }[]
    | null;
  const person = (v: PersonEmbed): string | null =>
    Array.isArray(v) ? (v[0]?.full_name ?? null) : (v?.full_name ?? null);

  const payables: Payable[] = (
    (payableRows ?? []) as unknown as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    clinicId: r.clinic_id as string,
    supplierId: (r.supplier_id as string | null) ?? null,
    supplierName: one(r.supplier as Embed),
    accountCode: r.account_code as string,
    accountName: one(r.account as Embed),
    costCenterId: (r.cost_center_id as string | null) ?? null,
    costCenterName: one(r.center as Embed),
    description: r.description as string,
    documentNumber: (r.document_number as string | null) ?? null,
    accrualDate: r.accrual_date as string,
    dueDate: r.due_date as string,
    amountCents: Number(r.amount_cents),
    paidAmountCents: Number(r.paid_amount_cents ?? 0),
    paidFeeCents: Number(r.paid_fee_cents ?? 0),
    paidInterestCents: Number(r.paid_interest_cents ?? 0),
    status: r.status as Payable["status"],
    approvalMode: r.approval_mode as ApprovalMode,
    requiresApproval: Boolean(r.requires_approval),
    approvedByName: person(r.approver as PersonEmbed),
    approvalNote: (r.approval_note as string | null) ?? null,
    cancelReason: (r.cancel_reason as string | null) ?? null,
    createdByName: person(r.author as PersonEmbed),
    createdById: (r.created_by as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    recurrenceId: (r.recurrence_id as string | null) ?? null,
  }));

  const payments: PaymentRow[] = (
    (paymentRows ?? []) as unknown as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    payableId: r.payable_id as string,
    amountCents: Number(r.amount_cents),
    feeCents: Number(r.fee_cents ?? 0),
    interestCents: Number(r.interest_cents ?? 0),
    paidAt: r.paid_at as string,
    paymentMethod: (r.payment_method as string | null) ?? null,
    reference: (r.reference as string | null) ?? null,
    reversed: Boolean(r.reversed),
    reversalOf: (r.reversal_of as string | null) ?? null,
    reversalReason: (r.reversal_reason as string | null) ?? null,
    byName: person(r.author as PersonEmbed),
  }));

  const paymentEntries: PayablePaymentEntry[] = payments.map((p) => ({
    paidAt: p.paidAt,
    amountCents: p.amountCents,
    feeCents: p.feeCents,
    interestCents: p.interestCents,
    reversed: p.reversed,
    reversalOf: p.reversalOf,
  }));

  const isFranchisorClinic = session.activeClinic?.type === "franchisor";
  // Só conta ANALÍTICA de despesa recebe lançamento — e só a que vale aqui.
  const accounts: ChartAccount[] = sortAccounts(
    (accountRows ?? [])
      .map((r) => ({
        code: r.code as string,
        name: r.name as string,
        parentCode: (r.parent_code as string | null) ?? null,
        kind: r.kind as ChartAccount["kind"],
        nature: r.nature as ChartAccount["nature"],
        costBehavior: r.cost_behavior as ChartAccount["costBehavior"],
        scope: r.scope as ChartAccount["scope"],
        isAnalytic: Boolean(r.is_analytic),
        fiscalAccountCode: (r.fiscal_account_code as string | null) ?? null,
        active: Boolean(r.active),
      }))
      .filter(
        (a) =>
          a.isAnalytic &&
          a.kind === "expense" &&
          (a.scope === "both" ||
            a.scope === (isFranchisorClinic ? "franchisor" : "unit"))
      )
  );

  const costCenters = (centerRows ?? [])
    .filter(
      (c) => c.clinic_id === null || c.clinic_id === clinicId
    )
    .map((c) => ({ id: c.id as string, name: c.name as string }));

  const rules: ApprovalRule[] = (ruleRows ?? []).map((r) => ({
    clinicId: (r.clinic_id as string | null) ?? null,
    accountCode: (r.account_code as string | null) ?? null,
    mode: r.approval_mode as ApprovalMode,
    thresholdCents:
      r.threshold_cents === null ? null : Number(r.threshold_cents),
  }));

  const isFinanceStaff =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((r) =>
      r.includes("finance_franchisor")
    );
  const canManage =
    isFinanceStaff || hasRoleInClinic(session, clinicId, ["unit_manager"]);
  const canConfigureNetworkRules =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((r) =>
      r.includes("finance_franchisor")
    );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Receipt className="size-6 text-primary" />
          Contas a pagar
        </h1>
        <p className="text-sm text-muted-foreground">
          Toda despesa nasce classificada — conta do plano de contas e centro de
          custo. É isso que faz a DRE fechar sozinha depois, em vez de alguém
          classificar tudo no fim do mês.
        </p>
      </div>

      <PayablesBoard
        clinicId={clinicId}
        payables={payables}
        payments={payments}
        paymentEntries={paymentEntries}
        suppliers={(supplierRows ?? []).map((s) => ({
          id: s.id as string,
          name: s.name as string,
        }))}
        accounts={accounts}
        costCenters={costCenters}
        rules={rules}
        today={today}
        canManage={canManage}
        canConfigureNetworkRules={canConfigureNetworkRules}
        currentUserId={session.userId}
        isFinanceStaff={isFinanceStaff}
      />
    </div>
  );
}
