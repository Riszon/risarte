import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { rodarRotinaHoraria } from "@/lib/signatures/rotina-horaria";

/**
 * Cron horário das assinaturas digitais (`vercel.json`: minuto 15 de cada hora).
 *
 * ZS6: confere na ZapSign o pacote sem notícia, busca o PDF assinado que
 * faltou e manda a fila de e-mail (`src/lib/signatures/rotina-horaria.ts`).
 * Só a Vercel chama (o `CRON_SECRET` vem no cabeçalho); qualquer outro
 * recebe 401. Responde 200 com os números da rodada (sem dado pessoal).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return new Response(null, { status: 401 });
  }
  try {
    const stats = await rodarRotinaHoraria();
    return Response.json({ ok: true, ...stats, erros: stats.erros.length });
  } catch (e) {
    console.error("signatures hourly failed:", e instanceof Error ? e.message : String(e));
    return Response.json({ ok: false }, { status: 500 });
  }
}
