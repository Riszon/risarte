import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { sortAccounts, type ChartAccount } from "@/lib/finance/accounts";
import type {
  LedgerEntry,
  ReconciliationStatus,
} from "@/lib/finance/reconciliation";
import {
  ReconciliationBoard,
  type BankAccountRow,
  type BankTxRow,
  type ImportRow,
} from "./reconciliation-board";
import { todayInBrazil } from "@/lib/dates";

/** FIN4a — conciliação bancária: o que o sistema diz × o que o banco mostra. */
export default async function ReconciliationPage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const clinicId = session.activeClinic?.id ?? null;
  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const today = todayInBrazil();

  const [
    { data: accountRows },
    { data: txRows },
    { data: importRows },
    { data: entryRows },
    { data: chartRows },
    { data: centerRows },
  ] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select(
        "id, alias, bank_name, agency, account_number, kind, opening_balance_cents, opening_date, active"
      )
      .eq("clinic_id", clinicId)
      .order("alias"),
    supabase
      .from("bank_transactions")
      .select(
        "id, bank_account_id, posted_at, amount_cents, description, fit_id, status, matched_entry_id, ignore_reason, matcher:profiles!bank_transactions_matched_by_fkey ( full_name )"
      )
      .eq("clinic_id", clinicId)
      .order("posted_at"),
    supabase
      .from("bank_statement_imports")
      .select(
        "id, bank_account_id, file_name, format, period_start, period_end, inserted_count, duplicate_count, created_at, reverted_at, author:profiles!bank_statement_imports_created_by_fkey ( full_name )"
      )
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false }),
    // Só o que tem CAIXA: conciliação é sobre dinheiro que se moveu.
    supabase
      .from("financial_entries")
      .select(
        "id, amount_cents, cash_date, description, account_code, direction, reconciled_at"
      )
      .eq("clinic_id", clinicId)
      .not("cash_date", "is", null)
      .neq("status", "cancelled")
      .order("cash_date"),
    supabase
      .from("chart_of_accounts")
      .select(
        "code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic, fiscal_account_code, active"
      )
      .eq("active", true),
    supabase
      .from("cost_centers")
      .select("id, name, clinic_id")
      .eq("active", true)
      .order("code"),
  ]);

  type PersonEmbed = { full_name: string } | { full_name: string }[] | null;
  const person = (v: PersonEmbed): string | null =>
    Array.isArray(v) ? (v[0]?.full_name ?? null) : (v?.full_name ?? null);

  const accounts: BankAccountRow[] = (accountRows ?? []).map((a) => ({
    id: a.id as string,
    alias: a.alias as string,
    bankName: (a.bank_name as string | null) ?? null,
    agency: (a.agency as string | null) ?? null,
    accountNumber: (a.account_number as string | null) ?? null,
    kind: a.kind as string,
    openingBalanceCents: Number(a.opening_balance_cents ?? 0),
    openingDate: a.opening_date as string,
    active: Boolean(a.active),
  }));

  const transactions: BankTxRow[] = (
    (txRows ?? []) as unknown as Record<string, unknown>[]
  ).map((t) => ({
    id: t.id as string,
    bankAccountId: t.bank_account_id as string,
    postedAt: t.posted_at as string,
    amountCents: Number(t.amount_cents),
    description: (t.description as string) ?? "",
    fitId: (t.fit_id as string | null) ?? null,
    status: t.status as ReconciliationStatus,
    matchedEntryId: (t.matched_entry_id as string | null) ?? null,
    ignoreReason: (t.ignore_reason as string | null) ?? null,
    matchedByName: person(t.matcher as PersonEmbed),
  }));

  const imports: ImportRow[] = (
    (importRows ?? []) as unknown as Record<string, unknown>[]
  ).map((i) => ({
    id: i.id as string,
    bankAccountId: i.bank_account_id as string,
    fileName: (i.file_name as string | null) ?? null,
    format: i.format as string,
    periodStart: (i.period_start as string | null) ?? null,
    periodEnd: (i.period_end as string | null) ?? null,
    insertedCount: Number(i.inserted_count ?? 0),
    duplicateCount: Number(i.duplicate_count ?? 0),
    createdAt: i.created_at as string,
    byName: person(i.author as PersonEmbed),
    revertedAt: (i.reverted_at as string | null) ?? null,
  }));

  // No razão o valor é positivo e o sinal vem da direção; aqui viramos para o
  // ponto de vista da conta, que é como o extrato mostra.
  const entries: LedgerEntry[] = (
    (entryRows ?? []) as unknown as Record<string, unknown>[]
  ).map((e) => ({
    id: e.id as string,
    amountCents:
      (e.direction === "outflow" ? -1 : 1) * Number(e.amount_cents),
    cashDate: e.cash_date as string,
    description: (e.description as string) ?? "",
    accountCode: e.account_code as string,
    reconciled: e.reconciled_at !== null,
  }));

  const isFranchisorClinic = session.activeClinic?.type === "franchisor";
  const chart: ChartAccount[] = sortAccounts(
    (chartRows ?? [])
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
          (a.scope === "both" ||
            a.scope === (isFranchisorClinic ? "franchisor" : "unit"))
      )
  );

  const costCenters = (centerRows ?? [])
    .filter((c) => c.clinic_id === null || c.clinic_id === clinicId)
    .map((c) => ({ id: c.id as string, name: c.name as string }));

  const canReconcile =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((r) =>
      r.includes("finance_franchisor")
    ) ||
    hasRoleInClinic(session, clinicId, ["unit_manager"]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Landmark className="size-6 text-primary" />
          Conciliação bancária
        </h1>
        <p className="text-sm text-muted-foreground">
          Enquanto o saldo do sistema não bate com o do banco, o caixa é
          opinião. Importe o extrato (OFX ou CSV) e case cada linha com o
          lançamento correspondente.
        </p>
      </div>

      <ReconciliationBoard
        clinicId={clinicId}
        accounts={accounts}
        transactions={transactions}
        imports={imports}
        entries={entries}
        chart={chart}
        costCenters={costCenters}
        today={today}
        canReconcile={canReconcile}
      />
    </div>
  );
}
