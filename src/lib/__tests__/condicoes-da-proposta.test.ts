import { describe, expect, it } from "vitest";
import {
  avisoDoValorMinimo,
  avisosDosLimites,
  custoDaImplantacao,
  custoDosDependentes,
  precoDaFaixa,
  problemasDasFaixas,
  rotuloDaFaixa,
  type PrecoDeDependente,
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

describe("o preço dos dependentes", () => {
  const preco: PrecoDeDependente = {
    modo: "FAMILY_PACKAGE",
    individualCents: 3990,
    familiaCents: 5990,
    extraCents: 1990,
    tamanhoDaFamilia: 3,
  };

  it("por dependente é conta fechada, não estimativa", () => {
    const r = custoDosDependentes({ ...preco, modo: "PER_DEPENDENT" }, 10, null);
    expect(r.totalCents).toBe(10 * 3990);
    expect(r.estimado).toBe(false);
  });

  it("um dependente por titular paga o INDIVIDUAL", () => {
    const r = custoDosDependentes(preco, 4, 4);
    expect(r.totalCents).toBe(4 * 3990);
    expect(r.estimado).toBe(true);
  });

  it("dois ou três por titular pagam o PACOTE, não o dobro", () => {
    // É o ponto do pacote: 3 dependentes de um titular custam R$ 59,90, e não
    // 3 × R$ 39,90.
    expect(custoDosDependentes(preco, 3, 1).totalCents).toBe(5990);
    expect(custoDosDependentes(preco, 6, 3).totalCents).toBe(3 * 5990);
  });

  it("acima do pacote, cada um a mais custa o EXTRA", () => {
    // 5 dependentes de um titular = pacote (3) + 2 extras.
    expect(custoDosDependentes(preco, 5, 1).totalCents).toBe(5990 + 2 * 1990);
  });

  it("o resto da divisão vai para os primeiros, um a cada", () => {
    // 5 dependentes entre 2 titulares = 3 e 2 → pacote + pacote.
    const r = custoDosDependentes(preco, 5, 2);
    expect(r.totalCents).toBe(2 * 5990);
  });

  it("SEM saber quantos titulares terão dependentes, NÃO inventa distribuição", () => {
    const r = custoDosDependentes(preco, 9, null);
    expect(r.totalCents).toBe(9 * 3990);
    expect(r.estimado).toBe(true);
    expect(r.explicacao).toMatch(/Sem saber/);
  });

  it("zero dependente custa zero e não é estimativa", () => {
    const r = custoDosDependentes(preco, 0, 5);
    expect(r.totalCents).toBe(0);
    expect(r.estimado).toBe(false);
  });

  it("o pacote familiar SEMPRE se declara estimativa", () => {
    // Na hora da proposta ninguém sabe a distribuição real. Fingir precisão
    // faria a primeira fatura não bater, sem ninguém saber por quê.
    expect(custoDosDependentes(preco, 8, 4).estimado).toBe(true);
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
