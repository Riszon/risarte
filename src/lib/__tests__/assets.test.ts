import { describe, expect, it } from "vitest";
import {
  assetErrors,
  bookValue,
  depreciationForMonth,
  depreciationSchedule,
  firstDepreciationMonth,
  isDepreciable,
  monthlyDepreciation,
} from "../finance/assets";

const cadeira = {
  costCents: 3_000_000, // R$ 30.000
  residualCents: 0,
  usefulLifeMonths: 120,
};

describe("depreciação linear", () => {
  it("a cadeira de R$ 30 mil custa R$ 250 por mês, não R$ 30 mil num mês", () => {
    // É a conta inteira do FIN6.0: comprar não é gastar.
    expect(monthlyDepreciation(cadeira)).toBe(25_000);
  });

  it("A ÚLTIMA PARCELA ABSORVE O RESÍDUO — a soma fecha exata", () => {
    // R$ 10.000 em 36 meses dá 277,7777... por mês. Se cada mês levasse o valor
    // arredondado, sobrariam centavos e o bem nunca zeraria no balanço.
    const asset = { costCents: 1_000_000, residualCents: 0, usefulLifeMonths: 36 };
    const parcels = depreciationSchedule(asset);
    expect(parcels.length).toBe(36);
    expect(parcels.reduce((s, p) => s + p, 0)).toBe(1_000_000);
    // O último mês é o que difere, absorvendo a diferença.
    expect(parcels[0]).toBe(27_778);
    expect(parcels[35]).not.toBe(parcels[0]);
  });

  it("NUNCA deprecia além do custo", () => {
    const asset = { costCents: 10_000, residualCents: 0, usefulLifeMonths: 3 };
    // Já depreciou quase tudo: o mês leva só o que falta.
    expect(depreciationForMonth(asset, 9_000)).toBe(1_000);
    // Totalmente depreciado para sozinho — despesa eterna de algo que já não
    // vale nada seria mentira no resultado de todo mês seguinte.
    expect(depreciationForMonth(asset, 10_000)).toBe(0);
    expect(depreciationForMonth(asset, 99_999)).toBe(0);
  });

  it("valor residual reduz a base, não o custo", () => {
    const asset = {
      costCents: 100_000,
      residualCents: 20_000,
      usefulLifeMonths: 8,
    };
    expect(monthlyDepreciation(asset)).toBe(10_000);
    // Depreciados R$ 800: o valor contábil ainda considera o custo cheio.
    expect(bookValue(asset, 80_000)).toBe(20_000);
  });

  it("valor contábil nunca fica negativo", () => {
    expect(bookValue(cadeira, 9_999_999)).toBe(0);
  });
});

describe("quando a depreciação começa", () => {
  it("no mês SEGUINTE à entrada em uso", () => {
    expect(firstDepreciationMonth("2026-03-10")).toBe("2026-04");
  });

  it("vira o ano corretamente", () => {
    expect(firstDepreciationMonth("2026-12-28")).toBe("2027-01");
  });

  it("a data de USO manda, não a da compra", () => {
    // Comprado em dezembro, instalado em fevereiro: só deprecia em março.
    expect(isDepreciable("2026-02-05", "2026-02")).toBe(false);
    expect(isDepreciable("2026-02-05", "2026-03")).toBe(true);
  });
});

describe("validação do cadastro", () => {
  it("entrar em uso antes de existir é erro de digitação", () => {
    expect(
      assetErrors({
        name: "Cadeira",
        costCents: 100,
        usefulLifeMonths: 120,
        acquisitionDate: "2026-05-10",
        inServiceDate: "2026-04-01",
      })
    ).toContain("A entrada em uso não pode ser anterior à aquisição.");
  });

  it("bem sem valor não passa", () => {
    expect(
      assetErrors({
        name: "Cadeira",
        costCents: null,
        usefulLifeMonths: 120,
        acquisitionDate: "2026-05-10",
        inServiceDate: "2026-05-10",
      })
    ).toContain("Informe o valor de aquisição.");
  });

  it("cadastro completo não reclama", () => {
    expect(
      assetErrors({
        name: "Cadeira odontológica",
        costCents: 3_000_000,
        usefulLifeMonths: 120,
        acquisitionDate: "2026-05-10",
        inServiceDate: "2026-06-01",
      })
    ).toEqual([]);
  });
});
