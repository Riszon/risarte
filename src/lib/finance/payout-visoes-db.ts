import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fimDoMes,
  historyFromDb,
  myEvolutionFromDb,
  networkFromDb,
  type HistoryRow,
  type HistoryRowDb,
  type MyEvolutionRow,
  type MyEvolutionRowDb,
  type NetworkPayoutRow,
  type NetworkPayoutRowDb,
} from "./payout-visoes";

// Repasse, Etapa 5 (0401) — as leituras. O banco decide quem lê o quê; aqui só
// se pede e se traduz. Falhou = diz que falhou (a tela não mostra zero no
// lugar de "não consegui ler").

export type Lido<T> = { ok: true; dados: T } | { ok: false; erro: string };

export async function carregarHistorico(
  supabase: SupabaseClient,
  clinicId: string,
  de: string,
  ate: string,
  providerId: string | null = null
): Promise<Lido<HistoryRow[]>> {
  const { data, error } = await supabase.rpc("payout_history", {
    p_clinic_id: clinicId,
    p_from: `${de}-01`,
    p_to: fimDoMes(ate),
    p_provider_id: providerId,
  });
  if (error) {
    console.error("payout_history failed:", error.message);
    return { ok: false, erro: "Não foi possível ler o histórico de repasse." };
  }
  return { ok: true, dados: ((data ?? []) as HistoryRowDb[]).map(historyFromDb) };
}

export async function carregarRepasseDaRede(
  supabase: SupabaseClient,
  de: string,
  ate: string
): Promise<Lido<NetworkPayoutRow[]>> {
  const { data, error } = await supabase.rpc("payout_network_summary", {
    p_from: `${de}-01`,
    p_to: fimDoMes(ate),
  });
  if (error) {
    console.error("payout_network_summary failed:", error.message);
    return { ok: false, erro: "Não foi possível ler o repasse da rede." };
  }
  return { ok: true, dados: ((data ?? []) as NetworkPayoutRowDb[]).map(networkFromDb) };
}

export async function carregarMinhaEvolucao(
  supabase: SupabaseClient,
  de: string,
  ate: string
): Promise<Lido<MyEvolutionRow[]>> {
  const { data, error } = await supabase.rpc("my_payout_evolution", {
    p_from: `${de}-01`,
    p_to: fimDoMes(ate),
  });
  if (error) {
    console.error("my_payout_evolution failed:", error.message);
    return { ok: false, erro: "Não foi possível ler a evolução do seu repasse." };
  }
  return { ok: true, dados: ((data ?? []) as MyEvolutionRowDb[]).map(myEvolutionFromDb) };
}
