// ASA3, entrega 1 — a conta do split (spec 18.2). Os números da tabela da
// especificação saem daqui. Percentuais de exemplo NÃO redondos e diferentes
// por taxa (18.5), para pegar erro de rateio e de arredondamento.
import { describe, expect, it } from "vitest";
import {
  cabeNoLiquido,
  entradasDoSplit,
  modalidadesDoMeio,
  repasseSimulado,
  splitsParaOAsaas,
  tarifaMaxima,
  tarifaParaOSplit,
  SemTarifa,
  type TarifaVigente,
} from "@/lib/asaas/split";

// As tarifas reais das contas de teste (acquirer_rates, 13/11/2026).
const TARIFAS: TarifaVigente[] = [
  { modality: "pix", fee_percent: 0, fixed_fee_cents: 99, valid_from: "2026-11-10", valid_to: "2027-02-10" },
  { modality: "pix", fee_percent: 0, fixed_fee_cents: 199, valid_from: "2027-02-11", valid_to: null },
  { modality: "boleto", fee_percent: 0, fixed_fee_cents: 99, valid_from: "2026-11-10", valid_to: "2027-02-10" },
  { modality: "boleto", fee_percent: 0, fixed_fee_cents: 199, valid_from: "2027-02-11", valid_to: null },
  { modality: "credito_avista", fee_percent: 1.99, fixed_fee_cents: 49, valid_from: "2026-11-10", valid_to: "2027-02-10", min_installments: 1 },
  { modality: "credito_avista", fee_percent: 2.99, fixed_fee_cents: 49, valid_from: "2027-02-11", valid_to: null, min_installments: 1 },
  { modality: "credito_parcelado", fee_percent: 3.49, fixed_fee_cents: 49, valid_from: "2026-11-10", valid_to: null, min_installments: 2 },
];

// 18.5: royalty 6,37 + planejamento 2,91 + comercial 5,44 = 14,72 na raiz;
// fundo de propaganda 1,83 numa carteira própria.
const DUAS = [
  { walletId: "raiz", percent: 14.72 },
  { walletId: "fundo", percent: 1.83 },
];
const UMA = [{ walletId: "raiz", percent: 16.55 }];

/** Diferença devido − repassado, por carteira, no pago e na tarifa dados. */
function diferencas(carteiras: typeof DUAS, tarifaDoSplit: { a: number; bCents: number }, pago: number, tarifaReal: { a: number; bCents: number }) {
  const e = entradasDoSplit(carteiras, tarifaDoSplit);
  return repasseSimulado(e, pago, tarifaReal).map((r) => r.devidoCents - r.cents);
}

describe("a tarifa que vai para a conta", () => {
  it("no boleto, olha também a do Pix (QR Code) e fica com a menor", () => {
    expect(modalidadesDoMeio("BOLETO")).toEqual(["boleto", "pix"]);
    const t = tarifaParaOSplit(
      [
        { modality: "boleto", fee_percent: 0, fixed_fee_cents: 199, valid_from: null, valid_to: null },
        { modality: "pix", fee_percent: 0, fixed_fee_cents: 149, valid_from: null, valid_to: null },
      ],
      "BOLETO",
      "2026-11-13",
      "2026-11-20"
    );
    expect(t).toEqual({ a: 0, bCents: 149 });
  });

  it("cartão: só o à vista (o parcelado é da ASA4)", () => {
    const t = tarifaParaOSplit(TARIFAS, "CREDIT_CARD", "2027-03-01", "2027-03-10");
    expect(t.a).toBeCloseTo(0.0299, 10);
    expect(t.bCents).toBe(49);
  });

  it("janela que cruza o fim da promoção: a MENOR percentual e a MENOR fixa; o teto usa a MAIOR", () => {
    expect(tarifaParaOSplit(TARIFAS, "PIX", "2027-02-01", "2027-02-20")).toEqual({ a: 0, bCents: 99 });
    expect(tarifaMaxima(TARIFAS, "PIX", "2027-02-01", "2027-02-20")).toEqual({ a: 0, bCents: 199 });
    const c = tarifaParaOSplit(TARIFAS, "CREDIT_CARD", "2027-02-01", "2027-02-20");
    expect(c.a).toBeCloseTo(0.0199, 10);
    expect(c.bCents).toBe(49);
  });

  it("sem tarifa para o meio: recusa (não chuta)", () => {
    expect(() => tarifaParaOSplit([], "PIX", "2026-11-13", "2026-11-20")).toThrow(SemTarifa);
  });
});

describe("as entradas (método B)", () => {
  it("Pix de tarifa fixa: q = p e F = p × tarifa, para baixo", () => {
    const [e] = entradasDoSplit(UMA, { a: 0, bCents: 99 });
    expect(e.percentualValue).toBe(16.55);
    expect(e.fixedCents).toBe(16); // 16,55% × 0,99 = 0,1638 → 0,16
  });

  it("cartão: q = p ÷ (1 − a) em 4 casas para baixo, F = q × parte fixa para baixo", () => {
    const [raiz, fundo] = entradasDoSplit(DUAS, { a: 0.0299, bCents: 49 });
    expect(raiz.percentualValue).toBe(15.1736); // 14,72 / 0,9701 = 15,17369…
    expect(raiz.fixedCents).toBe(7); // 15,1736% × 0,49 = 0,0743
    expect(fundo.percentualValue).toBe(1.8864); // 1,83 / 0,9701 = 1,88640…
    expect(fundo.fixedCents).toBe(0);
  });

  it("vai ao Asaas em reais, sem fixedValue zerado", () => {
    expect(splitsParaOAsaas(entradasDoSplit(DUAS, { a: 0.0299, bCents: 49 }))).toEqual([
      { walletId: "raiz", percentualValue: 15.1736, fixedValue: 0.07 },
      { walletId: "fundo", percentualValue: 1.8864 },
    ]);
  });

  it("carteira com 0% não vai", () => {
    expect(entradasDoSplit([{ walletId: "x", percent: 0 }], { a: 0, bCents: 99 })).toEqual([]);
  });
});

// Até 1 centavo pelo F para baixo; em parcelas grandes, mais 1 pelo corte do
// percentual em 4 casas (0,0001% × líquido). Total: até 2 centavos por carteira.
describe("a diferença: nunca a maior, no máximo 2 centavos por carteira", () => {
  const cenarios = [
    ["Pix", { a: 0, bCents: 99 }],
    ["Pix cheio", { a: 0, bCents: 199 }],
    ["cartão promo", { a: 0.0199, bCents: 49 }],
    ["cartão cheio", { a: 0.0299, bCents: 49 }],
  ] as const;
  for (const [nome, t] of cenarios) {
    for (const valor of [600, 817, 50_000, 500_000]) {
      for (const [quando, pago] of [
        ["no prazo", valor],
        ["com 5% de desconto", Math.round(valor * 0.95)],
        ["com multa e juros", Math.round(valor * 1.03)],
      ] as const) {
        it(`${nome}, R$ ${(valor / 100).toFixed(2)}, ${quando}`, () => {
          for (const carteiras of [UMA, DUAS]) {
            for (const d of diferencas(carteiras, t, pago, t)) {
              expect(d).toBeGreaterThanOrEqual(0);
              expect(d).toBeLessThanOrEqual(2);
            }
          }
        });
      }
    }
  }
});

describe("a promoção que começa ou acaba com a cobrança em aberto (18.2, proteção)", () => {
  it("emitida na promoção (Pix 0,99) e paga depois do fim (1,99): repasse menor, a favor da unidade", () => {
    const doSplit = tarifaParaOSplit(TARIFAS, "PIX", "2027-02-05", "2027-02-15");
    expect(doSplit.bCents).toBe(99);
    const dif = diferencas(DUAS, doSplit, 50_000, { a: 0, bCents: 199 });
    // p × (1,99 − 0,99) + o arredondamento: 14,72% → R$ 0,16; 1,83% → R$ 0,03 (o Asaas arredonda para baixo).
    expect(dif).toEqual([16, 3]);
  });

  it("o inverso: cheia na emissão, promoção começando antes do vencimento — paga na cheia, a favor da unidade; paga na promoção, exato", () => {
    const comPromoFutura: TarifaVigente[] = [
      { modality: "pix", fee_percent: 0, fixed_fee_cents: 199, valid_from: null, valid_to: "2027-03-09" },
      { modality: "pix", fee_percent: 0, fixed_fee_cents: 99, valid_from: "2027-03-10", valid_to: null },
    ];
    const doSplit = tarifaParaOSplit(comPromoFutura, "PIX", "2027-03-01", "2027-03-15");
    expect(doSplit.bCents).toBe(99);
    expect(diferencas(DUAS, doSplit, 50_000, { a: 0, bCents: 199 })).toEqual([16, 3]);
    for (const d of diferencas(DUAS, doSplit, 50_000, { a: 0, bCents: 99 })) expect(d).toBeLessThanOrEqual(1);
  });

  it("cartão emitido na promoção e pago na cheia: a diferença também fica com a unidade", () => {
    const doSplit = tarifaParaOSplit(TARIFAS, "CREDIT_CARD", "2027-02-05", "2027-02-15");
    const dif = diferencas(DUAS, doSplit, 50_000, { a: 0.0299, bCents: 49 });
    for (const d of dif) expect(d).toBeGreaterThan(0);
    expect(dif[0]).toBeLessThanOrEqual(80); // 14,72% × 1% × R$ 500 ≈ R$ 0,74
  });
});

describe("teto de segurança", () => {
  it("17% cabem com folga numa parcela comum", () => {
    const e = entradasDoSplit(UMA, { a: 0, bCents: 99 });
    expect(cabeNoLiquido(e, 50_000, 2_500, { a: 0, bCents: 199 }).ok).toBe(true);
  });

  it("parcela de R$ 1,00 no Pix: a tarifa come o líquido e a cobrança não sai", () => {
    const e = entradasDoSplit(UMA, { a: 0, bCents: 99 });
    expect(cabeNoLiquido(e, 100, 0, { a: 0, bCents: 99 }).ok).toBe(false);
  });

  it("o desconto entra no pior caso", () => {
    const e = entradasDoSplit([{ walletId: "x", percent: 95 }], { a: 0, bCents: 99 });
    expect(cabeNoLiquido(e, 10_000, 0, { a: 0, bCents: 99 }).ok).toBe(true);
    expect(cabeNoLiquido(e, 10_000, 9_700, { a: 0, bCents: 99 }).ok).toBe(false);
  });
});

// ---- A emissão com o split (sem banco: o Asaas de mentira) ------------------------
import { emitirComOAsaas, type BancoDaEmissao, type CobrancaDoBanco } from "@/lib/asaas/cobranca";
import { fakeAsaasFetch, limparAsaasDeMentira } from "@/lib/asaas/fake";
import { findPaymentsByReference } from "@/lib/asaas/api";
import { decidirSplit, comIdsDoAsaas, type EntradaParaGravar, type PlanoDoSplit } from "@/lib/asaas/split";

const cred = { apiKey: "$aact_hmlg_" + "x".repeat(40), environment: "sandbox" as const };
const opts = { fetchImpl: fakeAsaasFetch };

function cobranca(id: string, valor = 50_000, desconto = 0): CobrancaDoBanco {
  return {
    charge_id: id, status: "emitindo", clinic_id: "c", gateway_account_id: "a", billing_type: "PIX",
    value_cents: valor, discount_cents: desconto, fine_percent: 2, fine_cents: 1000, interest_percent: 1,
    due_date: "2026-11-20", description: "Parcela 1", asaas_payment_id: null, payer_kind: "client",
    payer_guardian_id: null, client_id: "k", payer_name: "Paciente", payer_cpf: "12345678909", asaas_customer_id: null,
  };
}
function plano(valor = 50_000, desconto = 0): PlanoDoSplit {
  return {
    elegivel: true,
    carteiras: [
      { accountId: "raiz", walletId: "w-raiz", percent: 14.72, fees: { royalty: 6.37, planejamento: 2.91, comercial: 5.44 } },
      { accountId: "fundo", walletId: "w-fundo", percent: 1.83, fees: { fundo: 1.83 } },
    ],
    tarifas: TARIFAS, hoje: "2026-11-13", vencimento: "2026-11-20", valorCents: valor, descontoCents: desconto, meio: "PIX",
  };
}
function bancoComSplit(p: PlanoDoSplit, falhaAoGravar = false) {
  const g = { erro: null as string | null, emitida: null as string | null, split: null as EntradaParaGravar[] | null, sem: null as string | null, teto: 0 };
  const banco: BancoDaEmissao = {
    salvarPagador: async () => "local-1",
    gravarErro: async (code) => { g.erro = code; },
    gravarEmissao: async (r) => { g.emitida = r.asaasPaymentId; return null; },
    planoDoSplit: async () => p,
    gravarSplit: async (e) => { if (falhaAoGravar) throw new Error("banco fora"); g.split = e; },
    semSplit: async (m) => { g.sem = m; },
    avisarTeto: async () => { g.teto++; },
  };
  return { banco, g };
}

describe("a emissão com o split", () => {
  it("manda as duas carteiras ao Asaas e grava com os ids do split", async () => {
    limparAsaasDeMentira();
    const { banco, g } = bancoComSplit(plano());
    expect(await emitirComOAsaas(cobranca("s-1"), cred, opts, banco)).toEqual({ ok: true });
    const [p] = await findPaymentsByReference(cred, "s-1", opts);
    expect(p.split).toEqual([
      expect.objectContaining({ walletId: "w-raiz", percentualValue: 14.72, fixedValue: 0.14 }),
      expect.objectContaining({ walletId: "w-fundo", percentualValue: 1.83, fixedValue: 0.01 }),
    ]);
    expect(g.split?.map((e) => [e.walletId, e.accountId, e.asaasSplitId?.startsWith("split_fake_")])).toEqual([
      ["w-raiz", "raiz", true],
      ["w-fundo", "fundo", true],
    ]);
    expect(g.split?.[0].fees).toEqual({ royalty: 6.37, planejamento: 2.91, comercial: 5.44 });
    expect(g.emitida).toBe(p.id);
  });

  it("sem split permitido (ex.: franqueadora): sai sem split e grava o motivo", async () => {
    limparAsaasDeMentira();
    const { banco, g } = bancoComSplit({ elegivel: false, motivo: "franqueadora" });
    expect(await emitirComOAsaas(cobranca("s-2"), cred, opts, banco)).toEqual({ ok: true });
    const [p] = await findPaymentsByReference(cred, "s-2", opts);
    expect(p.split).toBeUndefined();
    expect(g.sem).toBe("franqueadora");
    expect(g.split).toBeNull();
  });

  it("TETO: parcela de R$ 1,00 no Pix não sai, e o Financeiro é avisado", async () => {
    limparAsaasDeMentira();
    const { banco, g } = bancoComSplit(plano(100));
    const r = await emitirComOAsaas(cobranca("s-3", 100), cred, opts, banco);
    expect(r.ok).toBe(false);
    expect(g.erro).toBe("split_teto");
    expect(g.teto).toBe(1);
    expect(await findPaymentsByReference(cred, "s-3", opts)).toHaveLength(0);
  });

  it("o split não gravou: a cobrança NÃO é marcada emitida; a nova tentativa acha pela referência e grava, sem duplicar", async () => {
    limparAsaasDeMentira();
    const t1 = bancoComSplit(plano(), true);
    const r1 = await emitirComOAsaas(cobranca("s-4"), cred, opts, t1.banco);
    expect(r1.ok).toBe(false);
    expect(t1.g.emitida).toBeNull();
    const t2 = bancoComSplit(plano());
    expect(await emitirComOAsaas(cobranca("s-4"), cred, opts, t2.banco)).toEqual({ ok: true });
    expect(t2.g.split).toHaveLength(2);
    expect(await findPaymentsByReference(cred, "s-4", opts)).toHaveLength(1);
  });

  it("decidirSplit e comIdsDoAsaas: o id casa pelo walletId", () => {
    const d = decidirSplit(plano());
    if (!d.vai) throw new Error("devia ir");
    const com = comIdsDoAsaas(d.entradas, [{ id: "B", walletId: "w-fundo" }, { id: "A", walletId: "w-raiz" }]);
    expect(com.map((e) => e.asaasSplitId)).toEqual(["A", "B"]);
  });
});
