import { describe, expect, it } from "vitest";
import {
  breakevenDay,
  buildBreakeven,
  daysInPeriod,
  type BreakevenLine,
} from "@/lib/finance/breakeven";
import { buildBridge, type BridgeRow } from "@/lib/finance/bridge";

const line = (
  code: string,
  role: BreakevenLine["role"],
  cents: number
): BreakevenLine => ({
  accountCode: code,
  accountName: code,
  role,
  amountCents: cents,
});

describe("ponto de equilíbrio", () => {
  // Faturou 100.000; imposto 6.000; variáveis 34.000; fixos 40.000.
  // RL = 94.000 · MC = 60.000 · MC% = 63,83% · PE = 40.000 / 0,6383 = 62.667
  const base = [
    line("1.1.01", "receita", 100_000),
    line("1.9.01", "deducao", -6_000),
    line("2.1.01", "variavel", -34_000),
    line("3.2.01", "fixo", -40_000),
  ];

  it("calcula margem de contribuição e ponto de equilíbrio", () => {
    const b = buildBreakeven(base);
    expect(b.receitaLiquidaCents).toBe(94_000);
    expect(b.margemContribuicaoCents).toBe(60_000);
    expect(b.margemPercent).toBeCloseTo(0.6383, 4);
    expect(b.pontoEquilibrioCents).toBe(62_667);
    expect(b.resultadoCents).toBe(20_000);
    expect(b.semSolucao).toBe(false);
  });

  it("a margem de segurança diz quanto o faturamento pode cair", () => {
    const b = buildBreakeven(base);
    expect(b.margemSegurancaCents).toBe(94_000 - 62_667);
    expect(b.margemSegurancaPercent).toBeCloseTo(0.3333, 3);
  });

  it("depreciação separa o ponto contábil do ponto de CAIXA", () => {
    const b = buildBreakeven([...base, line("5.2.01", "depreciacao", -6_000)]);
    // O contábil sobe (fixo maior); o de caixa fica onde estava.
    expect(b.custoFixoTotalCents).toBe(46_000);
    expect(b.custoFixoCaixaCents).toBe(40_000);
    expect(b.pontoEquilibrioCents).toBe(72_067);
    expect(b.pontoEquilibrioCaixaCents).toBe(62_667);
    // Comprar a cadeira não muda o que precisa sair do bolso este mês.
    expect(b.pontoEquilibrioCaixaCents).toBeLessThan(b.pontoEquilibrioCents!);
  });

  it("receita financeira abate o custo fixo, não infla a receita", () => {
    const b = buildBreakeven([
      ...base,
      line("4.1.01", "receita_financeira", 4_000),
    ]);
    expect(b.receitaLiquidaCents).toBe(94_000);
    expect(b.custoFixoTotalCents).toBe(36_000);
    expect(b.pontoEquilibrioCents).toBe(56_400);
  });

  it("margem de contribuição negativa não tem ponto de equilíbrio", () => {
    // Os variáveis comem mais do que a receita: faturar mais só piora.
    const b = buildBreakeven([
      line("1.1.01", "receita", 100_000),
      line("2.1.01", "variavel", -110_000),
      line("3.2.01", "fixo", -40_000),
    ]);
    expect(b.semSolucao).toBe(true);
    expect(b.pontoEquilibrioCents).toBeNull();
    expect(b.margemSegurancaCents).toBeNull();
  });

  it("período sem faturamento não divide por zero", () => {
    const b = buildBreakeven([line("3.2.01", "fixo", -40_000)]);
    expect(b.margemPercent).toBeNull();
    expect(b.pontoEquilibrioCents).toBeNull();
    expect(b.resultadoCents).toBe(-40_000);
  });

  it("conta fora da estrutura não entra em nenhum total", () => {
    const b = buildBreakeven([...base, line("9.9.99", "fora", -50_000)]);
    expect(b.resultadoCents).toBe(20_000);
  });
});

describe("o dia da virada", () => {
  it("aponta o dia do mês em que o faturamento passou do ponto", () => {
    // 62.667 de ponto, 94.000 em 31 dias = 3.032/dia → dia 21.
    expect(
      breakevenDay({
        receitaLiquidaCents: 94_000,
        pontoEquilibrioCents: 62_667,
        days: 31,
      })
    ).toBe(21);
  });

  it("não inventa dia quando o ponto não foi atingido", () => {
    expect(
      breakevenDay({
        receitaLiquidaCents: 30_000,
        pontoEquilibrioCents: 62_667,
        days: 31,
      })
    ).toBeNull();
  });

  it("sem ponto ou sem faturamento, não há dia", () => {
    expect(
      breakevenDay({
        receitaLiquidaCents: 94_000,
        pontoEquilibrioCents: null,
        days: 31,
      })
    ).toBeNull();
    expect(
      breakevenDay({
        receitaLiquidaCents: 0,
        pontoEquilibrioCents: 10_000,
        days: 31,
      })
    ).toBeNull();
  });

  it("conta os dias do período nas duas pontas", () => {
    expect(daysInPeriod("2026-08-01", "2026-08-31")).toBe(31);
    expect(daysInPeriod("2026-08-19", "2026-08-19")).toBe(1);
    expect(daysInPeriod("2026-08-31", "2026-08-01")).toBe(0);
  });
});

describe("ponte lucro × caixa", () => {
  const row = (
    side: BridgeRow["side"],
    code: string,
    cents: number
  ): BridgeRow => ({
    side,
    accountCode: code,
    accountName: code,
    sourceType: "x",
    amountCents: cents,
  });

  it("fecha exatamente: lucro − só competência + só caixa = caixa", () => {
    const b = buildBridge([
      row("lucro", "", 20_000),
      // Vendeu e não recebeu: sai do caminho.
      row("dre_only", "1.1.01", 30_000),
      // Depreciação: está no lucro e não saiu do bolso — volta.
      row("dre_only", "5.2.01", -5_000),
      // Recebeu venda de mês anterior: entra.
      row("cash_only", "1.1.01", 12_000),
      // Comprou uma cadeira: saiu dinheiro e não é despesa.
      row("cash_only", "5.1.01", -8_000),
      row("caixa", "", 20_000 - 30_000 + 5_000 + 12_000 - 8_000),
    ]);
    expect(b.lucroCents).toBe(20_000);
    expect(b.caixaCents).toBe(-1_000);
    expect(b.residualCents).toBe(0);
  });

  it("dá nome a cada diferença, sem balde 'outros'", () => {
    const b = buildBridge([
      row("lucro", "", 0),
      row("dre_only", "5.2.01", -5_000),
      row("dre_only", "1.1.02", 10_000),
      row("dre_only", "3.2.01", -2_000),
      row("cash_only", "5.4.01", -7_000),
      row("caixa", "", 0),
    ]);
    const keys = b.steps.map((s) => s.key).sort();
    expect(keys).toEqual(
      ["depreciacao", "despesas_a_pagar", "distribuicao", "vendas_a_receber"].sort()
    );
    const dep = b.steps.find((s) => s.key === "depreciacao");
    // Depreciação NEGATIVA no lucro volta POSITIVA no caminho para o caixa.
    expect(dep?.amountCents).toBe(5_000);
  });

  it("denuncia lançamento não classificado em vez de esconder", () => {
    const b = buildBridge([
      row("lucro", "", 10_000),
      row("dre_only", "1.1.01", 4_000),
      // O caixa não bate com o caminho: falta explicação de R$ 3,00.
      row("caixa", "", 6_300),
    ]);
    expect(b.residualCents).toBe(300);
  });

  it("soma contas repetidas dentro do mesmo passo", () => {
    const b = buildBridge([
      row("lucro", "", 0),
      row("dre_only", "1.1.01", 1_000),
      row("dre_only", "1.1.02", 2_000),
      row("caixa", "", -3_000),
    ]);
    const step = b.steps.find((s) => s.key === "vendas_a_receber");
    expect(step?.amountCents).toBe(-3_000);
    expect(step?.details).toHaveLength(2);
    expect(b.residualCents).toBe(0);
  });
});
