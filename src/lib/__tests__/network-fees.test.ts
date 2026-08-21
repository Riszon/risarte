import { describe, expect, it } from "vitest";
import {
  feeKind,
  feeLabel,
  ruleErrors,
  simulateMonth,
  splitAmountCents,
  totalFixedCents,
  totalPercent,
  type NetworkFeeRule,
} from "@/lib/finance/network-fees";

const rule = (
  fee: NetworkFeeRule["fee"],
  kind: NetworkFeeRule["kind"],
  percent: number,
  amountCents = 0,
  active = true
): NetworkFeeRule => ({
  fee,
  kind,
  percent,
  amountCents,
  dueDay: 10,
  active,
  isOverride: false,
  note: "",
});

describe("o valor de uma baixa", () => {
  it("percentual sobre o recebido, arredondando meio para cima", () => {
    // R$ 1.000,00 a 2,5% = R$ 25,00
    expect(splitAmountCents(100_000, rule("royalty", "percent", 2.5))).toBe(2_500);
    // R$ 333,33 a 2,5% = R$ 8,33325 → 8,33
    expect(splitAmountCents(33_333, rule("royalty", "percent", 2.5))).toBe(833);
  });

  it("taxa desligada não cobra nada", () => {
    expect(
      splitAmountCents(100_000, rule("royalty", "percent", 5, 0, false))
    ).toBe(0);
  });

  it("percentual zerado não gera linha de R$ 0,00", () => {
    expect(splitAmountCents(100_000, rule("royalty", "percent", 0))).toBe(0);
  });

  it("taxa fixa não incide sobre a baixa", () => {
    // A taxa de sistema é mensal: cobrá-la a cada recebimento multiplicaria
    // o valor pelo número de baixas do mês.
    expect(splitAmountCents(100_000, rule("sistema", "fixed", 0, 50_000))).toBe(0);
  });

  it("recebimento zero ou negativo não gera taxa", () => {
    expect(splitAmountCents(0, rule("royalty", "percent", 5))).toBe(0);
    expect(splitAmountCents(-100, rule("royalty", "percent", 5))).toBe(0);
  });
});

describe("o que incide sobre cada real", () => {
  const rules = [
    rule("royalty", "percent", 5),
    rule("fundo", "percent", 2),
    rule("planejamento", "percent", 3),
    rule("comercial", "percent", 4, 0, false), // desligada nesta unidade
    rule("sistema", "fixed", 0, 50_000),
    rule("sdr", "fixed", 0, 30_000),
  ];

  it("soma só os percentuais ligados", () => {
    expect(totalPercent(rules)).toBe(10);
  });

  it("soma só as fixas ligadas", () => {
    expect(totalFixedCents(rules)).toBe(80_000);
  });

  it("simula o mês somando as duas naturezas", () => {
    // Recebeu R$ 50.000: 10% = R$ 5.000, mais R$ 800 de fixas.
    const s = simulateMonth(rules, 5_000_000);
    expect(s.percentCents).toBe(500_000);
    expect(s.fixedCents).toBe(80_000);
    expect(s.totalCents).toBe(580_000);
  });

  it("mês sem receber ainda paga as fixas", () => {
    // É a diferença que o franqueado precisa enxergar antes de assinar.
    const s = simulateMonth(rules, 0);
    expect(s.percentCents).toBe(0);
    expect(s.totalCents).toBe(80_000);
  });
});

describe("validação da configuração", () => {
  it("recusa percentual fora da faixa", () => {
    expect(
      ruleErrors({ kind: "percent", percent: -1, amountCents: 0, dueDay: 10 })
    ).toHaveLength(1);
    expect(
      ruleErrors({ kind: "percent", percent: 101, amountCents: 0, dueDay: 10 })
    ).toHaveLength(1);
  });

  it("recusa vencimento depois do dia 28", () => {
    // Fevereiro existe: dia 30 não cai em fevereiro nenhum.
    expect(
      ruleErrors({ kind: "fixed", percent: 0, amountCents: 100, dueDay: 30 })
    ).toContain("O dia do vencimento precisa estar entre 1 e 28.");
    expect(
      ruleErrors({ kind: "fixed", percent: 0, amountCents: 100, dueDay: 28 })
    ).toHaveLength(0);
  });

  it("configuração válida não reclama", () => {
    expect(
      ruleErrors({ kind: "percent", percent: 5, amountCents: 0, dueDay: 10 })
    ).toEqual([]);
  });
});

describe("rótulos", () => {
  it("traduz e sabe a natureza de cada taxa", () => {
    expect(feeLabel("planejamento")).toBe("Centro de planejamento");
    expect(feeKind("sdr")).toBe("fixed");
    expect(feeKind("royalty")).toBe("percent");
    expect(feeLabel("desconhecida")).toBe("desconhecida");
  });
});
