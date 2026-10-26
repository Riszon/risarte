import { describe, expect, it } from "vitest";
import {
  avisoDoQuadro,
  estimativaDaProposta,
  pricingDaProposta,
  dependentesDoQuadro,
  estimativaDosDependentes,
  lerQuadro,
  problemasDoQuadro,
} from "@/lib/empresarial/dependentes-da-proposta";
import {
  computeMonthlyCents,
  custoDosDependentesDoTitular,
  dependentPlanCostCents,
  pricingFromRow,
  type AdhesionPricing,
  type MonthlyEmployee,
} from "@/lib/empresarial/pricing";
import { camposDaEmpresa } from "@/lib/empresarial/proposta";

/**
 * OS DEPENDENTES NA PROPOSTA E NA COBRANÇA (1032, dono em 26/10/2026).
 */

const FAMILIAR: AdhesionPricing = {
  holderFeeCents: 3990,
  dependentIndividualFeeCents: 3990,
  dependentFamilyFeeCents: 5990,
  dependentFamilyExtraFeeCents: 1990,
  maxInstallments: 24,
  dependentFamilySize: 3,
  dependentMode: "FAMILY_PACKAGE",
};
const INDIVIDUAL: AdhesionPricing = { ...FAMILIAR, dependentMode: "PER_DEPENDENT" };

// O exemplo do próprio pedido: 3 sem, 4 com 1, 2 com 2, 3 com 3, 1 com 4.
const QUADRO = [
  { dependentes: 0, titulares: 3 },
  { dependentes: 1, titulares: 4 },
  { dependentes: 2, titulares: 2 },
  { dependentes: 3, titulares: 3 },
  { dependentes: 4, titulares: 1 },
];

describe("o preço dos dependentes de UM titular — a régua da cobrança", () => {
  it("familiar: 1 paga o individual, 2 e 3 o pacote, acima do pacote o extra", () => {
    expect(custoDosDependentesDoTitular(FAMILIAR, 0)).toBe(0);
    expect(custoDosDependentesDoTitular(FAMILIAR, 1)).toBe(3990);
    expect(custoDosDependentesDoTitular(FAMILIAR, 2)).toBe(5990);
    expect(custoDosDependentesDoTitular(FAMILIAR, 3)).toBe(5990);
    expect(custoDosDependentesDoTitular(FAMILIAR, 4)).toBe(5990 + 1990);
  });

  it("individual: cada dependente paga o valor individual — a cobrança passa a seguir a proposta", () => {
    expect(custoDosDependentesDoTitular(INDIVIDUAL, 3)).toBe(3 * 3990);
  });

  it("⚠️ pacote de 2: o 3º dependente paga o extra (antes o rótulo FAMILY escondia)", () => {
    // O banco chama de FAMILY quem tem 2 ou 3 (o 3 está fixo na 1002); com o
    // pacote combinado em 2, o extra do 3º nunca era cobrado.
    const pacoteDe2 = { ...FAMILIAR, dependentFamilySize: 2 };
    expect(dependentPlanCostCents(pacoteDe2, "FAMILY", 3)).toBe(5990 + 1990);
  });

  it("empresa antiga, sem o campo novo, continua no pacote familiar", () => {
    const antigo: AdhesionPricing = { ...FAMILIAR, dependentMode: undefined };
    expect(custoDosDependentesDoTitular(antigo, 3)).toBe(5990);
  });

  it("a linha do banco vira o preço com o tamanho do pacote e o modo", () => {
    const p = pricingFromRow({
      company_id: "x",
      holder_fee_cents: 1,
      dependent_individual_fee_cents: 2,
      dependent_family_fee_cents: 3,
      dependent_family_extra_fee_cents: 4,
      max_installments: 5,
      dependent_family_size: 2,
      dependent_mode: "PER_DEPENDENT",
    });
    expect(p.dependentFamilySize).toBe(2);
    expect(p.dependentMode).toBe("PER_DEPENDENT");
  });
});

describe("o quadro da proposta", () => {
  it("o exemplo do pedido: soma família a família", () => {
    const r = estimativaDosDependentes({
      calculo: "DISTRIBUTION",
      pricing: FAMILIAR,
      quadro: QUADRO,
      dependentes: 0,
    })!;
    // 4×39,90 + 2×59,90 + 3×59,90 + 1×(59,90+19,90)
    expect(r.totalCents).toBe(4 * 3990 + 2 * 5990 + 3 * 5990 + (5990 + 1990));
    expect(r.dependentes).toBe(4 + 4 + 9 + 4);
  });

  it("⚠️ A PROPOSTA E O BOLETO DÃO O MESMO NÚMERO com o quadro certo", () => {
    const familias: MonthlyEmployee[] = QUADRO.flatMap((l) =>
      Array.from({ length: l.titulares }, () => ({
        status: "ACTIVE" as const,
        dependentPlan: l.dependentes === 0 ? ("NONE" as const) : ("FAMILY" as const),
        activeDependentCount: l.dependentes,
      }))
    );
    for (const pricing of [FAMILIAR, INDIVIDUAL]) {
      const proposta = estimativaDosDependentes({
        calculo: "DISTRIBUTION",
        pricing,
        quadro: QUADRO,
        dependentes: 0,
      })!;
      expect(proposta.totalCents).toBe(computeMonthlyCents(pricing, familias).dependentsCents);
    }
  });

  it("como individual: dependentes × valor individual, em qualquer modo", () => {
    const r = estimativaDosDependentes({
      calculo: "AS_INDIVIDUAL",
      pricing: FAMILIAR,
      quadro: [],
      dependentes: 10,
    })!;
    expect(r.totalCents).toBe(10 * 3990);
  });

  it("não calcular devolve nulo — nunca R$ 0,00", () => {
    expect(
      estimativaDosDependentes({ calculo: "NONE", pricing: FAMILIAR, quadro: QUADRO, dependentes: 9 })
    ).toBeNull();
  });

  it("lê o quadro do banco descartando linha sem titular", () => {
    expect(
      lerQuadro([
        { dependentes: 1, titulares: 4 },
        { dependentes: 2, titulares: 0 },
        { dependentes: "3", titulares: "2" },
        "lixo",
      ])
    ).toEqual([
      { dependentes: 1, titulares: 4 },
      { dependentes: 3, titulares: 2 },
    ]);
    expect(lerQuadro(null)).toEqual([]);
    expect(dependentesDoQuadro(QUADRO)).toBe(21);
  });

  it("duas linhas com a mesma quantidade de dependentes são recusadas", () => {
    expect(
      problemasDoQuadro([
        { dependentes: 1, titulares: 2 },
        { dependentes: 1, titulares: 3 },
      ])
    ).toHaveLength(1);
    expect(problemasDoQuadro(QUADRO)).toEqual([]);
  });

  it("avisa quando o quadro não fecha com os titulares da proposta", () => {
    expect(avisoDoQuadro(QUADRO, 13)).toBeNull();
    expect(avisoDoQuadro(QUADRO, 20)).toContain("7 sem linha");
    expect(avisoDoQuadro(QUADRO, 10)).toContain("mais que");
  });
});

describe("a proposta gravada e o fechamento", () => {
  const PROPOSTA = {
    billing_basis: "PER_EMPLOYEE",
    includes_dependents: true,
    dependents_estimate: 21,
    dependent_fee_cents: 3990,
    dependent_mode: "FAMILY_PACKAGE",
    dependent_family_fee_cents: 5990,
    dependent_family_extra_fee_cents: 1990,
    dependent_family_size: 3,
    dependents_calc_mode: "DISTRIBUTION",
    dependents_distribution: QUADRO,
  };

  it("a proposta gravada estima pelo quadro", () => {
    expect(estimativaDaProposta(PROPOSTA)?.totalCents).toBe(
      4 * 3990 + 2 * 5990 + 3 * 5990 + (5990 + 1990)
    );
  });

  it("sem dependentes, no valor fixo ou sem escolha de calcular: nada", () => {
    expect(estimativaDaProposta({ ...PROPOSTA, includes_dependents: false })).toBeNull();
    expect(estimativaDaProposta({ ...PROPOSTA, billing_basis: "FIXED_PER_COMPANY" })).toBeNull();
    expect(estimativaDaProposta({ ...PROPOSTA, dependents_calc_mode: null })).toBeNull();
  });

  it("modo vazio na proposta antiga vale o plano familiar — o mesmo que a cobrança", () => {
    expect(pricingDaProposta({ dependent_mode: null }).dependentMode).toBe("FAMILY_PACKAGE");
  });

  const LEAD = { company_name: "Acme", cnpj: "12345678000190" };

  it("o fechamento congela a estimativa quando a implantação inclui dependentes", () => {
    const c = camposDaEmpresa(
      { ...PROPOSTA, implantation_includes_dependents: true } as unknown as Parameters<
        typeof camposDaEmpresa
      >[0],
      LEAD
    );
    expect(c.implantation_includes_dependents).toBe(true);
    expect(c.implantation_dependents_cents).toBe(
      estimativaDaProposta(PROPOSTA)!.totalCents
    );
  });

  it("implantação só dos titulares (o padrão) não leva valor de dependente", () => {
    const c = camposDaEmpresa(
      PROPOSTA as unknown as Parameters<typeof camposDaEmpresa>[0],
      LEAD
    );
    expect(c.implantation_includes_dependents).toBe(false);
    expect(c.implantation_dependents_cents).toBeNull();
  });
});
