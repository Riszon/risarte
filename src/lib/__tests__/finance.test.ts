import { describe, expect, it } from "vitest";
import {
  allocateProportional,
  percentOf,
  roundHalfEven,
  roundHalfUp,
  splitAmount,
  sumCents,
} from "@/lib/finance/money";
import {
  computeLateCharges,
  daysBetween,
  daysLate,
  lateLabel,
  type LateFeeTerms,
} from "@/lib/finance/late-fees";
import {
  accountLevel,
  buildCostCenterTree,
  canBeParentOfUnitCenter,
  compareAccountCodes,
  isValidAccountCode,
  parentAccountCode,
  postableAccounts,
  sortAccounts,
  type ChartAccount,
  type CostCenter,
} from "@/lib/finance/accounts";

// FIN0 — dinheiro não pode depender de acerto visual. Toda regra aqui.

describe("arredondamento", () => {
  it("meio para cima (política padrão da rede)", () => {
    expect(roundHalfUp(10.5)).toBe(11);
    expect(roundHalfUp(10.4)).toBe(10);
    expect(roundHalfUp(0.5)).toBe(1);
  });

  it("meio para cima trata negativo pelo valor absoluto", () => {
    // Math.round(-0.5) é 0 no JS: seria -0 centavos numa devolução.
    expect(roundHalfUp(-10.5)).toBe(-11);
    expect(roundHalfUp(-0.5)).toBe(-1);
  });

  it("meio par (bancário) puxa para o vizinho par", () => {
    expect(roundHalfEven(10.5)).toBe(10);
    expect(roundHalfEven(11.5)).toBe(12);
    expect(roundHalfEven(10.6)).toBe(11);
  });

  it("percentual sobre centavos", () => {
    expect(percentOf(100000, 2)).toBe(2000); // 2% de R$ 1.000,00
    expect(percentOf(15733, 1)).toBe(157); // 1% de R$ 157,33
    expect(percentOf(100000, 0)).toBe(0);
    expect(percentOf(0, 10)).toBe(0);
  });
});

describe("divisão de valores — a última parcela absorve o resíduo", () => {
  it("divisão exata", () => {
    expect(splitAmount(90000, 3)).toEqual([30000, 30000, 30000]);
  });

  it("resíduo de centavos cai na última", () => {
    const parts = splitAmount(10000, 3);
    expect(parts).toEqual([3333, 3333, 3334]);
    expect(sumCents(parts)).toBe(10000);
  });

  it("a soma SEMPRE fecha com o total (casos fixos)", () => {
    const casos = [
      [176700, 5],
      [100000, 7],
      [1, 3],
      [99999, 11],
      [578000, 6],
    ] as const;
    for (const [total, partes] of casos) {
      expect(sumCents(splitAmount(total, partes))).toBe(total);
    }
  });

  it("uma parte só devolve o total; zero partes devolve vazio", () => {
    expect(splitAmount(12345, 1)).toEqual([12345]);
    expect(splitAmount(12345, 0)).toEqual([]);
  });
});

describe("rateio proporcional", () => {
  it("distribui conforme os pesos e fecha o total", () => {
    const out = allocateProportional(10000, [1, 1, 2]);
    expect(sumCents(out)).toBe(10000);
    expect(out[2]).toBeGreaterThan(out[0]);
  });

  it("resíduo vai para quem tem maior fração", () => {
    const out = allocateProportional(1000, [1, 1, 1]);
    expect(sumCents(out)).toBe(1000);
    expect(out).toEqual([334, 333, 333]);
  });

  it("sem pesos válidos, divide igual", () => {
    expect(allocateProportional(900, [0, 0, 0])).toEqual([300, 300, 300]);
  });
});

describe("dias de atraso", () => {
  it("conta dias inteiros entre datas", () => {
    expect(daysBetween("2026-07-01", "2026-07-31")).toBe(30);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1); // 2026 não é bissexto
  });

  it("vencimento hoje NÃO está em atraso; ontem = 1 dia", () => {
    expect(daysLate("2026-07-31", "2026-07-31")).toBe(0);
    expect(daysLate("2026-07-30", "2026-07-31")).toBe(1);
  });

  it("carência desconta do atraso", () => {
    expect(daysLate("2026-07-25", "2026-07-31", 3)).toBe(3);
    expect(daysLate("2026-07-29", "2026-07-31", 3)).toBe(0);
  });

  it("rótulo em pt-BR", () => {
    expect(lateLabel(0)).toBe("Em dia");
    expect(lateLabel(1)).toBe("1 dia em atraso");
    expect(lateLabel(12)).toBe("12 dias em atraso");
  });
});

describe("multa e juros — tabela de casos fixos", () => {
  const rede: LateFeeTerms = {
    lateFeePercent: 2,
    monthlyInterestPercent: 1,
    graceDays: 0,
  };

  it("em dia não cobra nada", () => {
    const r = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-07-31",
      referenceDate: "2026-07-31",
      terms: rede,
    });
    expect(r).toEqual({
      daysLate: 0,
      lateFeeCents: 0,
      interestCents: 0,
      totalCents: 100000,
    });
  });

  it("R$ 1.000,00 com 30 dias de atraso = multa 20,00 + juros 10,00", () => {
    const r = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-06-30",
      referenceDate: "2026-07-30",
      terms: rede,
    });
    expect(r.daysLate).toBe(30);
    expect(r.lateFeeCents).toBe(2000);
    expect(r.interestCents).toBe(1000);
    expect(r.totalCents).toBe(103000);
  });

  it("R$ 1.000,00 com 1 dia de atraso = multa cheia + juros de 1 dia", () => {
    const r = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-07-30",
      referenceDate: "2026-07-31",
      terms: rede,
    });
    expect(r.daysLate).toBe(1);
    expect(r.lateFeeCents).toBe(2000);
    expect(r.interestCents).toBe(33); // 1000,00 × (1%/30) × 1
    expect(r.totalCents).toBe(102033);
  });

  it("R$ 253,40 com 15 dias (valor real de parcelamento)", () => {
    const r = computeLateCharges({
      principalCents: 25340,
      dueDate: "2026-07-16",
      referenceDate: "2026-07-31",
      terms: rede,
    });
    expect(r.daysLate).toBe(15);
    expect(r.lateFeeCents).toBe(507); // 2% de 253,40 = 5,068 → 5,07
    expect(r.interestCents).toBe(127); // 253,40 × (1%/30) × 15 = 1,267 → 1,27
    expect(r.totalCents).toBe(25974);
  });

  it("carência de 5 dias: dentro dela não cobra", () => {
    const comCarencia: LateFeeTerms = { ...rede, graceDays: 5 };
    const dentro = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-07-28",
      referenceDate: "2026-07-31",
      terms: comCarencia,
    });
    expect(dentro.totalCents).toBe(100000);
    expect(dentro.daysLate).toBe(0);
  });

  it("taxas CONGELADAS: a mesma parcela com taxas antigas dá o valor antigo", () => {
    const antigas: LateFeeTerms = {
      lateFeePercent: 1,
      monthlyInterestPercent: 0.5,
      graceDays: 0,
    };
    const r = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-06-30",
      referenceDate: "2026-07-30",
      terms: antigas,
    });
    expect(r.lateFeeCents).toBe(1000);
    expect(r.interestCents).toBe(500);
    // Mudar a configuração da rede não pode reescrever o passado.
    expect(r.totalCents).toBe(101500);
  });

  it("multa zero configurada = só juros", () => {
    const semMulta: LateFeeTerms = { ...rede, lateFeePercent: 0 };
    const r = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-06-30",
      referenceDate: "2026-07-30",
      terms: semMulta,
    });
    expect(r.lateFeeCents).toBe(0);
    expect(r.interestCents).toBe(1000);
  });
});

describe("plano de contas", () => {
  it("valida o formato do código", () => {
    expect(isValidAccountCode("1")).toBe(true);
    expect(isValidAccountCode("1.1.01")).toBe(true);
    expect(isValidAccountCode("1.")).toBe(false);
    expect(isValidAccountCode("1.a")).toBe(false);
    expect(isValidAccountCode("")).toBe(false);
  });

  it("nível e pai", () => {
    expect(accountLevel("1")).toBe(1);
    expect(accountLevel("1.1.01")).toBe(3);
    expect(parentAccountCode("1.1.01")).toBe("1.1");
    expect(parentAccountCode("1")).toBeNull();
  });

  it("ordena hierarquicamente, não como texto", () => {
    // Como texto puro, "1.10" viria antes de "1.9" — e "2" antes de "1.9.03".
    const codes = ["2", "1.10", "1.9", "1.9.03", "1", "1.1"];
    const sorted = sortAccounts(codes.map((code) => ({ code }))).map(
      (a) => a.code
    );
    expect(sorted).toEqual(["1", "1.1", "1.9", "1.9.03", "1.10", "2"]);
  });

  it("compara códigos numericamente", () => {
    expect(compareAccountCodes("1.9", "1.10")).toBeLessThan(0);
    expect(compareAccountCodes("2", "1.9.03")).toBeGreaterThan(0);
    expect(compareAccountCodes("1.1", "1.1")).toBe(0);
  });

  it("só conta analítica, ativa e do escopo certo recebe lançamento", () => {
    const contas: ChartAccount[] = [
      {
        code: "1",
        name: "Receitas",
        parentCode: null,
        kind: "revenue",
        nature: "operational",
        costBehavior: "none",
        scope: "both",
        isAnalytic: false, // grupo sintético
        fiscalAccountCode: null,
        active: true,
      },
      {
        code: "1.1.01",
        name: "Procedimentos",
        parentCode: "1.1",
        kind: "revenue",
        nature: "operational",
        costBehavior: "none",
        scope: "unit",
        isAnalytic: true,
        fiscalAccountCode: null,
        active: true,
      },
      {
        code: "1.3.01",
        name: "Royalties",
        parentCode: "1.3",
        kind: "revenue",
        nature: "intercompany",
        costBehavior: "none",
        scope: "franchisor",
        isAnalytic: true,
        fiscalAccountCode: null,
        active: true,
      },
      {
        code: "3.9.99",
        name: "Conta desativada",
        parentCode: "3",
        kind: "expense",
        nature: "operational",
        costBehavior: "fixed",
        scope: "both",
        isAnalytic: true,
        fiscalAccountCode: null,
        active: false,
      },
    ];
    expect(postableAccounts(contas, "unit").map((a) => a.code)).toEqual([
      "1.1.01",
    ]);
    expect(postableAccounts(contas, "franchisor").map((a) => a.code)).toEqual([
      "1.3.01",
    ]);
  });
});

describe("centros de custo", () => {
  const centros: CostCenter[] = [
    { id: "cli", code: "CLI", name: "Clínico", parentId: null, scope: "network", clinicId: null, active: true },
    { id: "com", code: "COM", name: "Comercial", parentId: null, scope: "network", clinicId: null, active: true },
    { id: "orto", code: "CLI-ORT", name: "Sala de orto", parentId: "cli", scope: "unit", clinicId: "u1", active: true },
  ];

  it("monta a árvore com os filhos no pai certo", () => {
    const tree = buildCostCenterTree(centros);
    expect(tree.map((n) => n.code)).toEqual(["CLI", "COM"]);
    expect(tree[0].children.map((n) => n.code)).toEqual(["CLI-ORT"]);
    expect(tree[1].children).toEqual([]);
  });

  it("centro de unidade só pendura em centro da REDE", () => {
    expect(canBeParentOfUnitCenter(centros[0])).toBe(true); // network
    expect(canBeParentOfUnitCenter(centros[2])).toBe(false); // unit
    expect(canBeParentOfUnitCenter(null)).toBe(false);
  });
});
