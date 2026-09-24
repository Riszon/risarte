import { describe, expect, it } from "vitest";
import {
  avisoDoValorMinimo,
  avisosDosLimites,
  custoDaImplantacao,
  precoDaFaixa,
  problemasDasFaixas,
  rotuloDaFaixa,
} from "@/lib/empresarial/condicoes-da-proposta";

const FAIXAS = [
  { minQuantity: 1, priceCents: 3990 },
  { minQuantity: 50, priceCents: 3490 },
  { minQuantity: 100, priceCents: 2990 },
];

describe("faixa de preço por quantidade", () => {
  it("a faixa do TOTAL vale para todos — é a decisão do dono", () => {
    // 120 adesões pagam 120 × o preço da faixa de 100.
    expect(precoDaFaixa(FAIXAS, 120, 9999).precoCents).toBe(2990);
    expect(precoDaFaixa(FAIXAS, 120, 9999).faixa?.minQuantity).toBe(100);
  });

  it("pega a MAIOR faixa alcançada, não a primeira da lista", () => {
    expect(precoDaFaixa(FAIXAS, 60, 9999).precoCents).toBe(3490);
    expect(precoDaFaixa(FAIXAS, 100, 9999).precoCents).toBe(2990);
    expect(precoDaFaixa(FAIXAS, 99, 9999).precoCents).toBe(3490);
  });

  it("a resposta NÃO depende da ordem da lista", () => {
    // Ordenar antes seria depender de quem chama — e um dia alguém chamaria
    // com a lista do jeito que o banco devolveu.
    const embaralhada = [FAIXAS[2], FAIXAS[0], FAIXAS[1]];
    expect(precoDaFaixa(embaralhada, 120, 9999).precoCents).toBe(2990);
  });

  it("SEM FAIXA, vale o preço combinado na proposta", () => {
    // É o caso normal: o pedido incluía "poder assinalar também sem regras".
    expect(precoDaFaixa([], 500, 4500).precoCents).toBe(4500);
    expect(precoDaFaixa([], 500, 4500).faixa).toBeNull();
  });

  it("quantidade abaixo da menor faixa também cai no preço combinado", () => {
    const so100 = [{ minQuantity: 100, priceCents: 2990 }];
    expect(precoDaFaixa(so100, 10, 4500).precoCents).toBe(4500);
  });
});

describe("o que impede a tabela de faixas de fazer sentido", () => {
  it("duas faixas na mesma quantidade dariam dois preços para a mesma conta", () => {
    const p = problemasDasFaixas([
      { minQuantity: 50, priceCents: 3000 },
      { minQuantity: 50, priceCents: 2000 },
    ]);
    expect(p.some((x) => x.includes("duas faixas"))).toBe(true);
  });

  it("faixa maior mais CARA é aviso, não erro", () => {
    // Quase sempre é digitação trocada; mas existe negociação em que o volume
    // custa mais. O sistema diz o que vê; quem decide é quem vende.
    const p = problemasDasFaixas([
      { minQuantity: 1, priceCents: 2000 },
      { minQuantity: 50, priceCents: 3000 },
    ]);
    expect(p.some((x) => x.includes("custa MAIS"))).toBe(true);
  });

  it("tabela que barateia com volume não tem problema nenhum", () => {
    expect(problemasDasFaixas(FAIXAS)).toEqual([]);
  });

  it("a faixa é escrita conforme a base da cobrança", () => {
    expect(rotuloDaFaixa(FAIXAS[1], true)).toBe(
      "A partir de 50 titulares: R$ 34,90 por titular"
    );
    expect(rotuloDaFaixa(FAIXAS[1], false)).toBe(
      "A partir de 50 adesões: R$ 34,90 por mês"
    );
  });
});

describe("a implantação", () => {
  it("por adesão multiplica pelos titulares", () => {
    expect(custoDaImplantacao("PER_ADHESION", 1990, 500_000, 50)).toBe(50 * 1990);
  });

  it("fixa é um valor só, independente da quantidade", () => {
    expect(custoDaImplantacao("FIXED", 1990, 500_000, 50)).toBe(500_000);
    expect(custoDaImplantacao("FIXED", 1990, 500_000, 5)).toBe(500_000);
  });

  it("sem modo escolhido, é POR ADESÃO — o comportamento que já existia", () => {
    expect(custoDaImplantacao(null, 1990, 500_000, 50)).toBe(50 * 1990);
  });
});

describe("os limites de adesão", () => {
  it("sem limite combinado, não há aviso nenhum", () => {
    expect(avisosDosLimites({ min: null, max: null, alvo: null }, 10, 5)).toEqual([]);
  });

  it("ABAIXO do mínimo avisa, não bloqueia", () => {
    // A empresa pode estar entrando aos poucos, e barrar adesão é barrar
    // receita.
    const a = avisosDosLimites({ min: 50, max: null, alvo: "HOLDERS" }, 20, 0);
    expect(a).toHaveLength(1);
    expect(a[0].gravidade).toBe("avisa");
  });

  it("ACIMA do máximo BLOQUEIA", () => {
    // O máximo costuma ser capacidade de atendimento; furá-lo é prometer o
    // que não se entrega.
    const a = avisosDosLimites({ min: null, max: 100, alvo: "HOLDERS" }, 120, 0);
    expect(a).toHaveLength(1);
    expect(a[0].gravidade).toBe("bloqueia");
  });

  it("o alvo muda o que é contado", () => {
    const so = { min: 30, max: null } as const;
    expect(avisosDosLimites({ ...so, alvo: "HOLDERS" }, 20, 50)).toHaveLength(1);
    expect(avisosDosLimites({ ...so, alvo: "DEPENDENTS" }, 20, 50)).toHaveLength(0);
    expect(avisosDosLimites({ ...so, alvo: "BOTH" }, 20, 50)).toHaveLength(0);
    expect(avisosDosLimites({ ...so, alvo: "BOTH" }, 10, 5)).toHaveLength(1);
  });

  it("sem alvo declarado, conta os titulares", () => {
    expect(avisosDosLimites({ min: 30, max: null, alvo: null }, 20, 500)).toHaveLength(1);
  });

  it("dentro dos limites, silêncio", () => {
    expect(avisosDosLimites({ min: 10, max: 100, alvo: "HOLDERS" }, 50, 0)).toEqual([]);
  });
});

describe("o valor mínimo da proposta", () => {
  it("avisa quando a mensalidade fica abaixo, e diz quanto falta", () => {
    const a = avisoDoValorMinimo(500_000, 420_000);
    expect(a?.gravidade).toBe("avisa");
    expect(a?.texto).toContain("800,00");
  });

  it("no limite exato, não avisa", () => {
    expect(avisoDoValorMinimo(500_000, 500_000)).toBeNull();
  });

  it("sem mínimo combinado, cala", () => {
    expect(avisoDoValorMinimo(null, 1)).toBeNull();
    expect(avisoDoValorMinimo(0, 1)).toBeNull();
  });
});
