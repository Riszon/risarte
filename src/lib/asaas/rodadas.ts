import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 4012 (spec 19.10 item 5): toda rodada de rotina fica gravada
 * (`gateway_routine_runs`) — é dela que o vigia do banco lê. Gravar a rodada
 * NUNCA derruba a rotina: banco sem a 4012 só não grava.
 */
export type Rotina = "cobrancas" | "split_diario" | "contas" | "regua";
export type OrigemDaRodada = "vercel" | "banco" | "rodar_agora" | "gatilho";

export async function comecarRodada(rotina: Rotina, origem: OrigemDaRodada, ator: string | null = null): Promise<number | null> {
  const { data, error } = await createAdminClient().rpc("_routine_run_start", { p_routine: rotina, p_origin: origem, p_actor: ator });
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("routine run start failed:", error.message);
    return null;
  }
  return typeof data === "number" ? data : Number(data);
}

export async function terminarRodada(
  id: number | null,
  r: { ok: boolean; criadas?: number; falhas?: number; puladas?: number; motivo?: string | null; detalhes?: Record<string, unknown> }
): Promise<void> {
  if (id === null) return;
  const { error } = await createAdminClient().rpc("_routine_run_finish", {
    p_id: id,
    p_ok: r.ok,
    p_created: r.criadas ?? 0,
    p_failed: r.falhas ?? 0,
    p_skipped: r.puladas ?? 0,
    p_reason: r.motivo ?? null,
    p_details: r.detalhes ?? {},
  });
  if (error) console.error("routine run finish failed:", error.message);
}
