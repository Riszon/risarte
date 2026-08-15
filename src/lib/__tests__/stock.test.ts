import { describe, expect, it } from "vitest";
import {
  applyMovement,
  balanceAlerts,
  conversionSummary,
  isInbound,
  kitCost,
  movementErrors,
  replayMovements,
  suggestedPackages,
  summarizeCount,
  unitCostFromPackage,
  unitShort,
  unitsFromPackages,
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
    expect(compra.balance.avgCostCents).toBeCloseTo(722.2222, 3);
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
    expect(b.avgCostCents).toBeCloseTo(411.1111, 3);
  });
});

describe("embalagem × consumo — o erro de 100 vezes", () => {
  it("caixa de sugadores: R$ 25,00 por 100 vira R$ 0,25 cada", () => {
    // Sem esta conta, cada sugador entrava no procedimento por R$ 25,00.
    expect(unitCostFromPackage(2500, 100)).toBe(25);
    expect(unitsFromPackages(1, 100)).toBe(100);
  });

  it("resina: tubo de R$ 180,00 com 4 g custa R$ 45,00 o grama", () => {
    expect(unitCostFromPackage(18000, 4)).toBe(4500);
  });

  it("adesivo por RENDIMENTO: frasco de R$ 240,00 rende 20 aplicações", () => {
    // Ninguém mede ml de adesivo na clínica; mede-se quantas restaurações o
    // frasco dá. A unidade de controle vira "aplicação" e a conta é a mesma.
    expect(unitCostFromPackage(24000, 20)).toBe(1200);
  });

  it("custo unitário mantém decimais em vez de arredondar sempre para baixo", () => {
    // R$ 180,00 ÷ 7 g. Arredondar para 2571 a cada movimento erraria sempre
    // para o mesmo lado.
    expect(unitCostFromPackage(18000, 7)).toBeCloseTo(2571.4286, 3);
  });

  it("fator inválido não divide por zero", () => {
    expect(unitCostFromPackage(2500, 0)).toBe(2500);
    expect(unitsFromPackages(2, 0)).toBe(2);
  });

  it("a entrada pela embalagem chega ao mesmo saldo da entrada avulsa", () => {
    const conv = conversionSummary({
      packages: 2,
      packageUnit: "caixa",
      packageCostCents: 2500,
      unitsPerPackage: 100,
      stockUnit: "unidade",
    });
    expect(conv.units).toBe(200);
    expect(conv.unitCostCents).toBe(25);

    const r = applyMovement(
      { quantity: 0, avgCostCents: 0, minQuantity: 0 },
      {
        kind: "entrada",
        quantity: conv.units,
        unitCostCents: conv.unitCostCents,
      }
    );
    expect(r.balance.quantity).toBe(200);
    expect(r.balance.avgCostCents).toBe(25);
    // 2 caixas a R$ 25,00 = R$ 50,00. O total fecha com a nota.
    expect(r.totalCents).toBe(5000);
  });

  it("consumo fracionado cobra o pedaço certo", () => {
    // 0,2 g de resina a R$ 45,00/g = R$ 9,00.
    const r = applyMovement(
      { quantity: 4, avgCostCents: 4500, minQuantity: 0 },
      { kind: "consumo", quantity: 0.2 }
    );
    expect(r.totalCents).toBe(900);
    expect(r.balance.quantity).toBeCloseTo(3.8, 5);
  });

  it("abreviação das unidades", () => {
    expect(unitShort("unidade")).toBe("un");
    expect(unitShort("aplicação")).toBe("apl");
    expect(unitShort("caixa")).toBe("cx");
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

describe("inventário", () => {
  it("a diferença sai contra o ESPERADO CONGELADO, não contra o saldo de agora", () => {
    // Entre contar a gaveta e aplicar a contagem houve um atendimento. Se o
    // ajuste fosse "deixe o saldo igual ao contado", ele apagaria esse consumo.
    const r = summarizeCount([
      { itemId: "a", expectedQuantity: 10, countedQuantity: 8, avgCostCents: 500 },
    ]);
    expect(r.differences).toBe(1);
    expect(r.shortageCents).toBe(1000); // 2 unidades a R$ 5,00
    expect(r.surplusCents).toBe(0);
  });

  it("separa sobra de falta em vez de compensar as duas", () => {
    // Compensar esconderia que faltou um item caro e sobrou um barato.
    const r = summarizeCount([
      { itemId: "a", expectedQuantity: 10, countedQuantity: 12, avgCostCents: 300 },
      { itemId: "b", expectedQuantity: 5, countedQuantity: 2, avgCostCents: 900 },
    ]);
    expect(r.surplusCents).toBe(600);
    expect(r.shortageCents).toBe(2700);
    expect(r.netCents).toBe(-2100);
  });

  it("linha não contada fica pendente, não vira diferença zero", () => {
    const r = summarizeCount([
      { itemId: "a", expectedQuantity: 4, countedQuantity: null, avgCostCents: 100 },
      { itemId: "b", expectedQuantity: 4, countedQuantity: 4, avgCostCents: 100 },
    ]);
    expect(r.pending).toBe(1);
    expect(r.counted).toBe(1);
    expect(r.matching).toBe(1);
    expect(r.differences).toBe(0);
  });
});

describe("reposição", () => {
  it("arredonda a compra para CIMA: meia caixa não existe", () => {
    // Faltam 130 unidades, caixa com 100 → 2 caixas.
    expect(
      suggestedPackages({
        total: 20,
        minQuantity: 50,
        maxQuantity: 150,
        unitsPerPurchase: 100,
      })
    ).toBe(2);
  });

  it("sem máximo, o alvo é o dobro do mínimo", () => {
    // Repor só até o mínimo deixaria o item em alerta no dia seguinte.
    expect(
      suggestedPackages({
        total: 10,
        minQuantity: 50,
        maxQuantity: null,
        unitsPerPurchase: 20,
      })
    ).toBe(5); // alvo 100, faltam 90, caixa de 20 → 4,5 → 5
  });

  it("estoque acima do alvo não sugere compra", () => {
    expect(
      suggestedPackages({
        total: 200,
        minQuantity: 50,
        maxQuantity: 150,
        unitsPerPurchase: 100,
      })
    ).toBe(0);
  });

  it("saldo negativo entra na conta do que falta", () => {
    expect(
      suggestedPackages({
        total: -5,
        minQuantity: 10,
        maxQuantity: 20,
        unitsPerPurchase: 10,
      })
    ).toBe(3); // faltam 25 para o alvo 20
  });
});

describe("alerta de excesso", () => {
  it("acima do máximo é dinheiro parado", () => {
    expect(
      balanceAlerts({
        quantity: 300,
        avgCostCents: 100,
        minQuantity: 10,
        maxQuantity: 200,
      })
    ).toEqual(["acima_maximo"]);
  });

  it("falta pesa mais que sobra — abaixo do mínimo vem primeiro", () => {
    expect(
      balanceAlerts({
        quantity: 5,
        avgCostCents: 100,
        minQuantity: 10,
        maxQuantity: 4,
      })
    ).toEqual(["abaixo_minimo"]);
  });

  it("sem máximo definido, não inventa alerta", () => {
    expect(
      balanceAlerts({
        quantity: 5000,
        avgCostCents: 100,
        minQuantity: 10,
        maxQuantity: null,
      })
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
