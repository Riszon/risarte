"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManagePurchaseRequests } from "@/lib/purchases-access";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string; id?: string };

const DENIED = "Você não pode montar a lista de compras desta unidade.";

const ERRORS: Record<string, string> = {
  NOT_ALLOWED: DENIED,
  REQUEST_NOT_FOUND: "Lista não encontrada.",
  ALREADY_SENT: "Esta lista já foi enviada à Franqueadora.",
  EMPTY_REQUEST: "A lista está vazia — acrescente pelo menos um item.",
};

function explain(raw: string, fallback: string): string {
  for (const [code, message] of Object.entries(ERRORS)) {
    if (raw.includes(code)) return message;
  }
  return fallback;
}

/**
 * Gerar a lista a partir do que está abaixo do mínimo.
 *
 * Quem decide o que falta continua sendo o Estoque (`replenishment_list`): uma
 * segunda régua aqui divergiria dele, e o gerente veria duas verdades.
 */
export async function generatePurchaseRequest(input: {
  clinicId: string;
  isLocal: boolean;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canManagePurchaseRequests(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("build_purchase_request", {
    p_clinic_id: input.clinicId,
    p_is_local: input.isLocal,
  });
  if (error) {
    console.error("build_purchase_request failed:", error.message);
    return { ok: false, error: explain(error.message, "Não foi possível gerar a lista.") };
  }

  await logAudit({
    action: "create",
    entityType: "purchase_request",
    entityId: String(data ?? ""),
    clinicId: input.clinicId,
  });
  revalidatePath("/compras");
  return { ok: true, id: String(data ?? "") };
}

/** Acrescentar uma linha — item de estoque ou linha livre. */
export async function addRequestItem(input: {
  requestId: string;
  clinicId: string;
  itemId: string | null;
  description: string;
  accountCode: string | null;
  quantity: number;
  purchaseUnit: string | null;
  estimatedUnitCents: number;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canManagePurchaseRequests(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }
  if (!input.description.trim()) {
    return { ok: false, error: "Descreva o que precisa ser comprado." };
  }
  if (input.quantity <= 0) {
    return { ok: false, error: "A quantidade precisa ser maior que zero." };
  }

  const supabase = await createClient();

  // Item de estoque ganha a previsão dos três degraus; linha livre usa o que
  // for digitado (fica como 'manual', e a tela mostra isso).
  let unitCents = Math.round(input.estimatedUnitCents);
  let source = unitCents > 0 ? "manual" : "sem_referencia";
  let estimateDate: string | null = null;

  if (input.itemId) {
    const { data } = await supabase.rpc("estimated_purchase_cost", {
      p_clinic_id: input.clinicId,
      p_item_id: input.itemId,
    });
    const est = (
      (data ?? []) as {
        unit_cents: number;
        source: string;
        reference_date: string | null;
      }[]
    )[0];
    if (est) {
      unitCents = Number(est.unit_cents ?? 0);
      source = est.source;
      estimateDate = est.reference_date;
    }
  }

  const { error } = await supabase.from("purchase_request_items").insert({
    request_id: input.requestId,
    item_id: input.itemId,
    description: input.description.trim(),
    account_code: input.accountCode,
    quantity: input.quantity,
    purchase_unit: input.purchaseUnit,
    estimated_unit_cents: unitCents,
    estimated_total_cents: Math.round(unitCents * input.quantity),
    estimate_source: source,
    estimate_date: estimateDate,
  });
  if (error) {
    console.error("addRequestItem failed:", error.message);
    if (error.message.includes("purchase_request_item_unique")) {
      return { ok: false, error: "Este item já está na lista." };
    }
    return { ok: false, error: "Não foi possível acrescentar o item." };
  }

  revalidatePath("/compras");
  return { ok: true };
}

/** Mudar a quantidade de uma linha — o total acompanha. */
export async function updateRequestItem(input: {
  itemId: string;
  clinicId: string;
  quantity: number;
  estimatedUnitCents: number;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canManagePurchaseRequests(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }
  if (input.quantity <= 0) {
    return { ok: false, error: "A quantidade precisa ser maior que zero." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_request_items")
    .update({
      quantity: input.quantity,
      estimated_total_cents: Math.round(
        input.estimatedUnitCents * input.quantity
      ),
    })
    .eq("id", input.itemId);
  if (error) {
    console.error("updateRequestItem failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a quantidade." };
  }

  revalidatePath("/compras");
  return { ok: true };
}

export async function removeRequestItem(input: {
  itemId: string;
  clinicId: string;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canManagePurchaseRequests(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_request_items")
    .delete()
    .eq("id", input.itemId);
  if (error) {
    console.error("removeRequestItem failed:", error.message);
    return { ok: false, error: "Não foi possível remover o item." };
  }

  revalidatePath("/compras");
  return { ok: true };
}

/** Enviar à Franqueadora — o gerente da unidade. */
export async function sendPurchaseRequest(input: {
  requestId: string;
  clinicId: string;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canManagePurchaseRequests(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("send_purchase_request", {
    p_id: input.requestId,
  });
  if (error) {
    console.error("send_purchase_request failed:", error.message);
    return { ok: false, error: explain(error.message, "Não foi possível enviar.") };
  }

  await logAudit({
    action: "update",
    entityType: "purchase_request_send",
    entityId: input.requestId,
    clinicId: input.clinicId,
  });
  revalidatePath("/compras");
  return { ok: true };
}

/** Cancelar uma lista — rascunho ou enviada que não vai mais. */
export async function cancelPurchaseRequest(input: {
  requestId: string;
  clinicId: string;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canManagePurchaseRequests(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_requests")
    .update({ status: "cancelada", updated_at: new Date().toISOString() })
    .eq("id", input.requestId);
  if (error) {
    console.error("cancelPurchaseRequest failed:", error.message);
    return { ok: false, error: "Não foi possível cancelar." };
  }

  revalidatePath("/compras");
  return { ok: true };
}
