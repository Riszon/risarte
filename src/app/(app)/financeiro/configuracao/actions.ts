"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canPostFinance } from "@/lib/finance/access";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string; count?: number };

const DENIED = "Você não tem permissão para mexer nos alertas desta unidade.";

/**
 * FIN7.3 — os limites dos alertas, salvos pela própria unidade.
 *
 * Porta estreita de propósito: mexe só nas colunas de alerta. Multa, juros e
 * carência continuam sendo regra da rede, escrita só pela Franqueadora.
 */
export async function saveAlertSettings(input: {
  clinicId: string;
  enabled: boolean;
  budgetPercent: number;
  cashDays: number;
  breakevenDays: number;
  overdueCents: number;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canPostFinance(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_alert_settings", {
    p_clinic_id: input.clinicId,
    p_enabled: input.enabled,
    p_budget_percent: Math.max(1, Math.min(999, input.budgetPercent)),
    p_cash_days: Math.max(1, Math.min(365, Math.round(input.cashDays))),
    p_breakeven_days: Math.max(0, Math.min(31, Math.round(input.breakevenDays))),
    p_overdue_cents: Math.max(0, Math.round(input.overdueCents)),
  });
  if (error) {
    console.error("save_alert_settings failed:", error.message);
    if (error.message.includes("NOT_ALLOWED")) return { ok: false, error: DENIED };
    return { ok: false, error: "Não foi possível salvar os limites." };
  }

  await logAudit({
    action: "update",
    entityType: "finance_alert_settings",
    entityId: input.clinicId,
    clinicId: input.clinicId,
  });
  revalidatePath("/financeiro/configuracao");
  return { ok: true };
}

/**
 * Rodar a verificação na hora, sem esperar as 9h da manhã.
 *
 * Serve para conferir a régua depois de mexer nos limites — e continua
 * respeitando o anti-repetição: o que já foi avisado não avisa de novo.
 */
export async function checkFinanceAlertsNow(input: {
  clinicId: string;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canPostFinance(session, input.clinicId)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_finance_alerts", {
    p_clinic_id: input.clinicId,
  });
  if (error) {
    console.error("check_finance_alerts failed:", error.message);
    if (error.message.includes("NOT_ALLOWED")) return { ok: false, error: DENIED };
    return { ok: false, error: "Não foi possível verificar agora." };
  }

  revalidatePath("/financeiro/configuracao");
  return { ok: true, count: Number(data ?? 0) };
}
