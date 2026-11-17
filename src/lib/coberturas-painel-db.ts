// Funções de apoio, F4: a leitura do painel "Equipe e coberturas". UMA leitura
// para as duas telas (Painel da rede e /risartanos/coberturas): quem vê quais
// unidades é o BANCO quem decide (0419, `_coverage_visible_clinics`, D12).

import type { createClient } from "@/lib/supabase/server";
import {
  erroDoPainelDeCoberturas,
  lerPessoasEmCobertura,
  lerUnidadesDeCobertura,
  type PessoaEmCobertura,
  type UnidadeDeCobertura,
} from "@/lib/coberturas-painel";

type Supa = Awaited<ReturnType<typeof createClient>>;

export type PainelDeCoberturas =
  | { ok: true; unidades: UnidadeDeCobertura[]; pessoas: PessoaEmCobertura[] }
  | { ok: false; erro: string };

export async function carregarPainelDeCoberturas(
  supabase: Supa,
  de: string,
  ate: string
): Promise<PainelDeCoberturas> {
  const [u, p] = await Promise.all([
    supabase.rpc("coverage_panel_units", { p_de: de, p_ate: ate }),
    supabase.rpc("coverage_panel_people", { p_de: de, p_ate: ate }),
  ]);
  const erro = u.error ?? p.error;
  if (erro) return { ok: false, erro: erroDoPainelDeCoberturas(`${erro.message} ${erro.code ?? ""}`) };
  return {
    ok: true,
    unidades: lerUnidadesDeCobertura((u.data ?? []) as Record<string, unknown>[]),
    pessoas: lerPessoasEmCobertura((p.data ?? []) as Record<string, unknown>[]),
  };
}
