import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { rodarRelatorioMensal } from "@/lib/signatures/relatorio-mensal";

/**
 * Cron mensal das assinaturas digitais (`vercel.json`: dia 1º às 09:00 UTC =
 * 06:00 em Brasília).
 *
 * ZS7: o relatório do mês anterior (a rede inteira) em PDF, na fila de e-mail
 * de cada destinatário configurado (`src/lib/signatures/relatorio-mensal.ts`).
 * Só a Vercel chama (o `CRON_SECRET` vem no cabeçalho); qualquer outro recebe
 * 401. Uma vez por mês: chamar de novo não repete.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return new Response(null, { status: 401 });
  }
  try {
    const r = await rodarRelatorioMensal();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    console.error("signatures monthly failed:", e instanceof Error ? e.message : String(e));
    return Response.json({ ok: false }, { status: 500 });
  }
}
