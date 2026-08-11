import { describe, expect, it } from "vitest";
import {
  applyMovement,
  balanceAlerts,
  isInbound,
  kitCost,
  movementErrors,
  replayMovements,
  weightedAverage,
  type Balance,
} from "../stock";

describe("custo médio ponderado", () => {
  it("primeira entrada define o custo", () => {
    expect(weightedAverage(0, 0, 10, 500)).toBe(500);
  });

  it("pondera pela quantidade, não pela média das compras", () => {
    // 10 a R$ 5,00 + 90 a R$ 10,00. A média SIMPLES daria R$ 7,50 — e estaria
    // errada em 30%: quase tudo em estoque foi comprado a R$ 10,00.
    expect(weightedAverage(10, 500, 90, 1000)).toBe(950);
  });

  it("saldo negativo não pondera — a entrada vira o custo", () => {
    // Ponderar contra -5 unidades devolveria um custo sem significado.
    expect(weightedAverage(-5, 800, 10, 1000)).toBe(1000);
  });
});

describe("aplicar movimento", () => {
  it("entrada soma e recalcula o médio", () => {
    const r = applyMovement(
      { quantity: 10, avgCostCents: 500, minQuantity: 0 },
      { kind: "entrada", quantity: 10, unitCostCents: 700 }
    );
    expect(r.balance.quantity).toBe(20);
    expect(r.balance.avgCostCents).toBe(600);
    expect(r.unitCostCents).toBe(700);
    expect(r.totalCents).toBe(7000);
  });

  it("saída sai pelo médio VIGENTE e não mexe no médio", () => {
    const r = applyMovement(
      { quantity: 20, avgCostCents: 600, minQuantity: 0 },
      { kind: "consumo", quantity: 3 }
    );
    expect(r.balance.quantity).toBe(17);
    expect(r.balance.avgCostCents).toBe(600);
    expect(r.unitCostCents).toBe(600);
    expect(r.totalCents).toBe(1800);
  });

  it("comprar mais caro depois NÃO reescreve o consumo de ontem", () => {
    // A regra que o repasse ao dentista já seguia: o custo fica congelado no
    // movimento. Se recalculasse, o resultado do mês passado mudaria sozinho.
    const inicial: Balance = { quantity: 10, avgCostCents: 500, minQuantity: 0 };
    const consumo = applyMovement(inicial, { kind: "consumo", quantity: 2 });
    expect(consumo.unitCostCents).toBe(500);

    const compra = applyMovement(consumo.balance, {
      kind: "entrada",
      quantity: 10,
      unitCostCents: 900,
    });
    // A compra nova mudou o médio para frente...
    expect(compra.balance.avgCostCents).toBe(722);
    // ...mas o consumo já registrado continua valendo R$ 5,00 a unidade.
    expect(consumo.totalCents).toBe(1000);
  });

  it("saída NÃO é recusada por falta de saldo — fica negativo", () => {
    // Travar aqui seria travar atendimento por causa de cadastro.
    const r = applyMovement(
      { quantity: 1, avgCostCents: 400, minQuantity: 0 },
      { kind: "consumo", quantity: 5 }
    );
    expect(r.balance.quantity).toBe(-4);
  });

  it("entrada sem custo informado herda o médio", () => {
    const r = applyMovement(
      { quantity: 4, avgCostCents: 250, minQuantity: 0 },
      { kind: "entrada", quantity: 6 }
    );
    expect(r.balance.avgCostCents).toBe(250);
  });

  it("direção de cada tipo", () => {
    expect(isInbound("entrada")).toBe(true);
    expect(isInbound("ajuste_entrada")).toBe(true);
    expect(isInbound("transferencia_entrada")).toBe(true);
    expect(isInbound("consumo")).toBe(false);
    expect(isInbound("perda")).toBe(false);
    expect(isInbound("ajuste_saida")).toBe(false);
  });
});

describe("o saldo é projeção — dá para reconstruir", () => {
  it("refazer a série chega no mesmo saldo", () => {
    const b = replayMovements([
      { kind: "entrada", quantity: 100, unitCostCents: 300 },
      { kind: "consumo", quantity: 20 },
      { kind: "entrada", quantity: 100, unitCostCents: 500 },
      { kind: "perda", quantity: 5 },
      { kind: "ajuste_saida", quantity: 3 },
    ]);
    expect(b.quantity).toBe(172);
    // 80 a R$ 3,00 + 100 a R$ 5,00 = R$ 4,11 (ponderado, não R$ 4,00).
    expect(b.avgCostCents).toBe(411);
  });
});

describe("alertas do saldo", () => {
  it("negativo denuncia consumo sem entrada", () => {
    expect(
      balanceAlerts({ quantity: -2, avgCostCents: 100, minQuantity: 5 })
    ).toEqual(["negativo"]);
  });

  it("no mínimo já avisa (não espera furar)", () => {
    expect(
      balanceAlerts({ quantity: 5, avgCostCents: 100, minQuantity: 5 })
    ).toEqual(["abaixo_minimo"]);
  });

  it("saldo sem custo é armadilha silenciosa", () => {
    expect(
      balanceAlerts({ quantity: 10, avgCostCents: 0, minQuantity: 0 })
    ).toEqual(["sem_custo"]);
  });

  it("saldo saudável não inventa alerta", () => {
    expect(
      balanceAlerts({ quantity: 50, avgCostCents: 700, minQuantity: 10 })
    ).toEqual([]);
  });
});

describe("custo do kit", () => {
  it("soma quantidade × custo médio", () => {
    const r = kitCost(
      [
        { itemId: "a", quantity: 2 },
        { itemId: "b", quantity: 0.5 },
      ],
      { a: 350, b: 1200 }
    );
    expect(r.totalCents).toBe(1300);
    expect(r.missingItemIds).toEqual([]);
  });

  it("declara o item sem custo em vez de fingir que o kit está completo", () => {
    const r = kitCost(
      [
        { itemId: "a", quantity: 2 },
        { itemId: "novo", quantity: 1 },
      ],
      { a: 350 }
    );
    expect(r.totalCents).toBe(700);
    expect(r.missingItemIds).toEqual(["novo"]);
  });
});

describe("validação do movimento", () => {
  it("entrada sem custo é recusada", () => {
    // Entrada com valor zero derruba o custo médio em silêncio e faz todo
    // procedimento que usa o item parecer barato.
    expect(
      movementErrors({ itemId: "a", kind: "entrada", quantity: 5 })
    ).toContain("Informe o custo unitário da entrada.");
  });

  it("consumo não exige custo", () => {
    expect(
      movementErrors({ itemId: "a", kind: "consumo", quantity: 5 })
    ).toEqual([]);
  });

  it("quantidade zero ou negativa não passa", () => {
    expect(
      movementErrors({ itemId: "a", kind: "consumo", quantity: 0 })
    ).toContain("A quantidade precisa ser maior que zero.");
  });

  it("item obrigatório", () => {
    expect(
      movementErrors({ itemId: "", kind: "consumo", quantity: 1 })
    ).toContain("Escolha o item.");
  });
});
