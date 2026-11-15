// ASA4, entrega 2 (4013) — o CARTÃO PARCELADO PELO ASAAS: o que não depende do
// banco. Os números vêm das provas no sandbox (spec 19.19.1 e 19.19.2); o banco é
// provado no ensaio (scripts/asaas-ensaio-asa4-entrega2.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  custoDoParcelamento,
  datasDoBloco,
  erroDoBloco,
  faixaDe,
  tabelaDeCusto,
  tarifaDaParcela,
  valoresDoBloco,
} from "@/lib/asaas/parcelado";
import { decidirSplit, modalidadesDoMeio, parteFixaDaParcela, type PlanoDoSplit } from "@/lib/asaas/split";
import { ehParceladoPeloAsaas, meioParaARegra, mensagemDoErroDoParcelado, meiosDaBaixaVendaNova, trocasPossiveis } from "@/lib/venda-direta-meios";
import { mensagemDoParcelamento, situacaoDaParcela, type ParcelaDaVenda } from "@/lib/asaas/cobrancas-da-venda";
import { motivoSemCobranca } from "@/lib/cobrancas";
import { PAYMENT_METHODS } from "@/lib/commercial";

const SQL = readFileSync("supabase/migrations/4013_asa4_cartao_parcelado_pelo_asaas.sql", "utf8");
const API = readFileSync("src/lib/asaas/api.ts", "utf8");
const SERVIDOR = readFileSync("src/lib/asaas/parcelamento.ts", "utf8");
const AUTO = readFileSync("src/lib/asaas/cobrancas-automaticas.ts", "utf8");

// As faixas da promoção do sandbox (as que estavam na conta de Londrina na prova).
const PROMO = [
  { de: 2, ate: 6, pct: 2.49, fixo: 49 },
  { de: 7, ate: 12, pct: 2.99, fixo: 49 },
  { de: 13, ate: 21, pct: 3.29, fixo: 49 },
];
const CHEIA = [
  { de: 2, ate: 6, pct: 3.49, fixo: 49 },
  { de: 7, ate: 12, pct: 3.99, fixo: 49 },
  { de: 13, ate: 21, pct: 4.29, fixo: 49 },
];

describe("o bloco como o Asaas faz (19.19.1)", () => {
  it("valores iguais com a sobra na ÚLTIMA (3× de R$ 150,01 e 21× de R$ 3.000)", () => {
    expect(valoresDoBloco(15001, 3)).toEqual([5000, 5000, 5001]);
    const v21 = valoresDoBloco(300000, 21);
    expect(v21.slice(0, 20).every((v) => v === 14285)).toBe(true);
    expect(v21[20]).toBe(14300);
    expect(v21.reduce((s, v) => s + v, 0)).toBe(300000);
  });
  it("vencimentos mês a mês no mesmo dia, virando o ano", () => {
    expect(datasDoBloco("2026-11-18", 3)).toEqual(["2026-11-18", "2026-12-18", "2027-01-18"]);
  });
  it("a conferência do bloco espelha a do banco", () => {
    const ok = valoresDoBloco(30000, 3).map((v, k) => ({ due_date: datasDoBloco("2026-11-18", 3)[k], amount_cents: v }));
    expect(erroDoBloco(ok)).toBeNull();
    expect(erroDoBloco(ok.slice(0, 1))).toMatch(/pelo menos 2/);
    expect(erroDoBloco([{ ...ok[0], amount_cents: 10001 }, ok[1], { ...ok[2], amount_cents: 9999 }])).toMatch(/sobra dos centavos fica na última/);
    expect(erroDoBloco([ok[0], { ...ok[1], due_date: "2026-12-20" }, ok[2]])).toMatch(/mês a mês/);
    expect(erroDoBloco([{ due_date: "2026-11-29", amount_cents: 100 }, { due_date: "2026-12-29", amount_cents: 100 }])).toMatch(/dia 28/);
  });
  it("o banco confere o mesmo (2 a 21, dia até 28, mês a mês, sobra na última)", () => {
    expect(SQL).toContain("raise exception 'PARCELADO_ASAAS_MIN_2'");
    expect(SQL).toContain("raise exception 'PARCELADO_ASAAS_MAX_21'");
    expect(SQL).toContain("if extract(day from v_first) > 28 then raise exception 'PARCELADO_ASAAS_DIA'");
    expect(SQL).toContain("(v_first + make_interval(months => k))::date");
    expect(SQL).toContain("(case when k = v_n - 1 then v_total - v_base * (v_n - 1) else v_base end)");
  });
});

describe("a tarifa por parcela (19.19.2: medida no sandbox, 42 parcelas)", () => {
  it("a × V cortado + b ÷ n cortado: exatamente o que o Asaas cobrou", () => {
    expect(tarifaDaParcela(100000, 3, PROMO[0])).toBe(2506); // R$ 24,90 + R$ 0,16
    expect(tarifaDaParcela(50000, 6, PROMO[0])).toBe(1253);
    expect(tarifaDaParcela(25000, 12, PROMO[1])).toBe(751);
    expect(tarifaDaParcela(14285, 21, PROMO[2])).toBe(471);
    expect(tarifaDaParcela(14300, 21, PROMO[2])).toBe(472);
    expect(tarifaDaParcela(500, 3, PROMO[0])).toBe(28); // a prova com envio real: líquido R$ 4,72
  });
  it("a parte fixa sai UMA vez, rateada (não em cada parcela)", () => {
    expect(parteFixaDaParcela(49, 3)).toBe(16);
    expect(parteFixaDaParcela(49, 21)).toBe(2);
    expect(parteFixaDaParcela(49, 1)).toBe(49);
    const soma12 = valoresDoBloco(300000, 12).reduce((s, v) => s + tarifaDaParcela(v, 12, PROMO[1]), 0);
    expect(soma12).toBe(9012); // medido: R$ 90,12 (em cada parcela daria R$ 95,58)
  });
});

describe("o split por parcela (Método B com a parte fixa rateada)", () => {
  const plano = (n: number, valorCents: number): PlanoDoSplit => ({
    elegivel: true,
    carteiras: [{ accountId: "raiz", walletId: "w-raiz", percent: 17, fees: { royalties: 6, fundo: 2, planejamento: 3, comercial: 6 } }],
    tarifas: [
      { modality: "credito_avista", fee_percent: 1.99, fixed_fee_cents: 49, valid_from: null, valid_to: null, min_installments: 1, max_installments: 1 },
      ...PROMO.map((f) => ({ modality: "credito_parcelado", fee_percent: f.pct, fixed_fee_cents: f.fixo, valid_from: null, valid_to: null, min_installments: f.de, max_installments: f.ate })),
    ],
    hoje: "2026-11-14",
    vencimento: "2026-11-18",
    valorCents,
    descontoCents: 0,
    meio: "CREDIT_CARD",
    parcelas: n,
  });
  it("a modalidade do parcelado pela faixa", () => {
    expect(modalidadesDoMeio("CREDIT_CARD", 3)).toEqual(["credito_parcelado"]);
    expect(modalidadesDoMeio("CREDIT_CARD")).toEqual(["credito_avista"]);
  });
  it("3×: 17,4341% + R$ 0,02; 12×: 17,5239% + R$ 0,00 — o que foi enviado e aceito no sandbox", () => {
    const d3 = decidirSplit(plano(3, 100000));
    expect(d3.vai && d3.entradas[0]).toMatchObject({ percentualValue: 17.4341, fixedCents: 2 });
    const d12 = decidirSplit(plano(12, 25000));
    expect(d12.vai && d12.entradas[0]).toMatchObject({ percentualValue: 17.5239, fixedCents: 0 });
    const d21 = decidirSplit(plano(21, 14285));
    expect(d21.vai && d21.entradas[0]).toMatchObject({ percentualValue: 17.5783, fixedCents: 0 });
  });
  it("o banco calcula a mesma entrada (faixa pelo número de parcelas, b ÷ n)", () => {
    expect(SQL).toContain("v_mods := case when coalesce(c.installment_count, 1) > 1 then array['credito_parcelado']");
    expect(SQL).toContain("floor(coalesce(v_tar.b, 0)::numeric / coalesce(c.installment_count, 1))");
    expect(SQL).toContain("'parcelas', coalesce(c.installment_count, 1)");
    expect(SQL).toContain("'max_installments', r.max_installments");
  });
});

describe("o custo no fechamento (19.19.7 item 1; a tabela da 19.19.2)", () => {
  it("R$ 3.000 com a tarifa cheia: 3× R$ 105,18; 12× R$ 120,12; 21× R$ 128,95 — e os 17% da rede", () => {
    expect(custoDoParcelamento(300000, 3, CHEIA[0], 17)).toMatchObject({ tarifaCents: 10518, redeCents: 51000, unidadeCents: 300000 - 10518 - 51000 });
    expect(custoDoParcelamento(300000, 12, CHEIA[1], 17).tarifaCents).toBe(12012);
    expect(custoDoParcelamento(300000, 21, CHEIA[2], 17)).toMatchObject({ tarifaCents: 12895, soVisaEMaster: true });
  });
  it("a tabela vai de 2 ao teto da regra comercial (nunca acima de 21)", () => {
    expect(tabelaDeCusto(300000, 12, CHEIA, 17).map((l) => l.parcelas)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(tabelaDeCusto(300000, 30, CHEIA, 17).at(-1)?.parcelas).toBe(21);
  });
  it("com duas faixas vigentes (promoção), vale a menor", () => {
    expect(faixaDe([...CHEIA, ...PROMO], 3)?.pct).toBe(2.49);
  });
});

describe("os meios", () => {
  it("o meio novo, separado da maquininha, também no contrato", () => {
    expect(PAYMENT_METHODS).toContain("cartao_parcelado_asaas");
    expect(PAYMENT_METHODS).toContain("cartao_parcelado");
    expect(ehParceladoPeloAsaas("cartao_parcelado_asaas")).toBe(true);
    expect(meioParaARegra("cartao_parcelado_asaas")).toBe("cartao_parcelado");
  });
  it("sem baixa à mão e sem troca de meio para o parcelado (só o Asaas)", () => {
    expect(meiosDaBaixaVendaNova("cartao_parcelado_asaas", true)).toEqual(["dinheiro"]);
    expect(trocasPossiveis("pix", true)).not.toContain("cartao_parcelado_asaas");
    expect(SQL).toContain("raise exception 'PARCELADO_ASAAS_SO_PELO_ASAAS'");
  });
  it("a parcela do bloco não vira cobrança sozinha", () => {
    expect(SQL).toContain("raise exception 'USE_O_PARCELAMENTO'");
    expect(motivoSemCobranca({ status: "em_aberto", paymentMethod: "cartao_parcelado_asaas", graceDays: 0, unidadePronta: true, podeEmitir: true })).toMatch(/parcelamento é um só/);
  });
  it("os erros do banco em português", () => {
    expect(mensagemDoErroDoParcelado("ERROR: PARCELADO_ASAAS_VALORES")).toMatch(/sobra dos centavos fica na última/);
    expect(mensagemDoErroDoParcelado("x")).toBeNull();
  });
});

describe("o servidor e o Asaas", () => {
  it("o parcelamento vai com installmentCount + totalValue, sem `value`, e com a referência do bloco", () => {
    const corpo = API.slice(API.indexOf("export function createCardInstallment"), API.indexOf("/** `GET /v3/installments/{id}/payments`"));
    expect(corpo).toContain("installmentCount: input.installmentCount");
    expect(corpo).toContain("totalValue: input.totalValue");
    expect(corpo).not.toMatch(/\bvalue: input\.value/);
    expect(SERVIDOR).toContain("externalReference: blockId");
  });
  it("cada parcela recebe a referência da SUA cobrança; nunca repete o POST às cegas", () => {
    expect(SERVIDOR).toContain("if (p.externalReference !== c.id) await updatePaymentReference(cred, p.id!, c.id, opts);");
    expect(SERVIDOR).toContain('e.code === "unknown_outcome"');
    expect(SERVIDOR).toContain("parcelasBatem(bloco, parcelas)");
  });
  it("o cadastro SEM AVISOS do parcelado nunca é o pagador da régua", () => {
    expect(API).toContain("notificationDisabled: true, externalReference: input.externalReference");
    expect(API).toContain("!String(c.externalReference ?? \"\").startsWith(REFERENCIA_DO_CADASTRO_DO_PARCELADO)");
  });
  it("o parcelamento nasce inteiro, sem prazo, e cada parcela conta no limite diário", () => {
    expect(AUTO).toContain('admin.rpc("_card_blocks_due"');
    expect(AUTO).toContain("if (folga < b.parcelas)");
  });
  it("cancelar e estornar só o parcelamento inteiro", () => {
    expect(API).toContain('path: "/installments/{id}"');
    expect(API).toContain('path: "/installments/{id}/refund", params: { id }, body: {}');
    expect(SQL).toContain("raise exception 'PARCELADO_ASAAS_PAGO_USE_ESTORNO'");
  });
});

describe("a baixa e a taxa (19.19.4)", () => {
  it("a baixa sai como cartão parcelado, com a tarifa do parcelado", () => {
    expect(SQL).toContain("v_method := case when c.installment_block is not null then 'cartao_parcelado'");
    expect(SQL).toContain("when 'CREDIT_CARD_INSTALLMENT' then 'credito_parcelado'");
  });
  it("a taxa a reter pelo split aparece à parte no apurado", () => {
    expect(SQL).toContain("cs.status in ('enviado', 'bloqueado') and cs.settled_at is null");
    expect(SQL).toContain("awaiting_cents bigint");
  });
  it("o estorno mostra antes o que a unidade perde", () => {
    expect(SQL).toContain("'tarifa_que_nao_volta_cents'");
    expect(SQL).toContain("'taxa_devida_cents'");
  });
});

describe("as Cobranças da venda", () => {
  const base: ParcelaDaVenda = {
    installment_id: "i1", seq: 2, tipo: "parcela", vencimento: "2026-12-18", valor: 10000, pago: 0, meio: "cartao_parcelado_asaas",
    situacao_parcela: "em_aberto", pelo_asaas: false, parcelado: true, agendada_para: null, cobranca: null, ultimo_envio: null,
  };
  it("a parcela do parcelado sem cobrança: no parcelamento", () => {
    expect(situacaoDaParcela(base).rotulo).toBe("No parcelamento do cartão");
  });
  it("um link só, com o total e o número de parcelas", () => {
    expect(
      mensagemDoParcelamento({
        block: "b", parcelas: 3, total: 30000, situacao: "aguardando", link: "https://sandbox.asaas.com/i/x", primeira: "c1", creditadas: 0,
        pode_gerar: false, pode_tentar_de_novo: false, pode_cancelar: true, pode_estornar: false, gerar_permitido: true, cancelar_permitido: true, estornar_permitido: false,
      })
    ).toBe("Olá! Segue o link para pagar no cartão de crédito, em 3x, o total de R$ 300,00: https://sandbox.asaas.com/i/x");
  });
});
