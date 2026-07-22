import { describe, expect, it } from "vitest";
import {
  budgetTotalCents,
  formatBRL,
  formatMinutes,
  intervalSummary,
  parseBRLToCents,
  resolveProcedurePrices,
  type BudgetItem,
  type Procedure,
} from "@/lib/pricing";

// Dinheiro é sempre em CENTAVOS (inteiro) — nunca float. Estes testes travam a
// conversão pt-BR e o preço em cascata (padrão da rede → ajuste da unidade).

const NBSP = " "; // Intl usa espaço não-quebrável entre "R$" e o número.

describe("formatBRL", () => {
  it("formata centavos em reais pt-BR", () => {
    expect(formatBRL(123456)).toBe(`R$${NBSP}1.234,56`);
    expect(formatBRL(8000)).toBe(`R$${NBSP}80,00`);
  });
  it("zero e valores vazios", () => {
    expect(formatBRL(0)).toBe(`R$${NBSP}0,00`);
  });
});

describe("parseBRLToCents", () => {
  it("aceita os formatos comuns de digitação", () => {
    expect(parseBRLToCents("1.234,56")).toBe(123456);
    expect(parseBRLToCents("R$ 80,00")).toBe(8000);
    expect(parseBRLToCents("80")).toBe(8000);
    expect(parseBRLToCents("0,5")).toBe(50);
  });
  it("rejeita entrada inválida ou negativa", () => {
    expect(parseBRLToCents("")).toBeNull();
    expect(parseBRLToCents("abc")).toBeNull();
    expect(parseBRLToCents("-5")).toBeNull();
  });
});

describe("formatMinutes", () => {
  it("minutos, horas cheias e horas quebradas", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(90)).toBe("1h30");
    expect(formatMinutes(125)).toBe("2h05");
  });
});

describe("intervalSummary", () => {
  it("sem intervalos = vazio", () => {
    expect(intervalSummary([{ minIntervalDays: null }, {}])).toBe("");
  });
  it("intervalo único", () => {
    expect(
      intervalSummary([{ minIntervalDays: null }, { minIntervalDays: 15 }])
    ).toBe("a cada 15 dias");
  });
  it("intervalos variados = faixa mín–máx", () => {
    expect(
      intervalSummary([
        { minIntervalDays: 15 },
        { minIntervalDays: 90 },
        { minIntervalDays: 30 },
      ])
    ).toBe("intervalos 15–90 dias");
  });
});

const proc = (id: string, defaultPriceCents: number): Procedure => ({
  id,
  code: null,
  tussCode: null,
  name: `Proc ${id}`,
  specialty: null,
  defaultPriceCents,
  minPriceCents: null,
  maxPriceCents: null,
  commissionPercent: 0,
  commissionFixedCents: 0,
  pillar: null,
  estimatedMinutes: null,
  isActive: true,
});

describe("resolveProcedurePrices (cascata rede → unidade)", () => {
  it("o ajuste da unidade sobrescreve o padrão da rede", () => {
    const priced = resolveProcedurePrices(
      [proc("a", 10000), proc("b", 20000)],
      [{ procedureId: "b", priceCents: 15000 }]
    );
    expect(priced.find((p) => p.id === "a")?.effectivePriceCents).toBe(10000);
    expect(priced.find((p) => p.id === "b")?.effectivePriceCents).toBe(15000);
  });
});

describe("budgetTotalCents", () => {
  const item = (quantity: number, unitPriceCents: number): BudgetItem => ({
    id: "x",
    procedureId: null,
    description: "item",
    quantity,
    unitPriceCents,
    plannedSessions: null,
    plannedMinutes: null,
    stageId: null,
    suggestedProviderId: null,
  });

  it("soma quantidade × preço unitário", () => {
    expect(budgetTotalCents([item(2, 5000), item(1, 12345)])).toBe(22345);
  });
  it("orçamento vazio = 0", () => {
    expect(budgetTotalCents([])).toBe(0);
  });
});
