import { describe, expect, it } from "vitest";
import {
  avisoDaMargem,
  margemComBeneficio,
  type CustoDoProcedimento,
} from "@/lib/empresarial/margem-do-beneficio";

const CUSTO: CustoDoProcedimento = {
  precoCents: 20_000, // R$ 200,00
  repasseCents: 5_000, // R$ 50,00 — FIXO, não cai com o desconto
  materialCents: 2_000, // R$ 20,00
  taxaPercent: 3,
  temRepasse: true,
  temMaterial: true,
};

describe("a margem de cada benefício", () => {
  it("sem benefício, é a margem cheia", () => {
    const m = margemComBeneficio(CUSTO, null);
    // 200 − (50 + 20 + 3% de 200 = 6) = 124
    expect(m.margemComBeneficioCents).toBe(12_400);
    expect(m.custoDoBeneficioCents).toBe(0);
  });

  it("O DESCONTO SAI INTEIRO DA MARGEM — o repasse não cai junto", () => {
    // É a consequência do repasse fixo, e é o motivo de esta tela existir:
    // 40% de desconto tira R$ 80 do preço e R$ 77,60 da margem.
    const m = margemComBeneficio(CUSTO, {
      benefitType: "DISCOUNT_PERCENT",
      benefitValue: 40,
    });
    expect(m.precoComBeneficioCents).toBe(12_000);
    // 120 − (50 + 20 + 3% de 120 = 3,60) = 46,40
    expect(m.margemComBeneficioCents).toBe(4_640);
    expect(m.custoDoBeneficioCents).toBe(12_400 - 4_640);
  });

  it("SEM CUSTO deixa a margem NEGATIVA, e o sistema diz isso", () => {
    // O procedimento gratuito não é "margem zero": ele custa o repasse e o
    // material, que continuam sendo pagos.
    const m = margemComBeneficio(CUSTO, { benefitType: "FREE", benefitValue: null });
    expect(m.precoComBeneficioCents).toBe(0);
    expect(m.margemComBeneficioCents).toBe(-7_000);
    expect(m.negativa).toBe(true);
    expect(avisoDaMargem(m)).toMatch(/prejuízo/);
  });

  it("no gratuito NÃO se cobra taxa de cartão — não houve cobrança", () => {
    const m = margemComBeneficio(CUSTO, { benefitType: "FREE", benefitValue: null });
    expect(m.custoCents).toBe(7_000); // repasse + material, sem taxa
  });

  it("NÃO COBERTO é preço cheio, e margem cheia", () => {
    const m = margemComBeneficio(CUSTO, {
      benefitType: "NOT_COVERED",
      benefitValue: null,
    });
    expect(m.precoComBeneficioCents).toBe(20_000);
    expect(m.custoDoBeneficioCents).toBe(0);
  });

  it("desconto em reais desconta os reais", () => {
    const m = margemComBeneficio(CUSTO, {
      benefitType: "DISCOUNT_AMOUNT",
      benefitValue: 5_000,
    });
    expect(m.precoComBeneficioCents).toBe(15_000);
  });
});

describe("quando o sistema não sabe o custo", () => {
  it("DECLARA o que falta em vez de mostrar margem cheia com cara de verdade", () => {
    // Custo zero faz a margem parecer 100% — o número mais perigoso que esta
    // tela poderia mostrar, porque convida a dar desconto que não existe.
    const m = margemComBeneficio(
      {
        ...CUSTO,
        repasseCents: 0,
        materialCents: 0,
        taxaPercent: 0,
        temRepasse: false,
        temMaterial: false,
      },
      null
    );
    expect(m.margemPercent).toBe(100);
    expect(m.faltaSaber).toHaveLength(3);
    expect(avisoDaMargem(m)).toMatch(/teto otimista/);
  });

  it("com tudo cadastrado, não há aviso nenhum", () => {
    expect(avisoDaMargem(margemComBeneficio(CUSTO, null))).toBeNull();
  });

  it("falta só o material, e a frase diz só isso", () => {
    const m = margemComBeneficio({ ...CUSTO, temMaterial: false }, null);
    expect(m.faltaSaber).toEqual(["o custo de material"]);
    expect(avisoDaMargem(m)).toContain("custo de material");
    expect(avisoDaMargem(m)).not.toContain("repasse");
  });
});

describe("o percentual", () => {
  it("é sobre o que a pessoa PAGA, não sobre o preço de tabela", () => {
    // Sobre a tabela, todo desconto pareceria menos grave do que é.
    const m = margemComBeneficio(CUSTO, {
      benefitType: "DISCOUNT_PERCENT",
      benefitValue: 50,
    });
    expect(m.precoComBeneficioCents).toBe(10_000);
    expect(m.margemPercent).toBe(27); // 2.700 / 10.000
  });

  it("preço cobrado zero não vira divisão por zero", () => {
    const m = margemComBeneficio(CUSTO, { benefitType: "FREE", benefitValue: null });
    expect(m.margemPercent).toBeNull();
  });
});
