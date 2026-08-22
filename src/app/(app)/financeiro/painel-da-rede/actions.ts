"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { financeErrorMessage } from "@/lib/finance/errors";

type Result = { ok: boolean; error?: string; count?: number };

/**
 * Apurar os alertas de TODAS as unidades agora.
 *
 * O painel mostra o retrato da última apuração (o motor roda às 9h). Este botão
 * existe para a franqueadora não precisar esperar o dia seguinte depois de
 * mexer num limite — e continua respeitando o anti-repetição: o que já foi
 * avisado não avisa de novo.
 */
export async function checkAllAlerts(): Promise<Result> {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) {
    return { ok: false, error: "Só a Franqueadora apura a rede inteira." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_finance_alerts", {
    p_clinic_id: null,
  });
  if (error) {
    console.error("check_finance_alerts (rede) failed:", error.message);
    return {
      ok: false,
      error: financeErrorMessage(error.message) ?? "Não foi possível apurar.",
    };
  }

  revalidatePath("/financeiro/painel-da-rede");
  return { ok: true, count: Number(data ?? 0) };
}
