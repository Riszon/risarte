"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  canPostFinance,
  canConfigureFinanceNetwork,
} from "@/lib/finance/access";
import { financeErrorMessage } from "@/lib/finance/errors";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string };

/**
 * Fechar o mês — a UNIDADE (decisão do dono): é ela que sabe se terminou de
 * lançar. As duas regras que impedem (mês não terminou, mês anterior aberto)
 * moram no banco; aqui só traduzimos o recado.
 */
export async function closePeriod(input: {
  clinicId: string;
  year: number;
  month: number;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canPostFinance(session, input.clinicId)) {
    return { ok: false, error: "Você não pode fechar o mês desta unidade." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("close_fiscal_period", {
    p_clinic_id: input.clinicId,
    p_year: input.year,
    p_month: input.month,
  });
  if (error) {
    console.error("close_fiscal_period failed:", error.message);
    return {
      ok: false,
      error:
        financeErrorMessage(error.message) ??
        "Não foi possível fechar o período.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "fiscal_period_close",
    entityId: `${input.year}-${input.month}`,
    clinicId: input.clinicId,
  });
  revalidatePath("/financeiro/fechamento");
  return { ok: true };
}

/**
 * Reabrir — a FRANQUEADORA, com justificativa escrita.
 *
 * Quem fechou não reabre: é o que separa um controle de um botão.
 */
export async function reopenPeriod(input: {
  clinicId: string;
  year: number;
  month: number;
  reason: string;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) {
    return {
      ok: false,
      error:
        "Só a Franqueadora reabre um período fechado. Peça a reabertura explicando o motivo.",
    };
  }
  if (!input.reason.trim()) {
    return { ok: false, error: "Escreva o motivo da reabertura." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_fiscal_period", {
    p_clinic_id: input.clinicId,
    p_year: input.year,
    p_month: input.month,
    p_reason: input.reason.trim(),
  });
  if (error) {
    console.error("reopen_fiscal_period failed:", error.message);
    return {
      ok: false,
      error:
        financeErrorMessage(error.message) ??
        "Não foi possível reabrir o período.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "fiscal_period_reopen",
    entityId: `${input.year}-${input.month}`,
    clinicId: input.clinicId,
  });
  revalidatePath("/financeiro/fechamento");
  return { ok: true };
}
