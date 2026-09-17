import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTreino } from "@/lib/environment";
import {
  AMBIENTES,
  enderecoValido,
  type Ambiente,
} from "@/lib/ambientes";

/** Onde este código está rodando agora — o atalho para si mesmo não existe. */
export function ambienteAtual(): Ambiente {
  return isTreino() ? "treino" : "sistema";
}

/**
 * Os endereços dos ambientes (0259). São CONFIGURAÇÃO da rede, não código: o
 * Academy ainda não foi publicado, e ligar o atalho quando ele for não pode
 * depender de uma entrega nova.
 *
 * ⚠️ Banco ainda sem a 0259 (o código chega antes da migração — CLAUDE.md §0b):
 * devolve tudo vazio, e a tela simplesmente não mostra atalho nenhum. Nunca
 * derruba o Início.
 */
export async function carregarEnderecos(
  supabase: SupabaseClient
): Promise<Partial<Record<Ambiente, string | null>>> {
  const { data, error } = await supabase
    .from("environments")
    .select("key, url")
    .returns<{ key: Ambiente; url: string | null }[]>();
  if (error) return {};

  const enderecos: Partial<Record<Ambiente, string | null>> = {};
  for (const row of data ?? []) {
    if (AMBIENTES.includes(row.key)) enderecos[row.key] = enderecoValido(row.url);
  }
  return enderecos;
}

export type AmbienteConfigurado = {
  key: Ambiente;
  label: string;
  descricao: string | null;
  url: string | null;
};

/** A lista completa, para a tela de configuração dos endereços. */
export async function carregarAmbientes(
  supabase: SupabaseClient
): Promise<AmbienteConfigurado[]> {
  const { data } = await supabase
    .from("environments")
    .select("key, label, descricao, url")
    .order("sort_order")
    .returns<AmbienteConfigurado[]>();
  return data ?? [];
}
