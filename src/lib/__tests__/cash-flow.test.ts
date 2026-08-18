import { describe, expect, it } from "vitest";
import {
  buildCashFlow,
  cashTotals,
  firstNegative,
  periodEnd,
  periodLabel,
  periodStart,
  startOfMonth,
  startOfWeek,
  type CashSeriesRow,
} from "@/lib/finance/cash-flow";

const row = (
  day: string,
  kind: "realizado" | "previsto",
  inflow: number,
  outflow: number,
  activity: "operacional" | "investimento" | "financiamento" = "operacional"
): CashSeriesRow => ({
  day,
  kind,
  activity,
  inflowCents: inflow,
  outflowCents: outflow,
});

describe("recorte de períodos", () => {
  it("a semana começa na segunda", () => {
    // 2026-08-17 é uma segunda.
    expect(startOfWeek("2026-08-17")).toBe("2026-08-17");
    expect(startOfWeek("2026-08-19")).toBe("2026-08-17");
    // Domingo pertence à semana que começou na segunda anterior.
    expect(startOfWeek("2026-08-23")).toBe("2026-08-17");
    expect(startOfWeek("2026-08-24")).toBe("2026-08-24");
  });

  it("o mês fecha no último dia, inclusive em fevereiro bissexto", () => {
    expect(startOfMonth("2026-02-13")).toBe("2026-02-01");
    expect(periodEnd("2026-02-01", "mes")).toBe("2026-02-28");
    expect(periodEnd("2028-02-01", "mes")).toBe("2028-02-29");
    expect(periodEnd("2026-08-01", "mes")).toBe("2026-08-31");
  });

  it("por dia, início e fim são o próprio dia", () => {
    expect(periodStart("2026-08-19", "dia")).toBe("2026-08-19");
    expect(periodEnd("2026-08-19", "dia")).toBe("2026-08-19");
  });
});

describe("linha do tempo do caixa", () => {
  it("dia sem movimento continua na tabela, com o saldo parado", () => {
    const periods = buildCashFlow({
      rows: [row("2026-08-01", "realizado", 10_000, 0)],
      from: "2026-08-01",
      to: "2026-08-03",
      groupBy: "dia",
      openingCents: 0,
    });
    expect(periods).toHaveLength(3);
    expect(periods.map((p) => p.balanceCents)).toEqual([10_000, 10_000, 10_000]);
  });

  it("o saldo inicial entra antes do primeiro dia", () => {
    const periods = buildCashFlow({
      rows: [row("2026-08-01", "realizado", 0, 3_000)],
      from: "2026-08-01",
      to: "2026-08-01",
      groupBy: "dia",
      openingCents: 50_000,
    });
    expect(periods[0].balanceCents).toBe(47_000);
  });

  it("realizado e previsto somam no saldo, mas ficam separados na leitura", () => {
    const periods = buildCashFlow({
      rows: [
        row("2026-08-10", "realizado", 20_000, 0),
        row("2026-08-10", "previsto", 5_000, 1_000),
      ],
      from: "2026-08-10",
      to: "2026-08-10",
      groupBy: "dia",
      openingCents: 0,
    });
    const p = periods[0];
    expect(p.realizedInflowCents).toBe(20_000);
    expect(p.expectedInflowCents).toBe(5_000);
    expect(p.expectedOutflowCents).toBe(1_000);
    expect(p.netCents).toBe(24_000);
    expect(p.hasExpected).toBe(true);
  });

  it("agrupa por mês somando os dias", () => {
    const periods = buildCashFlow({
      rows: [
        row("2026-08-02", "realizado", 10_000, 0),
        row("2026-08-28", "realizado", 0, 4_000),
        row("2026-09-05", "previsto", 7_000, 0),
      ],
      from: "2026-08-01",
      to: "2026-09-30",
      groupBy: "mes",
      openingCents: 0,
    });
    expect(periods).toHaveLength(2);
    expect(periods[0].netCents).toBe(6_000);
    expect(periods[1].balanceCents).toBe(13_000);
  });

  it("o primeiro período é recortado pelo filtro, não pelo calendário", () => {
    const periods = buildCashFlow({
      rows: [],
      from: "2026-08-15",
      to: "2026-08-31",
      groupBy: "mes",
      openingCents: 0,
    });
    expect(periods[0].key).toBe("2026-08-01");
    expect(periods[0].start).toBe("2026-08-15");
    expect(periods[0].end).toBe("2026-08-31");
  });

  it("lançamento fora do período não entra", () => {
    const periods = buildCashFlow({
      rows: [
        row("2026-07-31", "realizado", 99_000, 0),
        row("2026-08-01", "realizado", 1_000, 0),
      ],
      from: "2026-08-01",
      to: "2026-08-01",
      groupBy: "dia",
      openingCents: 0,
    });
    expect(periods[0].balanceCents).toBe(1_000);
  });

  it("separa por atividade — investir não é operar", () => {
    const periods = buildCashFlow({
      rows: [
        row("2026-08-01", "realizado", 30_000, 0, "operacional"),
        row("2026-08-01", "realizado", 0, 50_000, "investimento"),
      ],
      from: "2026-08-01",
      to: "2026-08-01",
      groupBy: "dia",
      openingCents: 0,
    });
    const p = periods[0];
    expect(p.activityCents.operacional).toBe(30_000);
    expect(p.activityCents.investimento).toBe(-50_000);
    // O dia fecha negativo, mas a operação gerou caixa: é essa diferença que
    // a separação existe para mostrar.
    expect(p.netCents).toBe(-20_000);
  });

  it("período invertido devolve vazio em vez de laço infinito", () => {
    expect(
      buildCashFlow({
        rows: [],
        from: "2026-08-10",
        to: "2026-08-01",
        groupBy: "dia",
        openingCents: 0,
      })
    ).toEqual([]);
  });
});

describe("o aviso de caixa negativo", () => {
  it("aponta o primeiro dia em que falta dinheiro", () => {
    const periods = buildCashFlow({
      rows: [
        row("2026-08-02", "previsto", 0, 60_000),
        row("2026-08-05", "previsto", 90_000, 0),
      ],
      from: "2026-08-01",
      to: "2026-08-05",
      groupBy: "dia",
      openingCents: 40_000,
    });
    const neg = firstNegative(periods);
    expect(neg?.key).toBe("2026-08-02");
    expect(neg?.balanceCents).toBe(-20_000);
    // E o mês inteiro fecharia positivo — por isso o aviso é diário.
    expect(periods.at(-1)?.balanceCents).toBe(70_000);
  });

  it("agrupado por mês o buraco do dia 2 desaparece", () => {
    const monthly = buildCashFlow({
      rows: [
        row("2026-08-02", "previsto", 0, 60_000),
        row("2026-08-05", "previsto", 90_000, 0),
      ],
      from: "2026-08-01",
      to: "2026-08-31",
      groupBy: "mes",
      openingCents: 40_000,
    });
    expect(firstNegative(monthly)).toBeNull();
  });

  it("sem buraco nenhum, não inventa aviso", () => {
    const periods = buildCashFlow({
      rows: [row("2026-08-01", "realizado", 1_000, 0)],
      from: "2026-08-01",
      to: "2026-08-02",
      groupBy: "dia",
      openingCents: 0,
    });
    expect(firstNegative(periods)).toBeNull();
  });
});

describe("totais", () => {
  it("somam as duas metades e terminam no saldo do último período", () => {
    const periods = buildCashFlow({
      rows: [
        row("2026-08-01", "realizado", 10_000, 2_000),
        row("2026-08-02", "previsto", 3_000, 500),
      ],
      from: "2026-08-01",
      to: "2026-08-02",
      groupBy: "dia",
      openingCents: 1_000,
    });
    const t = cashTotals(periods, 1_000);
    expect(t.realizedInflowCents).toBe(10_000);
    expect(t.expectedInflowCents).toBe(3_000);
    expect(t.outflowCents).toBe(2_500);
    expect(t.netCents).toBe(10_500);
    expect(t.endBalanceCents).toBe(11_500);
  });

  it("sem período nenhum, o total é o saldo inicial", () => {
    expect(cashTotals([], 7_700).endBalanceCents).toBe(7_700);
  });
});

describe("rótulos", () => {
  it("dia, semana e mês têm formatos diferentes", () => {
    const [dia] = buildCashFlow({
      rows: [],
      from: "2026-08-17",
      to: "2026-08-17",
      groupBy: "dia",
      openingCents: 0,
    });
    expect(periodLabel(dia, "dia")).toBe("17/08");

    const [semana] = buildCashFlow({
      rows: [],
      from: "2026-08-17",
      to: "2026-08-23",
      groupBy: "semana",
      openingCents: 0,
    });
    expect(periodLabel(semana, "semana")).toBe("17/08 a 23/08");

    const [mes] = buildCashFlow({
      rows: [],
      from: "2026-08-01",
      to: "2026-08-31",
      groupBy: "mes",
      openingCents: 0,
    });
    expect(periodLabel(mes, "mes")).toBe("08/2026");
  });
});
