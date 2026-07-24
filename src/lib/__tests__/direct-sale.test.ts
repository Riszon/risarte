import { describe, expect, it } from "vitest";
import {
  canCloseDirectSale,
  canLaunchDirectSaleProcedure,
  directSaleFinalCents,
  directSaleStatusOf,
  directSaleViolations,
  isZeroValueSale,
  type DirectSaleFlags,
} from "@/lib/direct-sale";
import { resolveCommercialRule, type CommercialRuleRow } from "@/lib/commercial";

// Venda direta na unidade (docs/COMERCIAL.md §7): quem lança, quem fecha, e a
// regra comercial que BLOQUEIA o fechamento (não vai a autorização).

const flags = (p: Partial<DirectSaleFlags> = {}): DirectSaleFlags => ({
  directSale: true,
  reception: false,
  sdr: false,
  ...p,
});

describe("canLaunchDirectSaleProcedure", () => {
  it("procedimento não autorizado ninguém lança (nem admin)", () => {
    expect(
      canLaunchDirectSaleProcedure([], true, flags({ directSale: false }))
    ).toBe(false);
  });

  it("gerente e coordenador lançam todos os autorizados", () => {
    expect(canLaunchDirectSaleProcedure(["unit_manager"], false, flags())).toBe(
      true
    );
    expect(
      canLaunchDirectSaleProcedure(["clinical_coordinator"], false, flags())
    ).toBe(true);
  });

  it("recepção e SDR só os liberados para elas", () => {
    expect(canLaunchDirectSaleProcedure(["receptionist"], false, flags())).toBe(
      false
    );
    expect(
      canLaunchDirectSaleProcedure(
        ["receptionist"],
        false,
        flags({ reception: true })
      )
    ).toBe(true);
    expect(canLaunchDirectSaleProcedure(["sdr"], false, flags())).toBe(false);
    expect(
      canLaunchDirectSaleProcedure(["sdr"], false, flags({ sdr: true }))
    ).toBe(true);
  });
});

describe("canCloseDirectSale", () => {
  it("gerente e recepcionista fecham qualquer venda", () => {
    expect(canCloseDirectSale(["unit_manager"], false, [flags()])).toBe(true);
    expect(canCloseDirectSale(["receptionist"], false, [flags()])).toBe(true);
  });

  it("coordenador clínico NUNCA fecha", () => {
    expect(
      canCloseDirectSale(["clinical_coordinator"], false, [
        flags({ reception: true, sdr: true }),
      ])
    ).toBe(false);
  });

  it("SDR só fecha quando TODOS os itens são liberados para SDR", () => {
    expect(
      canCloseDirectSale(["sdr"], false, [flags({ sdr: true }), flags({ sdr: true })])
    ).toBe(true);
    expect(
      canCloseDirectSale(["sdr"], false, [flags({ sdr: true }), flags()])
    ).toBe(false);
    expect(canCloseDirectSale(["sdr"], false, [])).toBe(false);
  });
});

describe("directSaleFinalCents", () => {
  const base = {
    subtotalCents: 100000,
    programDiscountCents: 0,
    discountCents: 0,
    surchargeCents: 0,
    installments: 1,
    paymentMethod: null,
  };

  it("subtrai programa e desconto, soma acréscimo", () => {
    expect(
      directSaleFinalCents({
        ...base,
        programDiscountCents: 20000,
        discountCents: 5000,
        surchargeCents: 1000,
      })
    ).toBe(76000);
  });

  it("nunca fica negativo (programa cobre tudo)", () => {
    expect(
      directSaleFinalCents({ ...base, programDiscountCents: 150000 })
    ).toBe(0);
  });
});

describe("directSaleViolations", () => {
  const rule = resolveCommercialRule(
    [
      {
        clinic_id: null,
        max_discount_percent: 10,
        max_installments: 6,
        allowed_methods: ["pix", "boleto"],
      } as CommercialRuleRow,
    ],
    null
  );
  const base = {
    subtotalCents: 100000,
    programDiscountCents: 0,
    discountCents: 0,
    surchargeCents: 0,
    installments: 1,
    paymentMethod: "pix" as const,
  };

  it("dentro da regra = pode fechar", () => {
    expect(
      directSaleViolations({ ...base, discountCents: 10000 }, rule, {
        isManager: false,
      })
    ).toEqual([]);
  });

  it("desconto acima do máximo bloqueia", () => {
    const v = directSaleViolations({ ...base, discountCents: 15000 }, rule, {
      isManager: false,
    });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("Desconto");
  });

  it("desconto de programa não conta como desconto negociado", () => {
    // 50% de programa + 10% de desconto sobre o que sobrou = dentro da regra.
    expect(
      directSaleViolations(
        { ...base, programDiscountCents: 50000, discountCents: 5000 },
        rule,
        { isManager: false }
      )
    ).toEqual([]);
  });

  it("desconto é % do preço cheio (após programa), não do já descontado", () => {
    // R$600 sem programa, 10% máx = R$60. Um desconto de R$60 passa; R$61 não.
    const base = {
      subtotalCents: 60000,
      programDiscountCents: 0,
      surchargeCents: 0,
      installments: 1,
      paymentMethod: "pix" as const,
    };
    expect(
      directSaleViolations({ ...base, discountCents: 6000 }, rule, {
        isManager: false,
      })
    ).toEqual([]);
    expect(
      directSaleViolations({ ...base, discountCents: 6100 }, rule, {
        isManager: false,
      })
    ).toHaveLength(1);
  });

  it("acréscimo só o Gerente", () => {
    expect(
      directSaleViolations({ ...base, surchargeCents: 5000 }, rule, {
        isManager: false,
      })
    ).toHaveLength(1);
    expect(
      directSaleViolations({ ...base, surchargeCents: 5000 }, rule, {
        isManager: true,
      })
    ).toEqual([]);
  });

  it("sem desconto configurado na rede, qualquer desconto é bloqueado", () => {
    const noRule = resolveCommercialRule([], null);
    const v = directSaleViolations({ ...base, discountCents: 100 }, noRule, {
      isManager: true,
    });
    expect(v).toHaveLength(1);
  });

  it("parcelas e meio de pagamento fora da regra acumulam", () => {
    const v = directSaleViolations(
      { ...base, installments: 12, paymentMethod: "cartao_parcelado" },
      rule,
      { isManager: true }
    );
    expect(v).toHaveLength(2);
  });
});

describe("directSaleStatusOf", () => {
  it("só é concluída com contrato assinado E pagamento confirmado", () => {
    expect(
      directSaleStatusOf({
        contractSigned: true,
        paymentIssued: true,
        paymentConfirmed: true,
      })
    ).toBe("concluida");
  });

  it("cobrança emitida sem confirmação fica pendente", () => {
    expect(
      directSaleStatusOf({
        contractSigned: true,
        paymentIssued: true,
        paymentConfirmed: false,
      })
    ).toBe("cobranca_emitida");
  });

  it("nada marcado = aguardando fechamento", () => {
    expect(
      directSaleStatusOf({
        contractSigned: false,
        paymentIssued: false,
        paymentConfirmed: false,
      })
    ).toBe("aguardando_fechamento");
  });
});

describe("isZeroValueSale", () => {
  it("valor zerado por programa = pagamento já realizado", () => {
    expect(isZeroValueSale(0)).toBe(true);
    expect(isZeroValueSale(1)).toBe(false);
  });
});
