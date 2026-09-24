import { describe, expect, it } from "vitest";
import {
  VALIDADE_PADRAO_DIAS,
  comoSeraCobrado,
  comparacaoComOAtual,
  quemPagaOQue,
  validadeDaProposta,
} from "@/lib/empresarial/documento-da-proposta";
import { simularProposta } from "@/lib/empresarial/proposta";

describe("validade da proposta", () => {
  it("atravessa a virada do mês sem escorregar um dia", () => {
    // O erro clássico do módulo (fuso): montar Date com texto e perder o dia.
    expect(validadeDaProposta("2026-09-23", 15).iso).toBe("2026-10-08");
    expect(validadeDaProposta("2026-09-23", 15).texto).toBe("08/10/2026");
  });

  it("o padrão é um número só, em um lugar só", () => {
    expect(validadeDaProposta("2026-01-01").iso).toBe(
      validadeDaProposta("2026-01-01", VALIDADE_PADRAO_DIAS).iso
    );
  });
});

describe("quem paga o quê — a frase que vai para a empresa", () => {
  it("integral e titular são frases fechadas, sem número solto", () => {
    expect(quemPagaOQue("COMPANY_PAYS", null, null)).toContain(
      "custeia integralmente"
    );
    expect(quemPagaOQue("EMPLOYEE_PAYS", null, null)).toContain(
      "própria mensalidade"
    );
  });

  it("parcial em percentual diz o percentual", () => {
    expect(quemPagaOQue("COMPANY_PARTIAL", "PERCENT", 60)).toContain("60%");
  });

  it("parcial em valor NÃO inventa percentual", () => {
    // Subsídio em reais por titular não é uma fatia fixa da mensalidade:
    // escrever "%" aqui seria afirmar algo que a conta não sustenta.
    const frase = quemPagaOQue("COMPANY_PARTIAL", "AMOUNT", 2500);
    expect(frase).not.toContain("%");
    expect(frase).toContain("custeia parte");
  });
});

describe("como será cobrado", () => {
  it("valor fixo por empresa não fala em vidas", () => {
    const t = comoSeraCobrado("unico", "FIXED_PER_COMPANY");
    expect(t).toContain("Valor fixo mensal por empresa");
    expect(t).toContain("fatura única");
  });

  it("por CNPJ avisa que a cobrança se divide", () => {
    expect(comoSeraCobrado("por_cnpj", "PER_EMPLOYEE")).toContain("cada CNPJ");
  });

  it("sem modelo escolhido, não afirma nada sobre a fatura", () => {
    const t = comoSeraCobrado(null, "PER_EMPLOYEE");
    expect(t).toContain("por vida ativa");
    expect(t).not.toContain("fatura");
  });
});

describe("a comparação com o convênio atual", () => {
  const base = {
    basis: "PER_EMPLOYEE" as const,
    employeeCount: 10,
    holderFeeCents: 5_000,
    includeDependents: false,
    dependentsCount: 0,
    dependentFeeCents: 0,
    fixedMonthlyCents: 0,
    implantationPerEmployeeCents: 0,
    paymentModel: "COMPANY_PAYS" as const,
    subsidyType: null,
    subsidyValue: 0,
  };

  it("cala quando não se sabe o que a empresa paga hoje", () => {
    // "Economia de R$ 0,00" seria uma afirmação, e ela seria falsa.
    const r = simularProposta({ ...base, currentPlanMonthlyCents: null });
    expect(comparacaoComOAtual(r)).toBeNull();
  });

  it("MOSTRA quando o programa custa mais — e diz qual é o argumento", () => {
    const r = simularProposta({ ...base, currentPlanMonthlyCents: 30_000 });
    expect(r.economiaMensalCents).toBeLessThan(0);
    const t = comparacaoComOAtual(r);
    expect(t).toContain("maior que o do convênio atual");
    expect(t).toContain("cobertura");
  });

  it("empate é empate, não economia", () => {
    const r = simularProposta({ ...base, currentPlanMonthlyCents: 50_000 });
    expect(comparacaoComOAtual(r)).toContain("equivalente");
  });
});
