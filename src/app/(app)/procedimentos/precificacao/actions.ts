"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { margemMinimaValida } from "@/lib/finance/pricing-simulator";

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
  /**
   * A margem MÍNIMA (nulo = sem). É a MESMA do alerta de margem da negociação
   * e da venda direta — `commercial_rules.min_margin_percent` (decisão do
   * dono, 27/10/2026). `undefined` = a tela não conseguiu ler: não mexe.
   */
  minMarginPercent?: number | null;
}): Promise<PricingResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  if (input.minMarginPercent !== undefined) {
    const problema = margemMinimaValida(input.minMarginPercent, Math.max(0, input.targetMarginPercent));
    if (problema) return { ok: false, error: problema };
    // Só o Admin Master grava regra comercial (a regra do banco também).
    if (!session.isAdminMaster) {
      return { ok: false, error: "Só o Admin Master define a margem mínima." };
    }
  }

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

  // A margem mínima mora na regra comercial do MESMO escopo (unidade ou rede).
  // Só esta coluna: os outros campos da regra (teto, parcelas…) não mudam, e
  // a unidade sem regra própria ganha uma linha que herda o resto da rede.
  if (input.minMarginPercent !== undefined) {
    const minima = input.minMarginPercent === null ? null : Math.round(input.minMarginPercent * 100) / 100;
    const { data: regra, error: erroDaRegra } = input.clinicId
      ? await supabase.from("commercial_rules").select("id").eq("clinic_id", input.clinicId).maybeSingle()
      : await supabase.from("commercial_rules").select("id").is("clinic_id", null).maybeSingle();
    if (erroDaRegra) {
      console.error("saveCostSettings (regra) failed:", erroDaRegra.message);
      return { ok: false, error: "Os custos foram salvos, mas não consegui ler a regra comercial — a margem mínima não mudou." };
    }
    const { error: erroDaMinima } = regra
      ? await supabase
          .from("commercial_rules")
          .update({ min_margin_percent: minima, updated_by: session.userId, updated_at: new Date().toISOString() })
          .eq("id", regra.id)
      : minima === null
        ? { error: null } // sem regra e sem mínima: nada a gravar
        : await supabase.from("commercial_rules").insert({
            clinic_id: input.clinicId,
            min_margin_percent: minima,
            updated_by: session.userId,
            updated_at: new Date().toISOString(),
          });
    if (erroDaMinima) {
      console.error("saveCostSettings (margem mínima) failed:", erroDaMinima.message);
      return { ok: false, error: "Os custos foram salvos, mas a margem mínima não — tente de novo." };
    }
    revalidatePath("/admin/regras-comerciais");
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
