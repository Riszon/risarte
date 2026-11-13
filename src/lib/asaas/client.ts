import {
  ASAAS_BASE_URL,
  ASAAS_USER_AGENT,
  MENSAGEM_DA_RECUSA,
  recusaDeAmbiente,
  type AsaasEnvironment,
} from "./env";

/**
 * O CLIENTE HTTP DO ASAAS — uma porta só.
 *
 * Arquivo PURO (sem `server-only`, sem banco): recebe a chave e o ambiente de
 * quem chama e devolve a resposta. Quem busca a chave no Vault e grava o
 * registro das chamadas é `account.ts` — que é `server-only`. Esta separação
 * existe para o teste rodar com um `fetch` falso.
 *
 * O QUE ELE GARANTE:
 *   * cabeçalhos `access_token` (não é `Authorization: Bearer`), `User-Agent`
 *     e `Content-Type: application/json`;
 *   * a trava de ambiente (`recusaDeAmbiente`) ANTES de qualquer rede;
 *   * tempo limite por tentativa;
 *   * **TIMEOUT É RESULTADO DESCONHECIDO**: um POST/PUT/DELETE que não
 *     respondeu pode ter sido processado. Ele NUNCA é repetido aqui — o erro
 *     sai como `unknown_outcome` e quem chamou consulta o Asaas (pelo
 *     `externalReference`) antes de decidir. Só GET é repetido em falha de
 *     rede ou 5xx;
 *   * **429 = espera progressiva**: o Asaas recusou ANTES de processar, então
 *     repetir é seguro para qualquer método. A espera respeita o
 *     `RateLimit-Reset` (segundos) quando vem, com teto;
 *   * o registro de cada tentativa (`onLog`) leva método, MODELO da rota,
 *     status e duração — nunca corpo, chave, CPF nem o identificador real.
 */

export type AsaasErrorCode =
  | "environment"
  | "timeout"
  | "network"
  | "unknown_outcome"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "bad_request"
  | "server_error"
  | "invalid_response";

export class AsaasError extends Error {
  readonly code: AsaasErrorCode;
  readonly httpStatus: number | null;
  /** Para a tela, em português, sem detalhe técnico. */
  readonly messagePt: string;
  /** Para o log, em inglês, sem dado pessoal e sem segredo. */
  readonly logMessage: string;
  /** Os códigos de erro que o Asaas devolveu (`errors[].code`). Sem descrição. */
  readonly asaasCodes: string[];

  constructor(args: {
    code: AsaasErrorCode;
    httpStatus?: number | null;
    messagePt: string;
    logMessage: string;
    asaasCodes?: string[];
  }) {
    super(args.logMessage);
    this.name = "AsaasError";
    this.code = args.code;
    this.httpStatus = args.httpStatus ?? null;
    this.messagePt = args.messagePt;
    this.logMessage = args.logMessage;
    this.asaasCodes = args.asaasCodes ?? [];
  }
}

const MESSAGES_PT: Record<AsaasErrorCode, string> = {
  // A recusa de ambiente tem mensagem própria (`MENSAGEM_DA_RECUSA`); esta é a de reserva.
  environment: "A chave e o ambiente do Asaas não combinam.",
  timeout: "O Asaas demorou demais para responder. Tente de novo em instantes.",
  network: "Não foi possível falar com o Asaas. Confira a conexão e tente de novo.",
  unknown_outcome:
    "O Asaas não respondeu a tempo e não dá para saber se o pedido foi processado. Nada foi repetido: confira antes de tentar de novo.",
  unauthorized: "O Asaas recusou a chave de API. Ela pode ter sido apagada, desativada ou ser de outra conta.",
  forbidden: "O Asaas bloqueou o pedido para esta conta. Confira a situação da conta no painel do Asaas.",
  not_found: "O Asaas não encontrou o que foi pedido.",
  rate_limited: "O Asaas limitou as chamadas por alguns instantes. Tente de novo em um minuto.",
  bad_request: "O Asaas recusou os dados enviados.",
  server_error: "O Asaas está indisponível no momento. Tente de novo em instantes.",
  invalid_response: "O Asaas respondeu de um jeito que o riSZon não entendeu.",
};

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type AsaasLogEntry = {
  method: HttpMethod;
  /** O MODELO da rota (`/payments/{id}`), nunca o caminho preenchido. */
  path: string;
  httpStatus: number | null;
  durationMs: number;
  attempt: number;
  errorCode: AsaasErrorCode | null;
  rateRemaining: number | null;
};

export type AsaasRequestArgs = {
  apiKey: string;
  environment: AsaasEnvironment;
  method: HttpMethod;
  /** Modelo da rota, com `{nome}` onde entra identificador. Ex.: `/webhooks/{id}`. */
  path: string;
  /** Os valores de `{nome}`. Não vão para o registro. */
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
};

export type AsaasRequestOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  env?: Record<string, string | undefined>;
  /** Tempo limite por tentativa. Padrão 15 s. */
  timeoutMs?: number;
  /** Quantas vezes insistir no 429. Padrão 3 (4 tentativas no total). */
  rateLimitRetries?: number;
  /** Teto da soma das esperas do 429. Padrão 20 s (cabe numa requisição). */
  maxTotalWaitMs?: number;
  /** Repetições de GET em falha de rede/5xx. Padrão 1. */
  getRetries?: number;
  /** Para o teste: a espera (padrão `setTimeout`). */
  sleep?: (ms: number) => Promise<void>;
  /** Recebe cada tentativa. Nunca pode derrubar a chamada. */
  onLog?: (entry: AsaasLogEntry) => void | Promise<void>;
};

const defaultSleep = (ms: number) => (ms <= 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms)));

/** Monta o endereço: troca `{nome}` pelos valores e acrescenta a consulta. */
export function buildAsaasUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string>,
  query?: AsaasRequestArgs["query"]
): string {
  const filled = path.replace(/\{(\w+)\}/g, (_m, nome: string) => {
    const v = params?.[nome];
    if (!v) throw new Error(`asaas: missing path param "${nome}"`);
    return encodeURIComponent(v);
  });
  const url = new URL(baseUrl.replace(/\/+$/, "") + (filled.startsWith("/") ? filled : `/${filled}`));
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Quanto esperar antes da próxima tentativa do 429, em ms.
 * `RateLimit-Reset` (segundos) manda quando vem; senão, 1 s, 2 s, 4 s…
 * Sempre com um pouco de acaso, para duas requisições não baterem juntas.
 */
export function esperaDoRateLimit(attempt: number, resetHeader: string | null, random: () => number = Math.random): number {
  const reset = Number(resetHeader);
  const base = Number.isFinite(reset) && reset > 0 ? reset * 1000 : 1000 * 2 ** (attempt - 1);
  return Math.round(base + random() * 250);
}

function asaasCodesOf(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((e) => (e && typeof e === "object" ? (e as { code?: unknown }).code : null))
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.slice(0, 60))
    .slice(0, 5);
}

/**
 * O MOTIVO que o Asaas escreveu (`errors[].description`), só para a TELA —
 * nunca para o registro nem para o log. Ex.: "Não é possível efetuar o estorno
 * pois o seu cliente não possui um e-mail válido." (pedido do dono, 13/11/2026).
 */
function asaasMotivoOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return null;
  const d = errors
    .map((e) => (e && typeof e === "object" ? (e as { description?: unknown }).description : null))
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 240));
  return d.length ? d.slice(0, 2).join(" ") : null;
}

function codeFor(status: number): AsaasErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_request";
}

async function safeLog(onLog: AsaasRequestOptions["onLog"], entry: AsaasLogEntry) {
  if (!onLog) return;
  try {
    await onLog(entry);
  } catch {
    // O registro nunca derruba a chamada.
  }
}

/** A chamada. `T` é o corpo JSON esperado; resposta vazia devolve `null`. */
export async function asaasRequest<T>(args: AsaasRequestArgs, options: AsaasRequestOptions = {}): Promise<T> {
  const baseUrl = options.baseUrl ?? ASAAS_BASE_URL[args.environment];
  const where = `Asaas ${args.method} ${args.path}`;

  const recusa = recusaDeAmbiente({
    apiKey: args.apiKey,
    environment: args.environment,
    baseUrl,
    env: options.env,
  });
  if (recusa) {
    throw new AsaasError({
      code: "environment",
      messagePt: MENSAGEM_DA_RECUSA[recusa],
      logMessage: `${where}: refused before network (${recusa})`,
    });
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const rateLimitRetries = options.rateLimitRetries ?? 3;
  const maxTotalWaitMs = options.maxTotalWaitMs ?? 20_000;
  const getRetries = args.method === "GET" ? (options.getRetries ?? 1) : 0;

  const url = buildAsaasUrl(baseUrl, args.path, args.params, args.query);
  // GET com corpo devolve 403 no Asaas: corpo só nos outros métodos.
  const hasBody = args.method !== "GET" && args.body !== undefined;
  const headers: Record<string, string> = {
    access_token: args.apiKey,
    "User-Agent": ASAAS_USER_AGENT,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  let attempt = 0;
  let rateLimited = 0;
  let transientRetries = 0;
  let waited = 0;

  for (;;) {
    attempt++;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: args.method,
        headers,
        body: hasBody ? JSON.stringify(args.body) : undefined,
        signal: controller.signal,
        redirect: "error",
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === "AbortError";
      // Quem escreve não repete: o pedido pode ter chegado.
      const code: AsaasErrorCode = args.method === "GET" ? (aborted ? "timeout" : "network") : "unknown_outcome";
      await safeLog(options.onLog, {
        method: args.method, path: args.path, httpStatus: null,
        durationMs: Date.now() - started, attempt, errorCode: code, rateRemaining: null,
      });
      if (args.method === "GET" && transientRetries < getRetries) {
        transientRetries++;
        await sleep(400);
        continue;
      }
      const err = new AsaasError({
        code,
        messagePt: MESSAGES_PT[code],
        logMessage: `${where}: ${aborted ? `timeout after ${timeoutMs}ms` : "network error"} (attempt ${attempt})`,
      });
      console.error(err.logMessage);
      throw err;
    }
    clearTimeout(timer);

    const durationMs = Date.now() - started;
    const remainingHeader = res.headers.get("RateLimit-Remaining");
    const rateRemaining = remainingHeader !== null && Number.isFinite(Number(remainingHeader)) ? Number(remainingHeader) : null;
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
      await safeLog(options.onLog, {
        method: args.method, path: args.path, httpStatus: res.status,
        durationMs, attempt, errorCode: null, rateRemaining,
      });
      if (!text) return null as T;
      if (json === null) {
        const err = new AsaasError({
          code: "invalid_response",
          httpStatus: res.status,
          messagePt: MESSAGES_PT.invalid_response,
          logMessage: `${where} -> ${res.status}: body is not JSON`,
        });
        console.error(err.logMessage);
        throw err;
      }
      return json as T;
    }

    const code = codeFor(res.status);
    await safeLog(options.onLog, {
      method: args.method, path: args.path, httpStatus: res.status,
      durationMs, attempt, errorCode: code, rateRemaining,
    });

    if (res.status === 429 && rateLimited < rateLimitRetries) {
      const wait = esperaDoRateLimit(rateLimited + 1, res.headers.get("RateLimit-Reset"));
      if (waited + wait <= maxTotalWaitMs) {
        rateLimited++;
        waited += wait;
        await sleep(wait);
        continue;
      }
    }
    if (res.status >= 500 && args.method === "GET" && transientRetries < getRetries) {
      transientRetries++;
      await sleep(400);
      continue;
    }

    const asaasCodes = asaasCodesOf(json);
    // Dado recusado (400): a tela mostra o motivo do Asaas. O log continua só com o código.
    const motivo = code === "bad_request" ? asaasMotivoOf(json) : null;
    const err = new AsaasError({
      code,
      httpStatus: res.status,
      messagePt: motivo ? `O Asaas recusou: ${motivo}` : MESSAGES_PT[code],
      logMessage: `${where} -> ${res.status}${asaasCodes.length ? ` [${asaasCodes.join(",")}]` : ""} (attempt ${attempt})`,
      asaasCodes,
    });
    console.error(err.logMessage);
    throw err;
  }
}

/** A mensagem pt-BR de QUALQUER erro vindo do cliente (AsaasError ou não). */
export function mensagemDoAsaas(error: unknown): string {
  if (error instanceof AsaasError) return error.messagePt;
  return MESSAGES_PT.network;
}
