import { describe, expect, it } from "vitest";
import {
  buildConsolidated,
  networkTotals,
  unitMargin,
  versusAverage,
  type ConsolidatedLine,
  type UnitSummary,
} from "@/lib/finance/consolidation";

const line = (
  accountCode: string,
  block: string,
  amountCents: number,
  eliminatedCents = 0
): ConsolidatedLine => ({
  accountCode,
  accountName: accountCode,
  block,
  amountCents,
  eliminatedCents,
});

describe("a demonstração consolidada", () => {
  it("o que foi eliminado não entra no resultado", () => {
    // A unidade própria pagou 1.000 de royalty; a franqueadora recebeu 1.000.
    // Os dois lados eliminados: nem faturamento a mais, nem custo a mais.
    const c = buildConsolidated([
      line("1.1.01", "receita_bruta", 500_000),
      line("1.3.01", "receita_bruta", 0, 100_000),
      line("2.6.01", "custos_diretos", 0, -100_000),
      line("3.2.01", "despesas_operacionais", -200_000),
    ]);
    expect(c.dre.receitaBrutaCents).toBe(500_000);
    expect(c.dre.lucroLiquidoCents).toBe(300_000);
  });

  it("o lucro seria o mesmo SEM eliminar — o que muda é o faturamento", () => {
    // É a razão de existir da eliminação, e vale prender num teste.
    const semEliminar = buildConsolidated([
      line("1.1.01", "receita_bruta", 500_000),
      line("1.3.01", "receita_bruta", 100_000),
      line("2.6.01", "custos_diretos", -100_000),
      line("3.2.01", "despesas_operacionais", -200_000),
    ]);
    expect(semEliminar.dre.lucroLiquidoCents).toBe(300_000);
    // Mesmo lucro, faturamento inflado em 100.000.
    expect(semEliminar.dre.receitaBrutaCents).toBe(600_000);
  });

  it("soma o total eliminado com sinal", () => {
    const c = buildConsolidated([
      line("1.3.01", "receita_bruta", 0, 100_000),
      line("2.6.01", "custos_diretos", 0, -100_000),
    ]);
    // Receita e despesa se anulam: é a prova de que o par estava completo.
    expect(c.eliminatedCents).toBe(0);
  });

  it("aponta as contas que sumiram inteiras", () => {
    const c = buildConsolidated([
      line("1.1.01", "receita_bruta", 500_000),
      line("1.3.01", "receita_bruta", 0, 100_000),
    ]);
    expect(c.fullyEliminated).toEqual(["1.3.01"]);
  });

  it("sem eliminação nenhuma, nada é apontado", () => {
    const c = buildConsolidated([line("1.1.01", "receita_bruta", 500_000)]);
    expect(c.eliminatedCents).toBe(0);
    expect(c.fullyEliminated).toEqual([]);
  });
});

describe("as unidades lado a lado", () => {
  const unit = (
    name: string,
    gross: number,
    net: number,
    result: number,
    ownership: "own" | "franchised" = "franchised"
  ): UnitSummary => ({
    clinicId: name,
    clinicName: name,
    ownership,
    grossRevenueCents: gross,
    netRevenueCents: net,
    resultCents: result,
  });

  const units = [
    unit("A", 1_000_000, 900_000, 100_000),
    unit("B", 600_000, 550_000, -50_000),
    unit("C", 200_000, 190_000, 10_000, "own"),
  ];

  it("soma para comparar, e conta quantas são próprias", () => {
    const t = networkTotals(units);
    expect(t.units).toBe(3);
    expect(t.ownUnits).toBe(1);
    expect(t.grossRevenueCents).toBe(1_800_000);
    expect(t.averageGrossCents).toBe(600_000);
  });

  it("rede vazia não divide por zero", () => {
    const t = networkTotals([]);
    expect(t.averageGrossCents).toBe(0);
    expect(versusAverage(units[0], t)).toBeNull();
  });

  it("posiciona a unidade contra a média", () => {
    const t = networkTotals(units);
    expect(versusAverage(units[0], t)).toBeCloseTo(0.6667, 3);
    expect(versusAverage(units[1], t)).toBe(0);
    expect(versusAverage(units[2], t)).toBeCloseTo(-0.6667, 3);
  });

  it("margem sobre a receita líquida, e nula sem receita", () => {
    expect(unitMargin(units[0])).toBeCloseTo(0.1111, 4);
    expect(unitMargin(units[1])).toBeCloseTo(-0.0909, 4);
    expect(unitMargin(unit("D", 0, 0, -5_000))).toBeNull();
  });
});
