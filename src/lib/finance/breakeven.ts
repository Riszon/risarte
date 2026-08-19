// FIN6.3 — PONTO DE EQUILÍBRIO.
//
// "Quanto preciso faturar para não dar prejuízo?" A conta é simples e a
// armadilha também: ela depende inteiramente de separar custo que ACOMPANHA o
// faturamento (material, repasse, taxa do cartão, imposto) de custo que existe
// mesmo com a cadeira vazia (aluguel, salário, contabilidade).
//
// Essa separação NÃO mora aqui: mora no plano de contas (`cost_behavior`),
// onde o dono pode corrigir. Margem calculada sobre rótulo que ninguém pode
// mudar vira número errado com cara de oficial.
//
// Dinheiro em centavos; percentuais como fração (0.62 = 62%).

export type BreakevenRole =
  | "receita"
  | "deducao"
  | "variavel"
  | "fixo"
  | "depreciacao"
  | "receita_financeira"
  | "fora";

export type BreakevenLine = {
  accountCode: string;
  accountName: string;
  role: BreakevenRole;
  /** Sinal pela direção, como na DRE: entrada soma, saída subtrai. */
  amountCents: number;
};

export type Breakeven = {
  receitaBrutaCents: number;
  /** Negativo. */
  deducoesCents: number;
  receitaLiquidaCents: number;
  /** Negativo. */
  variaveisCents: number;
  /** Negativo. */
  fixosCents: number;
  /** Negativo. */
  depreciacaoCents: number;
  receitaFinanceiraCents: number;
  /** Receita líquida − custos variáveis: o que sobra para pagar a estrutura. */
  margemContribuicaoCents: number;
  /** Fração de 0 a 1. `null` quando não houve faturamento no período. */
  margemPercent: number | null;
  /** Positivo: fixos + depreciação − receita financeira. */
  custoFixoTotalCents: number;
  /** Positivo: o mesmo, sem depreciação — o que precisa sair do bolso. */
  custoFixoCaixaCents: number;
  /** Faturamento que zera o resultado. `null` quando não é calculável. */
  pontoEquilibrioCents: number | null;
  /** Faturamento que zera o CAIXA (ignora a depreciação). */
  pontoEquilibrioCaixaCents: number | null;
  /** Quanto o faturamento pode cair antes de virar prejuízo. */
  margemSegurancaCents: number | null;
  margemSegurancaPercent: number | null;
  /** Margem de contribuição − custo fixo total. Bate com o lucro da DRE. */
  resultadoCents: number;
  /**
   * A margem de contribuição é zero ou negativa: cada real faturado piora o
   * resultado, e NÃO EXISTE faturamento que resolva. Mostrar um ponto de
   * equilíbrio aqui (a conta daria um número negativo ou gigante) seria pior
   * do que não mostrar nada.
   */
  semSolucao: boolean;
  lines: BreakevenLine[];
};

const sumRole = (lines: BreakevenLine[], role: BreakevenRole): number =>
  lines.reduce((s, l) => (l.role === role ? s + l.amountCents : s), 0);

export function buildBreakeven(lines: BreakevenLine[]): Breakeven {
  const receitaBrutaCents = sumRole(lines, "receita");
  const deducoesCents = sumRole(lines, "deducao");
  const variaveisCents = sumRole(lines, "variavel");
  const fixosCents = sumRole(lines, "fixo");
  const depreciacaoCents = sumRole(lines, "depreciacao");
  const receitaFinanceiraCents = sumRole(lines, "receita_financeira");

  const receitaLiquidaCents = receitaBrutaCents + deducoesCents;
  const margemContribuicaoCents = receitaLiquidaCents + variaveisCents;

  // Custo fixo é magnitude positiva; a receita financeira abate porque também
  // ajuda a pagar a estrutura (não é faturamento, então não entra na base).
  const custoFixoTotalCents = Math.round(
    -fixosCents - depreciacaoCents - receitaFinanceiraCents
  );
  const custoFixoCaixaCents = Math.round(
    -fixosCents - receitaFinanceiraCents
  );

  const margemPercent =
    receitaLiquidaCents > 0
      ? margemContribuicaoCents / receitaLiquidaCents
      : null;

  const semSolucao = margemPercent === null || margemContribuicaoCents <= 0;

  const ponto = (fixo: number): number | null =>
    semSolucao || margemPercent === null || margemPercent <= 0
      ? null
      : Math.round(fixo / margemPercent);

  const pontoEquilibrioCents = ponto(custoFixoTotalCents);
  const pontoEquilibrioCaixaCents = ponto(custoFixoCaixaCents);

  const margemSegurancaCents =
    pontoEquilibrioCents === null
      ? null
      : receitaLiquidaCents - pontoEquilibrioCents;
  const margemSegurancaPercent =
    margemSegurancaCents === null || receitaLiquidaCents <= 0
      ? null
      : margemSegurancaCents / receitaLiquidaCents;

  return {
    receitaBrutaCents,
    deducoesCents,
    receitaLiquidaCents,
    variaveisCents,
    fixosCents,
    depreciacaoCents,
    receitaFinanceiraCents,
    margemContribuicaoCents,
    margemPercent,
    custoFixoTotalCents,
    custoFixoCaixaCents,
    pontoEquilibrioCents,
    pontoEquilibrioCaixaCents,
    margemSegurancaCents,
    margemSegurancaPercent,
    resultadoCents: margemContribuicaoCents - custoFixoTotalCents,
    semSolucao,
    lines,
  };
}

/**
 * O dia em que o faturamento do período passa do ponto de equilíbrio, no ritmo
 * médio do próprio período.
 *
 * É uma régua, não uma previsão: o faturamento não é uniforme (segunda rende
 * menos que sexta). Serve para responder "passei do ponto no dia 12 ou no dia
 * 28?", que é uma diferença enorme de folga com o mesmo lucro no fim.
 */
export function breakevenDay(input: {
  receitaLiquidaCents: number;
  pontoEquilibrioCents: number | null;
  /** Dias do período. */
  days: number;
}): number | null {
  const { receitaLiquidaCents, pontoEquilibrioCents, days } = input;
  if (pontoEquilibrioCents === null || days <= 0) return null;
  if (receitaLiquidaCents <= 0) return null;
  const perDay = receitaLiquidaCents / days;
  if (perDay <= 0) return null;
  const day = Math.ceil(pontoEquilibrioCents / perDay);
  // Além do período: o ponto não foi atingido, e dizer "dia 47" seria pior que
  // dizer nada.
  return day > days ? null : Math.max(1, day);
}

/** Quantos dias tem o intervalo, inclusive nas duas pontas. */
export function daysInPeriod(from: string, to: string): number {
  const d = (iso: string) => {
    const [y, m, dd] = iso.split("-").map(Number);
    return Date.UTC(y, (m ?? 1) - 1, dd ?? 1);
  };
  const diff = (d(to) - d(from)) / 86_400_000;
  return diff < 0 ? 0 : Math.round(diff) + 1;
}
