"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { ScheduleEntry } from "@/lib/payments";

export type ScheduleResult = { ok: boolean; error?: string };

/**
 * I9: grava o plano de cobrança (entrada + parcelas) de uma negociação ou de
 * uma venda direta. A soma tem de fechar com o valor da venda — quem garante
 * isso é o banco (`TOTAL_MISMATCH`), não a tela.
 */
export async function savePaymentSchedule(input: {
  negotiationId?: string;
  directSaleId?: string;
  entries: ScheduleEntry[];
}): Promise<ScheduleResult> {
  await getSessionContext();
  if (!input.negotiationId && !input.directSaleId) {
    return { ok: false, error: "Venda não informada." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_payment_schedule", {
    p_negotiation_id: input.negotiationId ?? null,
    p_direct_sale_id: input.directSaleId ?? null,
    p_entries: input.entries.map((e) => ({
      kind: e.kind,
      due_date: e.dueDate,
      amount_cents: e.amountCents,
    })),
  });
  if (error) {
    const m = error.message;
    if (m.includes("TOTAL_MISMATCH")) {
      return {
        ok: false,
        error:
          "A soma das cobranças precisa fechar exatamente com o valor da venda.",
      };
    }
    if (m.includes("MULTIPLE_DOWN_PAYMENTS")) {
      return { ok: false, error: "Só pode haver uma entrada." };
    }
    if (m.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Você não pode definir o pagamento desta venda.",
      };
    }
    // FIN2: reescrever o plano apagaria as parcelas — e as baixas junto.
    if (m.includes("SCHEDULE_LOCKED")) {
      return {
        ok: false,
        error:
          "Esta venda já tem recebimento ou renegociação: o plano de cobrança não pode mais ser reescrito. Use a renegociação na aba Financeiro da ficha.",
      };
    }
    console.error("save_payment_schedule failed:", m);
    return { ok: false, error: "Não foi possível salvar o plano de pagamento." };
  }
  await logAudit({
    action: "update",
    entityType: "payment_schedule",
    entityId: input.negotiationId ?? input.directSaleId ?? "",
  });
  revalidatePath("/comercial");
  revalidatePath("/comercial/venda-direta");
  return { ok: true };
}

/** Baixa de uma cobrança (o Financeiro completo é o próximo módulo). */
export async function markInstallmentPaid(
  installmentId: string,
  paid: boolean
): Promise<ScheduleResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_installment_paid", {
    p_installment_id: installmentId,
    p_paid: paid,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite dar baixa." };
    }
    if (error.message.includes("INSTALLMENT_SETTLED")) {
      return { ok: false, error: "Esta cobrança já está quitada." };
    }
    console.error("mark_installment_paid failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a baixa." };
  }
  revalidatePath("/comercial");
  revalidatePath("/comercial/venda-direta");
  return { ok: true };
}
