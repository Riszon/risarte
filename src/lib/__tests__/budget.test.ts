import { describe, expect, it } from "vitest";
import {
  blockLabel,
  budgetSign,
  buildBudgetReport,
  variance,
  yearProgress,
  type BudgetRow,
} from "@/lib/finance/budget";

const row = (
  accountCode: string,
  block: BudgetRow["block"],
  budgetCents: number,
  actualCents: number
): BudgetRow => ({
  accountCode,
  accountName: accountCode,
  block,
  budgetCents,
  actualCents,
  ytdBudgetCents: budgetCents,
  ytdActualCents: actualCents,
});

describe("a variação tem uma regra só", () => {
  it("receita acima da meta é positiva", () => {
    const v = variance(120_000, 100_000);
    expect(v.deltaCents).toBe(20_000);
    expect(v.status).toBe("melhor");
  });

  it("despesa MENOR que a meta também é positiva", () => {
    // Meta −5.000, gastou −4.000: sobrou mil. Mesma conta, mesmo sinal.
    const v = variance(-400_000, -500_000);
    expect(v.deltaCents).toBe(100_000);
    expect(v.status).toBe("melhor");
  });

  it("despesa MAIOR que a meta estoura", () => {
    const v = variance(-600_000, -500_000);
    expect(v.deltaCents).toBe(-100_000);
    expect(v.percent).toBeCloseTo(-0.2, 4);
    expect(v.status).toBe("estourou");
  });

  it("receita abaixo da meta também estoura — a régua é a mesma", () => {
    expect(variance(70_000, 100_000).status).toBe("estourou");
  });

  it("dentro da folga fica no alvo, para os dois lados", () => {
    expect(variance(102_000, 100_000).status).toBe("no_alvo");
    expect(variance(97_000, 100_000).status).toBe("no_alvo");
  });

  it("entre a folga e o dobro dela é atenção, não estouro", () => {
    // −8% com folga de 5%: passou, mas não dobrou.
    expect(variance(-540_000, -500_000).status).toBe("atencao");
  });

  it("a folga é ajustável", () => {
    expect(variance(-540_000, -500_000, 0.1).status).toBe("no_alvo");
  });

  it("sem meta não inventa percentual", () => {
    const v = variance(-30_000, 0);
    expect(v.status).toBe("sem_meta");
    expect(v.percent).toBeNull();
    expect(v.deltaCents).toBe(-30_000);
  });

  it("meta sem realizado é o mês inteiro de variação", () => {
    const v = variance(0, -500_000);
    expect(v.deltaCents).toBe(500_000);
    expect(v.status).toBe("melhor");
  });
});

describe("o relatório", () => {
  const rows = [
    row("1.1.01", "receita_bruta", 1_000_000, 900_000),
    row("1.1.02", "receita_bruta", 200_000, 260_000),
    row("1.9.01", "deducoes", -60_000, -58_000),
    row("2.1.01", "custos_diretos", -400_000, -420_000),
    row("3.2.01", "despesas_operacionais", -300_000, -300_000),
  ];

  it("agrupa nos blocos da DRE, na mesma ordem", () => {
    const r = buildBudgetReport(rows);
    expect(r.sections.map((s) => s.block)).toEqual([
      "receita_bruta",
      "deducoes",
      "custos_diretos",
      "despesas_operacionais",
    ]);
  });

  it("soma cada bloco e o resultado do período", () => {
    const r = buildBudgetReport(rows);
    expect(r.sections[0].budgetCents).toBe(1_200_000);
    expect(r.sections[0].actualCents).toBe(1_160_000);
    expect(r.resultBudgetCents).toBe(440_000);
    expect(r.resultActualCents).toBe(382_000);
  });

  it("bloco vazio não aparece", () => {
    const r = buildBudgetReport([row("1.1.01", "receita_bruta", 100, 100)]);
    expect(r.sections).toHaveLength(1);
  });

  it("conta fora do resultado não entra em nenhum bloco", () => {
    const r = buildBudgetReport([...rows, row("6.1.01", "fora", -999, -999)]);
    expect(r.resultActualCents).toBe(382_000);
  });

  it("ordena as contas pelo código dentro do bloco", () => {
    const r = buildBudgetReport([
      row("1.1.02", "receita_bruta", 1, 1),
      row("1.1.01", "receita_bruta", 1, 1),
    ]);
    expect(r.sections[0].rows.map((x) => x.accountCode)).toEqual([
      "1.1.01",
      "1.1.02",
    ]);
  });
});

describe("o sinal da conta", () => {
  it("receita soma, dedução e despesa subtraem", () => {
    expect(budgetSign("1.1.01")).toBe(1);
    expect(budgetSign("1.9.01")).toBe(-1);
    expect(budgetSign("3.2.01")).toBe(-1);
    expect(budgetSign("5.2.01")).toBe(-1);
  });
});

describe("auxiliares", () => {
  it("rotula os blocos em pt-BR", () => {
    expect(blockLabel("despesas_operacionais")).toBe("Despesas operacionais");
  });

  it("a fração do ano não passa dos limites", () => {
    expect(yearProgress(3)).toBeCloseTo(0.25, 4);
    expect(yearProgress(12)).toBe(1);
    expect(yearProgress(0)).toBeCloseTo(1 / 12, 4);
    expect(yearProgress(99)).toBe(1);
  });
});
