import { describe, expect, it } from "vitest";
import {
  acimaDoLimite,
  porAtencao,
  taxaDaRede,
  totaisDaRede,
  type UnidadeRecebivel,
} from "@/lib/finance/network-receivables";

function unidade(over: Partial<UnidadeRecebivel>): UnidadeRecebivel {
  return {
    clinicId: over.nome ?? "id",
    nome: "Unidade",
    ownership: "franchised",
    abertoCents: 0,
    vencidoCents: 0,
    vencidoQuantidade: 0,
    abertoQuantidade: 0,
    taxaPercent: null,
    limitePercent: 5,
    aVencer: [0, 0, 0, 0],
    atrasadas: [0, 0, 0, 0],
    ...over,
  };
}

describe("taxaDaRede — soma em cima, soma embaixo", () => {
  // ⚠️ O TESTE QUE JUSTIFICA A FÓRMULA. Nos dados de teste do sistema as duas
  // contas dão o mesmo número (uma unidade só com movimento), então a diferença
  // não aparece lá — aparece aqui, que é onde ela precisa ficar presa.
  const pequenaRuim = unidade({
    nome: "Pequena",
    abertoCents: 50_000, // R$ 500
    vencidoCents: 50_000, // tudo vencido → 100%
    taxaPercent: 100,
  });
  const grandeBoa = unidade({
    nome: "Grande",
    abertoCents: 50_000_000, // R$ 500 mil
    vencidoCents: 1_000_000, // R$ 10 mil → 2%
    taxaPercent: 2,
  });

  it("a rede pesa pelo VALOR, não pela quantidade de unidades", () => {
    // Vencido 50.000 + 1.000.000 = 1.050.000 sobre 50.050.000 → 2,10%
    expect(taxaDaRede([pequenaRuim, grandeBoa])).toBe(2.1);
  });

  it("a média simples daria uma resposta MUITO diferente — e errada", () => {
    const media = (100 + 2) / 2; // 51%
    expect(taxaDaRede([pequenaRuim, grandeBoa])).toBeLessThan(media / 10);
    // 2,10% × 51% é a diferença entre "a rede está bem, com uma unidade
    // doente" e "metade da carteira da rede está vencida".
  });

  it("rede sem nada a receber não tem taxa (null, nunca 0%)", () => {
    expect(taxaDaRede([unidade({}), unidade({})])).toBeNull();
    expect(taxaDaRede([])).toBeNull();
  });

  it("rede em dia dá 0%, que é diferente de não ter o que medir", () => {
    expect(
      taxaDaRede([unidade({ abertoCents: 100_000, vencidoCents: 0 })])
    ).toBe(0);
  });
});

describe("acimaDoLimite", () => {
  it("compara com o teto da própria unidade", () => {
    expect(acimaDoLimite(unidade({ taxaPercent: 6, limitePercent: 5 }))).toBe(true);
    expect(acimaDoLimite(unidade({ taxaPercent: 5, limitePercent: 5 }))).toBe(false);
  });
  it("sem taxa ou sem limite, não acusa", () => {
    expect(acimaDoLimite(unidade({ taxaPercent: null, limitePercent: 5 }))).toBe(false);
    expect(acimaDoLimite(unidade({ taxaPercent: 90, limitePercent: null }))).toBe(false);
  });
});

describe("porAtencao — quem está pior primeiro", () => {
  const grandeProblema = unidade({
    nome: "Grande problema",
    abertoCents: 50_000_000,
    vencidoCents: 8_000_000, // R$ 80 mil vencidos
    taxaPercent: 16,
    limitePercent: 5,
  });
  const pequenaCem = unidade({
    nome: "Pequena cem",
    abertoCents: 30_000,
    vencidoCents: 30_000, // R$ 300 vencidos, 100%
    taxaPercent: 100,
    limitePercent: 5,
  });
  const emDia = unidade({
    nome: "Em dia",
    abertoCents: 10_000_000,
    vencidoCents: 0,
    taxaPercent: 0,
    limitePercent: 5,
  });
  const semNada = unidade({ nome: "Sem nada", taxaPercent: null });

  it("VALOR VENCIDO manda entre as que estouraram o limite, não a taxa", () => {
    // ⚠️ A pequena tem 100% e a grande tem 16% — ordenar por TAXA colocaria os
    // R$ 300 na frente dos R$ 80 mil. Vai-se atrás dos R$ 80 mil primeiro.
    const ordem = [pequenaCem, grandeProblema].sort(porAtencao).map((u) => u.nome);
    expect(ordem).toEqual(["Grande problema", "Pequena cem"]);
  });

  it("quem estourou vem antes de quem está dentro do limite", () => {
    const ordem = [emDia, pequenaCem].sort(porAtencao).map((u) => u.nome);
    expect(ordem).toEqual(["Pequena cem", "Em dia"]);
  });

  it("unidade sem nada a receber vai para o fim", () => {
    const ordem = [semNada, emDia, grandeProblema]
      .sort(porAtencao)
      .map((u) => u.nome);
    expect(ordem).toEqual(["Grande problema", "Em dia", "Sem nada"]);
  });
});

describe("totaisDaRede", () => {
  const a = unidade({
    nome: "A",
    abertoCents: 100_000,
    vencidoCents: 20_000,
    vencidoQuantidade: 2,
    taxaPercent: 20,
    limitePercent: 5,
    aVencer: [10, 20, 30, 40],
    atrasadas: [1, 2, 3, 4],
  });
  const b = unidade({
    nome: "B",
    abertoCents: 300_000,
    vencidoCents: 0,
    taxaPercent: 0,
    limitePercent: 5,
    aVencer: [100, 200, 300, 400],
    atrasadas: [0, 0, 0, 0],
  });
  const c = unidade({ nome: "C", taxaPercent: null });

  it("soma as faixas coluna a coluna", () => {
    const t = totaisDaRede([a, b, c]);
    expect(t.aVencer).toEqual([110, 220, 330, 440]);
    expect(t.atrasadas).toEqual([1, 2, 3, 4]);
  });

  it("conta quem estourou e quem não tem o que medir, separadamente", () => {
    const t = totaisDaRede([a, b, c]);
    expect(t.acimaDoLimite).toBe(1); // só a A
    expect(t.semReceber).toBe(1); // a C
    expect(t.unidades).toBe(3);
  });

  it("a taxa dos totais é a ponderada, não a média", () => {
    const t = totaisDaRede([a, b, c]);
    expect(t.taxaPercent).toBe(5); // 20.000 / 400.000
    // A média simples de 20% e 0% seria 10% — o dobro.
  });
});
