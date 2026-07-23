import { describe, expect, it } from "vitest";
import {
  commercialColumnOf,
  discountPercentOf,
  gutScore,
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
      commercialColumnOf({ ...base, cardStage: "follow_up_clinica" })
    ).toBe("follow_up_clinica");
    expect(
      commercialColumnOf({ ...base, cardStage: "acontecendo_agora" })
    ).toBe("acontecendo_agora");
  });
});
