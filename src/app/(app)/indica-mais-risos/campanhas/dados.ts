import "server-only";
import { indicaDb } from "@/lib/indica/db";
import type { CampanhaStatus, PublicoCampanha, RegrasCampanha } from "@/lib/indica/campanhas";

export type Campanha = {
  id: string;
  nome: string;
  descricao: string | null;
  modelo: string | null;
  escopo: "rede" | "unidades";
  unidades: string[];
  publico: PublicoCampanha;
  especialidade: string | null;
  inicio: string;
  fim: string;
  regras: RegrasCampanha;
  beneficio_indicado: { descricao?: string } | null;
  orcamento_max_centavos: number | null;
  status: CampanhaStatus;
  regulamento_md: string | null;
  versao: number;
  alerta_orcamento_em: string | null;
  orcamento_esgotado_em: string | null;
  criado_em: string;
};

export const CAMPOS_CAMPANHA =
  "id, nome, descricao, modelo, escopo, unidades, publico, especialidade, inicio, fim, regras, beneficio_indicado, orcamento_max_centavos, status, regulamento_md, versao, alerta_orcamento_em, orcamento_esgotado_em, criado_em";

export type Consumo = {
  riso_coins: number;
  custo_centavos: number;
  orcamento_max_centavos: number | null;
  percentual: number | null;
};

/** Consumo de cada campanha (Riso Coins das indicações dela + marcos). */
export async function consumos(ids: string[]): Promise<Map<string, Consumo>> {
  const db = await indicaDb();
  const pares = await Promise.all(
    ids.map(async (id) => {
      const { data, error } = await db.rpc("campanha_consumo", { p_campanha_id: id });
      if (error) console.error("campanha_consumo:", error.message);
      return [id, (data as Consumo | null) ?? null] as const;
    })
  );
  return new Map(pares.filter((p): p is readonly [string, Consumo] => p[1] !== null));
}
