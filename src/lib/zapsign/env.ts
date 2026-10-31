import "server-only";

/**
 * O AMBIENTE DA ZAPSIGN — só no servidor (plano ZS0 §5.1 e §12).
 *
 * Variáveis (nomes; os valores ficam na Vercel e no `.env.local`, nunca no git):
 *   ZAPSIGN_API_TOKEN       token da conta da franqueadora (sandbox no treino e
 *                           no desenvolvimento; produção SÓ no projeto de produção)
 *   ZAPSIGN_ENV             `sandbox` | `production` — escolhe o endereço da API
 *   ZAPSIGN_WEBHOOK_SECRET  o valor do cabeçalho `x-riszon-webhook-secret` que a
 *                           ZapSign manda de volta (cadastrado no webhook dela)
 *
 * ⚠️ SANDBOX É O PADRÃO. Sem `ZAPSIGN_ENV=production` escrito, toda chamada
 * vai para o sandbox — um esquecimento de configuração nunca cria documento
 * com validade jurídica (nem consome crédito) por engano.
 */

export type ZapsignEnv = "sandbox" | "production";

const BASE_URL: Record<ZapsignEnv, string> = {
  sandbox: "https://sandbox.api.zapsign.com.br/api/v1",
  production: "https://api.zapsign.com.br/api/v1",
};

export function zapsignEnv(): ZapsignEnv {
  return process.env.ZAPSIGN_ENV === "production" ? "production" : "sandbox";
}

export function zapsignBaseUrl(): string {
  return BASE_URL[zapsignEnv()];
}

export function zapsignToken(): string | null {
  const t = (process.env.ZAPSIGN_API_TOKEN ?? "").trim();
  return t || null;
}

export function zapsignWebhookSecret(): string | null {
  const s = (process.env.ZAPSIGN_WEBHOOK_SECRET ?? "").trim();
  return s || null;
}

/** Há token? Sem ele as telas dizem que a assinatura digital não está ligada. */
export function isZapsignConfigured(): boolean {
  return zapsignToken() !== null;
}
