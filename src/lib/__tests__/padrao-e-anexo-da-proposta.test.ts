import { describe, expect, it } from "vitest";
import {
  descontoNoAnexo,
  frasesDoResumo,
  ordenarParaOAnexo,
  percentualDoDesconto,
  resumoDosBeneficios,
  type BeneficioDoAnexo,
} from "@/lib/empresarial/beneficios-da-proposta";
import { comparacaoComOPadrao } from "@/lib/empresarial/padrao-da-proposta";
import { simularProposta, type PropostaInput } from "@/lib/empresarial/proposta";
import { DEFAULT_ADHESION_PRICING } from "@/lib/empresarial/pricing";

// ---------------------------------------------------------------------------
// Resumo e anexo dos benefícios (1036)
// ---------------------------------------------------------------------------

const b = (
  nome: string,
  benefitType: BeneficioDoAnexo["benefitType"],
  benefitValue: number | null,
  precoCents: number | null = null
): BeneficioDoAnexo => ({
  nome,
  procedureId: nome,
  benefitType,
  benefitValue,
  precoCents,
  usageLimitCount: null,
  usagePeriodMonths: null,
  gracePeriodMonths: 0,
  maxInstallments: null,
  forHolder: true,
  forDependent: true,
});

describe("quantos por cento o benefício desconta", () => {
  it("sem custo é 100%, e o desconto em % é ele mesmo", () => {
    expect(percentualDoDesconto(b("x", "FREE", null))).toBe(100);
    expect(percentualDoDesconto(b("x", "DISCOUNT_PERCENT", 30))).toBe(30);
  });
  it("desconto em reais vira % pelo preço de tabela", () => {
    expect(percentualDoDesconto(b("x", "DISCOUNT_AMOUNT", 5000, 20000))).toBe(25);
  });
  it("desconto em reais sem preço não inventa %", () => {
    expect(percentualDoDesconto(b("x", "DISCOUNT_AMOUNT", 5000, null))).toBeNull();
    expect(percentualDoDesconto(b("x", "DISCOUNT_AMOUNT", 5000, 0))).toBeNull();
  });
  it("não coberto não é desconto", () => {
    expect(percentualDoDesconto(b("x", "NOT_COVERED", null))).toBeNull();
  });
});

describe("o resumo do documento", () => {
  const lista = [
    b("Limpeza", "FREE", null),
    b("Consulta", "FREE", null),
    b("Restauração", "DISCOUNT_PERCENT", 10),
    b("Canal", "DISCOUNT_PERCENT", 40),
    b("Coroa", "DISCOUNT_AMOUNT", 10000, 50000), // 20%
    b("Clareamento", "NOT_COVERED", null),
  ];

  it("conta sem custo, a faixa dos descontos em % e o valor fixo à parte", () => {
    const r = resumoDosBeneficios(lista);
    expect(r).toEqual({
      semCusto: 2,
      comDesconto: 2,
      menorPercent: 10,
      maiorPercent: 40,
      emValorFixo: 1,
    });
    expect(frasesDoResumo(r)).toEqual([
      "2 procedimentos sem custo (R$ 0,00)",
      "2 procedimentos com descontos de 10% a 40%",
      "1 procedimento com desconto em valor fixo",
    ]);
  });

  it("o desconto em valor fixo não estica a faixa de % (o caso dos 97%)", () => {
    const r = resumoDosBeneficios([
      b("Restauração", "DISCOUNT_PERCENT", 20),
      b("Clareamento", "DISCOUNT_PERCENT", 50),
      b("Controle pós-operatório", "DISCOUNT_AMOUNT", 37000, 38000),
    ]);
    expect(frasesDoResumo(r)).toEqual([
      "2 procedimentos com descontos de 20% a 50%",
      "1 procedimento com desconto em valor fixo",
    ]);
  });

  it("um desconto só, e singular", () => {
    const r = resumoDosBeneficios([b("Limpeza", "FREE", null), b("Canal", "DISCOUNT_PERCENT", 20)]);
    expect(frasesDoResumo(r)).toEqual([
      "1 procedimento sem custo (R$ 0,00)",
      "1 procedimento com 20% de desconto",
    ]);
  });

  it("desconto em valor fixo sem preço também entra na linha própria", () => {
    const r = resumoDosBeneficios([b("Coroa", "DISCOUNT_AMOUNT", 10000, null)]);
    expect(frasesDoResumo(r)).toEqual(["1 procedimento com desconto em valor fixo"]);
  });

  it("lista vazia não escreve nada", () => {
    expect(frasesDoResumo(resumoDosBeneficios([]))).toEqual([]);
  });
});

describe("a ordem do anexo", () => {
  it("do maior desconto para o menor, empate pelo nome, sem o não coberto", () => {
    const ordem = ordenarParaOAnexo([
      b("Restauração", "DISCOUNT_PERCENT", 10),
      b("Sem preço", "DISCOUNT_AMOUNT", 1000, null),
      b("Limpeza", "FREE", null),
      b("Canal", "DISCOUNT_PERCENT", 40),
      b("Clareamento", "NOT_COVERED", null),
      b("Coroa", "DISCOUNT_AMOUNT", 10000, 25000), // 40%
      b("Consulta", "FREE", null),
    ]).map((x) => x.nome);
    expect(ordem).toEqual([
      "Consulta",
      "Limpeza",
      "Canal",
      "Coroa",
      "Restauração",
      "Sem preço",
    ]);
  });

  it("a coluna do desconto", () => {
    expect(descontoNoAnexo(b("x", "FREE", null))).toBe("Sem custo");
    expect(descontoNoAnexo(b("x", "DISCOUNT_PERCENT", 15))).toBe("15%");
    expect(descontoNoAnexo(b("x", "DISCOUNT_AMOUNT", 37000, 38000))).toBe(
      "R$ 370,00 de desconto (paga R$ 10,00)"
    );
    expect(descontoNoAnexo(b("x", "DISCOUNT_AMOUNT", 5000, null))).toBe("R$ 50,00 de desconto");
    expect(descontoNoAnexo(b("x", "DISCOUNT_AMOUNT", 150000, 250000))).toBe(
      "R$ 1.500,00 de desconto (paga R$ 1.000,00)"
    );
  });
});

// ---------------------------------------------------------------------------
// Padrão × proposta (1036)
// ---------------------------------------------------------------------------

const entrada = (mudar: Partial<PropostaInput> = {}): PropostaInput => ({
  basis: "PER_EMPLOYEE",
  employeeCount: 100,
  holderFeeCents: 2990,
  includeDependents: false,
  dependentsCount: 0,
  dependentFeeCents: 3990,
  fixedMonthlyCents: 0,
  paymentModel: "COMPANY_PAYS",
  subsidyType: null,
  subsidyValue: 0,
  currentPlanMonthlyCents: null,
  ...mudar,
});

const padrao = { ...DEFAULT_ADHESION_PRICING, holderFeeCents: 3990 };

describe("padrão × proposta", () => {
  it("proposta mais barata mostra a economia por mês e por ano", () => {
    const c = comparacaoComOPadrao({
      proposta: simularProposta(entrada()),
      padrao,
      basis: "PER_EMPLOYEE",
      titulares: 100,
      incluiDependentes: false,
      calculo: "NONE",
      quadro: [],
      dependentes: 0,
      implantacaoComDependentes: false,
    })!;
    expect(c.padraoMensalCents).toBe(399000);
    expect(c.propostaMensalCents).toBe(299000);
    expect(c.economiaMensalCents).toBe(100000);
    expect(c.economiaAnualCents).toBe(1200000);
    expect(c.economiaImplantacaoCents).toBe(100000);
    expect(c.maisBarata).toBe(true);
  });

  it("no preço padrão não há economia", () => {
    const c = comparacaoComOPadrao({
      proposta: simularProposta(entrada({ holderFeeCents: 3990 })),
      padrao,
      basis: "PER_EMPLOYEE",
      titulares: 100,
      incluiDependentes: false,
      calculo: "NONE",
      quadro: [],
      dependentes: 0,
      implantacaoComDependentes: false,
    })!;
    expect(c.economiaMensalCents).toBe(0);
    expect(c.maisBarata).toBe(false);
  });

  it("a faixa por quantidade entra na proposta, não no padrão", () => {
    const c = comparacaoComOPadrao({
      proposta: simularProposta(
        entrada({ holderFeeCents: 3990, faixas: [{ minQuantity: 50, priceCents: 3490 }] })
      ),
      padrao,
      basis: "PER_EMPLOYEE",
      titulares: 100,
      incluiDependentes: false,
      calculo: "NONE",
      quadro: [],
      dependentes: 0,
      implantacaoComDependentes: false,
    })!;
    expect(c.economiaMensalCents).toBe(50000);
  });

  it("os dependentes do padrão são contados pelo mesmo quadro, com o preço da rede", () => {
    // Proposta: 1 dependente a R$ 29,90; padrão: R$ 39,90. 10 titulares com 1.
    const quadro = [{ dependentes: 1, titulares: 10 }];
    const c = comparacaoComOPadrao({
      proposta: simularProposta(
        entrada({
          holderFeeCents: 3990,
          employeeCount: 10,
          includeDependents: true,
          dependentsCount: 10,
          dependentesEstimadosCents: 10 * 2990,
        })
      ),
      padrao,
      basis: "PER_EMPLOYEE",
      titulares: 10,
      incluiDependentes: true,
      calculo: "DISTRIBUTION",
      quadro,
      dependentes: 10,
      implantacaoComDependentes: false,
    })!;
    expect(c.padraoMensalCents).toBe(10 * 3990 + 10 * 3990);
    expect(c.economiaMensalCents).toBe(10 * 1000);
    // A implantação é só dos titulares: no mesmo preço, sem economia.
    expect(c.economiaImplantacaoCents).toBe(0);
  });

  it("se a proposta não calcula dependentes, o padrão também não", () => {
    const c = comparacaoComOPadrao({
      proposta: simularProposta(entrada({ includeDependents: true, dependentsCount: 30 })),
      padrao,
      basis: "PER_EMPLOYEE",
      titulares: 100,
      incluiDependentes: true,
      calculo: "NONE",
      quadro: [],
      dependentes: 30,
      implantacaoComDependentes: false,
    })!;
    expect(c.padraoMensalCents).toBe(399000);
  });

  it("valor fixo: o padrão conta os dependentes como individuais", () => {
    const c = comparacaoComOPadrao({
      proposta: simularProposta(
        entrada({ basis: "FIXED_PER_COMPANY", fixedMonthlyCents: 300000, includeDependents: true })
      ),
      padrao,
      basis: "FIXED_PER_COMPANY",
      titulares: 100,
      incluiDependentes: true,
      calculo: "NONE",
      quadro: [],
      dependentes: 20,
      implantacaoComDependentes: false,
    })!;
    expect(c.padraoMensalCents).toBe(100 * 3990 + 20 * DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents);
    expect(c.propostaPorTitularCents).toBeNull();
    expect(c.maisBarata).toBe(true);
  });

  it("sem titular não há comparação", () => {
    expect(
      comparacaoComOPadrao({
        proposta: simularProposta(entrada({ employeeCount: 0 })),
        padrao,
        basis: "PER_EMPLOYEE",
        titulares: 0,
        incluiDependentes: false,
        calculo: "NONE",
        quadro: [],
        dependentes: 0,
        implantacaoComDependentes: false,
      })
    ).toBeNull();
  });
});
