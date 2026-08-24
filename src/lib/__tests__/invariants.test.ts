import { describe, expect, it } from "vitest";
// As regras vivem em `scripts/` porque quem as usa é um script de conferência
// que roda fora do app. O teste importa o MESMO módulo — sem cópia, senão as
// duas versões divergiriam e a conferência passaria a mentir.
import {
  allocationMismatch,
  balanceMismatch,
  cancelledStillRevenue,
  feePayableMismatch,
  mixedAccrualAndCash,
  orphanReversals,
  overDepreciated,
  paidButNotSettled,
  receivedMismatch,
  unknownMovementKinds,
} from "../../../scripts/invariant-rules.mjs";

describe("venda cancelada não pode continuar como receita", () => {
  // O defeito real da 0226: 43 parcelas canceladas, R$ 10.941 de receita
  // fantasma na DRE.
  const entry = (sourceId: string, status = "open") => ({
    id: `e-${sourceId}`,
    source_type: "installment_accrual",
    source_id: sourceId,
    status,
    cash_date: null,
    reversal_of: null,
    amount_cents: 50_000,
  });

  it("ACUSA o defeito que aconteceu de verdade", () => {
    const found = cancelledStillRevenue(
      [entry("i1")],
      [{ id: "i1", status: "cancelada", paid_amount_cents: 0 }]
    );
    expect(found).toHaveLength(1);
  });

  it("cala quando o lançamento foi cancelado junto", () => {
    const found = cancelledStillRevenue(
      [entry("i1", "cancelled")],
      [{ id: "i1", status: "cancelada", paid_amount_cents: 0 }]
    );
    expect(found).toHaveLength(0);
  });

  it("parcela cancelada que JÁ RECEBEU mantém a receita", () => {
    // Sumir com ela deixaria o dinheiro no caixa sem origem no resultado.
    const found = cancelledStillRevenue(
      [entry("i1")],
      [{ id: "i1", status: "cancelada", paid_amount_cents: 20_000 }]
    );
    expect(found).toHaveLength(0);
  });

  it("parcela em aberto não é acusada", () => {
    const found = cancelledStillRevenue(
      [entry("i1")],
      [{ id: "i1", status: "em_aberto", paid_amount_cents: 0 }]
    );
    expect(found).toHaveLength(0);
  });
});

describe("competência e caixa não se misturam", () => {
  it("acusa competência com data de caixa e caixa sem ela", () => {
    const r = mixedAccrualAndCash([
      { source_type: "installment_accrual", cash_date: "2026-08-01" },
      { source_type: "receipt_cash", cash_date: null },
      { source_type: "installment_accrual", cash_date: null },
      { source_type: "receipt_cash", cash_date: "2026-08-01" },
    ]);
    expect(r.accrualWithCash).toHaveLength(1);
    expect(r.cashWithoutDate).toHaveLength(1);
  });

  it("cala quando cada um está no seu lugar", () => {
    const r = mixedAccrualAndCash([
      { source_type: "installment_accrual", cash_date: null },
      { source_type: "receipt_cash", cash_date: "2026-08-01" },
    ]);
    expect(r.accrualWithCash).toHaveLength(0);
    expect(r.cashWithoutDate).toHaveLength(0);
  });
});

describe("estorno com original marcado", () => {
  it("acusa contra-lançamento cujo original não foi marcado", () => {
    const found = orphanReversals([
      { id: "a", status: "settled", reversal_of: null },
      { id: "b", status: "settled", reversal_of: "a" },
    ]);
    expect(found).toHaveLength(1);
  });

  it("cala com o par completo", () => {
    const found = orphanReversals([
      { id: "a", status: "reversed", reversal_of: null },
      { id: "b", status: "settled", reversal_of: "a" },
    ]);
    expect(found).toHaveLength(0);
  });
});

describe("conta paga está quitada", () => {
  it("acusa conta 'paga' que não cobre o valor", () => {
    const found = paidButNotSettled(
      [{ id: "p1", status: "paga", amount_cents: 100_000, paid_amount_cents: 80_000 }],
      []
    );
    expect(found).toHaveLength(1);
  });

  it("o desconto por pontualidade completa a quitação", () => {
    // R$ 1.000 pagos com R$ 900 e R$ 100 de abatimento: está quitada.
    const found = paidButNotSettled(
      [{ id: "p1", status: "paga", amount_cents: 100_000, paid_amount_cents: 90_000 }],
      [
        {
          payable_id: "p1",
          discount_cents: 10_000,
          reversed: false,
          reversal_of: null,
        },
      ]
    );
    expect(found).toHaveLength(0);
  });

  it("desconto ESTORNADO não conta", () => {
    const found = paidButNotSettled(
      [{ id: "p1", status: "paga", amount_cents: 100_000, paid_amount_cents: 90_000 }],
      [
        {
          payable_id: "p1",
          discount_cents: 10_000,
          reversed: true,
          reversal_of: null,
        },
      ]
    );
    expect(found).toHaveLength(1);
  });
});

describe("depreciação não passa do custo", () => {
  it("acusa bem depreciado além do que custou", () => {
    expect(
      overDepreciated(
        [{ id: "a1", cost_cents: 100_000 }],
        [
          { asset_id: "a1", amount_cents: 60_000 },
          { asset_id: "a1", amount_cents: 50_000 },
        ]
      )
    ).toHaveLength(1);
  });

  it("depreciar até o custo exato é válido", () => {
    expect(
      overDepreciated(
        [{ id: "a1", cost_cents: 100_000 }],
        [{ asset_id: "a1", amount_cents: 100_000 }]
      )
    ).toHaveLength(0);
  });
});

describe("saldo do estoque bate com os movimentos", () => {
  const mov = (kind: string, quantity: number) => ({
    clinic_id: "c",
    item_id: "i",
    kind,
    quantity,
  });

  it("entrada menos consumo é o saldo", () => {
    expect(
      balanceMismatch(
        [{ clinic_id: "c", item_id: "i", quantity: 8, in_use_quantity: 0 }],
        [mov("entrada", 10), mov("consumo", 2)]
      )
    ).toHaveLength(0);
  });

  it("ACUSA saldo escrito por fora do movimento", () => {
    expect(
      balanceMismatch(
        [{ clinic_id: "c", item_id: "i", quantity: 99, in_use_quantity: 0 }],
        [mov("entrada", 10)]
      )
    ).toHaveLength(1);
  });

  it("abertura de embalagem NÃO muda o total", () => {
    // Ela só passa da prateleira para "em uso": 10 entram, 1 abre, e o total
    // continua 10 — 9 fechadas mais 1 em uso.
    expect(
      balanceMismatch(
        [{ clinic_id: "c", item_id: "i", quantity: 9, in_use_quantity: 1 }],
        [mov("entrada", 10), mov("abertura", 1)]
      )
    ).toHaveLength(0);
  });

  it("a sobra descartada na abertura muda o total", () => {
    expect(
      balanceMismatch(
        [{ clinic_id: "c", item_id: "i", quantity: 9, in_use_quantity: 1 }],
        [mov("entrada", 10), mov("abertura", 1), mov("ajuste_saida", 0.4)]
      )
    ).toHaveLength(1);
  });

  it("tolera arredondamento de milésimo", () => {
    expect(
      balanceMismatch(
        [{ clinic_id: "c", item_id: "i", quantity: 9.9995, in_use_quantity: 0 }],
        [mov("entrada", 10)]
      )
    ).toHaveLength(0);
  });
});

describe("tipos de movimento conhecidos", () => {
  it("acusa tipo que a conferência ignoraria em silêncio", () => {
    expect(
      unknownMovementKinds([{ kind: "entrada" }, { kind: "devolucao" }])
    ).toEqual(["devolucao"]);
  });

  it("cala com os tipos previstos", () => {
    expect(
      unknownMovementKinds([
        { kind: "entrada" },
        { kind: "consumo" },
        { kind: "abertura" },
        { kind: "ajuste_saida" },
      ])
    ).toEqual([]);
  });
});

describe("rateio da rodada soma o total comprado", () => {
  it("cala quando a soma das partes é o total", () => {
    expect(
      allocationMismatch(
        [
          {
            id: "ri",
            requested_quantity: 47,
            adjusted_quantity: null,
            awarded_supplier_id: "s",
          },
        ],
        [
          { round_item_id: "ri", allocated_quantity: 30 },
          { round_item_id: "ri", allocated_quantity: 17 },
        ]
      )
    ).toHaveLength(0);
  });

  it("ACUSA fração perdida no arredondamento", () => {
    expect(
      allocationMismatch(
        [
          {
            id: "ri",
            requested_quantity: 47,
            adjusted_quantity: null,
            awarded_supplier_id: "s",
          },
        ],
        [
          { round_item_id: "ri", allocated_quantity: 30 },
          { round_item_id: "ri", allocated_quantity: 16 },
        ]
      )
    ).toHaveLength(1);
  });

  it("respeita a quantidade AJUSTADA pela franqueadora", () => {
    expect(
      allocationMismatch(
        [
          {
            id: "ri",
            requested_quantity: 47,
            adjusted_quantity: 45,
            awarded_supplier_id: "s",
          },
        ],
        [{ round_item_id: "ri", allocated_quantity: 45 }]
      )
    ).toHaveLength(0);
  });

  it("item sem fornecedor escolhido não é cobrado", () => {
    expect(
      allocationMismatch(
        [
          {
            id: "ri",
            requested_quantity: 47,
            adjusted_quantity: null,
            awarded_supplier_id: null,
          },
        ],
        []
      )
    ).toHaveLength(0);
  });
});

describe("recebido do pedido bate com as entregas", () => {
  it("soma entregas parciais", () => {
    expect(
      receivedMismatch(
        [{ id: "oi", quantity: 10, received_quantity: 8 }],
        [
          { order_item_id: "oi", quantity: 5 },
          { order_item_id: "oi", quantity: 3 },
        ]
      )
    ).toHaveLength(0);
  });

  it("ACUSA recebido que não veio de entrega nenhuma", () => {
    expect(
      receivedMismatch([{ id: "oi", quantity: 10, received_quantity: 8 }], [])
    ).toHaveLength(1);
  });
});

describe("conta da taxa bate com os splits", () => {
  const split = (cents: number, reversed = false) => ({
    clinic_id: "c",
    fee: "royalty",
    period_month: "2026-08-01",
    amount_cents: cents,
    reversed,
  });
  const payable = (cents: number, status = "aberta") => ({
    clinic_id: "c",
    network_fee: "royalty",
    fee_period: "2026-08-01",
    amount_cents: cents,
    status,
  });

  it("cala quando a conta é a soma dos splits", () => {
    expect(
      feePayableMismatch([split(3_000), split(2_000)], [payable(5_000)])
    ).toHaveLength(0);
  });

  it("ACUSA conta que não acompanhou o recebimento novo", () => {
    // O defeito que o refresh evita: a conta congelada no primeiro recebimento
    // do mês, porque `post_payable_accrual` não reescreve o que já existe.
    expect(
      feePayableMismatch([split(3_000), split(2_000)], [payable(3_000)])
    ).toHaveLength(1);
  });

  it("split estornado sai da conta", () => {
    expect(
      feePayableMismatch(
        [split(3_000), split(2_000, true)],
        [payable(3_000)]
      )
    ).toHaveLength(0);
  });

  it("taxa FIXA não tem split e não é cobrada aqui", () => {
    expect(
      feePayableMismatch(
        [],
        [
          {
            clinic_id: "c",
            network_fee: "sistema",
            fee_period: "2026-08-01",
            amount_cents: 50_000,
            status: "aberta",
          },
        ]
      )
    ).toHaveLength(0);
  });

  it("conta cancelada não é cobrada", () => {
    expect(
      feePayableMismatch([split(3_000)], [payable(9_999, "cancelada")])
    ).toHaveLength(0);
  });
});
