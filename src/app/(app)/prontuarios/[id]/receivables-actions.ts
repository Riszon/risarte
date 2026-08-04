"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type ReceivableResult = { ok: boolean; error?: string };

/**
 * FIN1 — registra uma BAIXA (total ou parcial). O `clientToken` garante
 * idempotência: duplo clique não vira dois recebimentos.
 */
export async function registerReceipt(input: {
  clientId: string;
  installmentId: string;
  amountCents: number;
  receivedAt: string;
  paymentMethod: string;
  reference: string;
  notes: string;
  clientToken: string;
}): Promise<ReceivableResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("register_payment_receipt", {
    p_installment_id: input.installmentId,
    p_amount_cents: Math.round(input.amountCents),
    p_received_at: input.receivedAt,
    p_payment_method: input.paymentMethod || null,
    p_reference: input.reference || null,
    p_notes: input.notes || null,
    p_client_token: input.clientToken,
  });
  if (error) {
    const m = error.message;
    if (m.includes("AMOUNT_OVER_BALANCE")) {
      return {
        ok: false,
        error:
          "O valor é maior que o total devido (parcela + multa e juros). Recarregue a tela.",
      };
    }
    if (m.includes("INSTALLMENT_SETTLED")) {
      return { ok: false, error: "Esta cobrança já está quitada." };
    }
    if (m.includes("INVALID_AMOUNT")) {
      return { ok: false, error: "Informe um valor maior que zero." };
    }
    if (m.includes("INSTALLMENT_CLOSED")) {
      return {
        ok: false,
        error: "Esta cobrança foi cancelada ou renegociada — não recebe baixa.",
      };
    }
    if (m.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Sua função não permite registrar recebimento.",
      };
    }
    console.error("register_payment_receipt failed:", m);
    return { ok: false, error: "Não foi possível registrar o recebimento." };
  }

  await logAudit({
    action: "create",
    entityType: "payment_receipt",
    entityId: input.installmentId,
  });
  revalidatePath(`/prontuarios/${input.clientId}`);
  revalidatePath("/financeiro");
  return { ok: true };
}

/** FIN1 — estorna uma baixa (contra-lançamento; a original fica no histórico). */
export async function reverseReceipt(input: {
  clientId: string;
  receiptId: string;
  reason: string;
}): Promise<ReceivableResult> {
  await getSessionContext();
  const supabase = await createClient();

  if (!input.reason.trim()) {
    return { ok: false, error: "Escreva o motivo do estorno." };
  }

  const { error } = await supabase.rpc("reverse_payment_receipt", {
    p_receipt_id: input.receiptId,
    p_reason: input.reason,
  });
  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_REVERSED")) {
      return { ok: false, error: "Este recebimento já foi estornado." };
    }
    if (m.includes("CANNOT_REVERSE_REVERSAL")) {
      return { ok: false, error: "Não se estorna um estorno." };
    }
    if (m.includes("REASON_REQUIRED")) {
      return { ok: false, error: "Escreva o motivo do estorno." };
    }
    if (m.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error:
          "Estorno é ato de conferência: só Gerente, Financeiro da Franqueadora ou Admin Master.",
      };
    }
    console.error("reverse_payment_receipt failed:", m);
    return { ok: false, error: "Não foi possível estornar o recebimento." };
  }

  await logAudit({
    action: "update",
    entityType: "payment_receipt_reversal",
    entityId: input.receiptId,
  });
  revalidatePath(`/prontuarios/${input.clientId}`);
  revalidatePath("/financeiro");
  return { ok: true };
}
