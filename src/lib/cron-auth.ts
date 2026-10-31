import "server-only";

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
  return header === `Bearer ${secret}`;
}
