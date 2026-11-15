"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { ScheduleEntry } from "@/lib/payments";
import { mensagemDoErroDeMeio } from "@/lib/venda-direta-meios";
import { criarCobrancasAutomaticas } from "@/lib/asaas/cobrancas-automaticas";
import { comBoletosCancelados } from "@/lib/asaas/boletos-da-operacao";

export type ScheduleResult = { ok: boolean; error?: string; precisaConfirmar?: number };

/**
 * I9: grava o plano de cobrança (entrada + parcelas) de uma negociação ou de
 * uma venda direta. A soma tem de fechar com o valor da venda — quem garante
 * isso é o banco (`TOTAL_MISMATCH`), não a tela.
 */
export async function savePaymentSchedule(input: {
  negotiationId?: string;
  directSaleId?: string;
  entries: ScheduleEntry[];
  /** 4015 (19.26.1): a pessoa confirmou que salvar cancela os boletos vivos da venda. */
  confirmarCancelamento?: boolean;
}): Promise<ScheduleResult> {
  const session = await getSessionContext();
  if (!input.negotiationId && !input.directSaleId) {
    return { ok: false, error: "Venda não informada." };
  }
  const supabase = await createClient();
  // 4015: trocar vencimento ou valor apaga e recria as parcelas. Com boletos vivos,
  // salvar cancela os boletos no Asaas na mesma operação (com a confirmação); na
  // forma 2, os boletos novos nascem logo depois, no mesmo link da lista.
  const { data: daVenda } = await supabase
    .from("payment_installments")
    .select("id")
    .eq(input.negotiationId ? "negotiation_id" : "direct_sale_id", (input.negotiationId ?? input.directSaleId)!);
  const op = await comBoletosCancelados<unknown>({
    operacao: "alteração do parcelamento",
    motivo: "parcelamento alterado",
    installmentIds: (daVenda ?? []).map((x) => x.id as string),
    actorId: session.userId,
    confirmar: Boolean(input.confirmarCancelamento),
    venda: { negotiationId: input.negotiationId ?? null, directSaleId: input.directSaleId ?? null },
    tentar: async () => {
      const r = await supabase.rpc("save_payment_schedule", {
        p_negotiation_id: input.negotiationId ?? null,
        p_direct_sale_id: input.directSaleId ?? null,
        p_entries: input.entries.map((e) => ({
          kind: e.kind,
          due_date: e.dueDate,
          amount_cents: e.amountCents,
          // 4011: o meio da parcela (venda direta nova); vazio = o da venda.
          ...(e.paymentMethod ? { payment_method: e.paymentMethod } : {}),
        })),
      });
      return { error: r.error };
    },
  });
  if (!op.ok && op.precisaConfirmar) return { ok: false, error: op.error, precisaConfirmar: op.precisaConfirmar };
  const error = op.ok ? null : { message: op.error };
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
    const meio = mensagemDoErroDeMeio(m);
    if (meio) return { ok: false, error: meio };
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
  // ASA4 (4012): venda direta nova já assinada → as parcelas pelo Asaas que
  // vencem dentro do prazo nascem agora (o banco decide quais; idempotente).
  if (input.directSaleId) {
    await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: input.directSaleId }).catch((e) =>
      console.error("auto charge on schedule failed:", e instanceof Error ? e.message : e)
    );
  }
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
