"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { payoutRateErrors } from "@/lib/finance/payout";

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
 * Fecha o mês: consolida, aplica o bônus e gera as contas a pagar.
 * NÃO paga ninguém — quem paga é o Financeiro, pelo fluxo que já existe.
 */
export async function closePayoutMonth(input: {
  clinicId: string;
  month: string;
  bonusPercent: number;
}): Promise<PayoutResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("close_payout_month", {
    p_clinic_id: input.clinicId,
    p_month: input.month,
    p_bonus_percent: input.bonusPercent,
  });
  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_CLOSED")) {
      return { ok: false, error: "Este mês já foi fechado." };
    }
    if (m.includes("NOTHING_TO_CLOSE")) {
      return {
        ok: false,
        error: "Não há repasse apurado neste mês para fechar.",
      };
    }
    if (m.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite fechar o repasse." };
    }
    console.error("close_payout_month failed:", m);
    return { ok: false, error: "Não foi possível fechar o mês." };
  }

  await logAudit({
    action: "create",
    entityType: "payout_closing",
    entityId: input.clinicId,
    clinicId: input.clinicId,
  });
  refresh();
  return { ok: true };
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
