import "server-only";

import type { empresarialDb } from "./db";
import {
  COLUNAS_DO_VALOR_DA_PROPOSTA,
  valorDaPropostaGravada,
  type PropostaGravada,
} from "./valor-da-proposta";

type Db = Awaited<ReturnType<typeof empresarialDb>>;

/**
 * O valor de cada proposta com preço gravado, por lead (OC-00011).
 *
 * A RLS decide o que cada consultor enxerga. Erro de leitura não derruba o
 * funil: ele cai no valor estimado e o motivo fica no log.
 */
export async function valoresDasPropostas(db: Db): Promise<Map<string, number>> {
  const [{ data: propostas, error: erroP }, { data: faixas, error: erroF }] = await Promise.all([
    db
      .from("lead_qualification")
      .select(COLUNAS_DO_VALOR_DA_PROPOSTA)
      .returns<(PropostaGravada & { lead_id: string })[]>(),
    db
      .from("lead_price_tiers")
      .select("lead_id, min_quantity, price_cents")
      .returns<{ lead_id: string; min_quantity: number; price_cents: number }[]>(),
  ]);
  const valores = new Map<string, number>();
  if (erroP || erroF) {
    console.error("valores das propostas:", erroP?.message ?? erroF?.message);
    return valores;
  }
  for (const q of propostas ?? []) {
    const v = valorDaPropostaGravada(
      q,
      (faixas ?? [])
        .filter((f) => f.lead_id === q.lead_id)
        .map((f) => ({ minQuantity: f.min_quantity, priceCents: f.price_cents }))
    );
    if (v != null) valores.set(q.lead_id, v);
  }
  return valores;
}
