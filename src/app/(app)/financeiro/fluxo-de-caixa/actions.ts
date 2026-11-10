"use server";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";

export type CashDetailRow = {
  refDate: string;
  kind: "realizado" | "previsto";
  direction: "inflow" | "outflow";
  amountCents: number;
  description: string;
  sourceType: string;
  /** 0372 — quem registrou o movimento (ou lançou a conta, no previsto). */
  createdByName?: string | null;
};

/**
 * O drill-down do fluxo de caixa: de um período até os lançamentos e os
 * documentos que o formaram.
 *
 * Mesma invariante do FIN0 e da DRE — número de relatório que não se explica
 * não se usa para decidir.
 */
export async function loadCashDetail(input: {
  clinicId: string;
  from: string;
  to: string;
}): Promise<{ ok: boolean; rows?: CashDetailRow[]; error?: string }> {
  const session = await getSessionContext();
  if (!canViewFinance(session)) {
    return { ok: false, error: "Sem permissão." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cash_flow_detail", {
    p_clinic_id: input.clinicId,
    p_from: input.from,
    p_to: input.to,
  });
  if (error) {
    console.error("cash_flow_detail failed:", error.message);
    return { ok: false, error: "Não foi possível abrir o período." };
  }

  return {
    ok: true,
    rows: (
      (data ?? []) as {
        ref_date: string;
        kind: string;
        direction: string;
        amount_cents: number;
        description: string | null;
        source_type: string;
        // 0372 — sem a migração no banco, não vem (fica nulo).
        created_by_name?: string | null;
      }[]
    ).map((r) => ({
      refDate: r.ref_date,
      kind: r.kind === "previsto" ? "previsto" : "realizado",
      direction: r.direction === "outflow" ? "outflow" : "inflow",
      amountCents: Number(r.amount_cents ?? 0),
      description: r.description ?? "",
      sourceType: r.source_type,
      createdByName: r.created_by_name ?? null,
    })),
  };
}
