"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
import { canPostFinance } from "@/lib/finance/access";
import { assetErrors } from "@/lib/finance/assets";

export type AssetResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/financeiro/bens");
  revalidatePath("/financeiro");
}

/**
 * Cadastra o bem. O gatilho do banco lança o ATIVO em 6.2.01 — comprar um bem
 * não é gastar, então nada disso toca o resultado até a depreciação rodar.
 */
export async function saveAsset(input: {
  clinicId: string;
  categoryId: string;
  name: string;
  description: string;
  supplierId: string;
  invoiceNumber: string;
  acquisitionDate: string;
  inServiceDate: string;
  cost: string;
  usefulLifeMonths: string;
  notes: string;
}): Promise<AssetResult> {
  const session = await getSessionContext();
  if (!canPostFinance(session, input.clinicId)) {
    return { ok: false, error: "Sua função não permite cadastrar bens." };
  }

  const costCents = parseBRLToCents(input.cost);
  const months = Number(input.usefulLifeMonths.replace(",", ".")) || 0;

  const errors = assetErrors({
    name: input.name,
    costCents,
    usefulLifeMonths: months,
    acquisitionDate: input.acquisitionDate,
    inServiceDate: input.inServiceDate,
  });
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const supabase = await createClient();
  const { error } = await supabase.from("fixed_assets").insert({
    clinic_id: input.clinicId,
    category_id: input.categoryId || null,
    name: input.name.trim(),
    description: input.description.trim() || null,
    supplier_id: input.supplierId || null,
    invoice_number: input.invoiceNumber.trim() || null,
    acquisition_date: input.acquisitionDate,
    in_service_date: input.inServiceDate || input.acquisitionDate,
    cost_cents: costCents,
    useful_life_months: Math.round(months),
    notes: input.notes.trim() || null,
    created_by: session.userId,
  });
  if (error) {
    console.error("saveAsset failed:", error.message);
    return { ok: false, error: "Não foi possível cadastrar o bem." };
  }

  await logAudit({
    action: "create",
    entityType: "fixed_asset",
    entityId: input.name,
    clinicId: input.clinicId,
  });
  refresh();
  return { ok: true };
}

/**
 * Roda a depreciação do mês. Rodar duas vezes é seguro — o índice único por
 * (bem, mês) impede dobrar a despesa.
 */
export async function runDepreciation(input: {
  clinicId: string;
  month: string;
}): Promise<AssetResult> {
  const session = await getSessionContext();
  if (!canPostFinance(session, input.clinicId)) {
    return { ok: false, error: "Sua função não permite lançar depreciação." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("depreciate_month", {
    p_clinic_id: input.clinicId,
    p_month: `${input.month}-01`,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite lançar depreciação." };
    }
    console.error("depreciate_month failed:", error.message);
    return { ok: false, error: "Não foi possível rodar a depreciação." };
  }

  await logAudit({
    action: "create",
    entityType: "asset_depreciation",
    entityId: input.month,
    clinicId: input.clinicId,
  });
  refresh();
  return Number(data ?? 0) === 0
    ? {
        ok: true,
        error:
          "Nada a depreciar neste mês — ou já foi rodado, ou os bens ainda não entraram em uso.",
      }
    : { ok: true };
}

/**
 * Baixa: para de depreciar e o valor que restava vai para resultado. Sem isso o
 * sistema depreciaria para sempre uma cadeira que já foi para o lixo.
 */
export async function disposeAsset(input: {
  clinicId: string;
  assetId: string;
  date: string;
  reason: string;
}): Promise<AssetResult> {
  const session = await getSessionContext();
  if (!canPostFinance(session, input.clinicId)) {
    return { ok: false, error: "Sua função não permite dar baixa em bens." };
  }
  if (!input.reason.trim()) {
    return { ok: false, error: "Informe o motivo da baixa." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("dispose_asset", {
    p_asset_id: input.assetId,
    p_date: input.date || null,
    p_reason: input.reason,
  });
  if (error) {
    if (error.message.includes("ALREADY_DISPOSED")) {
      return { ok: false, error: "Este bem já foi baixado." };
    }
    console.error("dispose_asset failed:", error.message);
    return { ok: false, error: "Não foi possível dar baixa no bem." };
  }

  await logAudit({
    action: "update",
    entityType: "fixed_asset",
    entityId: input.assetId,
    clinicId: input.clinicId,
  });
  refresh();
  return { ok: true };
}

/** Vida útil padrão da categoria — editável de propósito. */
export async function saveAssetCategory(input: {
  clinicId: string | null;
  name: string;
  months: string;
}): Promise<AssetResult> {
  const session = await getSessionContext();
  if (!session.isAdminMaster && !canPostFinance(session, input.clinicId)) {
    return { ok: false, error: "Sem permissão para editar categorias." };
  }
  if (!input.name.trim()) return { ok: false, error: "Informe o nome." };
  const months = Number(input.months.replace(",", ".")) || 0;
  if (months <= 0) return { ok: false, error: "Informe a vida útil em meses." };

  const supabase = await createClient();
  const { error } = await supabase.from("asset_categories").insert({
    clinic_id: input.clinicId,
    name: input.name.trim(),
    default_useful_life_months: Math.round(months),
    created_by: session.userId,
  });
  if (error) {
    console.error("saveAssetCategory failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a categoria." };
  }
  refresh();
  return { ok: true };
}
