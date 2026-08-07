"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { modalityOf } from "@/lib/finance/acquirers";

export type ReceivableResult = { ok: boolean; error?: string };

/** O que a taxa da adquirente fez com este recebimento (FIN4c). */
export type FeeOutcome = {
  feeCents: number;
  netCents: number;
  settlementDate: string | null;
  /** A taxa já tinha sido paga na emissão do boleto. */
  chargedAtIssue: boolean;
};

/**
 * FIN4c — aplica a taxa da adquirente sobre um recebimento recém-registrado.
 *
 * Roda logo depois da baixa e **nunca derruba a baixa**: se não houver taxa
 * cadastrada para aquele meio de pagamento (unidade que ainda não montou a
 * tabela), o recebimento continua válido e simplesmente fica sem taxa. Mostrar
 * erro aqui só assustaria a recepção por um problema que é de cadastro.
 *
 * A MODALIDADE VEM DO MEIO DA BAIXA, não do meio da venda: se a parcela era
 * boleto e o cliente pagou por PIX no balcão, quem custou foi o PIX.
 */
async function applyFeeToReceipt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  receiptId: string,
  installmentId: string,
  receiptMethod: string | null
): Promise<FeeOutcome | null> {
  const { data: inst } = await supabase
    .from("payment_installments")
    .select("acquirer_id, negotiation_id, direct_sale_id")
    .eq("id", installmentId)
    .maybeSingle();
  if (!inst?.acquirer_id) return null;

  // Faixa de parcelas que a adquirente cobra = parcelamento da VENDA.
  let installments = 1;
  const originColumn = inst.negotiation_id ? "negotiation_id" : "direct_sale_id";
  const originId = inst.negotiation_id ?? inst.direct_sale_id;
  if (originId) {
    const { count } = await supabase
      .from("payment_installments")
      .select("id", { count: "exact", head: true })
      .eq(originColumn, originId);
    installments = Math.max(1, count ?? 1);
  }

  const modality = modalityOf(receiptMethod, installments);
  if (!modality) return null;

  const { data, error } = await supabase.rpc("apply_acquirer_fee", {
    p_receipt_id: receiptId,
    p_acquirer_id: inst.acquirer_id as string,
    p_modality: modality,
    p_installments: installments,
  });
  if (error) {
    // Cadastro incompleto não é erro de atendimento — a baixa já valeu.
    if (
      error.message.includes("RATE_NOT_FOUND") ||
      error.message.includes("ACQUIRER_NOT_FOUND") ||
      error.message.includes("CLINIC_MISMATCH") ||
      error.message.includes("FEE_ALREADY_APPLIED")
    ) {
      console.warn("taxa da adquirente não aplicada:", error.message);
      return null;
    }
    console.error("apply_acquirer_fee failed:", error.message);
    return null;
  }

  const r = (data ?? {}) as {
    fee_cents?: number;
    net_cents?: number;
    settlement_date?: string;
    charged_at_issue?: boolean;
  };
  return {
    feeCents: r.fee_cents ?? 0,
    netCents: r.net_cents ?? 0,
    settlementDate: r.settlement_date ?? null,
    chargedAtIssue: Boolean(r.charged_at_issue),
  };
}

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
}): Promise<ReceivableResult & { fee?: FeeOutcome }> {
  await getSessionContext();
  const supabase = await createClient();

  const { data: receiptId, error } = await supabase.rpc("register_payment_receipt", {
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
    if (m.includes("SALE_NOT_CLOSED")) {
      // 0203: a regra de ouro passou a ser imposta pelo banco.
      return {
        ok: false,
        error:
          "Esta venda ainda não foi fechada. Registre o contrato assinado e o pagamento confirmado antes de dar baixa.",
      };
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

  // FIN4c: a taxa da adquirente entra AGORA. Antes a função existia e nenhuma
  // tela a chamava — a despesa da maquininha nunca era lançada.
  const fee =
    typeof receiptId === "string"
      ? await applyFeeToReceipt(
          supabase,
          receiptId,
          input.installmentId,
          input.paymentMethod || null
        )
      : null;

  await logAudit({
    action: "create",
    entityType: "payment_receipt",
    entityId: input.installmentId,
  });
  revalidatePath(`/prontuarios/${input.clientId}`);
  revalidatePath("/financeiro");
  return { ok: true, fee: fee ?? undefined };
}

/**
 * FIN4b — no cartão, a clínica não recebe o valor cheio nem no mesmo dia.
 * O cliente pagou o BRUTO (é isso que quita a dívida dele); aqui registramos
 * a taxa da adquirente e a data em que o dinheiro cai.
 */
export async function applyAcquirerFee(input: {
  clientId: string;
  receiptId: string;
  acquirerId: string;
  modality: string;
  installments: number;
}): Promise<
  ReceivableResult & {
    feeCents?: number;
    netCents?: number;
    settlementDate?: string;
  }
> {
  await getSessionContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("apply_acquirer_fee", {
    p_receipt_id: input.receiptId,
    p_acquirer_id: input.acquirerId,
    p_modality: input.modality,
    p_installments: input.installments,
  });
  if (error) {
    const m = error.message;
    if (m.includes("RATE_NOT_FOUND")) {
      return {
        ok: false,
        error:
          "Não há taxa cadastrada para essa modalidade e número de parcelas nesta adquirente.",
      };
    }
    if (m.includes("FEE_ALREADY_APPLIED")) {
      return { ok: false, error: "A taxa desta baixa já foi registrada." };
    }
    if (m.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite registrar a taxa." };
    }
    console.error("apply_acquirer_fee failed:", m);
    return { ok: false, error: "Não foi possível registrar a taxa do cartão." };
  }

  const r = (data ?? {}) as {
    fee_cents?: number;
    net_cents?: number;
    settlement_date?: string;
  };
  revalidatePath(`/prontuarios/${input.clientId}`);
  revalidatePath("/financeiro");
  return {
    ok: true,
    feeCents: r.fee_cents ?? 0,
    netCents: r.net_cents ?? 0,
    settlementDate: r.settlement_date,
  };
}

/**
 * FIN4b.2 — registra que o boleto foi GERADO e lança a taxa de emissão.
 *
 * Só cobra quando a configuração da adquirente diz que a taxa é cobrada na
 * emissão — e o banco garante que a mesma parcela nunca paga a taxa duas vezes.
 * Quando o ASAAS entrar, o webhook de "boleto gerado" chama esta mesma função.
 */
export async function registerBoletoIssue(input: {
  clientId: string;
  installmentId: string;
  issuedAt: string;
}): Promise<ReceivableResult & { feeCents?: number; waived?: boolean }> {
  await getSessionContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("register_boleto_issue", {
    p_installment_id: input.installmentId,
    p_acquirer_id: null,
    p_issued_at: input.issuedAt,
  });
  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_ISSUED")) {
      return { ok: false, error: "O boleto desta cobrança já foi registrado." };
    }
    if (m.includes("FEE_ALREADY_CHARGED")) {
      return {
        ok: false,
        error:
          "A taxa desta cobrança já foi lançada na baixa — não se cobra duas vezes.",
      };
    }
    if (m.includes("FEE_NOT_ON_ISSUE")) {
      return {
        ok: false,
        error:
          "A adquirente está configurada para cobrar a taxa no pagamento, não na emissão.",
      };
    }
    if (m.includes("RATE_NOT_FOUND")) {
      return {
        ok: false,
        error: "Não há taxa de boleto cadastrada para esta adquirente.",
      };
    }
    if (m.includes("ACQUIRER_NOT_FOUND") || m.includes("CLINIC_MISMATCH")) {
      return {
        ok: false,
        error: "Nenhuma adquirente cadastrada atende esta unidade.",
      };
    }
    if (m.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite registrar a emissão." };
    }
    console.error("register_boleto_issue failed:", m);
    return { ok: false, error: "Não foi possível registrar a emissão." };
  }

  await logAudit({
    action: "update",
    entityType: "boleto_issue",
    entityId: input.installmentId,
  });
  const r = (data ?? {}) as { fee_cents?: number; waived?: boolean };
  revalidatePath(`/prontuarios/${input.clientId}`);
  revalidatePath("/financeiro");
  return { ok: true, feeCents: r.fee_cents ?? 0, waived: Boolean(r.waived) };
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
  /** Juros ao mês do novo parcelamento (Tabela Price). */
  monthlyInterestPercent: number;
}): Promise<ReceivableResult & { pending?: boolean }> {
  await getSessionContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_renegotiation", {
    p_client_id: input.clientId,
    p_installment_ids: input.installmentIds,
    p_entries: input.entries,
    p_reason: input.reason || null,
    p_monthly_interest_percent: input.monthlyInterestPercent,
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
    if (m.includes("RENEGOTIATION_PENDING")) {
      return {
        ok: false,
        error:
          "Alguma dessas cobranças já está numa renegociação aguardando autorização do Gerente.",
      };
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

/**
 * FIN2.4 — marca uma etapa do fechamento da renegociação (acordo assinado /
 * cobrança emitida / pagamento confirmado). Mesmo fluxo manual do fechamento
 * da venda: quando o core ganhar ZapSign/ASAAS, é aqui que eles se plugam.
 */
export async function setRenegotiationStep(input: {
  clientId: string;
  renegotiationId: string;
  step: "contract" | "payment_issued" | "payment_confirmed";
  value: boolean;
}): Promise<ReceivableResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("renegotiation_close_step", {
    p_id: input.renegotiationId,
    p_step: input.step,
    p_value: input.value,
  });
  if (error) {
    const m = error.message;
    if (m.includes("NOT_APPLIED")) {
      return {
        ok: false,
        error:
          "A renegociação ainda espera autorização do Gerente — não há acordo para assinar.",
      };
    }
    if (m.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite esta etapa." };
    }
    console.error("renegotiation_close_step failed:", m);
    return { ok: false, error: "Não foi possível registrar a etapa." };
  }

  await logAudit({
    action: "update",
    entityType: "renegotiation_close",
    entityId: input.renegotiationId,
  });
  revalidatePath(`/prontuarios/${input.clientId}`);
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
