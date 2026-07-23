"use server";

import { revalidatePath } from "next/cache";
import {
  getSessionContext,
  hasRoleInClinic,
  requireAdminMaster,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
import { PAYMENT_METHODS } from "@/lib/commercial";

export type DirectSaleResult = { ok: boolean; error?: string };

const SALE_ROLES = ["receptionist", "clinical_coordinator", "unit_manager"] as const;

/** Registra uma venda direta na unidade (recepção/coordenador/gerente). */
export async function createDirectSale(input: {
  clientName: string;
  procedureId: string;
  description: string;
  value: string;
  paymentMethod: string;
  notes: string;
}): Promise<DirectSaleResult> {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id;
  if (!clinicId) return { ok: false, error: "Escolha uma unidade ativa." };
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, clinicId, [...SALE_ROLES])
  ) {
    return { ok: false, error: "Você não pode registrar venda direta aqui." };
  }

  const description = input.description.trim();
  if (!description) return { ok: false, error: "Descreva o procedimento." };
  const valueCents = parseBRLToCents(input.value) ?? 0;
  if (valueCents <= 0) return { ok: false, error: "Informe o valor da venda." };
  const method =
    input.paymentMethod &&
    (PAYMENT_METHODS as readonly string[]).includes(input.paymentMethod)
      ? input.paymentMethod
      : null;

  const supabase = await createClient();
  const { error } = await supabase.from("direct_sales").insert({
    clinic_id: clinicId,
    client_name: input.clientName.trim() || null,
    procedure_id: input.procedureId || null,
    description,
    value_cents: valueCents,
    payment_method: method,
    notes: input.notes.trim() || null,
    created_by: session.userId,
  });
  if (error) {
    console.error("createDirectSale failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a venda." };
  }
  await logAudit({
    action: "create",
    entityType: "direct_sale",
    entityId: description,
    clinicId,
  });
  revalidatePath("/comercial/venda-direta");
  return { ok: true };
}

/** Marca pagamento (recepção), lançamento (coordenador) ou cancela a venda. */
export async function markDirectSale(
  saleId: string,
  field: "paid" | "launched" | "cancelled",
  value: boolean
): Promise<DirectSaleResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: sale } = await supabase
    .from("direct_sales")
    .select("clinic_id")
    .eq("id", saleId)
    .single();
  if (!sale) return { ok: false, error: "Venda não encontrada." };
  const clinicId = sale.clinic_id as string;
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, clinicId, [...SALE_ROLES])
  ) {
    return { ok: false, error: "Você não pode alterar esta venda." };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (field === "paid") {
    patch.paid = value;
    patch.paid_by = value ? session.userId : null;
    patch.paid_at = value ? now : null;
  } else if (field === "launched") {
    patch.launched = value;
    patch.launched_by = value ? session.userId : null;
    patch.launched_at = value ? now : null;
  } else {
    patch.cancelled = value;
  }

  const { error } = await supabase
    .from("direct_sales")
    .update(patch)
    .eq("id", saleId);
  if (error) {
    console.error("markDirectSale failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar a venda." };
  }
  await logAudit({
    action: "update",
    entityType: "direct_sale",
    entityId: saleId,
    clinicId,
  });
  revalidatePath("/comercial/venda-direta");
  return { ok: true };
}

/** Admin liga/desliga um procedimento na lista de venda direta. */
export async function setProcedureDirectSale(
  procedureId: string,
  value: boolean
): Promise<DirectSaleResult> {
  await requireAdminMaster();
  const supabase = await createClient();
  const { error } = await supabase
    .from("procedures")
    .update({ direct_sale: value, updated_at: new Date().toISOString() })
    .eq("id", procedureId);
  if (error) {
    console.error("setProcedureDirectSale failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar o procedimento." };
  }
  await logAudit({
    action: "update",
    entityType: "procedure_direct_sale",
    entityId: procedureId,
  });
  revalidatePath("/comercial/venda-direta");
  return { ok: true };
}
