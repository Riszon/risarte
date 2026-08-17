// A DRE — a montagem da estrutura, fora de qualquer tela.
//
// O banco agrega por conta; aqui a estrutura é montada, e é AQUI que mora o
// risco: qual bloco entra em qual subtotal, e em que ordem. Errar isso não
// quebra nada — só devolve um lucro errado com cara de certo.
//
// O SINAL JÁ VEM DA DIREÇÃO (entrada soma, saída subtrai), então cada subtotal
// é uma soma acumulada. Sem isso seria preciso manter uma tabela de "esta conta
// subtrai, aquela soma" em sincronia com o plano de contas — e ela ficaria
// desatualizada no dia em que alguém criasse uma conta nova.

import { roundHalfUp } from "./money";

export const DRE_BLOCKS = [
  "receita_bruta",
  "deducoes",
  "custos_diretos",
  "despesas_operacionais",
  "depreciacao",
  "resultado_financeiro",
] as const;

export type DreBlock = (typeof DRE_BLOCKS)[number];

export const BLOCK_LABELS: Record<DreBlock, string> = {
  receita_bruta: "Receita bruta",
  deducoes: "Deduções da receita",
  custos_diretos: "Custos diretos",
  despesas_operacionais: "Despesas operacionais",
  depreciacao: "Depreciação e baixa de bens",
  resultado_financeiro: "Resultado financeiro",
};

export type DreLine = {
  accountCode: string;
  accountName: string;
  block: string;
  amountCents: number;
};

export type DreSection = {
  block: DreBlock;
  label: string;
  totalCents: number;
  lines: DreLine[];
};

export type Dre = {
  sections: DreSection[];
  receitaBrutaCents: number;
  deducoesCents: number;
  receitaLiquidaCents: number;
  custosDiretosCents: number;
  lucroBrutoCents: number;
  despesasOperacionaisCents: number;
  ebitdaCents: number;
  depreciacaoCents: number;
  resultadoFinanceiroCents: number;
  lucroLiquidoCents: number;
};

/**
 * Monta a DRE a partir das linhas agregadas.
 *
 * A ordem dos subtotais é a estrutura do documento base e não é negociável:
 * receita líquida vem antes do custo direto, e o EBITDA antes da depreciação —
 * é o que permite comparar unidades e períodos falando a mesma língua.
 */
export function buildDre(lines: DreLine[]): Dre {
  const byBlock = new Map<DreBlock, DreLine[]>();
  for (const b of DRE_BLOCKS) byBlock.set(b, []);
  for (const line of lines) {
    const list = byBlock.get(line.block as DreBlock);
    // Linha fora da estrutura (conta de ativo, empréstimo) é ignorada de
    // propósito — ver o cabeçalho da migração 0225.
    if (list) list.push(line);
  }

  const total = (b: DreBlock) =>
    (byBlock.get(b) ?? []).reduce((s, l) => s + l.amountCents, 0);

  const receitaBruta = total("receita_bruta");
  const deducoes = total("deducoes");
  const receitaLiquida = receitaBruta + deducoes;
  const custos = total("custos_diretos");
  const lucroBruto = receitaLiquida + custos;
  const despesas = total("despesas_operacionais");
  const ebitda = lucroBruto + despesas;
  const depreciacao = total("depreciacao");
  const financeiro = total("resultado_financeiro");
  const lucroLiquido = ebitda + depreciacao + financeiro;

  return {
    sections: DRE_BLOCKS.map((b) => ({
      block: b,
      label: BLOCK_LABELS[b],
      totalCents: total(b),
      lines: (byBlock.get(b) ?? []).sort((a, c) =>
        a.accountCode.localeCompare(c.accountCode)
      ),
    })),
    receitaBrutaCents: receitaBruta,
    deducoesCents: deducoes,
    receitaLiquidaCents: receitaLiquida,
    custosDiretosCents: custos,
    lucroBrutoCents: lucroBruto,
    despesasOperacionaisCents: despesas,
    ebitdaCents: ebitda,
    depreciacaoCents: depreciacao,
    resultadoFinanceiroCents: financeiro,
    lucroLiquidoCents: lucroLiquido,
  };
}

/**
 * Análise vertical: a linha como % da RECEITA LÍQUIDA.
 *
 * Sobre a líquida, não a bruta — é o que sobra depois do imposto que de fato
 * paga os custos. Comparar custo com receita bruta faria toda unidade parecer
 * mais eficiente do que é, e o erro seria maior onde o imposto é maior.
 */
export function verticalPercent(
  amountCents: number,
  receitaLiquidaCents: number
): number | null {
  if (receitaLiquidaCents === 0) return null;
  return (
    roundHalfUp((Math.abs(amountCents) * 10000) / Math.abs(receitaLiquidaCents)) /
    100
  );
}

/** Variação contra o período anterior. */
export function variation(
  currentCents: number,
  previousCents: number
): { deltaCents: number; percent: number | null } {
  const delta = currentCents - previousCents;
  if (previousCents === 0) return { deltaCents: delta, percent: null };
  return {
    deltaCents: delta,
    percent: roundHalfUp((delta * 10000) / Math.abs(previousCents)) / 100,
  };
}

/**
 * O período imediatamente anterior, do MESMO tamanho.
 *
 * Comparar janeiro (31 dias) com fevereiro (28) sem isso mostraria uma queda de
 * 10% que é só calendário.
 */
export function previousPeriod(
  from: string,
  to: string
): { from: string; to: string } {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevStart), to: iso(prevEnd) };
}

/**
 * Margem líquida — o número que resume o mês.
 *
 * Devolve null sem receita: 0% diria "não sobrou nada", quando a verdade é
 * "não houve venda", e as duas coisas pedem decisões opostas.
 */
export function netMarginPercent(dre: Dre): number | null {
  if (dre.receitaLiquidaCents === 0) return null;
  return (
    roundHalfUp((dre.lucroLiquidoCents * 10000) / dre.receitaLiquidaCents) / 100
  );
}
