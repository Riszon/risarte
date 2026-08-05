"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { rateErrors, type CardModality } from "@/lib/finance/acquirers";

export type AcquirerResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/financeiro/adquirentes");
  revalidatePath("/financeiro/conciliacao");
}

export async function saveAcquirer(input: {
  id: string | null;
  clinicId: string;
  name: string;
  isDefault: boolean;
  notes: string;
  active: boolean;
}): Promise<AcquirerResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  if (!input.name.trim()) return { ok: false, error: "Informe o nome." };

  // Só uma padrão por unidade (índice único no banco): tiramos a anterior.
  if (input.isDefault) {
    let q = supabase
      .from("card_acquirers")
      .update({ is_default: false })
      .eq("clinic_id", input.clinicId)
      .eq("is_default", true);
    if (input.id) q = q.neq("id", input.id);
    await q;
  }

  const row = {
    clinic_id: input.clinicId,
    name: input.name.trim(),
    is_default: input.isDefault,
    notes: input.notes || null,
    active: input.active,
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };

  const { error } = input.id
    ? await supabase.from("card_acquirers").update(row).eq("id", input.id)
    : await supabase
        .from("card_acquirers")
        .insert({ ...row, created_by: session.userId });
  if (error) {
    console.error("saveAcquirer failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a adquirente." };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "card_acquirer",
    entityId: input.id ?? input.clinicId,
  });
  refresh();
  return { ok: true };
}

/**
 * FIN4b — faixa de taxa com VIGÊNCIA. Renegociar a taxa não reescreve o que já
 * foi recebido: cria-se uma linha nova valendo a partir da data acordada.
 */
export async function saveRate(input: {
  id: string | null;
  acquirerId: string;
  modality: CardModality;
  minInstallments: number;
  maxInstallments: number;
  feePercent: number;
  fixedFeeCents: number;
  settlementDays: number;
  settlementBusinessDays: boolean;
  freeMonthlyCount: number | null;
  validFrom: string;
  validTo: string | null;
}): Promise<AcquirerResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const errors = rateErrors(input);
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const row = {
    acquirer_id: input.acquirerId,
    modality: input.modality,
    min_installments: input.minInstallments,
    max_installments: input.maxInstallments,
    fee_percent: input.feePercent,
    fixed_fee_cents: Math.round(input.fixedFeeCents),
    settlement_days: input.settlementDays,
    settlement_business_days: input.settlementBusinessDays,
    free_monthly_count: input.freeMonthlyCount,
    valid_from: input.validFrom,
    valid_to: input.validTo,
  };

  const { error } = input.id
    ? await supabase.from("acquirer_rates").update(row).eq("id", input.id)
    : await supabase
        .from("acquirer_rates")
        .insert({ ...row, created_by: session.userId });
  if (error) {
    console.error("saveRate failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a taxa." };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "acquirer_rate",
    entityId: input.acquirerId,
  });
  refresh();
  return { ok: true };
}

export async function deleteRate(input: {
  id: string;
}): Promise<AcquirerResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("acquirer_rates")
    .delete()
    .eq("id", input.id);
  if (error) {
    console.error("deleteRate failed:", error.message);
    return { ok: false, error: "Não foi possível remover a taxa." };
  }

  await logAudit({
    action: "update",
    entityType: "acquirer_rate_delete",
    entityId: input.id,
  });
  refresh();
  return { ok: true };
}
