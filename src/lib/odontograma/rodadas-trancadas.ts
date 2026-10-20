import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * OD2 (0310, decisão E1): as rodadas do cliente com o diagnóstico FINALIZADO.
 * O que pertence a elas (considerações, mídias) não se edita nem se apaga — a
 * tela esconde os botões e o banco recusa.
 *
 * Banco ainda sem a 0310 (a coluna não existe): devolve vazio, e a tela segue
 * como antes — lá não há trava nenhuma a respeitar.
 */
export async function rodadasFinalizadas(clientId: string): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinical_evaluations")
    .select("id, diagnosis_finalized_at")
    .eq("client_id", clientId)
    .not("diagnosis_finalized_at", "is", null)
    .returns<{ id: string; diagnosis_finalized_at: string }[]>();
  if (error) return new Map();
  return new Map((data ?? []).map((r) => [r.id, r.diagnosis_finalized_at]));
}
