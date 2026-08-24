"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManagePurchaseRequests } from "@/lib/purchases-access";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string; receiptId?: string };

const MESSAGES: Record<string, string> = {
  NOT_ALLOWED: "Você não tem permissão para receber nesta unidade.",
  ORDER_NOT_FOUND: "Pedido não encontrado.",
  ORDER_CANCELLED: "Este pedido foi cancelado.",
  NO_ITEMS: "Informe o que chegou.",
  ITEM_NOT_IN_ORDER: "Um dos itens não pertence a este pedido.",
  NO_INSTALLMENTS: "Informe ao menos uma parcela para a conta a pagar.",
  UNIT_LOCKED:
    "O item já tem movimento: a unidade de medida não pode mais mudar.",
};

function explain(raw: string): string | null {
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return message;
  }
  return null;
}

/**
 * Registrar o recebimento de um pedido.
 *
 * A entrada no estoque e a conta a pagar saem do mesmo `register_stock_purchase`
 * que a compra avulsa usa — um caminho só para "compra vira dívida". O preço
 * que entra é o **da nota**; quando ele diverge do negociado, o sistema aceita e
 * registra a diferença, em vez de barrar o material na porta.
 */
export async function receiveOrder(input: {
  orderId: string;
  clinicId: string;
  invoiceNumber: string;
  issueDate: string;
  items: {
    orderItemId: string;
    quantity: number;
    unitCents: number | null;
    lotCode: string;
    expiresAt: string;
  }[];
  installments: { amountCents: number; dueDate: string }[];
  notes: string;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canManagePurchaseRequests(session, input.clinicId)) {
    return { ok: false, error: MESSAGES.NOT_ALLOWED };
  }

  const items = input.items.filter((i) => i.quantity > 0);
  if (items.length === 0) {
    return { ok: false, error: "Informe o que chegou." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_purchase_order", {
    p_order_id: input.orderId,
    p_invoice_number: input.invoiceNumber || null,
    p_issue_date: input.issueDate,
    p_items: items.map((i) => ({
      orderItemId: i.orderItemId,
      quantity: i.quantity,
      unitCents: i.unitCents,
      lotCode: i.lotCode || null,
      expiresAt: i.expiresAt || null,
    })),
    p_installments: input.installments.filter((p) => p.amountCents > 0),
    p_notes: input.notes || null,
  });

  if (error) {
    console.error("receive_purchase_order failed:", error.message);
    return {
      ok: false,
      error: explain(error.message) ?? "Não foi possível registrar a entrega.",
    };
  }

  await logAudit({
    action: "create",
    entityType: "purchase_receipt",
    entityId: input.orderId,
    clinicId: input.clinicId,
  });
  revalidatePath("/compras/receber");
  revalidatePath("/estoque");
  return { ok: true, receiptId: String(data) };
}

export type ReconciliationRow = {
  orderItemId: string;
  description: string;
  orderedQuantity: number;
  receivedQuantity: number;
  quantityDiff: number;
  orderedUnitCents: number;
  invoicedUnitCents: number | null;
  priceDiffCents: number;
};

/** Pedido × recebido × pago, item a item. */
export async function loadReconciliation(input: {
  orderId: string;
}): Promise<{ ok: boolean; rows?: ReconciliationRow[]; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("order_reconciliation", {
    p_order_id: input.orderId,
  });
  if (error) {
    console.error("order_reconciliation failed:", error.message);
    return { ok: false, error: "Não foi possível abrir a conferência." };
  }

  return {
    ok: true,
    rows: (
      (data ?? []) as {
        order_item_id: string;
        description: string;
        ordered_quantity: number;
        received_quantity: number;
        quantity_diff: number;
        ordered_unit_cents: number;
        invoiced_unit_cents: number | null;
        price_diff_cents: number;
      }[]
    ).map((r) => ({
      orderItemId: r.order_item_id,
      description: r.description,
      orderedQuantity: Number(r.ordered_quantity ?? 0),
      receivedQuantity: Number(r.received_quantity ?? 0),
      quantityDiff: Number(r.quantity_diff ?? 0),
      orderedUnitCents: Number(r.ordered_unit_cents ?? 0),
      invoicedUnitCents:
        r.invoiced_unit_cents === null ? null : Number(r.invoiced_unit_cents),
      priceDiffCents: Number(r.price_diff_cents ?? 0),
    })),
  };
}
