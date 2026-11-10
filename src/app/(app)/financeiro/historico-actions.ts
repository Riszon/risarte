"use server";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { TipoDoHistorico } from "@/lib/finance/historico-do-lancamento";

export type LinhaDoHistorico = {
  id: number;
  occurredAt: string;
  userId: string | null;
  userName: string | null;
  actor: string;
  tableName: string;
  op: "I" | "U" | "D";
  changes: Record<string, unknown> | null;
};

/**
 * O histórico de UM lançamento do Financeiro (0372): a trilha da auditoria
 * geral, só das linhas dele, para quem enxerga o Financeiro da unidade.
 */
export async function loadFinanceHistory(
  tipo: TipoDoHistorico,
  id: string
): Promise<{ ok: boolean; rows: LinhaDoHistorico[]; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_history", { p_kind: tipo, p_id: id });
  if (error) {
    // Sem a 0372 no banco a porta não existe: dizer isso, não "erro".
    if (error.code === "PGRST202" || /finance_history/.test(error.message ?? "")) {
      return {
        ok: false,
        rows: [],
        error: "O histórico ainda não está disponível neste ambiente (falta atualizar o banco).",
      };
    }
    console.error("loadFinanceHistory failed:", error.message);
    return { ok: false, rows: [], error: "Não foi possível ler o histórico." };
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    occurredAt: String(r.occurred_at),
    userId: (r.user_id as string | null) ?? null,
    userName: (r.user_name as string | null) ?? null,
    actor: String(r.actor ?? "usuario"),
    tableName: String(r.table_name),
    op: r.op as "I" | "U" | "D",
    changes: (r.changes as Record<string, unknown> | null) ?? null,
  }));
  return { ok: true, rows };
}
