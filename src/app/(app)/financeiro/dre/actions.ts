"use server";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";

export type DreEntry = {
  id: string;
  accrualDate: string;
  amountCents: number;
  status: string;
  sourceType: string;
  description: string;
  costCenterName: string;
};

/**
 * O drill-down: de uma linha da DRE até os lançamentos que a formaram.
 *
 * É a invariante do módulo desde o FIN0 — "qualquer número de relatório precisa
 * chegar ao documento de origem". Número que não se explica não se usa para
 * decidir.
 */
export async function loadDreEntries(input: {
  clinicId: string;
  from: string;
  to: string;
  accountCode: string;
  costCenterId: string;
}): Promise<{ ok: boolean; entries?: DreEntry[]; error?: string }> {
  const session = await getSessionContext();
  if (!canViewFinance(session)) {
    return { ok: false, error: "Sem permissão." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dre_entries", {
    p_clinic_id: input.clinicId,
    p_from: input.from,
    p_to: input.to,
    p_account_code: input.accountCode,
    p_cost_center_id: input.costCenterId || null,
  });
  if (error) {
    console.error("dre_entries failed:", error.message);
    return { ok: false, error: "Não foi possível abrir os lançamentos." };
  }

  return {
    ok: true,
    entries: (
      (data ?? []) as {
        entry_id: string;
        accrual_date: string;
        amount_cents: number;
        status: string;
        source_type: string;
        description: string | null;
        cost_center_name: string | null;
      }[]
    ).map((e) => ({
      id: e.entry_id,
      accrualDate: e.accrual_date,
      amountCents: Number(e.amount_cents ?? 0),
      status: e.status,
      sourceType: e.source_type,
      description: e.description ?? "",
      costCenterName: e.cost_center_name ?? "",
    })),
  };
}
