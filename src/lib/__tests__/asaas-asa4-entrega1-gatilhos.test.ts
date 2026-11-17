// ASA4, entrega 1, parte 2 (4012) — a cobrança nasce sozinha: o que não
// depende do banco. O banco é provado no ensaio
// (scripts/asaas-ensaio-asa4-entrega1-gatilhos.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { folgaDoLimite, origemDaCobranca, rotuloDoMotivo } from "@/lib/asaas/cobrancas-automaticas-regras";
import { linhasDeEnvio, mensagemDoWhatsApp, situacaoDaParcela, type ParcelaDaVenda } from "@/lib/asaas/cobrancas-da-venda";
import { WEBHOOK_EVENTS, WEBHOOK_EVENTS_VERSION } from "@/lib/asaas/api";

const SQL = readFileSync("supabase/migrations/4012_asa4_cobranca_na_assinatura_e_rotina.sql", "utf8");
const ORQ = readFileSync("src/lib/asaas/cobrancas-automaticas.ts", "utf8");
const ROTA = readFileSync("src/app/api/cron/gateway-cobrancas/route.ts", "utf8");
const AUTH = readFileSync("src/lib/cron-auth.ts", "utf8");
const VERCEL = readFileSync("vercel.json", "utf8");
const ZAP = readFileSync("src/lib/signatures/webhook-apply.ts", "utf8");
const VENDA = readFileSync("src/app/(app)/comercial/venda-direta/actions.ts", "utf8");
const BAIXA = readFileSync("src/app/(app)/prontuarios/[id]/receivables-actions.ts", "utf8");

const base: ParcelaDaVenda = {
  installment_id: "i1",
  seq: 1,
  tipo: "parcela",
  vencimento: "2026-12-10",
  valor: 10000,
  pago: 0,
  meio: "boleto",
  situacao_parcela: "em_aberto",
  pelo_asaas: true,
  agendada_para: "2026-11-25",
  cobranca: null,
  ultimo_envio: null,
};
const cobranca = {
  id: "c1",
  status: "emitida",
  meio: "BOLETO",
  valor: 10000,
  link: "https://sandbox.asaas.com/i/x",
  boleto: null,
  pix: null,
  linha: "123",
  criada_em: "2026-11-14T12:00:00Z",
  origem: "assinatura",
  enviada_pelo_asaas_em: null,
  aberta_em: null,
  paga_em: null,
};

describe("o limite diário (19.5)", () => {
  it("guarda uma reserva para a emissão manual (10%, no mínimo 20)", () => {
    expect(folgaDoLimite({ limite: 5000, usado: 0, atingido: false })).toBe(4500);
    expect(folgaDoLimite({ limite: 100, usado: 70, atingido: false })).toBe(10);
    expect(folgaDoLimite({ limite: 100, usado: 90, atingido: false })).toBe(0);
    expect(folgaDoLimite({ limite: 5000, usado: 10, atingido: true })).toBe(0);
  });
  it("a rotina lê o limite antes e para perto dele", () => {
    expect(ORQ).toContain("getPaymentLimits");
    expect(ORQ).toContain('resumo.motivo = "limite_diario"');
    expect(ORQ).toContain("seguidas >= 3");
  });
});

describe("a origem gravada na cobrança", () => {
  it("assinatura, venda direta, rotina, rodar agora e restante", () => {
    expect(origemDaCobranca("gatilho", "assinatura")).toBe("assinatura");
    expect(origemDaCobranca("gatilho", "venda_direta")).toBe("venda_direta");
    expect(origemDaCobranca("vercel", "assinatura")).toBe("rotina");
    expect(origemDaCobranca("banco", "assinatura")).toBe("rotina");
    expect(origemDaCobranca("rodar_agora", "assinatura")).toBe("rodar_agora");
    expect(origemDaCobranca("gatilho", "venda_direta", "restante")).toBe("restante");
  });
  it("os motivos da lista de pendências em português", () => {
    expect(rotuloDoMotivo("erro:PAYER_CPF_INVALID_CLIENT")).toBe("Erro: PAYER_CPF_INVALID_CLIENT");
    expect(rotuloDoMotivo("cancelada_a_mao")).toMatch(/não volta sozinha/);
  });
});

describe("Cobranças da venda (19.3)", () => {
  it("agendada, aguardando, paga, vencida e fora do Asaas", () => {
    expect(situacaoDaParcela(base).rotulo).toBe("Agendada para 25/11");
    expect(situacaoDaParcela({ ...base, cobranca }).rotulo).toBe("Aguardando pagamento");
    expect(situacaoDaParcela({ ...base, cobranca: { ...cobranca, status: "vencida" } }).rotulo).toBe("Vencida");
    expect(situacaoDaParcela({ ...base, situacao_parcela: "paga" }).rotulo).toBe("Paga");
    expect(situacaoDaParcela({ ...base, pelo_asaas: false, agendada_para: null }).rotulo).toMatch(/Fora do Asaas/);
  });
  it("'Enviada pelo Asaas' diz que não é confirmação de entrega; o envio pelo riSZon diz quem e quando", () => {
    expect(linhasDeEnvio({ ...base, cobranca })).toEqual(["Link ainda não enviado"]);
    const l = linhasDeEnvio({
      ...base,
      cobranca: { ...cobranca, enviada_pelo_asaas_em: "2026-11-14T12:00:00Z", aberta_em: "2026-11-15T12:00:00Z" },
      ultimo_envio: { canal: "whatsapp", quem: "Fulana", quando: "2026-11-14T13:00:00Z" },
    });
    expect(l[0]).toMatch(/não é confirmação de entrega/);
    expect(l[1]).toMatch(/Fulana \(WhatsApp\)/);
    expect(l[2]).toMatch(/Aberta pelo pagador/);
  });
  it("a mensagem do WhatsApp leva valor, vencimento e o link do Asaas", () => {
    expect(mensagemDoWhatsApp({ ...base, cobranca })).toBe("Olá! Segue o link da sua parcela de R$ 100,00, com vencimento em 10/12: https://sandbox.asaas.com/i/x");
  });
});

describe("os agendadores (19.10 item 5, 19.14)", () => {
  it("a Vercel cria às 07:00 de Brasília", () => {
    expect(VERCEL).toContain('{ "path": "/api/cron/gateway-cobrancas", "schedule": "0 10 * * *" }');
  });
  it("a rota aceita a Vercel ou o banco (senha do Vault conferida pelo servidor)", () => {
    expect(ROTA).toContain("origemDaRotina(request)");
    expect(AUTH).toContain('rpc("_db_cron_token_ok"');
    expect(AUTH).toContain('request.headers.get("x-riszon-origem") !== "banco"');
  });
  it("o 2º disparo: split 01:35, contas 08:10, cobranças 09:30 — só com pg_net", () => {
    expect(SQL).toContain("'risarte-2o-split-diario', '35 4 * * *'");
    expect(SQL).toContain("'risarte-2o-contas', '10 11 * * *'");
    expect(SQL).toContain("'risarte-2o-cobrancas', '30 12 * * *'");
    expect(SQL).toContain("or not exists (select 1 from pg_extension where extname = 'pg_net') then");
    expect(SQL).not.toMatch(/create extension[^;]*pg_net/i);
  });
  it("o vigia é só banco, de hora em hora, e não conta a rodada do gatilho", () => {
    expect(SQL).toContain("cron.schedule('risarte-vigia-rotinas', '5 * * * *'");
    expect(SQL).toContain("r.origin <> 'gatilho'");
  });
});

describe("os gatilhos", () => {
  it("ZapSign: contrato do plano assinado cria as cobranças (sem derrubar o 200)", () => {
    expect(ZAP).toContain('pkg.origin_type === "plan_negotiation"');
    expect(ZAP).toContain('origem: "gatilho", negotiationId');
    // VD3-2 (0415): o termo da venda direta assinado também cria as cobranças.
    expect(ZAP).toContain('pkg.origin_type === "direct_sale"');
    expect(ZAP).toContain('origem: "gatilho", directSaleId');
  });
  it("venda direta nova: contrato assinado e parcelamento salvo", () => {
    expect(VENDA).toContain('step === "contract" && value && ehVendaNova(info.methodRule)');
  });
  it("dinheiro parcial em parcela do Asaas: o restante volta", () => {
    expect(BAIXA).toContain('origemDaCobranca: "restante"');
  });
});

describe("a migração 4012", () => {
  it("contrato assinado antes de ligar a unidade continua manual; uma marca por venda", () => {
    expect(SQL).toContain("u.enabled_from <= now()");
    expect(SQL).toContain("on conflict (negotiation_id) do nothing");
    expect(SQL).toContain("negotiation_id uuid unique");
  });
  it("prazo de 11 a 30, maior que o 1º lembrete", () => {
    expect(SQL).toContain("check (window_days between 11 and 30)");
    expect(SQL).toContain("raise exception 'WINDOW_NOT_ABOVE_REMINDER'");
  });
  it("contrato: boleto e Pix; venda direta nova: boleto, Pix e cartão à vista", () => {
    expect(SQL).toContain("when i.negotiation_id is not null and i.payment_method = 'pix' then 'PIX'");
    expect(SQL).not.toContain("when i.negotiation_id is not null and i.payment_method = 'cartao'");
    expect(SQL).toContain("ds.method_rule = 'asa4' and i.payment_method = 'cartao' then 'CREDIT_CARD'");
  });
  it("a porta sem usuário é fechada e confere tudo da emissão manual", () => {
    expect(SQL).toContain("revoke execute on function public._charge_prepare_system(uuid, text, text) from public, anon, authenticated;");
    expect(SQL).toContain("from public._charge_compute(p_installment_id, p_billing_type, null)");
  });
  it("'Aberta pelo pagador' pelos avisos de visualização do Asaas", () => {
    expect(WEBHOOK_EVENTS).toContain("PAYMENT_CHECKOUT_VIEWED");
    expect(WEBHOOK_EVENTS).toContain("PAYMENT_BANK_SLIP_VIEWED");
    expect(WEBHOOK_EVENTS_VERSION).toBe(3);
    expect(SQL).toContain("set viewed_at = coalesce(c.viewed_at, new.received_at)");
  });
  it("a regra de leitura das cobranças (0403) não muda: só a porta própria", () => {
    expect(SQL).not.toMatch(/policy\s+charges_select/i);
    expect(SQL).toContain("create or replace function public.sale_charges_read");
  });
});
