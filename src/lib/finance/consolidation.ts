// FIN8.2 — CONSOLIDAÇÃO.
//
// Duas coisas que não podem se misturar:
//
//   • RESULTADO DO GRUPO = franqueadora + unidades PRÓPRIAS. O resultado de
//     quem é dono do negócio.
//   • FATURAMENTO DA REDE = todas as unidades, lado a lado, para comparar.
//     Faturamento de franqueada NUNCA entra no resultado da franqueadora — ela
//     ganha o royalty, não a receita da cadeira.
//
// A ELIMINAÇÃO não muda o lucro: quando uma unidade própria paga royalty à
// franqueadora, a despesa de lá e a receita de cá já se anulam ao somar. O que
// ela conserta é o FATURAMENTO — sem eliminar, o grupo apareceria faturando e
// gastando o mesmo valor a mais.

import { buildDre, type Dre, type DreLine } from "./dre";

export type ConsolidationScope = "grupo" | "rede";

export type ConsolidatedLine = DreLine & {
  /** Quanto desta conta era transferência dentro do grupo. */
  eliminatedCents: number;
};

export type Consolidated = {
  dre: Dre;
  lines: ConsolidatedLine[];
  /** Soma do que foi eliminado (com sinal). Zero quando não há grupo. */
  eliminatedCents: number;
  /** Contas cujo valor foi INTEIRAMENTE eliminado. */
  fullyEliminated: string[];
};

export function buildConsolidated(
  lines: ConsolidatedLine[]
): Consolidated {
  return {
    dre: buildDre(lines),
    lines,
    eliminatedCents: lines.reduce((s, l) => s + l.eliminatedCents, 0),
    fullyEliminated: lines
      .filter((l) => l.amountCents === 0 && l.eliminatedCents !== 0)
      .map((l) => l.accountCode),
  };
}

export type UnitSummary = {
  clinicId: string;
  clinicName: string;
  ownership: "own" | "franchised";
  grossRevenueCents: number;
  netRevenueCents: number;
  resultCents: number;
};

/** Margem líquida da unidade sobre a receita líquida. `null` sem receita. */
export function unitMargin(u: UnitSummary): number | null {
  if (u.netRevenueCents <= 0) return null;
  return u.resultCents / u.netRevenueCents;
}

export type NetworkTotals = {
  units: number;
  ownUnits: number;
  grossRevenueCents: number;
  netRevenueCents: number;
  resultCents: number;
  /** Faturamento médio por unidade — a régua para ler o ranking. */
  averageGrossCents: number;
};

/**
 * Os totais da REDE.
 *
 * É soma para comparar, não consolidação: aqui nada se elimina, e o número não
 * é o resultado de ninguém. Somá-lo ao da franqueadora é o erro que faz uma
 * rede parecer dez vezes maior do que é.
 */
export function networkTotals(units: UnitSummary[]): NetworkTotals {
  const gross = units.reduce((s, u) => s + u.grossRevenueCents, 0);
  return {
    units: units.length,
    ownUnits: units.filter((u) => u.ownership === "own").length,
    grossRevenueCents: gross,
    netRevenueCents: units.reduce((s, u) => s + u.netRevenueCents, 0),
    resultCents: units.reduce((s, u) => s + u.resultCents, 0),
    averageGrossCents: units.length > 0 ? Math.round(gross / units.length) : 0,
  };
}

/**
 * Quanto a unidade está acima ou abaixo da média da rede, em fração.
 *
 * Serve para ler o ranking sem depender do tamanho absoluto: uma unidade nova
 * faturando metade da média é uma informação; faturando R$ 40 mil, sozinho,
 * não é.
 */
export function versusAverage(
  u: UnitSummary,
  totals: NetworkTotals
): number | null {
  if (totals.averageGrossCents <= 0) return null;
  return u.grossRevenueCents / totals.averageGrossCents - 1;
}
