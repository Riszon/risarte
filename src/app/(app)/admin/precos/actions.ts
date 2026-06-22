"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";

export type PriceResult = { ok: boolean; error?: string };

/** Add a procedure to the network catalog (Admin Master only). */
export async function addProcedure(input: {
  name: string;
  code: string;
  category: string;
  price: string;
}): Promise<PriceResult> {
  await requireAdminMaster();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Informe o nome do procedimento." };
  const priceCents = input.price.trim() ? parseBRLToCents(input.price) : 0;
  if (priceCents === null) return { ok: false, error: "Preço inválido." };

  const supabase = await createClient();
  const { error } = await supabase.from("procedures").insert({
    name,
    code: input.code.trim() || null,
    category: input.category.trim() || null,
    default_price_cents: priceCents,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Já existe um procedimento com esse código." };
    }
    console.error("addProcedure failed:", error.message);
    return { ok: false, error: "Não foi possível adicionar o procedimento." };
  }
  await logAudit({ action: "create", entityType: "procedure", entityId: name });
  revalidatePath("/admin/precos");
  return { ok: true };
}

export async function editProcedure(
  id: string,
  input: { name: string; category: string; price: string }
): Promise<PriceResult> {
  await requireAdminMaster();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Informe o nome do procedimento." };
  const priceCents = input.price.trim() ? parseBRLToCents(input.price) : 0;
  if (priceCents === null) return { ok: false, error: "Preço inválido." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("procedures")
    .update({
      name,
      category: input.category.trim() || null,
      default_price_cents: priceCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("editProcedure failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o procedimento." };
  }
  await logAudit({ action: "update", entityType: "procedure", entityId: id });
  revalidatePath("/admin/precos");
  return { ok: true };
}

export async function setProcedureActive(
  id: string,
  active: boolean
): Promise<PriceResult> {
  await requireAdminMaster();
  const supabase = await createClient();
  const { error } = await supabase
    .from("procedures")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("setProcedureActive failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar o procedimento." };
  }
  await logAudit({
    action: "update",
    entityType: "procedure",
    entityId: id,
    details: { is_active: active },
  });
  revalidatePath("/admin/precos");
  return { ok: true };
}

/** Set (or clear, when price is empty) a unit's override for a procedure. */
export async function setUnitPrice(
  clinicId: string,
  procedureId: string,
  price: string
): Promise<PriceResult> {
  await requireAdminMaster();
  const supabase = await createClient();

  if (price.trim() === "") {
    const { error } = await supabase
      .from("clinic_procedure_prices")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("procedure_id", procedureId);
    if (error) {
      console.error("setUnitPrice (clear) failed:", error.message);
      return { ok: false, error: "Não foi possível remover o preço da unidade." };
    }
    revalidatePath("/admin/precos");
    return { ok: true };
  }

  const priceCents = parseBRLToCents(price);
  if (priceCents === null) return { ok: false, error: "Preço inválido." };

  const { error } = await supabase
    .from("clinic_procedure_prices")
    .upsert(
      {
        clinic_id: clinicId,
        procedure_id: procedureId,
        price_cents: priceCents,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id,procedure_id" }
    );
  if (error) {
    console.error("setUnitPrice failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o preço da unidade." };
  }
  await logAudit({
    action: "update",
    entityType: "clinic_procedure_price",
    entityId: procedureId,
    clinicId,
  });
  revalidatePath("/admin/precos");
  return { ok: true };
}
