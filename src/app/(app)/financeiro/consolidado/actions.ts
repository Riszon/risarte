"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { financeErrorMessage } from "@/lib/finance/errors";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string };

export type ClinicBreakdown = {
  clinicName: string;
  ownership: string;
  amountCents: number;
  eliminatedCents: number;
};

const DENIED = "Só a Franqueadora enxerga o consolidado da rede.";

/**
 * De onde veio cada linha do consolidado.
 *
 * O drill-down aqui não é por lançamento, e sim por UNIDADE: no consolidado a
 * pergunta é "quem trouxe este número", não "qual documento". O caminho até o
 * documento continua na DRE da unidade.
 */
export async function loadClinicBreakdown(input: {
  from: string;
  to: string;
  scope: "grupo" | "rede";
  accountCode: string;
}): Promise<{ ok: boolean; rows?: ClinicBreakdown[]; error?: string }> {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consolidated_by_clinic", {
    p_from: input.from,
    p_to: input.to,
    p_scope: input.scope,
    p_account_code: input.accountCode,
  });
  if (error) {
    console.error("consolidated_by_clinic failed:", error.message);
    return { ok: false, error: "Não foi possível abrir a conta." };
  }

  return {
    ok: true,
    rows: (
      (data ?? []) as {
        clinic_name: string;
        ownership: string;
        amount_cents: number;
        eliminated_cents: number;
      }[]
    ).map((r) => ({
      clinicName: r.clinic_name,
      ownership: r.ownership,
      amountCents: Number(r.amount_cents ?? 0),
      eliminatedCents: Number(r.eliminated_cents ?? 0),
    })),
  };
}

/**
 * Marcar a unidade como PRÓPRIA ou FRANQUEADA.
 *
 * É o interruptor que decide quem entra no Resultado do Grupo. A coluna existia
 * desde o FIN0 e nunca teve tela — sem ela, o grupo mostraria só a franqueadora
 * para sempre e ninguém saberia por quê.
 */
export async function setClinicOwnership(input: {
  clinicId: string;
  ownership: "own" | "franchised";
}): Promise<Result> {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) {
    return { ok: false, error: DENIED };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_clinic_ownership", {
    p_clinic_id: input.clinicId,
    p_ownership: input.ownership,
  });
  if (error) {
    console.error("set_clinic_ownership failed:", error.message);
    return {
      ok: false,
      error: financeErrorMessage(error.message) ?? "Não foi possível salvar.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "clinic_ownership",
    entityId: input.clinicId,
    clinicId: input.clinicId,
  });
  revalidatePath("/financeiro/consolidado");
  return { ok: true };
}
