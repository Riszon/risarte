import { isCronRequestAuthorized } from "@/lib/cron-auth";

/**
 * Cron mensal das assinaturas digitais (`vercel.json`: dia 1º às 09:00 UTC =
 * 06:00 em Brasília no horário padrão).
 *
 * ZS1: só a porta — valida o `CRON_SECRET` e responde 204. O relatório do mês
 * anterior (PDF + planilha por e-mail aos destinatários configurados) entra
 * na ZS7.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return new Response(null, { status: 401 });
  }
  return new Response(null, { status: 204 });
}
