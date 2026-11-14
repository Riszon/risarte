"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type Resultado = { ok: true; id?: string } | { ok: false; error: string };

const ERROS: [string, string][] = [
  ["PROOF_REQUIRED", "Anexe o comprovante do depósito (PDF ou foto)."],
  ["DIFFERENCE_REASON_REQUIRED", "O valor depositado é diferente da soma dos recebimentos: escreva o motivo."],
  ["RECEIPT_NOT_PENDING", "Algum recebimento já foi depositado ou estornado. Recarregue a tela."],
  ["RECEIPTS_REQUIRED", "Escolha os recebimentos depositados."],
  ["BANK_ACCOUNT_INVALID", "Escolha a conta bancária da unidade em que o dinheiro foi depositado."],
  ["INVALID_DATE", "A data do depósito não pode ser no futuro."],
  ["INVALID_AMOUNT", "Informe o valor depositado."],
  ["DEPOSIT_RECONCILED", "Este depósito já está ligado a uma linha do extrato. Desfaça a conciliação antes."],
  ["ALREADY_UNDONE", "Este depósito já foi desfeito."],
  ["REASON_REQUIRED", "Escreva o motivo."],
  ["NOT_ALLOWED", "Sua função não permite esta ação."],
];
const traduzir = (m: string, padrao: string) => ERROS.find(([k]) => m.includes(k))?.[1] ?? padrao;

/** 4011 — "Registrar depósito": o dinheiro do Caixa foi ao banco, com comprovante. */
export async function registrarDeposito(input: {
  clinicId: string;
  bankAccountId: string;
  depositedOn: string;
  receiptIds: string[];
  amountCents: number;
  proofPath: string;
  proofName: string;
  differenceReason: string;
}): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cash_deposit_register", {
    p: {
      clinic_id: input.clinicId,
      bank_account_id: input.bankAccountId,
      deposited_on: input.depositedOn,
      receipt_ids: input.receiptIds,
      amount_cents: Math.round(input.amountCents),
      proof_path: input.proofPath,
      proof_name: input.proofName,
      difference_reason: input.differenceReason || null,
    },
  });
  if (error) {
    const msg = traduzir(error.message, "Não foi possível registrar o depósito.");
    if (msg === "Não foi possível registrar o depósito.") console.error("cash_deposit_register failed:", error.message);
    return { ok: false, error: msg };
  }
  await logAudit({ action: "create", entityType: "cash_deposit", entityId: String(data), clinicId: input.clinicId });
  revalidatePath("/financeiro/dinheiro");
  return { ok: true, id: String(data) };
}

export async function desfazerDeposito(input: { depositId: string; reason: string }): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cash_deposit_undo", { p_id: input.depositId, p_reason: input.reason });
  if (error) {
    const msg = traduzir(error.message, "Não foi possível desfazer o depósito.");
    if (msg === "Não foi possível desfazer o depósito.") console.error("cash_deposit_undo failed:", error.message);
    return { ok: false, error: msg };
  }
  revalidatePath("/financeiro/dinheiro");
  return { ok: true };
}

/** Link curto (10 min) para abrir o comprovante; a regra da pasta decide quem vê. */
export async function linkDoComprovante(path: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("depositos").createSignedUrl(path, 600);
  if (error || !data) return { ok: false, error: "Não foi possível abrir o comprovante." };
  await logAudit({ action: "view", entityType: "cash_deposit_proof", entityId: path });
  return { ok: true, url: data.signedUrl };
}
