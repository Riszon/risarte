import { describe, expect, it } from "vitest";
import {
  averagePerUnit,
  byAttention,
  monthOverMonth,
  panelTotals,
  statusReasons,
  unitStatus,
  type MonthPoint,
  type UnitPanelRow,
} from "@/lib/finance/network-panel";

const unit = (
  name: string,
  over: Partial<UnitPanelRow> = {}
): UnitPanelRow => ({
  clinicId: name,
  clinicName: name,
  ownership: "franchised",
  alerts: 0,
  alertCaixa: null,
  alertOrcamento: null,
  alertEquilibrio: null,
  alertAtraso: null,
  overdueCents: 0,
  prevMonthClosed: true,
  feesDueCents: 0,
  feesPaidCents: 0,
  feesOpenCents: 0,
  feesOverdueCents: 0,
  ...over,
});

describe("o farol da unidade", () => {
  it("verde quando não há nada pendente", () => {
    expect(unitStatus(unit("A"))).toBe("verde");
    expect(statusReasons(unit("A"))).toEqual([]);
  });

  it("vermelho é só o que já dói: caixa negativo ou taxa vencida", () => {
    expect(unitStatus(unit("A", { alertCaixa: "fica negativo em 12/09" }))).toBe(
      "vermelho"
    );
    expect(unitStatus(unit("B", { feesOverdueCents: 50_000 }))).toBe("vermelho");
  });

  it("amarelo é o que ainda dá para resolver", () => {
    expect(unitStatus(unit("A", { alertOrcamento: "marketing em 95%" }))).toBe(
      "amarelo"
    );
    expect(unitStatus(unit("B", { alertEquilibrio: "faltam 5 dias" }))).toBe(
      "amarelo"
    );
    expect(unitStatus(unit("C", { alertAtraso: "R$ 8.000" }))).toBe("amarelo");
  });

  it("mês anterior não fechado é amarelo, não vermelho", () => {
    // É processo atrasado, não dinheiro faltando. Pintar de vermelho faria o
    // painel gritar igual para as duas coisas.
    expect(unitStatus(unit("A", { prevMonthClosed: false }))).toBe("amarelo");
  });

  it("o que dói ganha do que só incomoda", () => {
    const u = unit("A", {
      alertCaixa: "negativo",
      alertOrcamento: "estourando",
      prevMonthClosed: false,
    });
    expect(unitStatus(u)).toBe("vermelho");
    // E a lista de motivos começa pelo que se resolve primeiro.
    expect(statusReasons(u)[0]).toBe("caixa negativo previsto");
  });

  it("lista todos os motivos, não só o pior", () => {
    const u = unit("A", {
      alertCaixa: "x",
      feesOverdueCents: 1,
      alertAtraso: "y",
      prevMonthClosed: false,
    });
    expect(statusReasons(u)).toHaveLength(4);
  });
});

describe("a ordem de atenção", () => {
  it("pior primeiro, e o nome desempata", () => {
    const rows = [
      unit("Zebra"),
      unit("Alfa", { alertCaixa: "x", alerts: 1 }),
      unit("Beta", { alertOrcamento: "y", alerts: 1 }),
      unit("Ana"),
    ];
    expect([...rows].sort(byAttention).map((r) => r.clinicName)).toEqual([
      "Alfa",
      "Beta",
      "Ana",
      "Zebra",
    ]);
  });

  it("mesmo farol, quem tem mais alertas vem antes", () => {
    const rows = [
      unit("A", { alertOrcamento: "x", alerts: 1 }),
      unit("B", { alertOrcamento: "x", alerts: 5 }),
    ];
    expect([...rows].sort(byAttention).map((r) => r.clinicName)).toEqual([
      "B",
      "A",
    ]);
  });
});

describe("os totais do painel", () => {
  it("conta os faróis e soma o dinheiro", () => {
    const t = panelTotals([
      unit("A", { alertCaixa: "x", feesDueCents: 100_000, feesOpenCents: 100_000 }),
      unit("B", { prevMonthClosed: false, feesDueCents: 50_000, feesPaidCents: 50_000 }),
      unit("C", { feesDueCents: 30_000, feesPaidCents: 30_000 }),
    ]);
    expect(t.units).toBe(3);
    expect(t.red).toBe(1);
    expect(t.yellow).toBe(1);
    expect(t.green).toBe(1);
    expect(t.feesDueCents).toBe(180_000);
    expect(t.feesPaidCents).toBe(80_000);
    expect(t.notClosed).toBe(1);
  });

  it("rede vazia não quebra", () => {
    const t = panelTotals([]);
    expect(t.units).toBe(0);
    expect(t.feesDueCents).toBe(0);
  });
});

describe("a evolução da rede", () => {
  const points: MonthPoint[] = [
    { month: "2026-06-01", grossCents: 100_000, units: 2 },
    { month: "2026-07-01", grossCents: 150_000, units: 3 },
    { month: "2026-08-01", grossCents: 0, units: 0 },
  ];

  it("compara com o mês anterior", () => {
    expect(monthOverMonth(points, 1)).toBeCloseTo(0.5, 4);
    expect(monthOverMonth(points, 2)).toBe(-1);
  });

  it("o primeiro mês não tem com o que comparar", () => {
    expect(monthOverMonth(points, 0)).toBeNull();
  });

  it("mês anterior zerado não vira 'infinito por cento'", () => {
    const zeroed: MonthPoint[] = [
      { month: "2026-06-01", grossCents: 0, units: 0 },
      { month: "2026-07-01", grossCents: 50_000, units: 1 },
    ];
    expect(monthOverMonth(zeroed, 1)).toBeNull();
  });

  it("média por unidade não divide por zero", () => {
    expect(averagePerUnit(points[1])).toBe(50_000);
    expect(averagePerUnit(points[2])).toBe(0);
  });
});
