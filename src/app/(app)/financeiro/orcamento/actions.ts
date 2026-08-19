"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canPostFinance } from "@/lib/finance/access";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string; count?: number };

const DENIED = "Você não tem permissão para orçar nesta unidade.";

/**
 * Salva (ou apaga) a meta de uma conta no mês.
 *
 * A tela manda SEMPRE magnitude positiva: o sinal é aplicado no banco, por uma
 * regra só (`budget_sign`), para os dois lados nunca discordarem. Zero apaga a
 * linha — meta zerada e meta inexistente são a mesma coisa.
 */
export async function saveBudgetLine(input: {
  clinicId: string;
  year: number;
  month: number;
  accountCode: string;
  amountCents: number;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canPostFinance(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_budget_line", {
    p_clinic_id: input.clinicId,
    p_year: input.year,
    p_month: input.month,
    p_account_code: input.accountCode,
    p_amount_cents: Math.round(Math.abs(input.amountCents)),
  });
  if (error) {
    console.error("save_budget_line failed:", error.message);
    if (error.message.includes("NOT_ALLOWED")) return { ok: false, error: DENIED };
    if (error.message.includes("ACCOUNT_NOT_ANALYTIC")) {
      return { ok: false, error: "Esta conta é um grupo e não recebe meta." };
    }
    return { ok: false, error: "Não foi possível salvar a meta." };
  }

  await logAudit({
    action: "update",
    entityType: "budget_line",
    entityId: `${input.year}-${input.month}-${input.accountCode}`,
    clinicId: input.clinicId,
  });
  revalidatePath("/financeiro/orcamento");
  return { ok: true };
}

/** Copia o orçamento de um ano para outro, com reajuste percentual. */
export async function copyBudgetYear(input: {
  clinicId: string;
  fromYear: number;
  toYear: number;
  percent: number;
  overwrite: boolean;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canPostFinance(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_budget_year", {
    p_clinic_id: input.clinicId,
    p_from_year: input.fromYear,
    p_to_year: input.toYear,
    p_percent: input.percent,
    p_overwrite: input.overwrite,
  });
  if (error) {
    console.error("copy_budget_year failed:", error.message);
    if (error.message.includes("NOT_ALLOWED")) return { ok: false, error: DENIED };
    if (error.message.includes("SAME_YEAR")) {
      return { ok: false, error: "Escolha um ano de origem diferente." };
    }
    return { ok: false, error: "Não foi possível copiar o orçamento." };
  }

  await logAudit({
    action: "create",
    entityType: "budget_copy",
    entityId: `${input.fromYear}->${input.toYear}`,
    clinicId: input.clinicId,
  });
  revalidatePath("/financeiro/orcamento");
  return { ok: true, count: Number(data ?? 0) };
}

/** Preenche o ano a partir da média do realizado dos últimos meses. */
export async function fillBudgetFromActual(input: {
  clinicId: string;
  toYear: number;
  monthsBack: number;
  percent: number;
  overwrite: boolean;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canPostFinance(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fill_budget_from_actual", {
    p_clinic_id: input.clinicId,
    p_to_year: input.toYear,
    p_months_back: input.monthsBack,
    p_percent: input.percent,
    p_overwrite: input.overwrite,
  });
  if (error) {
    console.error("fill_budget_from_actual failed:", error.message);
    if (error.message.includes("NOT_ALLOWED")) return { ok: false, error: DENIED };
    return { ok: false, error: "Não foi possível sugerir o orçamento." };
  }

  await logAudit({
    action: "create",
    entityType: "budget_fill",
    entityId: String(input.toYear),
    clinicId: input.clinicId,
  });
  revalidatePath("/financeiro/orcamento");
  return { ok: true, count: Number(data ?? 0) };
}
