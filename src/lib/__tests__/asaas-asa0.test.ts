// ASA0 — integração Asaas: as travas de ambiente, o cliente HTTP, as tarifas,
// o webhook, a rotina semanal e as regras da Central de Configuração.
// O que é do BANCO (regra de linha, Vault, prontidão que cai sozinha) é
// provado pelo ensaio `scripts/asaas-ensaio-asa0.mjs`, no treino.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SessionContext } from "@/lib/auth";
import { WEBHOOK_EVENTS } from "@/lib/asaas/api";
import { AsaasError, asaasRequest, buildAsaasUrl, esperaDoRateLimit, type AsaasLogEntry } from "@/lib/asaas/client";
import {
  ASAAS_BASE_URL,
  environmentOfKey,
  isAsaasFake,
  isProductionAllowed,
  recusaDeAmbiente,
  webhookBaseUrl,
} from "@/lib/asaas/env";
import { diaDoAsaas, ratesFromAsaasFees } from "@/lib/asaas/fees";
import { estaNaVez } from "@/lib/asaas/rotina";
import { lerEventoDoAsaas } from "@/lib/asaas/webhook";
import {
  ABAS_DA_CENTRAL,
  ITENS_DE_PRONTIDAO,
  abaValida,
  diasSemUsoDaChave,
  estadoDaProntidao,
  podeVerCentral,
  podeVerRedeNaCentral,
  podeVerUnidadeNaCentral,
  podeVincularContaPelaTela,
  valorEfetivo,
} from "@/lib/central/central";
import { CAPACIDADES, matrizPadrao } from "@/lib/permissions";

const TESTE = "$aact_hmlg_" + "x".repeat(40);
const PROD = "$aact_prod_" + "x".repeat(40);
const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function resposta(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

describe("travas de ambiente do Asaas", () => {
  it("reconhece o ambiente pela chave", () => {
    expect(environmentOfKey(TESTE)).toBe("sandbox");
    expect(environmentOfKey(PROD)).toBe("production");
    expect(environmentOfKey("qualquer-coisa")).toBeNull();
    expect(environmentOfKey("")).toBeNull();
  });

  it("chave, endereço e conta têm de ser do mesmo ambiente", () => {
    expect(recusaDeAmbiente({ apiKey: TESTE, environment: "sandbox" })).toBeNull();
    expect(recusaDeAmbiente({ apiKey: PROD, environment: "sandbox" })).toBe("key_environment_mismatch");
    expect(recusaDeAmbiente({ apiKey: TESTE, environment: "production", env: { ASAAS_ALLOW_PRODUCTION: "sim" } })).toBe(
      "key_environment_mismatch"
    );
    expect(recusaDeAmbiente({ apiKey: TESTE, environment: "sandbox", baseUrl: ASAAS_BASE_URL.production })).toBe(
      "base_url_environment_mismatch"
    );
    expect(recusaDeAmbiente({ apiKey: TESTE, environment: "sandbox", baseUrl: "https://exemplo.com/v3" })).toBe("base_url_unknown");
    expect(recusaDeAmbiente({ apiKey: "", environment: "sandbox" })).toBe("key_missing");
    expect(recusaDeAmbiente({ apiKey: "abc", environment: "sandbox" })).toBe("key_unknown_format");
  });

  it("PRODUÇÃO fica trancada sem a liberação explícita", () => {
    expect(isProductionAllowed({})).toBe(false);
    expect(isProductionAllowed({ ASAAS_ALLOW_PRODUCTION: "true" })).toBe(false);
    expect(isProductionAllowed({ ASAAS_ALLOW_PRODUCTION: "sim" })).toBe(true);
    expect(recusaDeAmbiente({ apiKey: PROD, environment: "production", env: {} })).toBe("production_locked");
    expect(recusaDeAmbiente({ apiKey: PROD, environment: "production", env: { ASAAS_ALLOW_PRODUCTION: "sim" } })).toBeNull();
  });

  it("o cliente recusa chave de produção ANTES de qualquer rede", async () => {
    const fetchImpl = vi.fn();
    await expect(
      asaasRequest({ apiKey: PROD, environment: "production", method: "GET", path: "/wallets/" }, { fetchImpl, env: {} })
    ).rejects.toMatchObject({ code: "environment" });
    await expect(
      asaasRequest({ apiKey: PROD, environment: "sandbox", method: "GET", path: "/wallets/" }, { fetchImpl, env: {} })
    ).rejects.toMatchObject({ code: "environment" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("o Asaas de mentira nunca vale num site publicado como produção", () => {
    expect(isAsaasFake({ ASAAS_ENV: "fake", NODE_ENV: "development" })).toBe(true);
    expect(isAsaasFake({ ASAAS_ENV: "fake", NODE_ENV: "production" })).toBe(false);
    expect(isAsaasFake({ ASAAS_ENV: "fake", NODE_ENV: "production", NEXT_PUBLIC_AMBIENTE: "treino" })).toBe(true);
    expect(isAsaasFake({ NODE_ENV: "development" })).toBe(false);
  });

  it("o endereço do webhook só existe com endereço público em https", () => {
    expect(webhookBaseUrl({})).toBeNull();
    expect(webhookBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "risarte-asaas.vercel.app" })).toBe("https://risarte-asaas.vercel.app");
    expect(webhookBaseUrl({ ASAAS_WEBHOOK_BASE_URL: "https://exemplo.com/" })).toBe("https://exemplo.com");
    expect(webhookBaseUrl({ ASAAS_WEBHOOK_BASE_URL: "http://localhost:3000" })).toBeNull();
  });
});

describe("cliente HTTP do Asaas", () => {
  it("manda access_token, User-Agent e Content-Type — e nunca Authorization", async () => {
    const fetchImpl = vi.fn(async () => resposta(200, { data: [] }));
    await asaasRequest({ apiKey: TESTE, environment: "sandbox", method: "GET", path: "/wallets/" }, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(url).toBe("https://api-sandbox.asaas.com/v3/wallets/");
    expect(h.access_token).toBe(TESTE);
    expect(h["User-Agent"]).toMatch(/riSZon/);
    expect(h["Content-Type"]).toBe("application/json");
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("authorization");
    // GET com corpo devolve 403 no Asaas.
    expect(init.body).toBeUndefined();
  });

  it("monta o endereço com os parâmetros e a consulta", () => {
    expect(buildAsaasUrl("https://api-sandbox.asaas.com/v3", "/webhooks/{id}", { id: "a/b" })).toBe(
      "https://api-sandbox.asaas.com/v3/webhooks/a%2Fb"
    );
    expect(buildAsaasUrl("https://api-sandbox.asaas.com/v3/", "/pix/addressKeys", undefined, { status: "ACTIVE", vazio: "" })).toBe(
      "https://api-sandbox.asaas.com/v3/pix/addressKeys?status=ACTIVE"
    );
    expect(() => buildAsaasUrl("https://api-sandbox.asaas.com/v3", "/webhooks/{id}")).toThrow();
  });

  it("TIMEOUT NUM POST é resultado desconhecido e NUNCA é repetido", async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    await expect(
      asaasRequest({ apiKey: TESTE, environment: "sandbox", method: "POST", path: "/webhooks", body: { a: 1 } }, { fetchImpl, sleep: async () => {} })
    ).rejects.toMatchObject({ code: "unknown_outcome" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falha de rede num GET é repetida uma vez", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("rede");
      return resposta(200, { ok: true });
    });
    const r = await asaasRequest<{ ok: boolean }>(
      { apiKey: TESTE, environment: "sandbox", method: "GET", path: "/myAccount/status/" },
      { fetchImpl, sleep: async () => {} }
    );
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("429 espera pelo RateLimit-Reset e tenta de novo — inclusive em POST", async () => {
    const esperas: number[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      return n < 3 ? resposta(429, { errors: [] }, { "RateLimit-Reset": "2" }) : resposta(200, { id: "wh_1" });
    });
    const r = await asaasRequest<{ id: string }>(
      { apiKey: TESTE, environment: "sandbox", method: "POST", path: "/webhooks", body: {} },
      { fetchImpl, sleep: async (ms) => void esperas.push(ms) }
    );
    expect(r.id).toBe("wh_1");
    expect(esperas).toHaveLength(2);
    for (const e of esperas) expect(e).toBeGreaterThanOrEqual(2000);
  });

  it("429 que não passa desiste dentro do teto de espera", async () => {
    const fetchImpl = vi.fn(async () => resposta(429, { errors: [] }, { "RateLimit-Reset": "30" }));
    await expect(
      asaasRequest({ apiKey: TESTE, environment: "sandbox", method: "GET", path: "/wallets/" }, { fetchImpl, sleep: async () => {} })
    ).rejects.toMatchObject({ code: "rate_limited", httpStatus: 429 });
    // 30 s passa do teto de 20 s: nem espera.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a espera progressiva cresce quando o Asaas não diz quanto esperar", () => {
    const semAcaso = () => 0;
    expect(esperaDoRateLimit(1, null, semAcaso)).toBe(1000);
    expect(esperaDoRateLimit(2, null, semAcaso)).toBe(2000);
    expect(esperaDoRateLimit(3, null, semAcaso)).toBe(4000);
    expect(esperaDoRateLimit(1, "5", semAcaso)).toBe(5000);
  });

  it("401 vira chave recusada, com os códigos do Asaas e sem a descrição", async () => {
    const fetchImpl = vi.fn(async () =>
      resposta(401, { errors: [{ code: "invalid_access_token", description: "A chave de API fornecida é inválida" }] })
    );
    const erro = (await asaasRequest({ apiKey: TESTE, environment: "sandbox", method: "GET", path: "/wallets/" }, { fetchImpl }).catch(
      (e: unknown) => e
    )) as AsaasError;
    expect(erro).toBeInstanceOf(AsaasError);
    expect(erro.code).toBe("unauthorized");
    expect(erro.asaasCodes).toEqual(["invalid_access_token"]);
    expect(erro.logMessage).not.toMatch(/fornecida/);
  });

  it("O REGISTRO NÃO LEVA chave, corpo, consulta nem identificador", async () => {
    const entradas: AsaasLogEntry[] = [];
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => resposta(404, { errors: [{ code: "not_found", description: "x" }] }));
    await asaasRequest(
      {
        apiKey: TESTE,
        environment: "sandbox",
        method: "DELETE",
        path: "/webhooks/{id}",
        params: { id: "segredo-do-id" },
        query: { cpfCnpj: "12345678909" },
        body: { cpfCnpj: "12345678909" },
      },
      { fetchImpl, onLog: (e) => void entradas.push(e) }
    ).catch(() => {});
    const tudo = JSON.stringify(entradas) + JSON.stringify(erros.mock.calls);
    erros.mockRestore();
    expect(entradas).toHaveLength(1);
    expect(entradas[0].path).toBe("/webhooks/{id}");
    expect(tudo).not.toContain(TESTE);
    expect(tudo).not.toContain("aact_");
    expect(tudo).not.toContain("12345678909");
    expect(tudo).not.toContain("segredo-do-id");
  });

  it("registro que falha não derruba a chamada", async () => {
    const fetchImpl = vi.fn(async () => resposta(200, { ok: 1 }));
    const r = await asaasRequest<{ ok: number }>(
      { apiKey: TESTE, environment: "sandbox", method: "GET", path: "/wallets/" },
      {
        fetchImpl,
        onLog: () => {
          throw new Error("banco fora");
        },
      }
    );
    expect(r.ok).toBe(1);
  });
});

describe("tarifas do Asaas → linhas com vigência", () => {
  const HOJE = "2026-11-10";

  it("promoção com data de fim vira DUAS linhas: a promocional e a cheia do dia seguinte", () => {
    const r = ratesFromAsaasFees(
      { payment: { bankSlip: { defaultValue: 1.99, discountValue: 0.99, expirationDate: "2027-02-10 00:00:00", daysToReceive: 1 } } },
      HOJE
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ modality: "boleto", fixed_fee_cents: 99, valid_from: null, valid_to: "2027-02-10" });
    expect(r[1]).toMatchObject({ modality: "boleto", fixed_fee_cents: 199, valid_from: "2027-02-11", valid_to: null });
  });

  it("promoção vencida ou igual à cheia não vira linha", () => {
    const vencida = ratesFromAsaasFees(
      { payment: { bankSlip: { defaultValue: 1.99, discountValue: 0.99, expirationDate: "2026-01-01 00:00:00" } } },
      HOJE
    );
    expect(vencida).toHaveLength(1);
    expect(vencida[0].fixed_fee_cents).toBe(199);
    const igual = ratesFromAsaasFees(
      { payment: { bankSlip: { defaultValue: 1.99, discountValue: 1.99, expirationDate: "2027-01-01 00:00:00" } } },
      HOJE
    );
    expect(igual).toHaveLength(1);
  });

  it("cartão: valor fixo por cobrança + percentual por faixa de parcelas", () => {
    const r = ratesFromAsaasFees(
      {
        payment: {
          creditCard: {
            operationValue: 0.49,
            oneInstallmentPercentage: 2.99,
            upToSixInstallmentsPercentage: 3.49,
            upToTwelveInstallmentsPercentage: 3.99,
            upToTwentyOneInstallmentsPercentage: 4.29,
            daysToReceive: 32,
          },
        },
      },
      HOJE
    );
    expect(r.map((x) => [x.modality, x.min_installments, x.max_installments, x.fee_percent, x.fixed_fee_cents])).toEqual([
      ["credito_avista", 1, 1, 2.99, 49],
      ["credito_parcelado", 2, 6, 3.49, 49],
      ["credito_parcelado", 7, 12, 3.99, 49],
      ["credito_parcelado", 13, 21, 4.29, 49],
    ]);
    expect(r.every((x) => x.settlement_days === 32)).toBe(true);
  });

  it("PIX percentual leva piso e teto; PIX fixo não", () => {
    const pct = ratesFromAsaasFees(
      { payment: { pix: { fixedFeeValue: null, percentageFee: 0.99, minimumFeeValue: 0.5, maximumFeeValue: 5, monthlyCreditsWithoutFee: 30 } } },
      HOJE
    );
    expect(pct[0]).toMatchObject({ modality: "pix", fee_percent: 0.99, fixed_fee_cents: 0, min_fee_cents: 50, max_fee_cents: 500, free_monthly_count: 30 });
    const fixo = ratesFromAsaasFees({ payment: { pix: { fixedFeeValue: 1.99, percentageFee: null } } }, HOJE);
    expect(fixo[0]).toMatchObject({ fee_percent: 0, fixed_fee_cents: 199, min_fee_cents: null, max_fee_cents: null, free_monthly_count: null });
  });

  it("resposta vazia não inventa tarifa; centavo não perde por ponto flutuante", () => {
    expect(ratesFromAsaasFees(null, HOJE)).toEqual([]);
    expect(ratesFromAsaasFees({}, HOJE)).toEqual([]);
    expect(ratesFromAsaasFees({ payment: { bankSlip: { defaultValue: 2.3 } } }, HOJE)[0].fixed_fee_cents).toBe(230);
    expect(diaDoAsaas("2027-02-10 00:00:00")).toBe("2027-02-10");
    expect(diaDoAsaas("")).toBeNull();
  });
});

describe("webhook e rotina", () => {
  it("só aceita corpo que É um evento", () => {
    expect(lerEventoDoAsaas({ id: "evt_1&2", event: "PAYMENT_CREATED" })).toEqual({ id: "evt_1&2", event: "PAYMENT_CREATED" });
    expect(lerEventoDoAsaas({ event: "PAYMENT_CREATED" })).toBeNull();
    expect(lerEventoDoAsaas({ id: "evt_1", event: "pagamento criado" })).toBeNull();
    expect(lerEventoDoAsaas([])).toBeNull();
    expect(lerEventoDoAsaas(null)).toBeNull();
  });

  it("o webhook pede os eventos de cobrança, de split e da chave de API", () => {
    for (const e of ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE", "PAYMENT_REFUNDED", "PAYMENT_SPLIT_DONE", "PAYMENT_SPLIT_DIVERGENCE_BLOCK", "ACCESS_TOKEN_EXPIRING_SOON"]) {
      expect(WEBHOOK_EVENTS).toContain(e);
    }
    expect(new Set(WEBHOOK_EVENTS).size).toBe(WEBHOOK_EVENTS.length);
  });

  it("a rota confere o token ANTES de ler o corpo, em tempo constante, e responde 200", () => {
    const rota = ler("src/app/api/webhooks/asaas/[ref]/route.ts");
    const codigo = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).toContain('request.headers.get("asaas-access-token")');
    expect(codigo).toContain("segredoConfere(recebido, conta?.token ?? null)");
    expect(codigo.indexOf("segredoConfere(")).toBeLessThan(codigo.indexOf("request.json()"));
    expect(codigo).toMatch(/status: 401/);
    expect(codigo).toMatch(/\{ status: 200 \}/);
    // Nada de comparar segredo com !== / ===.
    expect(codigo).not.toMatch(/token\s*[!=]==/);
    // Nada do corpo no log.
    expect(codigo).not.toMatch(/console\.(log|error)\([^)]*body/);
  });

  it("a verificação é semanal, mas a que falhou volta no dia seguinte", () => {
    const agora = new Date("2026-11-10T12:00:00Z");
    expect(estaNaVez({ last_check_at: null, last_check_ok: null }, agora)).toBe(true);
    expect(estaNaVez({ last_check_at: "2026-11-09T12:00:00Z", last_check_ok: true }, agora)).toBe(false);
    expect(estaNaVez({ last_check_at: "2026-11-03T12:00:00Z", last_check_ok: true }, agora)).toBe(true);
    expect(estaNaVez({ last_check_at: "2026-11-09T12:00:00Z", last_check_ok: false }, agora)).toBe(true);
  });

  it("a rotina está no vercel.json e a rota exige o segredo", () => {
    expect(ler("vercel.json")).toContain("/api/cron/gateway-accounts");
    expect(ler("src/app/api/cron/gateway-accounts/route.ts")).toContain("isCronRequestAuthorized(request)");
  });
});

function sessao(p: Partial<SessionContext>): SessionContext {
  return {
    userId: "u1",
    email: "x@example.com",
    fullName: "X",
    isAdminMaster: false,
    clinics: [],
    rolesByClinic: {},
    activeClinic: null,
    activeClinicExplicit: false,
    permissoes: matrizPadrao(),
    ...p,
  } as SessionContext;
}

describe("Central de Configuração", () => {
  it("as permissões nascem SEM papel nenhum (só o Admin Master) — e a 4002 fixa o mesmo padrão", () => {
    for (const id of ["modulo.central", "acao.central.vincular_conta"]) {
      const c = CAPACIDADES.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect(c!.padrao).toEqual([]);
    }
    const sql = ler("supabase/migrations/4002_central_prontidao_historico_e_verificacao.sql");
    expect(sql).toContain("('modulo.central', '{}'::public.user_role[])");
    expect(sql).toContain("('acao.central.vincular_conta', '{}'::public.user_role[])");
    expect(sql).not.toMatch(/insert into public\.permission_matrix/);
  });

  it("por padrão só o Admin Master vê a Central", () => {
    expect(podeVerCentral(sessao({ isAdminMaster: true }))).toBe(true);
    expect(podeVerCentral(sessao({ rolesByClinic: { a: ["unit_manager"] } }))).toBe(false);
    expect(podeVerCentral(sessao({ rolesByClinic: { f: ["finance_franchisor"] } }))).toBe(false);
  });

  it("com a permissão ligada, o Gerente só alcança a PRÓPRIA unidade e nunca a rede", () => {
    const permissoes = { ...matrizPadrao(), "modulo.central": ["unit_manager" as const, "finance_franchisor" as const] };
    const gerente = sessao({ rolesByClinic: { a: ["unit_manager"] }, permissoes });
    expect(podeVerUnidadeNaCentral(gerente, "a")).toBe(true);
    expect(podeVerUnidadeNaCentral(gerente, "b")).toBe(false);
    expect(podeVerRedeNaCentral(gerente)).toBe(false);
    const financeiro = sessao({ rolesByClinic: { f: ["finance_franchisor"] }, permissoes });
    expect(podeVerUnidadeNaCentral(financeiro, "b")).toBe(true);
    expect(podeVerRedeNaCentral(financeiro)).toBe(true);
  });

  it("gravar a chave: Admin sempre; Gerente só com a permissão e só na própria unidade; Financeiro nunca", () => {
    const base = { ...matrizPadrao(), "modulo.central": ["unit_manager" as const, "finance_franchisor" as const] };
    const comAcao = { ...base, "acao.central.vincular_conta": ["unit_manager" as const, "finance_franchisor" as const] };
    expect(podeVincularContaPelaTela(sessao({ isAdminMaster: true }), null)).toBe(true);
    expect(podeVincularContaPelaTela(sessao({ rolesByClinic: { a: ["unit_manager"] }, permissoes: base }), "a")).toBe(false);
    expect(podeVincularContaPelaTela(sessao({ rolesByClinic: { a: ["unit_manager"] }, permissoes: comAcao }), "a")).toBe(true);
    expect(podeVincularContaPelaTela(sessao({ rolesByClinic: { a: ["unit_manager"] }, permissoes: comAcao }), "b")).toBe(false);
    expect(podeVincularContaPelaTela(sessao({ rolesByClinic: { f: ["finance_franchisor"] }, permissoes: comAcao }), "a")).toBe(false);
  });

  it("a aba da ASA0 existe nos dois níveis; aba desconhecida não abre", () => {
    expect(ABAS_DA_CENTRAL.map((a) => a.id)).toEqual(["conta"]);
    expect(abaValida("rede", "conta")).not.toBeNull();
    expect(abaValida("unidade", "conta")).not.toBeNull();
    expect(abaValida("unidade", "financeiro")).toBeNull();
  });

  it("LISTA VAZIA não é 'pronta': é 'não consegui conferir'", () => {
    expect(estadoDaProntidao([], true)).toBe("nao_conferida");
    expect(estadoDaProntidao(null, true)).toBe("nao_conferida");
    const ok = [{ item: "conta_validada", ok: true, sort_order: 10 }];
    expect(estadoDaProntidao(ok, false)).toBe("falta_marcar");
    expect(estadoDaProntidao(ok, true)).toBe("pronta");
    expect(estadoDaProntidao([...ok, { item: "chave_pix", ok: false, sort_order: 50 }], true)).toBe("faltam_itens");
  });

  it("todo item de prontidão que o banco devolve tem nome e instrução em português", () => {
    const sql = ler("supabase/migrations/4002_central_prontidao_historico_e_verificacao.sql");
    const corpo = sql.slice(sql.indexOf("function public._central_readiness_raw"), sql.indexOf("revoke execute on function public._central_readiness_raw"));
    const itens = [...corpo.matchAll(/select '([a-z_]+)'/g)].map((m) => m[1]);
    // A régua tem de achar os itens: zero achados é "não medi".
    expect(itens.length).toBeGreaterThanOrEqual(8);
    for (const i of itens) expect(ITENS_DE_PRONTIDAO[i], i).toBeDefined();
    for (const esperado of ["split_habilitado", "termo_registrado", "antecipacao_desligada", "chave_pix"]) expect(itens).toContain(esperado);
  });

  it("herança campo a campo: vazio herda; zero é valor", () => {
    expect(valorEfetivo(null, 2)).toEqual({ valor: 2, origem: "herdado" });
    expect(valorEfetivo(undefined, 2)).toEqual({ valor: 2, origem: "herdado" });
    expect(valorEfetivo(0, 2)).toEqual({ valor: 0, origem: "personalizado" });
    expect(valorEfetivo(1, 2)).toEqual({ valor: 1, origem: "personalizado" });
    expect(valorEfetivo(null, null)).toEqual({ valor: null, origem: "sem_valor" });
  });

  it("avisa da chave parada a partir de 60 dias", () => {
    const agora = new Date("2026-11-10T12:00:00Z");
    expect(diasSemUsoDaChave(null, agora)).toBeNull();
    expect(diasSemUsoDaChave("2026-10-01T12:00:00Z", agora)).toBeNull();
    expect(diasSemUsoDaChave("2026-09-01T12:00:00Z", agora)).toBe(70);
  });
});

// ---- réguas sobre o código e as migrações -------------------------------------

function arquivos(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      if (nome === "node_modules" || nome.startsWith(".next")) continue;
      arquivos(p, saida);
    } else if (/\.(ts|tsx)$/.test(nome)) saida.push(p.replace(/\\/g, "/"));
  }
  return saida;
}

describe("réguas da ASA0 (segredo fora do navegador, do código e dos registros)", () => {
  const fontes = arquivos("src").filter((f) => !f.includes("/__tests__/"));

  it("achou o código para medir", () => {
    expect(fontes.length).toBeGreaterThan(500);
    expect(fontes.some((f) => f.endsWith("src/lib/asaas/account.ts"))).toBe(true);
  });

  it("quem tira a chave do Vault e fala com o banco é server-only", () => {
    for (const f of ["src/lib/asaas/account.ts", "src/lib/asaas/link.ts", "src/lib/asaas/rotina.ts"]) {
      expect(ler(f), f).toMatch(/^import "server-only";/m);
    }
  });

  it("NENHUM componente de navegador importa o servidor do Asaas", () => {
    const clientes = fontes.filter((f) => /^\s*"use client";/m.test(ler(f).slice(0, 200)));
    expect(clientes.length).toBeGreaterThan(50);
    for (const f of clientes) {
      expect(ler(f), f).not.toMatch(/from "@\/lib\/asaas\/(account|link|rotina|api|client)"/);
      expect(ler(f), f).not.toMatch(/from "@\/lib\/supabase\/admin"/);
    }
  });

  it("a função que lê a chave só é chamada em account.ts — e a variável ASAAS_API_KEY não entra no código novo", () => {
    const quemLe = fontes.filter((f) => ler(f).includes("_gateway_read_key"));
    expect(quemLe).toEqual(["src/lib/asaas/account.ts"]);
    const quemUsaEnv = fontes.filter((f) => ler(f).includes("ASAAS_API_KEY"));
    // Só o cliente ANTIGO do Empresarial (nunca chamado; aposentado na ASA5).
    expect(quemUsaEnv).toEqual(["src/lib/empresarial/asaas.ts"]);
  });

  it("nenhuma chave de API escrita no repositório (código, roteiros, migrações, documentos)", () => {
    const alvos = [...arquivos("src"), ...readdirSync("scripts").map((f) => `scripts/${f}`), "docs/integracao-asaas.md", ".env.example"]
      .filter((f) => statSync(f).isFile());
    const padrao = /\$aact_(hmlg|prod)_[A-Za-z0-9+/=:_-]{20,}/;
    for (const f of alvos) {
      const texto = ler(f);
      // As chaves de mentira dos testes são montadas em pedaços e não casam com o padrão.
      expect(padrao.test(texto), f).toBe(false);
    }
  });

  it("a ação de gravar a chave não manda a chave para a auditoria nem para a resposta", () => {
    const acoes = ler("src/app/(app)/central/actions.ts");
    const gravar = acoes.slice(acoes.indexOf("export async function gravarChave"), acoes.indexOf("export async function criarWebhook"));
    expect(gravar.length).toBeGreaterThan(200);
    expect(gravar).not.toMatch(/logAudit\([^)]*apiKey/);
    expect(gravar).not.toMatch(/details/);
    expect(gravar).not.toMatch(/console\./);
    expect(gravar).not.toMatch(/return \{[^}]*apiKey/);
    // O campo da tela é só de gravação.
    const tela = ler("src/app/(app)/central/conta-client.tsx");
    expect(tela).toMatch(/name="api_key"[\s\S]{0,80}type="password"/);
    expect(tela).not.toMatch(/name="api_key"[\s\S]{0,200}(defaultValue|value)=/);
  });

  it("a leitura da tela não pede o valor de nenhum segredo", () => {
    const dados = ler("src/lib/central/dados.ts");
    expect(dados).not.toMatch(/decrypted_secret|vault\./);
    expect(dados).toContain("temChave: l.api_key_secret_id != null");
  });

  describe("migrações 4000–4002", () => {
    const m4000 = ler("supabase/migrations/4000_asaas_fundacao_contas_e_vault.sql");
    const m4001 = ler("supabase/migrations/4001_asaas_tarifas_no_adquirente.sql");
    const m4002 = ler("supabase/migrations/4002_central_prontidao_historico_e_verificacao.sql");
    const todas = m4000 + m4001 + m4002;

    it("toda função é fechada para public, anon e authenticated; só as da tela reabrem", () => {
      const criadas = [...todas.matchAll(/create or replace function public\.(\w+)\s*\(/g)].map((m) => m[1]);
      expect(criadas.length).toBeGreaterThanOrEqual(20);
      for (const fn of new Set(criadas)) {
        expect(todas, fn).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^;]*\\) from public, anon, authenticated;`));
      }
      const abertas = [...todas.matchAll(/grant execute on function public\.(\w+)\(/g)].map((m) => m[1]);
      for (const fn of abertas) expect(fn.startsWith("_"), `${fn} é interna e foi aberta`).toBe(false);
      expect(abertas).not.toContain("gateway_accounts_guard");
    });

    it("não há regra de ESCRITA em nenhuma tabela nova", () => {
      const regras = [...todas.matchAll(/create policy "[^"]+" on public\.(\w+)\s+for (\w+)/g)];
      expect(regras.length).toBeGreaterThanOrEqual(5);
      for (const [, tabela, cmd] of regras) expect(cmd, tabela).toBe("select");
    });

    it("a trava de produção está no gatilho e não existe função que ligue o interruptor", () => {
      expect(m4000).toContain("raise exception 'GATEWAY_PRODUCTION_LOCKED'");
      expect(m4000).toMatch(/production_enabled boolean not null default false/);
      expect(todas).not.toMatch(/set\s+production_enabled\s*=/i);
    });

    it("o Gerente só grava a chave depois do termo — no banco", () => {
      const fn = m4000.slice(m4000.indexOf("function public._gateway_actor_can_link"), m4000.indexOf("revoke execute on function public._gateway_actor_can_link"));
      expect(fn).toContain("a.term_registered_at is not null");
      expect(fn).toContain("r.role = 'unit_manager'");
      expect(fn).toContain("r.clinic_id = a.clinic_id");
    });

    it("o adquirente Asaas não nasce como padrão e a tarifa do Asaas é marcada como do gateway", () => {
      expect(m4001).toMatch(/'Asaas \(teste\)' else 'Asaas' end,\s*false,/);
      expect(m4001).toContain("'pagamento', 'gateway'");
    });

    it("terminam com a auditoria e deixam os registros técnicos de fora, com motivo", () => {
      for (const m of [m4000, m4001, m4002]) expect(m).toContain("select public.audit_attach_all();");
      for (const t of ["gateway_key_usage", "gateway_api_log", "gateway_webhook_events", "gateway_notices"]) {
        expect(todas).toContain(`('public', '${t}',`);
      }
    });
  });
});
