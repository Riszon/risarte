// ASA1, entrega 2 — a cobrança de parcela pelo Asaas. O que é do BANCO (quem
// emite, o valor, a parcela vencida, as travas, a dispensa) é provado pelo
// ensaio `scripts/asaas-ensaio-asa1-entrega2.mjs`, no treino. Aqui: o que o
// riSZon manda ao Asaas, o Asaas de mentira, as regras puras da tela e as
// guardas estáticas (cartão nunca passa pelo riSZon; a chave só sai da ponte).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createCustomer,
  createPayment,
  deletePayment,
  findCustomerByCpfCnpj,
  findPaymentsByReference,
  getPixPayload,
} from "@/lib/asaas/api";
import { AsaasError } from "@/lib/asaas/client";
import { fakeAsaasFetch, limparAsaasDeMentira, pagarNoAsaasDeMentira } from "@/lib/asaas/fake";
import {
  meioInicial,
  mensagemDaCobranca,
  mensagemDaCobrancaNoWhatsApp,
  METODOS_SEM_COBRANCA_NA_ASA1,
  motivoSemCobranca,
  SITUACOES_ATIVAS,
} from "@/lib/cobrancas";
import { emitirComOAsaas, type BancoDaEmissao, type CobrancaDoBanco } from "@/lib/asaas/cobranca";
import { viewInstallment, type Installment } from "@/lib/finance/receivables";
import { CAPACIDADES, matrizPadrao } from "@/lib/permissions";

const TESTE = "$aact_hmlg_" + "x".repeat(40);
const cred = { apiKey: TESTE, environment: "sandbox" as const };

// ---- o tempo esgotado na emissão, de ponta a ponta (sem banco) --------------------
function cobrancaDeTeste(id: string): CobrancaDoBanco {
  return {
    charge_id: id,
    status: "emitindo",
    clinic_id: "c",
    gateway_account_id: "a",
    billing_type: "PIX",
    value_cents: 1050,
    discount_cents: 50,
    fine_percent: 2,
    interest_percent: 1,
    due_date: "2026-11-20",
    description: "Parcela 1",
    asaas_payment_id: null,
    payer_kind: "guardian",
    payer_guardian_id: "g",
    client_id: "k",
    payer_name: "Mãe",
    payer_cpf: "12345678909",
    asaas_customer_id: null,
  };
}
function bancoDeTeste() {
  const gravado: { erro: string | null; emissao: string | null } = { erro: null, emissao: null };
  const banco: BancoDaEmissao = {
    salvarPagador: async () => "local-1",
    gravarErro: async (code) => {
      gravado.erro = code;
    },
    gravarEmissao: async (r) => {
      gravado.emissao = r.asaasPaymentId;
      return null;
    },
  };
  return { banco, gravado };
}
/** O Asaas de mentira que, no POST da cobrança, CRIA (ou não) e não responde a tempo. */
function asaasQueNaoResponde(criaAntesDeTravar: boolean) {
  const posts: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? "GET") === "POST" && /\/payments$/.test(new URL(url).pathname)) {
      posts.push(url);
      if (criaAntesDeTravar) await fakeAsaasFetch(input, init);
      await new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abort"))));
    }
    return fakeAsaasFetch(input, init);
  }) as typeof fetch;
  return { f, posts };
}

describe("tempo esgotado ao emitir: consulta pela referência, nunca repete", () => {
  it("o Asaas criou e não respondeu: o riSZon acha pela referência e grava, sem duplicar", async () => {
    limparAsaasDeMentira();
    const { f, posts } = asaasQueNaoResponde(true);
    const { banco, gravado } = bancoDeTeste();
    const r = await emitirComOAsaas(cobrancaDeTeste("ref-lento-1"), cred, { fetchImpl: f, timeoutMs: 20, sleep: async () => {} }, banco);
    expect(r).toEqual({ ok: true });
    expect(posts.length).toBe(1);
    expect(gravado.emissao).toMatch(/^pay_fake/);
    expect(await findPaymentsByReference(cred, "ref-lento-1", { fetchImpl: fakeAsaasFetch })).toHaveLength(1);
  });

  it("o Asaas NÃO criou e não respondeu: fica 'erro de emissão' sem repetir; o 'Tentar de novo' consulta antes e cria uma só", async () => {
    limparAsaasDeMentira();
    const lento = asaasQueNaoResponde(false);
    const t1 = bancoDeTeste();
    const r1 = await emitirComOAsaas(cobrancaDeTeste("ref-lento-2"), cred, { fetchImpl: lento.f, timeoutMs: 20, sleep: async () => {} }, t1.banco);
    expect(r1.ok).toBe(false);
    expect(lento.posts.length).toBe(1);
    expect(t1.gravado.erro).toBe("unknown_outcome");
    // Tentar de novo, com o Asaas respondendo.
    const t2 = bancoDeTeste();
    expect(await emitirComOAsaas(cobrancaDeTeste("ref-lento-2"), cred, { fetchImpl: fakeAsaasFetch }, t2.banco)).toEqual({ ok: true });
    // E mais uma vez (como se a gravação tivesse falhado): acha a que existe.
    const t3 = bancoDeTeste();
    expect(await emitirComOAsaas(cobrancaDeTeste("ref-lento-2"), cred, { fetchImpl: fakeAsaasFetch }, t3.banco)).toEqual({ ok: true });
    expect(t3.gravado.emissao).toBe(t2.gravado.emissao);
    expect(await findPaymentsByReference(cred, "ref-lento-2", { fetchImpl: fakeAsaasFetch })).toHaveLength(1);
  });
});

describe("a tela diz por que não há o botão", () => {
  const base = { status: "em_aberto", paymentMethod: "pix", graceDays: 0, unidadePronta: true, podeEmitir: true };
  it("botão aparece quando tudo está certo", () => {
    expect(motivoSemCobranca(base)).toBeNull();
  });
  it("cada motivo tem frase", () => {
    expect(motivoSemCobranca({ ...base, status: "paga" })).toMatch(/paga/);
    expect(motivoSemCobranca({ ...base, paymentMethod: "cartao_parcelado" })).toMatch(/parcelado/);
    expect(motivoSemCobranca({ ...base, unidadePronta: false })).toMatch(/não está pronta/);
    expect(motivoSemCobranca({ ...base, unidadePronta: null })).toMatch(/4004/);
    expect(motivoSemCobranca({ ...base, podeEmitir: false })).toMatch(/permissão/);
  });
});
const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function resposta(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("o que o riSZon manda ao Asaas", () => {
  it("o pagador vai só com nome e CPF, e as notificações do Asaas desligadas", async () => {
    const fetchImpl = vi.fn(async () => resposta(200, { id: "cus_1" }));
    await createCustomer(cred, { name: "Maria", cpfCnpj: "12345678909" }, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v3\/customers$/);
    expect(JSON.parse(String(init.body))).toEqual({ name: "Maria", cpfCnpj: "12345678909", notificationDisabled: true });
  });

  it("procura o pagador pelo CPF antes de criar", async () => {
    const fetchImpl = vi.fn(async () => resposta(200, { data: [{ id: "cus_apagado", deleted: true }, { id: "cus_ok", deleted: false }] }));
    const c = await findCustomerByCpfCnpj(cred, "12345678909", { fetchImpl });
    expect(c?.id).toBe("cus_ok");
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("cpfCnpj=12345678909");
  });

  it("a cobrança leva referência, desconto até o vencimento, multa e juros SEMPRE explícitos", async () => {
    const fetchImpl = vi.fn(async () => resposta(200, { id: "pay_1", invoiceUrl: "https://x" }));
    await createPayment(
      cred,
      {
        customer: "cus_1",
        billingType: "PIX",
        value: 105,
        dueDate: "2026-11-20",
        description: "Parcela 1",
        externalReference: "11111111-1111-1111-1111-111111111111",
        discountValue: 5,
        finePercent: 0,
        interestPercent: 1,
      },
      { fetchImpl }
    );
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({
      customer: "cus_1",
      billingType: "PIX",
      value: 105,
      dueDate: "2026-11-20",
      externalReference: "11111111-1111-1111-1111-111111111111",
      discount: { value: 5, dueDateLimitDays: 0, type: "FIXED" },
      fine: { value: 0, type: "PERCENTAGE" },
      interest: { value: 1 },
    });
    // Nunca dado de cartão nem split na ASA1.
    expect(body).not.toHaveProperty("creditCard");
    expect(body).not.toHaveProperty("creditCardHolderInfo");
    expect(body).not.toHaveProperty("split");
  });

  it("tempo esgotado ao criar a cobrança NÃO é repetido (resultado desconhecido)", async () => {
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      await new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abort"))));
      return resposta(200, {});
    });
    const err = await createPayment(
      cred,
      {
        customer: "c",
        billingType: "BOLETO",
        value: 1,
        dueDate: "2026-11-20",
        description: "d",
        externalReference: "r",
        discountValue: 0,
        finePercent: 2,
        interestPercent: 1,
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 10, sleep: async () => {} }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AsaasError);
    expect((err as AsaasError).code).toBe("unknown_outcome");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("o Asaas de mentira (servidor local de teste)", () => {
  const opts = { fetchImpl: fakeAsaasFetch };
  it("cria, acha pela referência, devolve o Pix e cancela", async () => {
    limparAsaasDeMentira();
    expect(await findCustomerByCpfCnpj(cred, "12345678909", opts)).toBeNull();
    const cus = await createCustomer(cred, { name: "A", cpfCnpj: "12345678909" }, opts);
    expect((await findCustomerByCpfCnpj(cred, "12345678909", opts))?.id).toBe(cus.id);
    const p = await createPayment(
      cred,
      {
        customer: String(cus.id),
        billingType: "PIX",
        value: 10,
        dueDate: "2026-11-20",
        description: "d",
        externalReference: "ref-1",
        discountValue: 0,
        finePercent: 2,
        interestPercent: 1,
      },
      opts
    );
    expect((await findPaymentsByReference(cred, "ref-1", opts)).map((x) => x.id)).toEqual([p.id]);
    expect(await getPixPayload(cred, String(p.id), opts)).toContain("fake");
    await deletePayment(cred, String(p.id), opts);
    expect(await findPaymentsByReference(cred, "ref-1", opts)).toEqual([]);
  });

  it("cobrança paga não se cancela", async () => {
    limparAsaasDeMentira();
    const p = await createPayment(
      cred,
      {
        customer: "c",
        billingType: "BOLETO",
        value: 10,
        dueDate: "2026-11-20",
        description: "d",
        externalReference: "ref-2",
        discountValue: 0,
        finePercent: 2,
        interestPercent: 1,
      },
      opts
    );
    pagarNoAsaasDeMentira(String(p.id));
    await expect(deletePayment(cred, String(p.id), opts)).rejects.toBeInstanceOf(AsaasError);
  });
});

describe("regras da tela", () => {
  it("o meio já vem do meio gravado na parcela", () => {
    expect(meioInicial("pix")).toBe("PIX");
    expect(meioInicial("cartao")).toBe("CREDIT_CARD");
    expect(meioInicial("boleto")).toBe("BOLETO");
    expect(meioInicial(null)).toBe("BOLETO");
  });

  it("cartão parcelado, crédito recorrente e depósito à vista não emitem na ASA1", () => {
    expect([...METODOS_SEM_COBRANCA_NA_ASA1].sort()).toEqual(["cartao_parcelado", "credito_recorrente", "deposito_avista"]);
  });

  it("as situações ativas batem com o índice único do banco", () => {
    const sql = ler("supabase/migrations/4004_asa1_cobrancas_travas_e_dispensa.sql");
    const m = /charges_one_active_per_installment[\s\S]*?where status in \(([^)]*)\)/.exec(sql);
    const doBanco = (m?.[1] ?? "").match(/'([a-z_]+)'/g)?.map((x) => x.replace(/'/g, "")).sort();
    expect(doBanco).toEqual([...SITUACOES_ATIVAS].sort());
  });

  it("cada código de recusa do banco tem mensagem em português", () => {
    const sql = ler("supabase/migrations/4004_asa1_cobrancas_travas_e_dispensa.sql");
    const codigos = new Set(
      [...sql.matchAll(/error_code := '([A-Z_]+)'|raise exception '([A-Z_]+)'/g)].map((m) => m[1] ?? m[2])
    );
    codigos.delete("WAIVER_IMMUTABLE");
    codigos.delete("CHARGE_NO_DELETE");
    codigos.delete("CHARGE_NOT_EMITTING");
    for (const c of codigos) {
      expect(mensagemDaCobranca(c), c).not.toMatch(/Não foi possível concluir/);
    }
  });

  it("a mensagem do WhatsApp leva o link e não leva CPF", () => {
    const t = mensagemDaCobrancaNoWhatsApp({
      nomeDoPagador: "Maria da Silva",
      valorFormatado: "R$ 105,00",
      vencimentoFormatado: "20/11/2026",
      link: "https://sandbox.asaas.com/i/abc",
    });
    expect(t).toContain("Olá, Maria!");
    expect(t).toContain("https://sandbox.asaas.com/i/abc");
    expect(t).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
  });

  it("a parcela quitada com dispensa não mostra o principal dispensado como saldo", () => {
    const base: Installment = {
      id: "i",
      seq: 1,
      kind: "parcela",
      dueDate: "2026-10-01",
      amountCents: 10000,
      benefitDiscountCents: 0,
      paidAmountCents: 8000,
      paidBenefitCents: 0,
      paidFeeCents: 0,
      paidInterestCents: 0,
      status: "paga",
      paymentMethod: "pix",
      terms: { lateFeePercent: 2, monthlyInterestPercent: 1, graceDays: 0 },
      origin: "direct_sale",
      sourceId: null,
      sourceCode: null,
      renegotiatedById: null,
      wasOverdue: true,
      waivedPrincipalCents: 2000,
    };
    expect(viewInstallment(base, "2026-11-11").balanceCents).toBe(0);
    expect(viewInstallment({ ...base, waivedPrincipalCents: 0 }, "2026-11-11").balanceCents).toBe(2000);
  });

  it("as permissões da cobrança nascem só com o Admin Master", () => {
    const m = matrizPadrao();
    for (const id of ["acao.cobranca.ver", "acao.cobranca.emitir", "acao.cobranca.cancelar"]) {
      expect(CAPACIDADES.some((c) => c.id === id), id).toBe(true);
      expect(m[id], id).toEqual([]);
    }
  });
});

describe("guardas estáticas", () => {
  const arquivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  const todos = arquivos("src");

  it("nenhuma tela tem campo de cartão (o cartão é digitado só na página do Asaas)", () => {
    for (const f of todos.filter((x) => x.endsWith(".tsx"))) {
      const s = ler(f);
      expect(s, f).not.toMatch(/autoComplete=["']cc-(number|csc|exp)/);
      expect(s, f).not.toMatch(/creditCardHolderInfo|creditCardToken/);
    }
  });

  it("criar e cancelar cobrança no Asaas só sai de src/lib/asaas/cobranca.ts", () => {
    for (const f of todos) {
      if (f.replace(/\\/g, "/").includes("src/lib/asaas/") || f.includes("__tests__")) continue;
      const s = ler(f);
      expect(s, f).not.toMatch(/\b(createPayment|deletePayment|createCustomer)\(/);
    }
  });

  it("as ações de cobrança da ficha conferem a permissão da tela antes do banco", () => {
    const s = ler("src/app/(app)/prontuarios/[id]/cobranca-actions.ts");
    const funcoes = s.split(/export async function /).slice(1);
    expect(funcoes.length).toBeGreaterThanOrEqual(6);
    for (const f of funcoes) {
      expect(f, f.slice(0, 40)).toMatch(/pode\(session, (cap|"acao\.cobranca\.)/);
    }
  });
});
