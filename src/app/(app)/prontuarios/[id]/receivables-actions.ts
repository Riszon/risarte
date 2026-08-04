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

/**
 * FIN2 — renegocia as cobranças escolhidas. O banco apura a dívida (o que
 * falta + benefício perdido + multa + juros), mede o desconto contra o teto da
 * unidade e, se preciso, deixa a renegociação **aguardando autorização** do
 * Gerente em vez de aplicar.
 */
export async function saveRenegotiation(input: {
  clientId: string;
  installmentIds: string[];
  entries: {
    kind: "entrada" | "parcela";
    due_date: string;
    amount_cents: number;
    payment_method?: string | null;
  }[];
  reason: string;
}): Promise<ReceivableResult & { pending?: boolean }> {
  await getSessionContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_renegotiation", {
    p_client_id: input.clientId,
    p_installment_ids: input.installmentIds,
    p_entries: input.entries,
    p_reason: input.reason || null,
  });
  if (error) {
    const m = error.message;
    if (m.includes("NO_INSTALLMENTS")) {
      return { ok: false, error: "Escolha ao menos uma cobrança." };
    }
    if (m.includes("NO_ENTRIES")) {
      return { ok: false, error: "Monte o novo parcelamento antes de salvar." };
    }
    if (m.includes("INSTALLMENT_NOT_OPEN")) {
      return {
        ok: false,
        error:
          "Alguma cobrança escolhida já foi paga, cancelada ou renegociada. Recarregue a tela.",
      };
    }
    if (m.includes("CLIENT_MISMATCH") || m.includes("CLINIC_MISMATCH")) {
      return {
        ok: false,
        error: "As cobranças precisam ser do mesmo cliente e da mesma unidade.",
      };
    }
    if (m.includes("MULTIPLE_DOWN_PAYMENTS")) {
      return { ok: false, error: "Só pode haver uma entrada." };
    }
    if (m.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error:
          "Renegociar é do Gerente da unidade, do Financeiro da Franqueadora ou do Admin Master.",
      };
    }
    console.error("save_renegotiation failed:", m);
    return { ok: false, error: "Não foi possível salvar a renegociação." };
  }

  await logAudit({
    action: "create",
    entityType: "payment_renegotiation",
    entityId: typeof data === "string" ? data : input.clientId,
  });
  revalidatePath(`/prontuarios/${input.clientId}`);
  revalidatePath("/financeiro");
  return { ok: true };
}

/** FIN2 — o Gerente autoriza (ou recusa) a renegociação com desconto. */
export async function authorizeRenegotiation(input: {
  clientId: string;
  renegotiationId: string;
  approve: boolean;
  note: string;
}): Promise<ReceivableResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("authorize_renegotiation", {
    p_id: input.renegotiationId,
    p_approve: input.approve,
    p_note: input.note || null,
  });
  if (error) {
    const m = error.message;
    if (m.includes("NOT_PENDING")) {
      return { ok: false, error: "Esta renegociação já foi decidida." };
    }
    if (m.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Só o Gerente da unidade ou o Admin Master autoriza.",
      };
    }
    console.error("authorize_renegotiation failed:", m);
    return { ok: false, error: "Não foi possível registrar a decisão." };
  }

  await logAudit({
    action: "update",
    entityType: "payment_renegotiation",
    entityId: input.renegotiationId,
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
