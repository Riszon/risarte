// FIN5 — a MARGEM da venda, ao vivo na negociação.
//
// Existe por causa de uma consequência do repasse fixo (briefing §RESOLVIDO):
// como o dentista recebe o mesmo valor independente do preço fechado, **cada
// real de desconto sai inteiro da margem da clínica**. Num plano com repasse
// alto, um desconto que parece pequeno pode zerar o resultado — e o consultor
// não tem como perceber isso de cabeça, no meio da conversa com o paciente.
//
// O alerta NÃO bloqueia. O teto de desconto já é a trava; isto aqui é
// informação para decidir. Travar duas vezes a mesma coisa só ensina a
// ignorar o aviso.

import { roundHalfUp } from "./money";

export type MarginInput = {
  /** Preço negociado (o que o cliente vai pagar). */
  priceCents: number;
  /** Repasse ao dentista — FIXO: não cai quando o preço cai. */
  payoutCents: number;
  /** Materiais e laboratório. Zero enquanto o Estoque não existir. */
  materialCents?: number;
  /** Taxa estimada do meio de pagamento escolhido. */
  acquirerFeeCents?: number;
};

export type MarginResult = {
  priceCents: number;
  payoutCents: number;
  materialCents: number;
  acquirerFeeCents: number;
  costCents: number;
  marginCents: number;
  /** Sobre o preço. Zero quando o preço é zero (nada a distribuir). */
  marginPercent: number;
  /** Abaixo do mínimo configurado — só um aviso. */
  belowMinimum: boolean;
  /** Margem negativa: a venda dá prejuízo direto. */
  negative: boolean;
  /**
   * Materiais ainda não entram (o módulo de Estoque vem depois do FIN5). A
   * tela precisa DIZER isso — margem incompleta apresentada como completa é
   * pior que margem nenhuma.
   */
  materialsPending: boolean;
};

export function computeMargin(
  input: MarginInput,
  minimumPercent: number | null = null
): MarginResult {
  const price = Math.max(0, Math.round(input.priceCents));
  const payout = Math.max(0, Math.round(input.payoutCents));
  const material = Math.max(0, Math.round(input.materialCents ?? 0));
  const fee = Math.max(0, Math.round(input.acquirerFeeCents ?? 0));

  const cost = payout + material + fee;
  const margin = price - cost;
  const percent = price > 0 ? roundHalfUp((margin * 10000) / price) / 100 : 0;

  return {
    priceCents: price,
    payoutCents: payout,
    materialCents: material,
    acquirerFeeCents: fee,
    costCents: cost,
    marginCents: margin,
    marginPercent: percent,
    belowMinimum:
      minimumPercent !== null && price > 0 && percent < minimumPercent,
    negative: margin < 0,
    materialsPending: material === 0,
  };
}

/**
 * Quanto de margem UM REAL de desconto custa.
 *
 * Com repasse fixo a resposta é sempre "um real" — mas dito assim, na tela,
 * o consultor entende por que 10% de desconto pode virar 30% da margem.
 */
export function marginLostByDiscount(input: {
  discountCents: number;
  marginBeforeDiscountCents: number;
}): { lostCents: number; percentOfMargin: number } {
  const lost = Math.max(0, Math.round(input.discountCents));
  const base = Math.max(0, Math.round(input.marginBeforeDiscountCents));
  return {
    lostCents: lost,
    percentOfMargin: base > 0 ? roundHalfUp((lost * 10000) / base) / 100 : 0,
  };
}
