// Os custos da MARGEM DA VENDA (negociação e venda direta) — pedido do dono,
// 27/10/2026: "a negociação deve contar a hora de cadeira e o imposto", e com
// a decisão de igualar à Precificação: cadeira, material e laboratório (dos
// kits), repasse e imposto + taxa média sobre o preço.
//
// As fontes são as MESMAS da Precificação (`cost_settings_for` e
// `material_costs_for_clinic`), para a margem mínima — que é uma só, a do
// alerta (`commercial_rules.min_margin_percent`) — valer a mesma coisa nas
// duas telas. Esta parte é pura (o painel usa no navegador); a leitura do
// banco mora em `custos-da-margem-db.ts`.

import { custoDiretoDosItens } from "./margin";

export type CustosDaMargem = {
  /** Hora de cadeira da unidade (cascata rede → unidade). */
  horaDeCadeiraCents: number;
  /** Imposto + taxa média do pagamento (%), sobre o preço. */
  proportionalPercent: number;
  /** Cada item da venda: o procedimento, a quantidade e os minutos de cadeira. */
  porItem: Record<string, { procedureId: string | null; quantidade: number; minutos: number }>;
  /** Material e laboratório de cada procedimento, por unidade. */
  materialPorProcedimento: Record<string, { materialCents: number; labCents: number }>;
};

/** Os minutos de cadeira de um item: o planejado; sem ele, o do cadastro × quantidade. */
export function minutosDoItem(
  minutosPlanejados: number | null,
  minutosDoCadastro: number | null,
  quantidade: number
): number {
  if (minutosPlanejados != null && minutosPlanejados > 0) return minutosPlanejados;
  return Math.max(0, minutosDoCadastro ?? 0) * Math.max(1, Math.round(quantidade || 1));
}

/**
 * Os custos dos itens escolhidos (na negociação: os ACEITOS — a compra parcial
 * tira o custo do que saiu). Nulo = os custos não foram lidos.
 */
export function custosDosItensAceitos(
  c: CustosDaMargem | null,
  itemIds: string[]
): { chairCents: number; materialCents: number; labCents: number; proportionalPercent: number } | null {
  if (!c) return null;
  const itens = itemIds
    .map((id) => c.porItem[id])
    .filter((i): i is CustosDaMargem["porItem"][string] => Boolean(i));
  const d = custoDiretoDosItens(itens, {
    horaDeCadeiraCents: c.horaDeCadeiraCents,
    materialDe: (procedureId) => c.materialPorProcedimento[procedureId],
  });
  return {
    chairCents: d.chairCents,
    materialCents: d.materialCents,
    labCents: d.labCents,
    proportionalPercent: c.proportionalPercent,
  };
}
