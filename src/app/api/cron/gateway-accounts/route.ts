import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { rodarRotinaDosAvisos, rodarVerificacaoDasContas } from "@/lib/asaas/rotina";
import { isAdminClientConfigured } from "@/lib/supabase/admin";

/**
 * Cron diário das contas Asaas (`vercel.json`: 06:40 no Brasil). Verifica as
 * contas cuja última verificação tem 7 dias ou mais (ou falhou): valida a
 * chave, atualiza situação e tarifas e mantém a chave em uso
 * (`src/lib/asaas/rotina.ts`). Só a Vercel chama (o `CRON_SECRET` vem no
 * cabeçalho); qualquer outro recebe 401. Responde só os números da rodada.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return new Response(null, { status: 401 });
  }
  if (!isAdminClientConfigured()) return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
  try {
    const stats = await rodarVerificacaoDasContas();
    // ASA2: avisos pendentes, resumo das vencidas e fila pausada. Banco sem a
    // 4005 só registra o erro e segue.
    const avisos = await rodarRotinaDosAvisos().catch((e) => {
      console.error("gateway notices routine failed:", e instanceof Error ? e.message : e);
      return {};
    });
    return Response.json({ ok: true, ...stats, ...avisos });
  } catch (e) {
    // Banco sem as migrações 4000+ (o código pode ir ao ar antes): não é erro
    // da rotina — não há conta nenhuma para verificar.
    const m = e instanceof Error ? e.message : String(e);
    if (/does not exist|schema cache|Could not find the table/i.test(m)) {
      return Response.json({ ok: true, contas: 0, verificadas: 0, semMigracao: true });
    }
    console.error("gateway accounts check failed:", m);
    return Response.json({ ok: false }, { status: 500 });
  }
}
