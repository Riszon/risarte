// A lista de fornecedores que VALEM numa unidade (0371) — uma leitura só para
// Contas a pagar, Estoque, Bens e a tela de Fornecedores.

import type { SupabaseClient } from "@supabase/supabase-js";
import { portaAusente } from "@/lib/finance/conta-do-dinheiro";

/**
 * Fornecedores ATIVOS que valem na unidade (rede toda, só a Franqueadora
 * quando a unidade é ela, ou as unidades escolhidas), pelo nome. A RLS de
 * quem chama decide o que aparece.
 *
 * Enquanto o banco não recebeu a 0371 (código no ar antes da migração), cai
 * na leitura antiga: os cadastrados na própria unidade.
 */
export async function fornecedoresDaUnidade<T = { id: string; name: string }>(
  supabase: SupabaseClient,
  clinicId: string,
  colunas = "id, name"
): Promise<T[]> {
  const novo = await supabase
    .rpc("suppliers_for_clinic", { p_clinic_id: clinicId })
    .select(colunas)
    .eq("active", true)
    .order("name");
  if (!novo.error) return (novo.data ?? []) as T[];
  if (!portaAusente(novo.error)) {
    console.error("fornecedoresDaUnidade:", novo.error.message);
    return [];
  }
  // Sem a 0371 as colunas novas também não existem: lê só id e nome.
  const antigo = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .order("name");
  return (antigo.data ?? []) as T[];
}
