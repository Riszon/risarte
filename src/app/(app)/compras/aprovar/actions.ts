"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManagePurchaseRequests } from "@/lib/purchases-access";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string; count?: number };

const ERRORS: Record<string, string> = {
  NOT_ALLOWED:
    "Só o gerente da unidade decide — é dinheiro dela, e a Franqueadora não aprova no lugar.",
  ALLOCATION_NOT_FOUND: "Item não encontrado.",
  ALREADY_ORDERED:
    "Este item já virou pedido. Para desfazer, é preciso cancelar o pedido.",
  NOTHING_APPROVED:
    "Nenhum item aprovado ainda. Um pedido vazio só criaria documento para alguém cancelar depois.",
};

function explain(raw: string, fallback: string): string {
  for (const [code, message] of Object.entries(ERRORS)) {
    if (raw.includes(code)) return message;
  }
  return fallback;
}

/** Aprovar ou recusar um item da parte da unidade. */
export async function decideItem(input: {
  allocationId: string;
  clinicId: string;
  approved: boolean;
  reason: string;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canManagePurchaseRequests(session, input.clinicId)) {
    return { ok: false, error: ERRORS.NOT_ALLOWED };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_allocation", {
    p_allocation_id: input.allocationId,
    p_approved: input.approved,
    p_reason: input.reason || null,
  });
  if (error) {
    console.error("decide_allocation failed:", error.message);
    return {
      ok: false,
      error: explain(error.message, "Não foi possível registrar a decisão."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "purchase_allocation",
    entityId: input.allocationId,
    clinicId: input.clinicId,
  });
  revalidatePath("/compras/aprovar");
  return { ok: true };
}

/**
 * Gerar os pedidos do que foi aprovado — um por fornecedor.
 *
 * É o pedido que é faturado, pago e entregue naquele endereço; por isso ele
 * nasce separado por fornecedor, e não um por rodada.
 */
export async function generateOrders(input: {
  roundId: string;
  clinicId: string;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canManagePurchaseRequests(session, input.clinicId)) {
    return { ok: false, error: ERRORS.NOT_ALLOWED };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_orders_from_round", {
    p_round_id: input.roundId,
    p_clinic_id: input.clinicId,
  });
  if (error) {
    console.error("create_orders_from_round failed:", error.message);
    return {
      ok: false,
      error: explain(error.message, "Não foi possível gerar os pedidos."),
    };
  }

  await logAudit({
    action: "create",
    entityType: "purchase_orders",
    entityId: input.roundId,
    clinicId: input.clinicId,
  });
  revalidatePath("/compras/aprovar");
  return { ok: true, count: Number(data ?? 0) };
}
