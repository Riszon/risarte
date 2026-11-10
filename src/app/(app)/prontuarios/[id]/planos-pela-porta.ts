import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * O plano aprovado no MESMO formato da leitura direta de `treatment_plans`
 * (plano → opções → itens), para a aba Sessões & Procedimentos.
 */
export type PlanoDosProcedimentos = {
  id: string;
  created_at: string;
  complement_of_plan_id: string | null;
  complement_no: number | null;
  quality_locked: boolean;
  quality_locked_at: string | null;
  treatment_plan_options: {
    id: string;
    is_primary: boolean;
    sort_order: number;
    title: string;
    treatment_plan_option_items: {
      id: string;
      description: string;
      sort_order: number;
    }[];
  }[];
};

type LinhaDaPorta = {
  plan_id: string;
  plan_created_at: string;
  complement_of_plan_id: string | null;
  complement_no: number | null;
  quality_locked: boolean;
  quality_locked_at: string | null;
  option_id: string;
  is_primary: boolean;
  option_sort: number;
  option_title: string;
  item_id: string;
  description: string;
  item_sort: number;
};

/** Monta planos → opções → itens a partir das linhas planas da porta. */
export function agruparPlanosDaPorta(linhas: LinhaDaPorta[]): PlanoDosProcedimentos[] {
  const planos = new Map<string, PlanoDosProcedimentos>();
  for (const l of linhas) {
    let plano = planos.get(l.plan_id);
    if (!plano) {
      plano = {
        id: l.plan_id,
        created_at: l.plan_created_at,
        complement_of_plan_id: l.complement_of_plan_id,
        complement_no: l.complement_no,
        quality_locked: l.quality_locked,
        quality_locked_at: l.quality_locked_at,
        treatment_plan_options: [],
      };
      planos.set(l.plan_id, plano);
    }
    let opcao = plano.treatment_plan_options.find((o) => o.id === l.option_id);
    if (!opcao) {
      opcao = {
        id: l.option_id,
        is_primary: l.is_primary,
        sort_order: l.option_sort,
        title: l.option_title,
        treatment_plan_option_items: [],
      };
      plano.treatment_plan_options.push(opcao);
    }
    opcao.treatment_plan_option_items.push({
      id: l.item_id,
      description: l.description,
      sort_order: l.item_sort,
    });
  }
  return [...planos.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * OC-00172 (0388): quem não lê o plano pela regra da tabela (o dentista) lê
 * os itens aprovados por `client_approved_plan_items` — sem preço, com o
 * portão do odontograma. Sem a 0388 no banco, devolve vazio (como antes).
 */
export async function planosPelaPorta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string
): Promise<PlanoDosProcedimentos[]> {
  const { data, error } = await supabase.rpc("client_approved_plan_items", {
    p_client: clientId,
  });
  if (error) {
    console.error("prontuário (procedimentos pela porta):", error.message);
    return [];
  }
  return agruparPlanosDaPorta((data ?? []) as LinhaDaPorta[]);
}
