"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type PricingResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/procedimentos/precificacao");
  revalidatePath("/procedimentos");
}

/** Custo da hora de cadeira, impostos, taxa média e margem-alvo da unidade. */
export async function saveCostSettings(input: {
  clinicId: string | null;
  chairCostPerHourCents: number;
  taxPercent: number;
  avgAcquirerFeePercent: number;
  targetMarginPercent: number;
}): Promise<PricingResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const row = {
    clinic_id: input.clinicId,
    chair_cost_per_hour_cents: Math.max(
      0,
      Math.round(input.chairCostPerHourCents)
    ),
    tax_percent: Math.max(0, input.taxPercent),
    avg_acquirer_fee_percent: Math.max(0, input.avgAcquirerFeePercent),
    target_margin_percent: Math.max(0, input.targetMarginPercent),
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };

  const { data: existing } = input.clinicId
    ? await supabase
        .from("clinic_cost_settings")
        .select("id")
        .eq("clinic_id", input.clinicId)
        .maybeSingle()
    : await supabase
        .from("clinic_cost_settings")
        .select("id")
        .is("clinic_id", null)
        .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("clinic_cost_settings")
        .update(row)
        .eq("id", existing.id)
    : await supabase.from("clinic_cost_settings").insert(row);
  if (error) {
    console.error("saveCostSettings failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a configuração." };
  }

  await logAudit({
    action: "update",
    entityType: "clinic_cost_settings",
    entityId: input.clinicId ?? "rede",
  });
  refresh();
  return { ok: true };
}

/** Material e laboratório de um procedimento. */
export async function saveProcedureCost(input: {
  clinicId: string | null;
  procedureId: string;
  materialsCents: number;
  labCents: number;
  notes: string;
}): Promise<PricingResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const row = {
    clinic_id: input.clinicId,
    procedure_id: input.procedureId,
    materials_cents: Math.max(0, Math.round(input.materialsCents)),
    lab_cents: Math.max(0, Math.round(input.labCents)),
    notes: input.notes.trim() || null,
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };

  let query = supabase
    .from("procedure_costs")
    .select("id")
    .eq("procedure_id", input.procedureId);
  query = input.clinicId
    ? query.eq("clinic_id", input.clinicId)
    : query.is("clinic_id", null);
  const { data: existing } = await query.maybeSingle();

  const { error } = existing
    ? await supabase.from("procedure_costs").update(row).eq("id", existing.id)
    : await supabase.from("procedure_costs").insert(row);
  if (error) {
    console.error("saveProcedureCost failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o custo." };
  }

  await logAudit({
    action: "update",
    entityType: "procedure_cost",
    entityId: input.procedureId,
  });
  refresh();
  return { ok: true };
}

/**
 * Aplica o preço sugerido no procedimento. É o ganho de o precificador morar
 * em Procedimentos: simula, vê o custo real e aplica sem trocar de tela nem
 * copiar número.
 */
export async function applySuggestedPrice(input: {
  procedureId: string;
  priceCents: number;
}): Promise<PricingResult> {
  await getSessionContext();
  const supabase = await createClient();

  if (input.priceCents <= 0) {
    return { ok: false, error: "Não há preço sugerido para aplicar." };
  }

  const { error } = await supabase
    .from("procedures")
    .update({ default_price_cents: Math.round(input.priceCents) })
    .eq("id", input.procedureId);
  if (error) {
    console.error("applySuggestedPrice failed:", error.message);
    return { ok: false, error: "Não foi possível aplicar o preço." };
  }

  await logAudit({
    action: "update",
    entityType: "procedure_price_from_simulator",
    entityId: input.procedureId,
  });
  refresh();
  return { ok: true };
}
