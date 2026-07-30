import { describe, expect, it } from "vitest";
import {
  commercialColumnOf,
  discountPercentOf,
  gutScore,
  automaticDiscountPercent,
  ruleWithProgramConditions,
  maxInstallmentsByMinimum,
  minInstallmentCentsFor,
  negotiationViolations,
  resolveCommercialRule,
  type CommercialRuleRow,
} from "@/lib/commercial";

// Regras comerciais em cascata (rede → unidade) e a validação da negociação
// (COM1) — negociação fora da regra exige autorização do Gerente da unidade.

const row = (
  clinicId: string | null,
  patch: Partial<CommercialRuleRow> = {}
): CommercialRuleRow => ({
  clinic_id: clinicId,
  max_discount_percent: null,
  max_installments: null,
  allowed_methods: null,
  ...patch,
});

describe("resolveCommercialRule", () => {
  const rows: CommercialRuleRow[] = [
    row(null, {
      max_discount_percent: 10,
      max_installments: 12,
      allowed_methods: ["pix", "boleto", "cartao"],
    }),
    row("clinic-x", { max_discount_percent: 15 }),
  ];

  it("campo da unidade vence; os demais herdam da rede", () => {
    const rule = resolveCommercialRule(rows, "clinic-x");
    expect(rule.maxDiscountPercent).toBe(15); // da unidade
    expect(rule.maxInstallments).toBe(12); // herdado da rede
    expect(rule.allowedMethods).toEqual(["pix", "boleto", "cartao"]);
  });

  it("unidade sem ajuste usa o padrão da rede", () => {
    expect(resolveCommercialRule(rows, "clinic-y").maxDiscountPercent).toBe(10);
  });

  it("sem regra nenhuma = tudo liberado (null)", () => {
    const rule = resolveCommercialRule([], "clinic-x");
    expect(rule.maxDiscountPercent).toBeNull();
    expect(rule.maxInstallments).toBeNull();
    expect(rule.allowedMethods).toBeNull();
  });

  it("descarta meios de pagamento desconhecidos gravados no banco", () => {
    const rule = resolveCommercialRule(
      [row(null, { allowed_methods: ["pix", "invalido"] })],
      null
    );
    expect(rule.allowedMethods).toEqual(["pix"]);
  });
});

describe("discountPercentOf", () => {
  it("ajuste negativo vira % de desconto sobre o subtotal", () => {
    expect(discountPercentOf(100000, -10000)).toBeCloseTo(10);
  });
  it("acréscimo ou subtotal zero = 0% de desconto", () => {
    expect(discountPercentOf(100000, 5000)).toBe(0);
    expect(discountPercentOf(0, -5000)).toBe(0);
  });
});

describe("negotiationViolations", () => {
  const rule = resolveCommercialRule(
    [
      row(null, {
        max_discount_percent: 10,
        max_installments: 12,
        allowed_methods: ["pix", "boleto"],
      }),
    ],
    null
  );

  it("dentro da regra = sem violações", () => {
    expect(
      negotiationViolations(
        {
          subtotalCents: 100000,
          adjustmentCents: -10000, // 10% (no limite)
          installments: 12,
          paymentMethod: "pix",
        },
        rule
      )
    ).toEqual([]);
  });

  it("desconto acima do máximo é violação", () => {
    const v = negotiationViolations(
      {
        subtotalCents: 100000,
        adjustmentCents: -15000, // 15%
        installments: 1,
        paymentMethod: "pix",
      },
      rule
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("Desconto");
  });

  it("parcelas e meio de pagamento fora da regra acumulam violações", () => {
    const v = negotiationViolations(
      {
        subtotalCents: 100000,
        adjustmentCents: 0,
        installments: 24,
        paymentMethod: "cartao_parcelado",
      },
      rule
    );
    expect(v).toHaveLength(2);
  });

  it("sem regra configurada, nada é violação", () => {
    expect(
      negotiationViolations(
        {
          subtotalCents: 100000,
          adjustmentCents: -90000,
          installments: 48,
          paymentMethod: "credito_recorrente",
        },
        resolveCommercialRule([], null)
      )
    ).toEqual([]);
  });
});

describe("gutScore", () => {
  it("G×U×T quando os 3 estão definidos", () => {
    expect(gutScore(5, 4, 3)).toBe(60);
  });
  it("faltando qualquer um = null", () => {
    expect(gutScore(5, null, 3)).toBeNull();
    expect(gutScore(undefined, 4, 3)).toBeNull();
  });
});

// COM3 — coluna do kanban derivada do cartão + fase + negociação.
describe("commercialColumnOf", () => {
  const base = {
    journeyPhase: "commercial_conversion",
    journeyStatus: null as string | null,
    cardStage: null,
    negotiationAccepted: false,
  };

  it("Fase 5 aguardando/tratando tem colunas próprias", () => {
    expect(
      commercialColumnOf({
        ...base,
        journeyPhase: "treatment_start",
        journeyStatus: "awaiting_treatment_start",
      })
    ).toBe("aguardando_iniciar");
    expect(
      commercialColumnOf({
        ...base,
        journeyPhase: "treatment_start",
        journeyStatus: "in_treatment",
      })
    ).toBe("tratamento_iniciado");
  });

  it("negociação aceita = fechamento (vence o estágio do cartão)", () => {
    expect(
      commercialColumnOf({
        ...base,
        cardStage: "apresentado",
        negotiationAccepted: true,
      })
    ).toBe("fechamento");
  });

  it("perdido/cancelado vêm antes do fechamento derivado", () => {
    expect(commercialColumnOf({ ...base, cardStage: "perdido" })).toBe(
      "perdido"
    );
    expect(commercialColumnOf({ ...base, cardStage: "cancelado" })).toBe(
      "cancelado"
    );
  });

  it("sem cartão = A apresentar; estágios manuais mapeiam direto", () => {
    expect(commercialColumnOf(base)).toBe("a_apresentar");
    expect(commercialColumnOf({ ...base, cardStage: "follow_up" })).toBe(
      "follow_up"
    );
    expect(
      commercialColumnOf({ ...base, cardStage: "acontecendo_agora" })
    ).toBe("acontecendo_agora");
  });

  it("follow_up_clinica (legado) é absorvido pela coluna Follow-up", () => {
    expect(
      commercialColumnOf({ ...base, cardStage: "follow_up_clinica" })
    ).toBe("follow_up");
  });
});

// I8: parcela mínima por meio de pagamento e desconto automático só à vista.

describe("parcela mínima por meio de pagamento", () => {
  const rows: CommercialRuleRow[] = [
    row(null, {
      max_installments: 24,
      min_installment_cents_by_method: { boleto: 15000, cartao_parcelado: 10000 },
    }),
    row("clinic-x", {
      min_installment_cents_by_method: { boleto: 20000 },
    }),
  ];

  it("a unidade sobrescreve só o meio que ela definiu", () => {
    const rule = resolveCommercialRule(rows, "clinic-x");
    expect(minInstallmentCentsFor(rule, "boleto")).toBe(20000);
    expect(minInstallmentCentsFor(rule, "cartao_parcelado")).toBe(10000);
    expect(minInstallmentCentsFor(rule, "pix")).toBeNull();
  });

  it("sem ajuste da unidade vale o padrão da rede", () => {
    const rule = resolveCommercialRule(rows, "clinic-y");
    expect(minInstallmentCentsFor(rule, "boleto")).toBe(15000);
  });

  it("limita as parcelas pelo mínimo do meio escolhido", () => {
    const rule = resolveCommercialRule(rows, "clinic-y");
    // R$ 1.200,00 com parcela mínima de R$ 150,00 = no máximo 8x.
    expect(maxInstallmentsByMinimum(rule, "boleto", 120000)).toBe(8);
    // Sem mínimo configurado, vale o teto de parcelas da regra.
    expect(maxInstallmentsByMinimum(rule, "pix", 120000)).toBe(24);
  });

  it("acusa parcela abaixo do mínimo", () => {
    const rule = resolveCommercialRule(rows, "clinic-y");
    const v = negotiationViolations(
      {
        subtotalCents: 120000,
        adjustmentCents: 0,
        installments: 12, // R$ 100,00 por parcela
        paymentMethod: "boleto",
      },
      rule
    );
    expect(v.some((x) => x.includes("abaixo do mínimo"))).toBe(true);
  });

  it("à vista não checa parcela mínima", () => {
    const rule = resolveCommercialRule(rows, "clinic-y");
    const v = negotiationViolations(
      {
        subtotalCents: 10000,
        adjustmentCents: 0,
        installments: 1,
        paymentMethod: "boleto",
      },
      rule
    );
    expect(v.some((x) => x.includes("abaixo do mínimo"))).toBe(false);
  });
});

describe("desconto automático só à vista", () => {
  const rule = resolveCommercialRule(
    [row(null, { cash_discount_percent: 5, max_discount_percent: 10 })],
    null
  );

  it("à vista concede o percentual configurado", () => {
    expect(automaticDiscountPercent(rule, 1)).toBe(5);
  });

  it("parcelado não tem desconto automático nenhum", () => {
    expect(automaticDiscountPercent(rule, 2)).toBe(0);
    expect(automaticDiscountPercent(rule, 12)).toBe(0);
  });

  it("nunca passa do teto de desconto da unidade", () => {
    const tight = resolveCommercialRule(
      [row(null, { cash_discount_percent: 15, max_discount_percent: 8 })],
      null
    );
    expect(automaticDiscountPercent(tight, 1)).toBe(8);
  });

  it("sem configuração, não há desconto automático", () => {
    expect(automaticDiscountPercent(resolveCommercialRule([], null), 1)).toBe(0);
  });
});

// J5: condição de pagamento do programa (Empresarial/PPR+) por cima da unidade.
describe("ruleWithProgramConditions", () => {
  const unit = resolveCommercialRule(
    [row(null, { allowed_methods: ["pix", "cartao"], max_installments: 6 })],
    null
  );

  it("acrescenta as formas do programa sem tirar as da unidade", () => {
    const r = ruleWithProgramConditions(unit, {
      allowedMethods: ["boleto", "pix"],
      maxInstallments: 24,
    });
    expect(new Set(r.allowedMethods ?? [])).toEqual(
      new Set(["pix", "cartao", "boleto"])
    );
  });

  it("vale o MAIOR parcelamento entre unidade e programa", () => {
    expect(
      ruleWithProgramConditions(unit, {
        allowedMethods: ["boleto"],
        maxInstallments: 24,
      }).maxInstallments
    ).toBe(24);
    // Programa menor que a unidade não reduz o que a unidade já permite.
    expect(
      ruleWithProgramConditions(unit, {
        allowedMethods: ["boleto"],
        maxInstallments: 2,
      }).maxInstallments
    ).toBe(6);
  });

  it("programa sem restrição de formas libera todas", () => {
    const r = ruleWithProgramConditions(unit, {
      allowedMethods: null,
      maxInstallments: 12,
    });
    expect(r.allowedMethods).toBeNull();
  });

  it("cliente sem programa mantém a regra da unidade intacta", () => {
    expect(ruleWithProgramConditions(unit, null)).toBe(unit);
  });

  it("preserva os demais campos da regra (parcela mínima, desconto à vista)", () => {
    const withExtras = resolveCommercialRule(
      [
        row(null, {
          allowed_methods: ["pix"],
          max_installments: 6,
          cash_discount_percent: 5,
          min_installment_cents_by_method: { boleto: 10000 },
        }),
      ],
      null
    );
    const r = ruleWithProgramConditions(withExtras, {
      allowedMethods: ["boleto"],
      maxInstallments: 24,
    });
    expect(r.cashDiscountPercent).toBe(5);
    expect(r.minInstallmentByMethod.boleto).toBe(10000);
  });
});
