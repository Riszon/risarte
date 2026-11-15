import { describe, expect, it } from "vitest";
import { custoDoItem, ordemSugerida, simularQuitacao, type ItemDoSimulador } from "@/lib/finance/dividas-simulador";

// LEVANTAMENTO DE DÍVIDAS, FASE 8: o simulador de quitação (3.12 do pedido).
const item = (o: Partial<ItemDoSimulador>): ItemDoSimulador => ({
  id: o.code ?? "x", code: "DV-0", clinicId: "L", clinicName: "Londrina", supplierName: "Banco",
  devidoCents: 1000, propostaCents: null, propostaValidade: null, custasCents: 0, prioridade: null, comRestricao: false, ...o,
});

describe("o custo de cada dívida", () => {
  it("proposta (senão o devido) + custas; economia só com proposta", () => {
    expect(custoDoItem(item({ propostaCents: 600, custasCents: 50 }))).toEqual({ custoCents: 650, economiaCents: 400, desconto: 0.4 });
    expect(custoDoItem(item({ custasCents: 50 }))).toEqual({ custoCents: 1050, economiaCents: 0, desconto: null });
  });
});

describe("a ordem sugerida", () => {
  it("prioridade → restrição → maior desconto → proposta que vence antes → código", () => {
    const o = ordemSugerida([
      item({ code: "DV-5" }),
      item({ code: "DV-4", propostaCents: 500, propostaValidade: "2026-12-30" }),
      item({ code: "DV-3", propostaCents: 500, propostaValidade: "2026-11-30" }),
      item({ code: "DV-2", comRestricao: true }),
      item({ code: "DV-1", prioridade: "baixa", comRestricao: true }),
      item({ code: "DV-0", prioridade: "alta" }),
    ]).map((i) => i.code);
    expect(o).toEqual(["DV-0", "DV-1", "DV-2", "DV-3", "DV-4", "DV-5"]);
  });
});

describe("a simulação com o caixa de cada CNPJ", () => {
  const itens = [
    item({ code: "DV-1", prioridade: "alta", devidoCents: 5000 }),
    item({ code: "DV-2", propostaCents: 300, devidoCents: 1000 }),
    item({ code: "DV-3", devidoCents: 700 }),
    item({ code: "DV-9", clinicId: "C", clinicName: "Cambé", devidoCents: 100 }),
  ];
  it("na ordem, o que cabe; o que não cabe é pulado e os menores seguintes ainda entram", () => {
    const s = simularQuitacao(itens, { L: 1200, C: null });
    const l = s.devedores.find((d) => d.clinicId === "L")!;
    expect(l.itens.map((i) => [i.code, i.cabe])).toEqual([["DV-1", false], ["DV-2", true], ["DV-3", true]]);
    expect([l.cabeCents, l.sobraCents, l.quitaveis, l.economiaQueCabeCents]).toEqual([1000, 200, 2, 700]);
  });
  it("cada CNPJ com o próprio caixa; sem valor informado não marca nada", () => {
    const s = simularQuitacao(itens, { L: 1200, C: null });
    const c = s.devedores.find((d) => d.clinicId === "C")!;
    expect(c.itens[0].cabe).toBeNull();
    expect(c.sobraCents).toBeNull();
    expect(s.totais).toEqual({ devidoCents: 6800, custoCents: 6100, custasCents: 0, economiaCents: 700, semProposta: 3 });
  });
});
