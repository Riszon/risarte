"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPurchaser } from "@/lib/purchases-access";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string; id?: string; count?: number };

const DENIED = "Só o Comprador da Franqueadora mexe na mesa de negociação.";

/** Mensagens dos códigos que o banco levanta nesta etapa. */
const ERRORS: Record<string, string> = {
  NOT_ALLOWED: DENIED,
  NO_REQUESTS: "Escolha ao menos uma lista para negociar.",
  REQUEST_NOT_AVAILABLE:
    "Uma das listas já está em outra rodada ou não foi enviada. Negociar de novo faria a unidade receber o item em dobro.",
  ROUND_CLOSED: "Esta rodada já foi fechada.",
  ITEM_NOT_FOUND: "Item não encontrado na rodada.",
  SUPPLIER_DID_NOT_QUOTE:
    "Este fornecedor não cotou o item. Escolher quem não cotou deixaria o pedido sem preço.",
  NOTHING_AWARDED:
    "Nenhum item foi negociado ainda. Fechar assim não seria fechar, seria cancelar.",
};

function explain(raw: string, fallback: string): string {
  for (const [code, message] of Object.entries(ERRORS)) {
    if (raw.includes(code)) return message;
  }
  return fallback;
}

async function requireBuyer() {
  const session = await getSessionContext();
  return isPurchaser(session) || canConfigureFinanceNetwork(session)
    ? session
    : null;
}

/** Abrir a rodada juntando as listas enviadas. */
export async function openRound(input: {
  requestIds: string[];
  name: string;
}): Promise<Result> {
  if (!(await requireBuyer())) return { ok: false, error: DENIED };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_purchase_round", {
    p_request_ids: input.requestIds,
    p_name: input.name || null,
  });
  if (error) {
    console.error("open_purchase_round failed:", error.message);
    return {
      ok: false,
      error: explain(error.message, "Não foi possível abrir a rodada."),
    };
  }

  await logAudit({
    action: "create",
    entityType: "purchase_round",
    entityId: String(data),
  });
  revalidatePath("/compras/rodadas");
  return { ok: true, id: String(data) };
}

/** Cadastrar (ou atualizar) a cotação de um fornecedor na rodada. */
export async function saveQuote(input: {
  roundId: string;
  supplierId: string;
  deliveryDays: number | null;
  paymentTerms: string;
  notes: string;
}): Promise<Result> {
  if (!(await requireBuyer())) return { ok: false, error: DENIED };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_purchase_quote", {
    p_round_id: input.roundId,
    p_supplier_id: input.supplierId,
    p_delivery_days: input.deliveryDays,
    p_payment_terms: input.paymentTerms || null,
    p_notes: input.notes || null,
  });
  if (error) {
    console.error("save_purchase_quote failed:", error.message);
    return {
      ok: false,
      error: explain(error.message, "Não foi possível salvar a cotação."),
    };
  }

  revalidatePath("/compras/rodadas");
  return { ok: true, id: String(data) };
}

/**
 * O preço de um item numa cotação.
 *
 * `null` APAGA a linha: "não cotou" é ausência de preço, não é zero — e zero
 * ganharia a comparação de melhor preço de quem simplesmente não respondeu.
 */
export async function saveQuotePrice(input: {
  quoteId: string;
  roundItemId: string;
  unitCents: number | null;
}): Promise<Result> {
  if (!(await requireBuyer())) return { ok: false, error: DENIED };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_quote_price", {
    p_quote_id: input.quoteId,
    p_round_item_id: input.roundItemId,
    p_unit_cents: input.unitCents,
  });
  if (error) {
    console.error("save_quote_price failed:", error.message);
    return {
      ok: false,
      error: explain(error.message, "Não foi possível salvar o preço."),
    };
  }

  revalidatePath("/compras/rodadas");
  return { ok: true };
}

/** Escolher de quem comprar o item — e, se for o caso, mudar a quantidade. */
export async function awardItem(input: {
  roundItemId: string;
  supplierId: string | null;
  adjustedQuantity: number | null;
  adjustReason: string;
}): Promise<Result> {
  if (!(await requireBuyer())) return { ok: false, error: DENIED };

  const supabase = await createClient();
  const { error } = await supabase.rpc("award_round_item", {
    p_round_item_id: input.roundItemId,
    p_supplier_id: input.supplierId,
    p_adjusted_quantity: input.adjustedQuantity,
    p_adjust_reason: input.adjustReason || null,
  });
  if (error) {
    console.error("award_round_item failed:", error.message);
    return {
      ok: false,
      error: explain(error.message, "Não foi possível escolher o fornecedor."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "purchase_round_award",
    entityId: input.roundItemId,
  });
  revalidatePath("/compras/rodadas");
  return { ok: true };
}

/** Fechar a rodada. Cada unidade passa a ter a parte dela. */
export async function closeRound(input: { roundId: string }): Promise<Result> {
  if (!(await requireBuyer())) return { ok: false, error: DENIED };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_purchase_round", {
    p_round_id: input.roundId,
  });
  if (error) {
    console.error("close_purchase_round failed:", error.message);
    return {
      ok: false,
      error: explain(error.message, "Não foi possível fechar a rodada."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "purchase_round_close",
    entityId: input.roundId,
  });
  revalidatePath("/compras/rodadas");
  return { ok: true, count: Number(data ?? 0) };
}
