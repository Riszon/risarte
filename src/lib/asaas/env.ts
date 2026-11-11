/**
 * OS AMBIENTES DO ASAAS e as travas que não dependem de rede.
 *
 * Arquivo PURO (sem `server-only`), para o teste alcançar. Nada aqui lê a
 * chave: a chave vem do Supabase Vault, pelo servidor (`account.ts`).
 *
 * ⚠️ PRODUÇÃO ESTÁ TRANCADA ATÉ A ASA7 (decisão do dono, 10/11/2026). São duas
 * travas independentes:
 *   1. o BANCO recusa conta `production` (`gateway_accounts_guard`, 4000);
 *   2. este cliente recusa chave `$aact_prod_` e recusa falar com a API de
 *      produção enquanto `ASAAS_ALLOW_PRODUCTION` não for exatamente `sim`.
 * A variável não existe em nenhum ambiente hoje — e a ASA7 só a cria com a
 * aprovação explícita do dono.
 */

export type AsaasEnvironment = "sandbox" | "production";

export const ASAAS_BASE_URL: Record<AsaasEnvironment, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

export const ASAAS_KEY_PREFIX: Record<AsaasEnvironment, string> = {
  sandbox: "$aact_hmlg_",
  production: "$aact_prod_",
};

/** O que o Asaas vê como origem das chamadas (cabeçalho obrigatório). */
export const ASAAS_USER_AGENT = "riSZon (Risarte Odontologia)";

/** De qual ambiente é esta chave? `null` = não parece uma chave do Asaas. */
export function environmentOfKey(apiKey: string | null | undefined): AsaasEnvironment | null {
  const k = (apiKey ?? "").trim();
  if (k.startsWith(ASAAS_KEY_PREFIX.sandbox)) return "sandbox";
  if (k.startsWith(ASAAS_KEY_PREFIX.production)) return "production";
  return null;
}

/** De qual ambiente é este endereço? `null` = não é a API do Asaas. */
export function environmentOfBaseUrl(baseUrl: string | null | undefined): AsaasEnvironment | null {
  const u = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (u === ASAAS_BASE_URL.sandbox) return "sandbox";
  if (u === ASAAS_BASE_URL.production) return "production";
  return null;
}

/** A produção está liberada NESTE servidor? Hoje, em lugar nenhum. */
export function isProductionAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.ASAAS_ALLOW_PRODUCTION === "sim";
}

export type RecusaDeAmbiente =
  | "key_missing"
  | "key_unknown_format"
  | "key_environment_mismatch"
  | "base_url_unknown"
  | "base_url_environment_mismatch"
  | "production_locked";

/**
 * A trava, numa função só: a chave, o endereço e o ambiente da conta têm de
 * ser do MESMO ambiente, e produção só passa com a liberação explícita.
 * Devolve o motivo da recusa, ou `null` quando pode seguir.
 */
export function recusaDeAmbiente(args: {
  apiKey: string | null | undefined;
  environment: AsaasEnvironment;
  baseUrl?: string;
  env?: Record<string, string | undefined>;
}): RecusaDeAmbiente | null {
  const key = (args.apiKey ?? "").trim();
  if (!key) return "key_missing";
  const daChave = environmentOfKey(key);
  if (!daChave) return "key_unknown_format";
  if (daChave !== args.environment) return "key_environment_mismatch";

  const baseUrl = args.baseUrl ?? ASAAS_BASE_URL[args.environment];
  const doEndereco = environmentOfBaseUrl(baseUrl);
  if (!doEndereco) return "base_url_unknown";
  if (doEndereco !== args.environment) return "base_url_environment_mismatch";

  if (args.environment === "production" && !isProductionAllowed(args.env)) return "production_locked";
  return null;
}

export const MENSAGEM_DA_RECUSA: Record<RecusaDeAmbiente, string> = {
  key_missing: "Cole a chave de API do Asaas.",
  key_unknown_format:
    "Isto não parece uma chave de API do Asaas. A chave começa com $aact_ e é gerada no painel do Asaas, em Integrações.",
  key_environment_mismatch:
    "Esta chave é de outro ambiente do Asaas. Conta de teste usa chave de teste (sandbox); conta real usa chave de produção.",
  base_url_unknown: "O endereço da API do Asaas configurado neste servidor não é reconhecido.",
  base_url_environment_mismatch: "O endereço da API do Asaas não é do mesmo ambiente da chave.",
  production_locked:
    "As chaves de produção do Asaas ainda não estão liberadas no riSZon. Por enquanto, só contas de teste (sandbox).",
};

/**
 * ASAAS DE MENTIRA (`ASAAS_ENV=fake`): o fluxo de vinculação roda sem rede,
 * para o servidor local de teste e o E2E. NUNCA vale num site publicado como
 * produção — a mesma regra da ZapSign de mentira.
 */
export function isAsaasFake(env: Record<string, string | undefined> = process.env): boolean {
  if (env.ASAAS_ENV !== "fake") return false;
  return env.NODE_ENV !== "production" || env.NEXT_PUBLIC_AMBIENTE === "treino";
}

/**
 * O endereço público que recebe os webhooks do Asaas, sem barra no fim.
 * `ASAAS_WEBHOOK_BASE_URL` manda; sem ela, o domínio de produção do projeto
 * na Vercel (o Asaas não segue redirecionamento nem atravessa a proteção de
 * deployment, então endereço de preview não serve). No computador local não
 * há endereço público: devolve `null` e o webhook não é criado.
 */
export function webhookBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = (env.ASAAS_WEBHOOK_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (explicit) return /^https:\/\//.test(explicit) ? explicit : null;
  const vercel = (env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim().replace(/\/+$/, "");
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return null;
}
