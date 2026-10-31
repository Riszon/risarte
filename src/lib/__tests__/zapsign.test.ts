import { afterEach, describe, expect, it, vi } from "vitest";
import { ZapsignError, zapsignRequest } from "@/lib/zapsign/client";
import {
  ZAPSIGN_MAX_PDF_BYTES,
  addSigner,
  createDocumentFromPdf,
  getDocument,
  getPlanInfo,
  listDocuments,
  placeSignatures,
  refuseDocument,
  removeSigner,
  reprocessWebhook,
  resendNotifications,
  signInBatch,
  updateSigner,
} from "@/lib/zapsign/api";
import { zapsignBaseUrl, zapsignEnv, isZapsignConfigured } from "@/lib/zapsign/env";
import { parseWebhook, webhookEventKey, webhookMatchesEnvironment } from "@/lib/zapsign/webhook";
import { CAPACIDADES } from "@/lib/permissions";
import { readFileSync } from "node:fs";

// ZS1 (plano ZS0 §5.1 e §13): o cliente da ZapSign com `fetch` falso —
// montagem do corpo, ordem dos signatários, cabeçalhos, repetição e erros.

type Chamada = { url: string; init: RequestInit };

/** Um `fetch` falso que responde a sequência dada e guarda o que recebeu. */
function fetchFalso(respostas: { status: number; body?: unknown; texto?: string }[]) {
  const chamadas: Chamada[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i++;
    const texto = r.texto ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    // 204 não pode levar corpo (o próprio `Response` recusa).
    return new Response(texto || null, { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, chamadas };
}

const OPTS = { token: "tok-teste", baseUrl: "https://sandbox.api.zapsign.com.br/api/v1", retryDelayMs: 0 };
const corpo = (c: Chamada) => JSON.parse(String(c.init.body));
/** Espera a chamada FALHAR e devolve o erro tipado; sucesso é falha do teste. */
const erroDe = (p: Promise<unknown>): Promise<ZapsignError> =>
  p.then(
    () => { throw new Error("esperava um ZapsignError e a chamada passou"); },
    (e: unknown) => e as ZapsignError
  );
const headers = (c: Chamada) => c.init.headers as Record<string, string>;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ambiente", () => {
  it("sandbox é o padrão; produção só quando escrito", () => {
    vi.stubEnv("ZAPSIGN_ENV", "");
    expect(zapsignEnv()).toBe("sandbox");
    expect(zapsignBaseUrl()).toBe("https://sandbox.api.zapsign.com.br/api/v1");
    vi.stubEnv("ZAPSIGN_ENV", "production");
    expect(zapsignEnv()).toBe("production");
    expect(zapsignBaseUrl()).toBe("https://api.zapsign.com.br/api/v1");
    vi.stubEnv("ZAPSIGN_ENV", "qualquer-coisa");
    expect(zapsignEnv()).toBe("sandbox");
  });

  it("configurado = tem token (espaço em branco não conta)", () => {
    vi.stubEnv("ZAPSIGN_API_TOKEN", "");
    expect(isZapsignConfigured()).toBe(false);
    vi.stubEnv("ZAPSIGN_API_TOKEN", "   ");
    expect(isZapsignConfigured()).toBe(false);
    vi.stubEnv("ZAPSIGN_API_TOKEN", "abc");
    expect(isZapsignConfigured()).toBe(true);
  });
});

describe("a chamada", () => {
  it("manda Bearer, User-Agent riSZon e JSON", async () => {
    const f = fetchFalso([{ status: 200, body: { ok: 1 } }]);
    await zapsignRequest("POST", "/docs/", { a: 1 }, { ...OPTS, fetchImpl: f.impl });
    expect(f.chamadas).toHaveLength(1);
    const c = f.chamadas[0];
    expect(c.url).toBe("https://sandbox.api.zapsign.com.br/api/v1/docs/");
    expect(headers(c).Authorization).toBe("Bearer tok-teste");
    expect(headers(c)["User-Agent"]).toBe("riSZon");
    expect(headers(c)["Content-Type"]).toBe("application/json");
    expect(corpo(c)).toEqual({ a: 1 });
  });

  it("sem token: erro `not_configured`, sem nenhuma chamada", async () => {
    const f = fetchFalso([{ status: 200, body: {} }]);
    const erro = await erroDe(zapsignRequest("GET", "/docs/", undefined, { ...OPTS, token: null, fetchImpl: f.impl }));
    expect(erro).toBeInstanceOf(ZapsignError);
    expect(erro.code).toBe("not_configured");
    expect(erro.messagePt).toMatch(/não está configurada/);
    expect(f.chamadas).toHaveLength(0);
  });

  it("repete UMA vez em 5xx e devolve o sucesso da segunda", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fetchFalso([{ status: 502, body: { error: "bad gateway" } }, { status: 200, body: { token: "d1" } }]);
    const r = await zapsignRequest<{ token: string }>("GET", "/docs/d1/", undefined, { ...OPTS, fetchImpl: f.impl });
    expect(r.token).toBe("d1");
    expect(f.chamadas).toHaveLength(2);
  });

  it("repete em 429 e, se continuar, erra `rate_limited` com mensagem pt-BR", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fetchFalso([{ status: 429, body: { error: "cooldown" } }]);
    const erro = await erroDe(zapsignRequest("POST", "/docs/d1/resend-notifications-bulk/", {}, { ...OPTS, fetchImpl: f.impl }));
    expect(f.chamadas).toHaveLength(2);
    expect(erro.code).toBe("rate_limited");
    expect(erro.httpStatus).toBe(429);
    expect(erro.messagePt).toMatch(/limitou/);
  });

  it("NÃO repete em 4xx: 400, 401 e 404 com os códigos certos", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [status, code] of [[400, "bad_request"], [401, "unauthorized"], [404, "not_found"]] as const) {
      const f = fetchFalso([{ status, body: { error: "x" } }]);
      const erro = await erroDe(zapsignRequest("GET", "/docs/x/", undefined, { ...OPTS, fetchImpl: f.impl }));
      expect(f.chamadas, String(status)).toHaveLength(1);
      expect(erro.code).toBe(code);
    }
  });

  it("403 document_already_signed vira o código próprio (assinado não cancela)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fetchFalso([{ status: 403, body: { error: "document_already_signed" } }]);
    const erro = await erroDe(refuseDocument({ doc_token: "d1", rejected_reason: "x" }, { ...OPTS, fetchImpl: f.impl }));
    expect(erro.code).toBe("document_already_signed");
    expect(erro.messagePt).toMatch(/já foi assinado/);
  });

  it("o log é em inglês, com método, caminho e código — sem o corpo nem dado pessoal", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fetchFalso([{ status: 400, body: { error: "invalid", signers: [{ name: "Maria da Silva", cpf: "12345678900" }] } }]);
    await zapsignRequest("POST", "/docs/", { signers: [{ name: "Maria da Silva" }] }, { ...OPTS, fetchImpl: f.impl }).catch(() => {});
    expect(log).toHaveBeenCalledTimes(1);
    const msg = String(log.mock.calls[0][0]);
    expect(msg).toContain("ZapSign POST /docs/ -> 400");
    expect(msg).not.toContain("Maria");
    expect(msg).not.toContain("12345678900");
  });

  it("falha de rede repete e, persistindo, erra `network`", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const impl = (async () => {
      n++;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const erro = await erroDe(zapsignRequest("GET", "/info-plan", undefined, { ...OPTS, fetchImpl: impl }));
    expect(n).toBe(2);
    expect(erro.code).toBe("network");
  });

  it("tempo limite estourado erra `timeout`", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const impl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      })) as unknown as typeof fetch;
    const erro = await erroDe(zapsignRequest("GET", "/info-plan", undefined, { ...OPTS, fetchImpl: impl, timeoutMs: 5, retries: 0 }));
    expect(erro.code).toBe("timeout");
  });

  it("resposta vazia (204) devolve nulo; resposta que não é JSON erra", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = fetchFalso([{ status: 204, texto: "" }]);
    expect(await zapsignRequest("DELETE", "/signer/s1/remove/", undefined, { ...OPTS, fetchImpl: ok.impl })).toBeNull();
    const ruim = fetchFalso([{ status: 200, texto: "<html>" }]);
    const erro = await erroDe(zapsignRequest("GET", "/docs/", undefined, { ...OPTS, fetchImpl: ruim.impl }));
    expect(erro.code).toBe("invalid_response");
  });

  it("querystring entra no endereço (e o vazio fica de fora)", async () => {
    const f = fetchFalso([{ status: 200, body: { count: 0, results: [] } }]);
    await listDocuments({ created_from: "2026-10-01T00:00:00", status: "signed", page: 2 }, { ...OPTS, fetchImpl: f.impl });
    const u = new URL(f.chamadas[0].url);
    expect(u.pathname).toBe("/api/v1/docs/");
    expect(u.searchParams.get("created_from")).toBe("2026-10-01T00:00:00");
    expect(u.searchParams.get("status")).toBe("signed");
    expect(u.searchParams.get("page")).toBe("2");
    expect(u.searchParams.has("created_to")).toBe(false);
  });
});

describe("criar documento", () => {
  const signers = [
    { name: "Risarte", email: "r@x.com", order_group: 3 },
    { name: "Cliente", phone_country: "55", phone_number: "43999990000", order_group: 1, auth_mode: "assinaturaTela-tokenWhatsapp" as const, require_selfie_photo: true },
    { name: "Testemunha", email: "t@x.com", order_group: 2, qualification: "Testemunha" },
  ];

  it("monta o corpo: pt-br, ordem ligada, external_id, signatários na ordem dos grupos", async () => {
    const f = fetchFalso([{ status: 200, body: { token: "doc1", signers: [{ token: "s1", sign_url: "https://app.zapsign.com.br/verificar/s1" }] } }]);
    const doc = await createDocumentFromPdf(
      { name: "Pacote ASS-000001", base64_pdf: "JVBERi0x", external_id: "pkg-1", disable_signer_emails: true, date_limit_to_sign: "2026-11-07T23:59:59", signers },
      { ...OPTS, fetchImpl: f.impl }
    );
    expect(doc.token).toBe("doc1");
    const b = corpo(f.chamadas[0]);
    expect(b.lang).toBe("pt-br");
    expect(b.signature_order_active).toBe(true);
    expect(b.external_id).toBe("pkg-1");
    expect(b.disable_signer_emails).toBe(true);
    expect(b.base64_pdf).toBe("JVBERi0x");
    expect(b.signers.map((s: { order_group: number }) => s.order_group)).toEqual([1, 2, 3]);
    expect(b.signers[0].require_selfie_photo).toBe(true);
    expect(b.signers[0].auth_mode).toBe("assinaturaTela-tokenWhatsapp");
  });

  it("o que vem de fora manda sobre o padrão (ordem desligada, outra língua)", async () => {
    const f = fetchFalso([{ status: 200, body: { token: "doc1" } }]);
    await createDocumentFromPdf({ name: "x", url_pdf: "https://a/b.pdf", signature_order_active: false, lang: "en", signers: [{ name: "A" }] }, { ...OPTS, fetchImpl: f.impl });
    const b = corpo(f.chamadas[0]);
    expect(b.signature_order_active).toBe(false);
    expect(b.lang).toBe("en");
    expect(b.url_pdf).toBe("https://a/b.pdf");
  });

  it("recusa sem PDF, sem signatário e PDF acima de 10 MB — antes de chamar", async () => {
    const f = fetchFalso([{ status: 200, body: {} }]);
    await expect(createDocumentFromPdf({ name: "x", signers: [{ name: "A" }] }, { ...OPTS, fetchImpl: f.impl })).rejects.toThrow(/base64_pdf or url_pdf/);
    await expect(createDocumentFromPdf({ name: "x", url_pdf: "https://a", signers: [] }, { ...OPTS, fetchImpl: f.impl })).rejects.toThrow(/signer/);
    const grande = "A".repeat(Math.ceil((ZAPSIGN_MAX_PDF_BYTES + 1024) * 4 / 3));
    await expect(createDocumentFromPdf({ name: "x", base64_pdf: grande, signers: [{ name: "A" }] }, { ...OPTS, fetchImpl: f.impl })).rejects.toThrow(/above/);
    expect(f.chamadas).toHaveLength(0);
  });
});

describe("os outros endpoints", () => {
  it("cada função bate no caminho e no método certos", async () => {
    const f = fetchFalso([{ status: 200, body: { token: "x", count: 0, results: [] } }]);
    const o = { ...OPTS, fetchImpl: f.impl };
    await getDocument("d1", o);
    await addSigner("d1", { name: "A", email: "a@x" }, o);
    await updateSigner("s1", { name: "B" }, o);
    await removeSigner("s1", o);
    await placeSignatures("d1", [{ page: 0, relative_position_left: 10, relative_position_bottom: 5, relative_size_x: 19.55, relative_size_y: 9.42, type: "signature", signer_token: "s1" }], o);
    await resendNotifications("d1", o);
    await refuseDocument({ doc_token: "d1", rejected_reason: "Dados errados", notify_signer: true }, o);
    await getPlanInfo(o);
    await reprocessWebhook("d1", o);
    await signInBatch({ user_token: "u1", signer_tokens: ["s1"] }, o);
    const vistos = f.chamadas.map((c) => `${c.init.method} ${new URL(c.url).pathname}`);
    expect(vistos).toEqual([
      "GET /api/v1/docs/d1/",
      "POST /api/v1/docs/d1/add-signer/",
      "POST /api/v1/signers/s1/",
      "DELETE /api/v1/signer/s1/remove/",
      "POST /api/v1/docs/d1/place-signatures/",
      "POST /api/v1/docs/d1/resend-notifications-bulk/",
      "POST /api/v1/refuse/",
      "GET /api/v1/info-plan",
      "POST /api/v1/docs/d1/reprocess-doc/",
      "POST /api/v1/sign/",
    ]);
    expect(corpo(f.chamadas[4])).toEqual({ rubricas: [{ page: 0, relative_position_left: 10, relative_position_bottom: 5, relative_size_x: 19.55, relative_size_y: 9.42, type: "signature", signer_token: "s1" }] });
    expect(corpo(f.chamadas[6])).toEqual({ doc_token: "d1", rejected_reason: "Dados errados", notify_signer: true });
    expect(corpo(f.chamadas[8])).toEqual({ send_webhook: true });
  });

  it("place-signatures recusa coordenada fora de 0–100 e página negativa", async () => {
    const f = fetchFalso([{ status: 200, body: {} }]);
    const o = { ...OPTS, fetchImpl: f.impl };
    const base = { page: 0, relative_position_left: 10, relative_position_bottom: 5, relative_size_x: 19.55, relative_size_y: 9.42, type: "visto" as const, signer_token: "s1" };
    await expect(placeSignatures("d1", [{ ...base, relative_position_left: 101 }], o)).rejects.toThrow(/between 0 and 100/);
    await expect(placeSignatures("d1", [{ ...base, page: -1 }], o)).rejects.toThrow(/page/);
    expect(f.chamadas).toHaveLength(0);
  });

  it("token vazio nunca vira caminho `/docs//`", async () => {
    const f = fetchFalso([{ status: 200, body: {} }]);
    await expect(getDocument("  ", { ...OPTS, fetchImpl: f.impl })).rejects.toThrow(/token is required/);
    await expect(refuseDocument({ doc_token: "d1", rejected_reason: " " }, { ...OPTS, fetchImpl: f.impl })).rejects.toThrow(/rejected_reason/);
    expect(f.chamadas).toHaveLength(0);
  });
});

describe("webhook", () => {
  const payload = {
    event_type: "doc_signed",
    token: "doc1",
    open_id: 42,
    external_id: "pkg-1",
    status: "signed",
    signed_file: "https://zapsign/signed.pdf?exp=1",
    sandbox: true,
    last_update_at: "2026-11-01T12:00:00Z",
    signer_who_signed: { token: "s2", status: "signed", signed_at: "2026-11-01T12:00:00Z", auth_mode: "assinaturaTela", name: "Maria" },
    signers: [
      { token: "s1", status: "signed", signed_at: "2026-11-01T11:00:00Z" },
      { token: "s2", status: "signed", signed_at: "2026-11-01T12:00:00Z" },
      { token: "s3", status: "new" },
    ],
  };

  it("normaliza o evento (sem o nome do signatário)", () => {
    const e = parseWebhook(payload)!;
    expect(e.eventType).toBe("doc_signed");
    expect(e.docToken).toBe("doc1");
    expect(e.openId).toBe(42);
    expect(e.externalId).toBe("pkg-1");
    expect(e.docStatus).toBe("signed");
    expect(e.signedFileUrl).toBe("https://zapsign/signed.pdf?exp=1");
    expect(e.sandbox).toBe(true);
    expect(e.signerWhoSigned).toEqual({ token: "s2", status: "signed", signedAt: "2026-11-01T12:00:00Z", authMode: "assinaturaTela", externalId: null });
    expect(e.signers.map((s) => s.status)).toEqual(["signed", "signed", "new"]);
    expect(JSON.stringify(e)).not.toContain("Maria");
  });

  it("corpo que não é evento → nulo; tipo novo → `unknown` com o cru guardado", () => {
    expect(parseWebhook(null)).toBeNull();
    expect(parseWebhook({})).toBeNull();
    expect(parseWebhook({ event_type: "doc_signed" })).toBeNull();
    expect(parseWebhook({ token: "d" })).toBeNull();
    const e = parseWebhook({ event_type: "doc_algo_novo", token: "d" })!;
    expect(e.eventType).toBe("unknown");
    expect(e.rawEventType).toBe("doc_algo_novo");
    expect(e.signers).toEqual([]);
  });

  it("a chave: uma por assinatura; repetição do mesmo evento dá a MESMA chave", () => {
    const e = parseWebhook(payload)!;
    expect(webhookEventKey(e)).toBe("doc_signed|doc1|s2");
    expect(webhookEventKey(parseWebhook(payload)!)).toBe(webhookEventKey(e));
    const outro = parseWebhook({ ...payload, signer_who_signed: { token: "s3" } })!;
    expect(webhookEventKey(outro)).not.toBe(webhookEventKey(e));
    expect(webhookEventKey(parseWebhook({ event_type: "doc_refused", token: "doc1" })!)).toBe("doc_refused|doc1");
  });

  it("evento repetível leva o instante: duas visualizações são dois eventos", () => {
    const a = parseWebhook({ event_type: "doc_viewed", token: "doc1", last_update_at: "2026-11-01T10:00:00Z" })!;
    const b = parseWebhook({ event_type: "doc_viewed", token: "doc1", last_update_at: "2026-11-01T10:05:00Z" })!;
    expect(webhookEventKey(a)).not.toBe(webhookEventKey(b));
  });

  it("sandbox não vale na produção, e vice-versa", () => {
    const e = parseWebhook(payload)!;
    expect(webhookMatchesEnvironment(e, "sandbox")).toBe(true);
    expect(webhookMatchesEnvironment(e, "production")).toBe(false);
    const prod = parseWebhook({ ...payload, sandbox: false })!;
    expect(webhookMatchesEnvironment(prod, "production")).toBe(true);
  });
});

describe("as permissões do módulo (plano §8) — tela e banco iguais", () => {
  const sql = readFileSync("supabase/migrations/0340_assinaturas_zs1_modulo.sql", "utf8").replace(/\r\n/g, "\n");
  const doBanco = (cap: string): string[] => {
    const m = sql.match(new RegExp(`when '${cap.replace(/\./g, "\\.")}' then\\s*array\\[([^\\]]*)\\]`));
    if (!m) return [];
    return m[1].split(",").map((s) => s.replace(/['\s]/g, "")).filter(Boolean).sort();
  };
  const caps = CAPACIDADES.filter((c) => c.grupo === "Assinaturas digitais");

  it("são as 8 do plano", () => {
    expect(caps.map((c) => c.id).sort()).toEqual([
      "acao.assinaturas.baixar", "acao.assinaturas.cancelar", "acao.assinaturas.configurar",
      "acao.assinaturas.enviar", "acao.assinaturas.painel_rede", "acao.assinaturas.painel_unidade",
      "acao.assinaturas.visualizar", "modulo.assinaturas",
    ]);
  });

  it.each(caps.map((c) => [c.id, c] as const))("%s: o padrão do código é o do banco (`signature_default_roles`)", (_id, c) => {
    expect([...c.padrao].sort()).toEqual(doBanco(c.id));
  });

  it("configurar nasce sem papel (só o Admin Master); painel da rede é do Financeiro", () => {
    expect(caps.find((c) => c.id === "acao.assinaturas.configurar")!.padrao).toEqual([]);
    expect(caps.find((c) => c.id === "acao.assinaturas.painel_rede")!.padrao).toEqual(["finance_franchisor"]);
  });

  it("aqui o banco lê a matriz: nenhuma marcada como `dependeDoBanco`", () => {
    expect(caps.every((c) => c.dependeDoBanco === false)).toBe(true);
  });

  it("a migração não cria policy de DELETE nem de escrita para authenticated nas tabelas do módulo", () => {
    const policies = [...sql.matchAll(/create policy "([^"]+)" on (public\.signature_\w+|storage\.objects)\s+for (\w+)/gi)];
    expect(policies.length).toBeGreaterThan(8);
    expect(policies.filter((p) => p[3].toLowerCase() !== "select").map((p) => p[1])).toEqual([]);
  });
});
