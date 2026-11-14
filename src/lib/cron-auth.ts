import "server-only";

import { segredoConfere } from "@/lib/segredo-de-webhook";

/**
 * A GUARDA DAS ROTINAS DA VERCEL (`/api/cron/*`, plano ZS0 §4.5).
 *
 * A Vercel chama cada rota de `vercel.json` na hora marcada com o cabeçalho
 * `Authorization: Bearer <CRON_SECRET>` — o valor é a variável `CRON_SECRET`
 * do projeto. Qualquer outra chamada (navegador, curl de fora) não tem o
 * segredo e recebe 401. Sem a variável configurada, NADA roda: uma rotina que
 * qualquer um pudesse disparar seria pior que uma rotina parada.
 */
export function isCronRequestAuthorized(request: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  // AP158 (item 5): comparação em tempo constante, como o webhook (AP99).
  return segredoConfere(header, `Bearer ${secret}`);
}

/**
 * 4012 (spec 19.14): o SEGUNDO DISPARO vem do banco (pg_cron + pg_net), com a
 * senha que o próprio banco gerou e guarda no Vault. A aplicação confere pela
 * porta do servidor `_db_cron_token_ok` — ninguém copia a senha para a Vercel.
 * Devolve a origem da chamada, ou null se não for autorizada.
 */
export async function origemDaRotina(request: Request): Promise<"vercel" | "banco" | null> {
  if (isCronRequestAuthorized(request)) return "vercel";
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || request.headers.get("x-riszon-origem") !== "banco") return null;
  const { createAdminClient, isAdminClientConfigured } = await import("@/lib/supabase/admin");
  if (!isAdminClientConfigured()) return null;
  const { data, error } = await createAdminClient().rpc("_db_cron_token_ok", { p_token: header.slice(7) });
  return !error && data === true ? "banco" : null;
}
