// O que as quatro visões da Auditoria têm em comum: as abas, o período, as
// pessoas (para o filtro e para trocar identificador por nome) e os formatos.

import { BRAZIL_TIME_ZONE, startOfTodayInBrazil } from "@/lib/dates";
import {
  clientesCitados,
  type Alteracao,
  type Nomes,
} from "@/lib/auditoria-alteracoes";

export const VISOES = ["alteracoes", "acoes", "acessos", "pessoa"] as const;
export type Visao = (typeof VISOES)[number];

export const VISAO_ROTULO: Record<Visao, string> = {
  alteracoes: "Alterações",
  acoes: "Ações",
  acessos: "Acessos",
  pessoa: "O dia de uma pessoa",
};

export const VISAO_EXPLICA: Record<Visao, string> = {
  alteracoes:
    "Tudo o que foi cadastrado, alterado ou excluído — com o conteúdo de antes e de depois. O banco registra sozinho, em todos os cadastros.",
  acoes:
    "O que cada pessoa fez nas telas: consultou uma ficha, exportou um relatório, entrou e saiu do sistema.",
  acessos:
    "Um registro por login: o dia, a hora em que entrou, como saiu, quanto tempo usou e quanto ficou parado.",
  pessoa:
    "Escolha uma pessoa e um dia para ver, em ordem, tudo o que ela fez: acessos, ações e alterações.",
};

export function lerVisao(v: unknown): Visao {
  return VISOES.includes(v as Visao) ? (v as Visao) : "alteracoes";
}

export const PERIODOS: Record<string, number | null> = {
  hoje: 0,
  "7d": 7,
  "30d": 30,
  tudo: null,
};

export function lerPeriodo(v: unknown, padrao = "7d"): string {
  return typeof v === "string" && v in PERIODOS ? v : padrao;
}

/** O começo do período, em instante — "hoje" é o dia BRASILEIRO. */
export function desde(periodo: string): string | null {
  const dias = PERIODOS[periodo];
  if (dias === null || dias === undefined) return null;
  const d = startOfTodayInBrazil();
  if (dias > 0) d.setDate(d.getDate() - dias);
  return d.toISOString();
}

export function texto(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

export function dataEHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function hora(iso: string, comSegundos = false): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    ...(comSegundos ? { second: "2-digit" } : {}),
  });
}

export const CLASSE_DO_SELECT =
  "h-9 max-w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** As pessoas e unidades que a página carrega uma vez e entrega às visões. */
export type Pessoas = {
  nomes: Nomes;
  /** Código do Risartano (RIS-…) de quem tem login. */
  codigoPorUsuario: Map<string, string>;
  opcoes: { value: string; label: string }[];
};

/** O endereço de uma visão, preservando o que foi pedido. */
export function enderecoDaVisao(
  visao: Visao,
  manter: Record<string, string | undefined> = {}
): string {
  const p = new URLSearchParams({ visao });
  for (const [k, v] of Object.entries(manter)) if (v) p.set(k, v);
  return `/admin/auditoria?${p.toString()}`;
}

/** O cliente do banco que a página abre uma vez e entrega às visões. */
export type Banco = Awaited<
  ReturnType<typeof import("@/lib/supabase/server").createClient>
>;

/**
 * Junta às pessoas os CLIENTES citados numa lista de alterações. Agendamento,
 * sessão e parcela não têm nome próprio: o que diz "qual registro" é de quem
 * são. Uma consulta só, pelos ids da lista (nunca a base inteira).
 */
export async function comClientes(
  supabase: Banco,
  pessoas: Pessoas,
  lista: Pick<Alteracao, "client_id">[]
): Promise<Pessoas> {
  const ids = clientesCitados(lista);
  if (ids.length === 0) return pessoas;
  const { data } = await supabase
    .from("clients")
    .select("id, code, full_name")
    .in("id", ids);
  const clientes = new Map<string, string>();
  for (const c of data ?? []) {
    clientes.set(c.id, [c.code, c.full_name].filter(Boolean).join(" · "));
  }
  return { ...pessoas, nomes: { ...pessoas.nomes, clientes } };
}
