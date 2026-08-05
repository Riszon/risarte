"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { ParsedBankTx } from "@/lib/finance/reconciliation";

export type ReconcileResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/financeiro/conciliacao");
}

function translate(message: string, fallback: string): string {
  const map: [string, string][] = [
    ["NOT_ALLOWED", "Sua função não permite conciliar."],
    ["ACCOUNT_NOT_FOUND", "Conta não encontrada."],
    [
      "ACCOUNT_NOT_ANALYTIC",
      "Essa é uma conta de grupo: escolha uma conta analítica.",
    ],
    ["INVALID_FORMAT", "Formato de arquivo não reconhecido."],
    ["NO_ROWS", "O arquivo não trouxe nenhum lançamento."],
    ["TRANSACTION_NOT_FOUND", "Lançamento do extrato não encontrado."],
    ["ENTRY_NOT_FOUND", "Lançamento do sistema não encontrado."],
    ["ALREADY_RECONCILED", "Esta linha já está conciliada."],
    ["CLINIC_MISMATCH", "O lançamento é de outra unidade."],
    [
      "AMOUNT_MISMATCH",
      "O valor não bate: conciliação exige o mesmo valor e o mesmo sentido (entrada/saída).",
    ],
    ["REASON_REQUIRED", "Escreva o motivo."],
  ];
  for (const [code, text] of map) {
    if (message.includes(code)) return text;
  }
  return fallback;
}

/**
 * FIN4a — importa o extrato. O arquivo é lido e interpretado no navegador
 * (`src/lib/finance/reconciliation.ts`); aqui chegam só as linhas já limpas,
 * então nenhum arquivo do banco sobe para o servidor.
 */
export async function importStatement(input: {
  bankAccountId: string;
  format: "ofx" | "csv";
  fileName: string;
  rows: ParsedBankTx[];
}): Promise<
  ReconcileResult & { inserted?: number; duplicates?: number; rows?: number }
> {
  await getSessionContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("import_bank_transactions", {
    p_bank_account_id: input.bankAccountId,
    p_format: input.format,
    p_file_name: input.fileName,
    p_rows: input.rows,
  });
  if (error) {
    console.error("import_bank_transactions failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível importar o extrato."),
    };
  }

  const result = (data ?? {}) as {
    rows?: number;
    inserted?: number;
    duplicates?: number;
  };
  await logAudit({
    action: "create",
    entityType: "bank_statement_import",
    entityId: input.bankAccountId,
  });
  refresh();
  return {
    ok: true,
    rows: result.rows ?? 0,
    inserted: result.inserted ?? 0,
    duplicates: result.duplicates ?? 0,
  };
}

export async function reconcileTransaction(input: {
  transactionId: string;
  entryId: string;
}): Promise<ReconcileResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("reconcile_bank_transaction", {
    p_transaction_id: input.transactionId,
    p_entry_id: input.entryId,
  });
  if (error) {
    console.error("reconcile_bank_transaction failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível conciliar."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "bank_reconciliation",
    entityId: input.transactionId,
  });
  refresh();
  return { ok: true };
}

export async function unreconcileTransaction(input: {
  transactionId: string;
}): Promise<ReconcileResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("unreconcile_bank_transaction", {
    p_transaction_id: input.transactionId,
  });
  if (error) {
    console.error("unreconcile_bank_transaction failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível desfazer."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "bank_reconciliation_undo",
    entityId: input.transactionId,
  });
  refresh();
  return { ok: true };
}

export async function ignoreTransaction(input: {
  transactionId: string;
  reason: string;
}): Promise<ReconcileResult> {
  await getSessionContext();
  const supabase = await createClient();

  if (!input.reason.trim()) {
    return { ok: false, error: "Escreva o motivo." };
  }
  const { error } = await supabase.rpc("ignore_bank_transaction", {
    p_transaction_id: input.transactionId,
    p_reason: input.reason,
  });
  if (error) {
    console.error("ignore_bank_transaction failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível ignorar a linha."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "bank_transaction_ignore",
    entityId: input.transactionId,
  });
  refresh();
  return { ok: true };
}

/** FIN4a — o que estava no banco e não no sistema vira lançamento aqui. */
export async function createEntryFromTransaction(input: {
  transactionId: string;
  accountCode: string;
  costCenterId: string | null;
  description: string;
}): Promise<ReconcileResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("create_entry_from_bank_transaction", {
    p_transaction_id: input.transactionId,
    p_account_code: input.accountCode,
    p_cost_center_id: input.costCenterId,
    p_description: input.description || null,
  });
  if (error) {
    console.error("create_entry_from_bank_transaction failed:", error.message);
    return {
      ok: false,
      error: translate(error.message, "Não foi possível criar o lançamento."),
    };
  }

  await logAudit({
    action: "create",
    entityType: "entry_from_bank",
    entityId: input.transactionId,
  });
  refresh();
  return { ok: true };
}

/** Conta bancária da unidade — o saldo de abertura ancora a conciliação. */
export async function saveBankAccount(input: {
  id: string | null;
  clinicId: string;
  alias: string;
  bankName: string;
  agency: string;
  accountNumber: string;
  kind: string;
  openingBalanceCents: number;
  openingDate: string;
  active: boolean;
}): Promise<ReconcileResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  if (!input.alias.trim()) {
    return { ok: false, error: "Dê um apelido para a conta." };
  }

  const row = {
    clinic_id: input.clinicId,
    alias: input.alias.trim(),
    bank_name: input.bankName || null,
    agency: input.agency || null,
    account_number: input.accountNumber || null,
    kind: input.kind,
    opening_balance_cents: Math.round(input.openingBalanceCents),
    opening_date: input.openingDate,
    active: input.active,
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };

  const { error } = input.id
    ? await supabase.from("bank_accounts").update(row).eq("id", input.id)
    : await supabase
        .from("bank_accounts")
        .insert({ ...row, created_by: session.userId });
  if (error) {
    console.error("saveBankAccount failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a conta bancária." };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "bank_account",
    entityId: input.id ?? input.clinicId,
  });
  refresh();
  return { ok: true };
}
