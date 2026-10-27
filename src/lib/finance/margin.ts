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
  /** Material dos kits (o mesmo da Precificação). */
  materialCents?: number;
  /** Taxa estimada do meio de pagamento escolhido, em R$. */
  acquirerFeeCents?: number;
  /**
   * Pedido do dono (27/10/2026): a margem da venda é a MESMA conta da
   * Precificação — também a hora de cadeira, o laboratório e o que sai do
   * preço em percentual (imposto + taxa média do pagamento).
   */
  chairCents?: number;
  labCents?: number;
  /** Imposto + taxa média (%), sobre o preço negociado. */
  proportionalPercent?: number;
};

export type MarginResult = {
  priceCents: number;
  payoutCents: number;
  materialCents: number;
  acquirerFeeCents: number;
  chairCents: number;
  labCents: number;
  /** Imposto + taxa média em R$ (o percentual aplicado ao preço). */
  proportionalCents: number;
  costCents: number;
  marginCents: number;
  /** Sobre o preço. Zero quando o preço é zero (nada a distribuir). */
  marginPercent: number;
  /** Abaixo do mínimo configurado — só um aviso. */
  belowMinimum: boolean;
  /** Margem negativa: a venda dá prejuízo direto. */
  negative: boolean;
  /**
   * Nenhum material entrou (nenhum procedimento com kit). A tela precisa DIZER
   * isso — margem incompleta apresentada como completa é pior que nenhuma.
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
  const chair = Math.max(0, Math.round(input.chairCents ?? 0));
  const lab = Math.max(0, Math.round(input.labCents ?? 0));
  // Sobre o PREÇO, como na Precificação (`simulatePrice`): é o que faz o
  // desconto cortar o imposto junto.
  const proportional = roundHalfUp((price * Math.max(0, input.proportionalPercent ?? 0)) / 100);

  const cost = payout + material + fee + chair + lab + proportional;
  const margin = price - cost;
  const percent = price > 0 ? roundHalfUp((margin * 10000) / price) / 100 : 0;

  return {
    priceCents: price,
    payoutCents: payout,
    materialCents: material,
    acquirerFeeCents: fee,
    chairCents: chair,
    labCents: lab,
    proportionalCents: proportional,
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
export type CustoDoItem = {
  procedureId: string | null;
  quantidade: number;
  /** Minutos de cadeira do item (o planejado; sem ele, o do cadastro × quantidade). */
  minutos: number;
};

/**
 * O custo direto dos itens de uma venda, pelas MESMAS fontes da Precificação:
 * a hora de cadeira da unidade (`cost_settings_for`) e o material e o
 * laboratório de cada procedimento (`material_costs_for_clinic`), vezes a
 * quantidade. A cadeira é arredondada uma vez, sobre o total de minutos.
 */
export function custoDiretoDosItens(
  itens: CustoDoItem[],
  ctx: {
    horaDeCadeiraCents: number;
    materialDe: (procedureId: string) => { materialCents: number; labCents: number } | undefined;
  }
): { chairCents: number; materialCents: number; labCents: number; minutos: number } {
  let minutos = 0;
  let materialCents = 0;
  let labCents = 0;
  for (const i of itens) {
    const q = Math.max(1, Math.round(i.quantidade || 1));
    minutos += Math.max(0, i.minutos || 0);
    const m = i.procedureId ? ctx.materialDe(i.procedureId) : undefined;
    if (m) {
      materialCents += m.materialCents * q;
      labCents += m.labCents * q;
    }
  }
  return {
    chairCents: roundHalfUp((Math.max(0, ctx.horaDeCadeiraCents) * minutos) / 60),
    materialCents,
    labCents,
    minutos,
  };
}

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
