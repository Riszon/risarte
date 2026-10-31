import "server-only";
import { zapsignBaseUrl, zapsignToken } from "./env";

/**
 * O CLIENTE HTTP DA ZAPSIGN — uma porta só (plano ZS0 §5.1).
 *
 * Toda chamada passa por `zapsignRequest`: `Authorization: Bearer`,
 * `User-Agent: riSZon`, tempo limite, UMA repetição em 5xx/429 com espera, e
 * o erro tipado `ZapsignError` com duas mensagens: a pt-BR para a tela
 * (`messagePt`) e a técnica em inglês para o log (`logMessage`), que nunca
 * carrega dado pessoal — só método, caminho e código HTTP.
 *
 * As dependências (fetch, token, endereço, esperas) podem ser injetadas, para
 * o teste rodar com um `fetch` falso sem tocar em `process.env`.
 */

export type ZapsignErrorCode =
  | "not_configured"
  | "timeout"
  | "network"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "document_already_signed"
  | "bad_request"
  | "server_error"
  | "invalid_response";

export class ZapsignError extends Error {
  readonly code: ZapsignErrorCode;
  readonly httpStatus: number | null;
  /** Para a tela, em português, sem detalhe técnico. */
  readonly messagePt: string;
  /** Para o log, em inglês, sem dado pessoal. */
  readonly logMessage: string;
  /** O que a ZapSign respondeu (texto curto), quando houver. */
  readonly detail: string | null;

  constructor(args: {
    code: ZapsignErrorCode;
    httpStatus?: number | null;
    messagePt: string;
    logMessage: string;
    detail?: string | null;
  }) {
    super(args.logMessage);
    this.name = "ZapsignError";
    this.code = args.code;
    this.httpStatus = args.httpStatus ?? null;
    this.messagePt = args.messagePt;
    this.logMessage = args.logMessage;
    this.detail = args.detail ?? null;
  }
}

export type ZapsignRequestOptions = {
  /** Para o teste: um `fetch` falso. Padrão: o global. */
  fetchImpl?: typeof fetch;
  /** Para o teste: token e endereço sem `process.env`. */
  token?: string | null;
  baseUrl?: string;
  /** Tempo limite por tentativa. Padrão 20 s. */
  timeoutMs?: number;
  /** Espera antes da repetição em 5xx/429. Padrão 800 ms (0 no teste). */
  retryDelayMs?: number;
  /** Quantas repetições. Padrão 1. */
  retries?: number;
  /** Querystring. */
  query?: Record<string, string | number | boolean | undefined>;
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const MESSAGES_PT: Record<ZapsignErrorCode, string> = {
  not_configured: "A assinatura digital ainda não está configurada neste ambiente (falta o token da ZapSign).",
  timeout: "A ZapSign demorou demais para responder. Tente de novo em instantes.",
  network: "Não foi possível falar com a ZapSign. Confira a conexão e tente de novo.",
  unauthorized: "A ZapSign recusou o token do riSZon. Avise o Admin Master.",
  not_found: "Este documento não foi encontrado na ZapSign.",
  rate_limited: "A ZapSign limitou as chamadas por alguns instantes. Tente de novo em um minuto.",
  document_already_signed: "O documento já foi assinado e não pode mais ser cancelado.",
  bad_request: "A ZapSign recusou os dados enviados. Confira os signatários e tente de novo.",
  server_error: "A ZapSign está indisponível no momento. Tente de novo em instantes.",
  invalid_response: "A ZapSign respondeu de um jeito que o riSZon não entendeu.",
};

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

/** Um trecho curto do corpo de erro — sem dado pessoal (só a mensagem/código). */
function shortDetail(body: unknown): string | null {
  if (!body || typeof body !== "object") return typeof body === "string" ? body.slice(0, 200) : null;
  const o = body as Record<string, unknown>;
  const candidate = o.error ?? o.detail ?? o.message ?? o.code;
  if (typeof candidate === "string") return candidate.slice(0, 200);
  if (Array.isArray(candidate)) return candidate.map(String).join("; ").slice(0, 200);
  return null;
}

function buildUrl(baseUrl: string, path: string, query?: ZapsignRequestOptions["query"]): string {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(base + p);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function codeFor(status: number, detail: string | null): ZapsignErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 403 && detail && /already[_ ]signed/i.test(detail)) return "document_already_signed";
  if (status >= 500) return "server_error";
  return "bad_request";
}

/**
 * A chamada. `T` é o corpo JSON esperado; respostas vazias (204) devolvem `null`.
 */
export async function zapsignRequest<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options: ZapsignRequestOptions = {}
): Promise<T> {
  const token = options.token === undefined ? zapsignToken() : options.token;
  const baseUrl = options.baseUrl ?? zapsignBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 800;
  const where = `ZapSign ${method} ${path}`;

  if (!token) {
    throw new ZapsignError({
      code: "not_configured",
      messagePt: MESSAGES_PT.not_configured,
      logMessage: `${where}: ZAPSIGN_API_TOKEN is not set`,
    });
  }

  const url = buildUrl(baseUrl, path, options.query);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "riSZon",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let lastError: ZapsignError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === "AbortError";
      lastError = new ZapsignError({
        code: aborted ? "timeout" : "network",
        messagePt: aborted ? MESSAGES_PT.timeout : MESSAGES_PT.network,
        logMessage: `${where}: ${aborted ? `timeout after ${timeoutMs}ms` : "network error"} (attempt ${attempt + 1})`,
      });
      // Rede e tempo limite também merecem a repetição.
      continue;
    }
    clearTimeout(timer);

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (res.ok) {
      if (!text) return null as T;
      if (json === null) {
        throw new ZapsignError({
          code: "invalid_response",
          httpStatus: res.status,
          messagePt: MESSAGES_PT.invalid_response,
          logMessage: `${where} -> ${res.status}: body is not JSON`,
        });
      }
      return json as T;
    }

    const detail = shortDetail(json ?? text);
    const code = codeFor(res.status, detail);
    lastError = new ZapsignError({
      code,
      httpStatus: res.status,
      messagePt: MESSAGES_PT[code],
      logMessage: `${where} -> ${res.status}${detail ? ` (${detail})` : ""} (attempt ${attempt + 1})`,
      detail,
    });

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) break;
  }

  // Loga em inglês, sem dado pessoal; a tela recebe `messagePt`.
  if (lastError) {
    console.error(lastError.logMessage);
    throw lastError;
  }
  throw new ZapsignError({
    code: "invalid_response",
    messagePt: MESSAGES_PT.invalid_response,
    logMessage: `${where}: no response`,
  });
}

/** A mensagem pt-BR de QUALQUER erro vindo do cliente (ZapsignError ou não). */
export function mensagemDaZapsign(error: unknown): string {
  if (error instanceof ZapsignError) return error.messagePt;
  return MESSAGES_PT.network;
}
