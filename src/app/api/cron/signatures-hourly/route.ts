import { isCronRequestAuthorized } from "@/lib/cron-auth";

/**
 * Cron horário das assinaturas digitais (`vercel.json`: minuto 15 de cada hora).
 *
 * ZS1: só a porta — valida o `CRON_SECRET` e responde 204. O trabalho de
 * verdade entra na ZS6: reconciliar pacotes sem notícia (`getDocument`),
 * baixar PDFs assinados pendentes e enviar a `signature_outbox` por e-mail.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return new Response(null, { status: 401 });
  }
  return new Response(null, { status: 204 });
}
