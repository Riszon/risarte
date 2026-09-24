import { describe, expect, it } from "vitest";
import {
  computeMonthlyCents,
  dependentPlanCostCents,
  type AdhesionPricing,
  type MonthlyEmployee,
} from "@/lib/empresarial/pricing";

/**
 * A MENSALIDADE DA EMPRESA depois que a proposta passou a mandar (OC-00083,
 * H4/1018): as faixas negociadas valem na cobrança, e o pacote familiar
 * deixou de ter o "3" escrito dentro da função.
 */

const PRECOS: AdhesionPricing = {
  holderFeeCents: 3990,
  dependentIndividualFeeCents: 3990,
  dependentFamilyFeeCents: 5990,
  dependentFamilyExtraFeeCents: 1990,
  maxInstallments: 24,
};

const titulares = (n: number): MonthlyEmployee[] =>
  Array.from({ length: n }, () => ({
    status: "ACTIVE",
    dependentPlan: "NONE",
    activeDependentCount: 0,
  }));

describe("a mensalidade com as faixas da proposta", () => {
  it("SEM faixa, é exatamente a conta de sempre", () => {
    // É o que protege toda empresa já cadastrada: tabela nova não muda preço.
    expect(computeMonthlyCents(PRECOS, titulares(120)).totalCents).toBe(120 * 3990);
  });

  it("a faixa alcançada vale para TODOS os titulares", () => {
    const r = computeMonthlyCents(PRECOS, titulares(120), [
      { minQuantity: 50, priceCents: 3490 },
      { minQuantity: 100, priceCents: 2990 },
    ]);
    expect(r.totalCents).toBe(120 * 2990);
    expect(r.holdersCents).toBe(120 * 2990);
  });

  it("A FAIXA É RECALCULADA PELA QUANTIDADE DE HOJE — é o que foi vendido", () => {
    // Congelar a faixa no fechamento faria a empresa crescer para 150 e
    // continuar pagando o preço de 50. "Cresça e pague menos" é o que ela
    // comprou, e a conta precisa cumprir isso sozinha.
    const faixas = [{ minQuantity: 100, priceCents: 2990 }];
    expect(computeMonthlyCents(PRECOS, titulares(99), faixas).totalCents).toBe(99 * 3990);
    expect(computeMonthlyCents(PRECOS, titulares(100), faixas).totalCents).toBe(
      100 * 2990
    );
  });

  it("titular INATIVO não conta para a faixa nem para a conta", () => {
    // Quem saiu não pode baratear o preço de quem ficou.
    const lista: MonthlyEmployee[] = [
      ...titulares(99),
      { status: "INACTIVE", dependentPlan: "NONE", activeDependentCount: 0 },
      { status: "DELETED", dependentPlan: "NONE", activeDependentCount: 0 },
    ];
    const r = computeMonthlyCents(PRECOS, lista, [{ minQuantity: 100, priceCents: 2990 }]);
    expect(r.holdersCount).toBe(99);
    expect(r.totalCents).toBe(99 * 3990);
  });

  it("os dependentes seguem a própria regra, sem entrar na faixa do titular", () => {
    const comDeps: MonthlyEmployee[] = [
      { status: "ACTIVE", dependentPlan: "FAMILY", activeDependentCount: 2 },
    ];
    const r = computeMonthlyCents(PRECOS, comDeps, [
      { minQuantity: 1, priceCents: 1000 },
    ]);
    expect(r.holdersCents).toBe(1000);
    expect(r.dependentsCents).toBe(5990);
  });
});

describe("o tamanho do pacote familiar deixou de ser um número no código", () => {
  it("sem negociar nada, o pacote continua cobrindo 3", () => {
    // Era o que a 0097 fazia com um `- 3` dentro da função. Mudar o padrão
    // seria mexer no preço de todo mundo sem ninguém pedir.
    expect(dependentPlanCostCents(PRECOS, "FAMILY_EXTRA", 5)).toBe(5990 + 2 * 1990);
  });

  it("pacote negociado MAIOR cobre mais e cobra menos extras", () => {
    const maior = { ...PRECOS, dependentFamilySize: 5 };
    expect(dependentPlanCostCents(maior, "FAMILY_EXTRA", 5)).toBe(5990);
    expect(dependentPlanCostCents(maior, "FAMILY_EXTRA", 7)).toBe(5990 + 2 * 1990);
  });

  it("pacote negociado MENOR cobra extra mais cedo", () => {
    const menor = { ...PRECOS, dependentFamilySize: 2 };
    expect(dependentPlanCostCents(menor, "FAMILY_EXTRA", 3)).toBe(5990 + 1990);
  });

  it("pacote de tamanho impossível não quebra a conta", () => {
    // Zero cobertos não é pacote; a conta trata como 1 em vez de devolver
    // número estranho.
    const zero = { ...PRECOS, dependentFamilySize: 0 };
    expect(dependentPlanCostCents(zero, "FAMILY_EXTRA", 3)).toBe(5990 + 2 * 1990);
  });
});
