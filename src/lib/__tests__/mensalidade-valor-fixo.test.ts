import { describe, expect, it } from "vitest";
import {
  ehValorFixo,
  fixoDoFechamento,
  implantacaoDoFixo,
  mensalidadeDoFixo,
} from "@/lib/empresarial/mensalidade";
import { contaDoExcedente } from "@/lib/empresarial/excedente";

describe("valor fixo por empresa (AP18 — regras do dono, 27/09/2026)", () => {
  it("⚠️ o exemplo: R$ 5.000 para 100; o termo leva a R$ 6.000 para 120", () => {
    // 1ª etapa: a mensalidade É o fixo.
    expect(mensalidadeDoFixo(500000, [])).toBe(500000);
    // Termo "novo valor fixo": a diferença é novo fixo − fixo ATUAL.
    const termo = contaDoExcedente(
      {
        modo: "NEW_FIXED",
        fixoCents: 600000,
        titularCents: null,
        dependenteCents: null,
        mensalidadeAtualCents: mensalidadeDoFixo(500000, [])!,
        implantacaoPorAdesaoCents: 0,
      },
      20,
      0
    );
    expect(termo.mensalDeltaCents).toBe(100000);
    // Aceito o termo, a mensalidade vira exatamente o novo pacote.
    expect(mensalidadeDoFixo(500000, [termo.mensalDeltaCents])).toBe(600000);
  });

  it("antes da correção a base do termo era titulares × preço — agora é o fixo", () => {
    // 100 ativos × R$ 60 = R$ 6.000 → diferença ZERO (o termo não cobrava nada).
    const errado = contaDoExcedente(
      { modo: "NEW_FIXED", fixoCents: 600000, titularCents: null, dependenteCents: null, mensalidadeAtualCents: 100 * 6000, implantacaoPorAdesaoCents: 0 },
      20, 0
    );
    expect(errado.mensalDeltaCents).toBe(0);
    const certo = contaDoExcedente(
      { modo: "NEW_FIXED", fixoCents: 600000, titularCents: null, dependenteCents: null, mensalidadeAtualCents: mensalidadeDoFixo(500000, [])!, implantacaoPorAdesaoCents: 0 },
      20, 0
    );
    expect(certo.mensalDeltaCents).toBe(100000);
  });

  it("dois termos somam; o histórico explica cada centavo", () => {
    expect(mensalidadeDoFixo(500000, [100000, 50000])).toBe(650000);
  });

  it("sem o fixo cadastrado não há conta (nulo, nunca zero)", () => {
    expect(mensalidadeDoFixo(null, [])).toBeNull();
    expect(mensalidadeDoFixo(undefined, [100000])).toBeNull();
  });

  it("implantação = 1º pagamento: um mês do fixo, depois só o acréscimo", () => {
    expect(implantacaoDoFixo(500000, [])).toEqual({ tipo: "primeira", aCobrarCents: 500000 });
    // Termo aceito (+R$ 1.000): a implantação da 2ª etapa é o acréscimo.
    expect(implantacaoDoFixo(600000, [500000])).toEqual({ tipo: "diferenca", aCobrarCents: 100000, jaCobradoCents: 500000 });
    // Clique duplo: nada a cobrar.
    expect(implantacaoDoFixo(600000, [500000, 100000])).toEqual({ tipo: "nada", jaCobradoCents: 600000 });
  });

  it("o fixo do fechamento é o da proposta com a faixa do tamanho da empresa", () => {
    const faixas = [{ minQuantity: 100, priceCents: 450000 }, { minQuantity: 200, priceCents: 800000 }];
    expect(fixoDoFechamento(500000, faixas, 150)).toBe(450000);
    expect(fixoDoFechamento(500000, faixas, 50)).toBe(500000);
    expect(fixoDoFechamento(500000, [], 150)).toBe(500000);
  });

  it("só FIXED_PER_COMPANY é valor fixo", () => {
    expect(ehValorFixo("FIXED_PER_COMPANY")).toBe(true);
    expect(ehValorFixo("PER_EMPLOYEE")).toBe(false);
    expect(ehValorFixo(null)).toBe(false);
    expect(ehValorFixo("outra")).toBe(false);
  });
});
