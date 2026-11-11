"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { payoutRateErrors } from "@/lib/finance/payout";
import { recalculateErrorText } from "@/lib/finance/payout-watchlist";

export type PayoutResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/financeiro/repasses");
  revalidatePath("/financeiro/contas-a-pagar");
}

/** Linha da tabela de repasse — vale para um NÍVEL ou para uma PESSOA. */
export async function savePayoutRate(input: {
  id: string | null;
  clinicId: string | null;
  procedureId: string;
  levelId: string | null;
  providerId: string | null;
  amountCents: number;
  validFrom: string;
  validTo: string | null;
}): Promise<PayoutResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const errors = payoutRateErrors(input);
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const row = {
    clinic_id: input.clinicId,
    procedure_id: input.procedureId,
    level_id: input.levelId,
    provider_id: input.providerId,
    amount_cents: Math.round(input.amountCents),
    valid_from: input.validFrom,
    valid_to: input.validTo,
  };

  const { error } = input.id
    ? await supabase.from("provider_payout_rates").update(row).eq("id", input.id)
    : await supabase
        .from("provider_payout_rates")
        .insert({ ...row, created_by: session.userId });
  if (error) {
    console.error("savePayoutRate failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o valor do repasse." };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "payout_rate",
    entityId: input.id ?? input.procedureId,
  });
  refresh();
  return { ok: true };
}

/** Encerra a vigência — o caminho certo quando o valor muda. */
export async function closePayoutRate(input: {
  id: string;
  validTo: string;
}): Promise<PayoutResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("provider_payout_rates")
    .update({ valid_to: input.validTo })
    .eq("id", input.id);
  if (error) {
    console.error("closePayoutRate failed:", error.message);
    return { ok: false, error: "Não foi possível encerrar a vigência." };
  }
  refresh();
  return { ok: true };
}

/** O dentista aponta para um nível do plano de carreira, na unidade. */
export async function setProviderLevel(input: {
  userId: string;
  clinicId: string;
  levelId: string | null;
}): Promise<PayoutResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("user_clinic_roles")
    .update({ career_level_id: input.levelId })
    .eq("user_id", input.userId)
    .eq("clinic_id", input.clinicId);
  if (error) {
    console.error("setProviderLevel failed:", error.message);
    return { ok: false, error: "Não foi possível definir o nível." };
  }

  await logAudit({
    action: "update",
    entityType: "provider_career_level",
    entityId: input.userId,
    clinicId: input.clinicId,
  });
  refresh();
  return { ok: true };
}

/**
 * 0387 — recalcula UM repasse que saiu com R$ 0,00 (o nível do dentista ou o
 * valor da tabela chegaram depois da conclusão). A regra mora no banco: só
 * linha zerada e fora de fechamento, pela tabela que vale na data do
 * procedimento; valor diferente de zero continua congelado.
 */
export async function recalculatePayout(input: {
  payoutId: string;
}): Promise<PayoutResult & { amountCents?: number }> {
  await getSessionContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("payout_recalculate", {
    p_payout_id: input.payoutId,
  });
  if (error) {
    console.error("payout_recalculate failed:", error.message);
    return { ok: false, error: recalculateErrorText(error.message) };
  }
  refresh();
  return { ok: true, amountCents: Number(data ?? 0) };
}

/** 0387 — recalcula todos os zerados da unidade que já têm valor na tabela. */
export async function recalculateZeroPayouts(input: {
  clinicId: string;
}): Promise<PayoutResult & { fixed?: number }> {
  await getSessionContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("payout_recalculate_zeros", {
    p_clinic_id: input.clinicId,
  });
  if (error) {
    console.error("payout_recalculate_zeros failed:", error.message);
    return { ok: false, error: recalculateErrorText(error.message) };
  }
  await logAudit({
    action: "update",
    entityType: "provider_payout",
    entityId: input.clinicId,
    clinicId: input.clinicId,
  });
  refresh();
  return { ok: true, fixed: Number(data ?? 0) };
}

/**
 * 0210 — nível de carreira editável: nome, descrição e os REQUISITOS para
 * evoluir. Os requisitos são descritivos de propósito — o sistema não promove
 * ninguém sozinho. Promover é decisão de gestão; o que o sistema faz é deixar
 * o critério escrito e visível para os dois lados.
 */
export async function saveCareerLevel(input: {
  id: string | null;
  clinicId: string | null;
  name: string;
  sortOrder: number;
  description: string;
  reqMonthsMin: number | null;
  reqMonthlyProductionCents: number | null;
  reqResults: string;
  reqEducation: string;
  reqOther: string;
  active: boolean;
}): Promise<PayoutResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  if (!input.name.trim()) return { ok: false, error: "Informe o nome do nível." };

  const row = {
    clinic_id: input.clinicId,
    name: input.name.trim(),
    sort_order: input.sortOrder,
    description: input.description.trim() || null,
    req_months_min: input.reqMonthsMin,
    req_monthly_production_cents: input.reqMonthlyProductionCents,
    req_results: input.reqResults.trim() || null,
    req_education: input.reqEducation.trim() || null,
    req_other: input.reqOther.trim() || null,
    active: input.active,
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };

  const { error } = input.id
    ? await supabase.from("career_levels").update(row).eq("id", input.id)
    : await supabase
        .from("career_levels")
        .insert({ ...row, created_by: session.userId });
  if (error) {
    console.error("saveCareerLevel failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o nível." };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "career_level",
    entityId: input.id ?? input.name,
  });
  refresh();
  return { ok: true };
}
