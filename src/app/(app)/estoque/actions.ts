"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
import {
  canManageStock,
  canManageStockCatalog,
  canConsumeStock,
} from "@/lib/stock-access";
import { movementErrors, type MovementKind } from "@/lib/stock";

export type StockResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/estoque");
  // O custo de material do kit alimenta o preço e a margem.
  revalidatePath("/procedimentos");
  revalidatePath("/procedimentos/precificacao");
}

/** Traduz o erro cru do banco para uma frase que quem lê entende. */
function friendly(message: string, fallback: string): string {
  if (message.includes("NOT_ALLOWED")) {
    return "Sua função não permite esta operação no estoque.";
  }
  if (message.includes("INVALID_QUANTITY")) {
    return "A quantidade precisa ser maior que zero.";
  }
  return fallback;
}

// -- CATÁLOGO (rede) ---------------------------------------------------------

export async function saveStockItem(input: {
  id: string | null;
  name: string;
  brand: string;
  /** Unidade de CONTROLE — em que o saldo vive e o kit consome. */
  unitOfMeasure: string;
  /** Embalagem em que se compra. */
  purchaseUnit: string;
  /** Quantas unidades de controle vêm numa embalagem. */
  unitsPerPurchase: string;
  category: string;
  notes: string;
  isActive: boolean;
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStockCatalog(session)) {
    return { ok: false, error: "O catálogo de insumos é da Franqueadora." };
  }
  if (!input.name.trim()) return { ok: false, error: "Informe o nome do item." };

  const factor = Number(input.unitsPerPurchase.replace(",", ".")) || 0;
  if (factor <= 0) {
    // Fator zero ou vazio faria a caixa inteira virar uma unidade — o erro de
    // 100 vezes que esta migração existe para consertar.
    return {
      ok: false,
      error:
        "Informe quantas unidades de consumo vêm em uma embalagem (1 se for igual).",
    };
  }

  const supabase = await createClient();
  const row = {
    name: input.name.trim(),
    brand: input.brand.trim() || null,
    unit_of_measure: input.unitOfMeasure.trim() || "unidade",
    purchase_unit: input.purchaseUnit.trim() || "unidade",
    units_per_purchase: factor,
    category: input.category.trim() || null,
    notes: input.notes.trim() || null,
    is_active: input.isActive,
  };

  const { error } = input.id
    ? await supabase.from("stock_items").update(row).eq("id", input.id)
    : await supabase
        .from("stock_items")
        .insert({ ...row, created_by: session.userId });
  if (error) {
    console.error("saveStockItem failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o item." };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "stock_item",
    entityId: input.id ?? input.name,
  });
  refresh();
  return { ok: true };
}

// -- MOVIMENTO ---------------------------------------------------------------

export async function postMovement(input: {
  clinicId: string;
  itemId: string;
  kind: MovementKind;
  /** Quantidade na unidade de CONTROLE (consumo, perda, ajuste). */
  quantity: string;
  unitCost: string;
  movementDate: string;
  reason: string;
  /** Entrada pela EMBALAGEM: "1 caixa a R$ 25,00" (o jeito da nota). */
  packages?: string;
  packageCost?: string;
  lotCode?: string;
  expiresAt?: string;
  supplierId?: string;
  invoiceNumber?: string;
}): Promise<StockResult> {
  const session = await getSessionContext();
  const byPackage =
    input.kind === "entrada" && (input.packages ?? "").trim() !== "";

  const quantity = Number(
    (byPackage ? (input.packages ?? "") : input.quantity).replace(",", ".")
  );
  const costText = byPackage ? (input.packageCost ?? "") : input.unitCost;
  const unitCostCents = costText.trim() === "" ? null : parseBRLToCents(costText);

  const errors = movementErrors({
    itemId: input.itemId,
    kind: input.kind,
    quantity,
    unitCostCents,
  });
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const isInbound =
    input.kind === "entrada" ||
    input.kind === "ajuste_entrada" ||
    input.kind === "transferencia_entrada";

  const allowed = isInbound
    ? canManageStock(session, input.clinicId)
    : canConsumeStock(session, input.clinicId);
  if (!allowed) {
    return { ok: false, error: "Sua função não permite este lançamento." };
  }

  // Ajuste e perda mudam patrimônio sem nota: sem motivo, ninguém consegue
  // auditar a diferença depois — e a diferença é justamente a informação.
  if (
    (input.kind === "perda" ||
      input.kind === "ajuste_entrada" ||
      input.kind === "ajuste_saida") &&
    input.reason.trim() === ""
  ) {
    return { ok: false, error: "Informe o motivo do ajuste ou da perda." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_stock_movement", {
    p_clinic_id: input.clinicId,
    p_item_id: input.itemId,
    p_kind: input.kind,
    // Quem converte embalagem → consumo é o BANCO: a mesma conta vale para a
    // nota digitada hoje e para a integração de compras amanhã.
    p_quantity: byPackage ? null : quantity,
    p_unit_cost_cents: byPackage ? null : unitCostCents,
    p_movement_date: input.movementDate || null,
    p_reason: input.reason.trim() || null,
    p_source_type: "manual",
    p_source_id: null,
    p_purchase_quantity: byPackage ? quantity : null,
    p_purchase_unit_cost_cents: byPackage ? unitCostCents : null,
    p_lot_code: input.lotCode?.trim() || null,
    p_expires_at: input.expiresAt || null,
    p_supplier_id: input.supplierId || null,
    p_invoice_number: input.invoiceNumber?.trim() || null,
  });
  if (error) {
    console.error("post_stock_movement failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível lançar o movimento."),
    };
  }

  await logAudit({
    action: "create",
    entityType: "stock_movement",
    entityId: input.itemId,
    clinicId: input.clinicId,
  });
  refresh();
  return { ok: true };
}

/**
 * Mínimo, máximo, onde fica guardado e o fornecedor habitual — tudo isto é DA
 * UNIDADE: Cambé guarda num armário e Londrina noutro, e `suppliers` já é por
 * clínica.
 */
export async function saveItemSettings(input: {
  clinicId: string;
  itemId: string;
  min: string;
  max: string;
  storageLocation: string;
  supplierId: string;
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStock(session, input.clinicId)) {
    return { ok: false, error: "Só a gestão define mínimo, máximo e local." };
  }
  const min = Number(input.min.replace(",", ".")) || 0;
  const max = Number(input.max.replace(",", ".")) || 0;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_stock_item_settings", {
    p_clinic_id: input.clinicId,
    p_item_id: input.itemId,
    p_min: min,
    p_max: max,
    p_storage_location: input.storageLocation.trim() || null,
    p_supplier_id: input.supplierId || null,
  });
  if (error) {
    if (error.message.includes("MAX_BELOW_MIN")) {
      return { ok: false, error: "O máximo não pode ser menor que o mínimo." };
    }
    console.error("set_stock_item_settings failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível salvar a configuração."),
    };
  }
  refresh();
  return { ok: true };
}

// -- KIT DO PROCEDIMENTO -----------------------------------------------------

/**
 * Grava o kit da REDE (padrão) ou o da unidade, e recalcula o custo de
 * material do procedimento na hora — senão o preço continuaria mostrando a
 * estimativa antiga e ninguém notaria a diferença.
 */
export async function saveKit(input: {
  procedureId: string;
  clinicId: string | null;
  activeClinicId: string;
  lines: { itemId: string; quantity: string }[];
}): Promise<StockResult> {
  const session = await getSessionContext();
  const scopeOk =
    input.clinicId === null
      ? canManageStockCatalog(session)
      : canManageStock(session, input.clinicId);
  if (!scopeOk) {
    return {
      ok: false,
      error:
        input.clinicId === null
          ? "O kit padrão da rede é definido pela Franqueadora."
          : "Sua função não permite editar o kit desta unidade.",
    };
  }

  const supabase = await createClient();

  const { data: kitRow, error: kitError } = await supabase
    .from("procedure_kits")
    .upsert(
      {
        procedure_id: input.procedureId,
        clinic_id: input.clinicId,
        created_by: session.userId,
      },
      { onConflict: "procedure_id,clinic_id" }
    )
    .select("id")
    .single();
  if (kitError || !kitRow) {
    console.error("saveKit (upsert) failed:", kitError?.message);
    return { ok: false, error: "Não foi possível salvar o kit." };
  }

  // Substitui a lista inteira: kit é uma foto do que se usa hoje, não um
  // histórico. O histórico de consumo real está em stock_movements.
  const { error: delError } = await supabase
    .from("procedure_kit_items")
    .delete()
    .eq("kit_id", kitRow.id);
  if (delError) {
    console.error("saveKit (clear) failed:", delError.message);
    return { ok: false, error: "Não foi possível atualizar o kit." };
  }

  const rows = input.lines
    .map((l) => ({
      kit_id: kitRow.id as string,
      item_id: l.itemId,
      quantity: Number(l.quantity.replace(",", ".")) || 0,
    }))
    .filter((r) => r.item_id && r.quantity > 0);

  if (rows.length > 0) {
    const { error } = await supabase.from("procedure_kit_items").insert(rows);
    if (error) {
      console.error("saveKit (insert) failed:", error.message);
      return { ok: false, error: "Não foi possível salvar os itens do kit." };
    }
  }

  const { error: refreshError } = await supabase.rpc("refresh_kit_costs", {
    p_clinic_id: input.activeClinicId,
    p_item_id: null,
  });
  if (refreshError) {
    console.error("refresh_kit_costs failed:", refreshError.message);
  }

  await logAudit({
    action: "update",
    entityType: "procedure_kit",
    entityId: input.procedureId,
    clinicId: input.clinicId ?? undefined,
  });
  refresh();
  return { ok: true };
}
