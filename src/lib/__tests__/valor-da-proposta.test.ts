import { describe, expect, it } from "vitest";
import {
  valorDaPropostaGravada,
  valorNoFunil,
  type PropostaGravada,
} from "@/lib/empresarial/valor-da-proposta";

const base: PropostaGravada = {
  billing_basis: "PER_EMPLOYEE",
  employee_count: 11,
  holder_fee_cents: 3990,
  fixed_monthly_cents: null,
  includes_dependents: false,
  implantation_includes_dependents: false,
  payment_model: "COMPANY_PAYS",
  subsidy_type: null,
  subsidy_value: null,
  dental_plan_monthly_cents: null,
};

describe("o valor da proposta no funil (OC-00011)", () => {
  it("o caso relatado: faixa + dependentes pelo quadro = R$ 524,40", () => {
    const v = valorDaPropostaGravada(
      {
        ...base,
        includes_dependents: true,
        dependents_calc_mode: "DISTRIBUTION",
        dependent_fee_cents: 2290,
        dependent_family_fee_cents: 5990,
        dependent_family_extra_fee_cents: 1990,
        dependent_family_size: 3,
        dependents_distribution: [
          { dependentes: 1, titulares: 4 },
          { dependentes: 3, titulares: 1 },
        ],
      },
      [{ minQuantity: 10, priceCents: 3390 }]
    );
    expect(v).toBe(52440);
  });

  it("valor fixo por empresa", () => {
    expect(
      valorDaPropostaGravada(
        { ...base, billing_basis: "FIXED_PER_COMPANY", fixed_monthly_cents: 100000 },
        []
      )
    ).toBe(100000);
  });

  it("só levantamento, sem preço gravado: não inventa proposta com o preço padrão", () => {
    expect(valorDaPropostaGravada({ ...base, holder_fee_cents: null }, [])).toBeNull();
    expect(valorDaPropostaGravada(null, [])).toBeNull();
  });

  it("sem titulares não há valor, e R$ 0,00 não apaga o estimado", () => {
    const v = valorDaPropostaGravada({ ...base, employee_count: 0 }, []);
    expect(v).toBeNull();
    expect(valorNoFunil(v, 50000)).toBe(50000);
  });

  it("a proposta manda sobre o estimado; sem nenhum dos dois, nada", () => {
    expect(valorNoFunil(52440, 50000)).toBe(52440);
    expect(valorNoFunil(null, null)).toBeNull();
  });
});
