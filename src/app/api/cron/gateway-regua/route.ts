import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { rodarFilaDaRegua } from "@/lib/asaas/regua-servidor";
import { isAdminClientConfigured } from "@/lib/supabase/admin";

/**
 * Cron da régua de avisos do Asaas (ASA2, entrega 3; 4007), a cada 10 minutos
 * (`vercel.json`). Aplica no Asaas os pagadores que estão na fila (unidade
 * ligada ou desligada, régua alterada, contato da ficha, pedido de não receber,
 * conta desativada): até 50 por conta por rodada. Só a Vercel chama (o
 * `CRON_SECRET` vem no cabeçalho); qualquer outro recebe 401. Responde só os
 * números da rodada.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return new Response(null, { status: 401 });
  }
  if (!isAdminClientConfigured()) return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
  try {
    const r = await rodarFilaDaRegua();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    // Banco sem a 4007 (o código pode ir ao ar antes): não há fila.
    if (/does not exist|schema cache|Could not find the function/i.test(m)) {
      return Response.json({ ok: true, pagadores: 0, semMigracao: true });
    }
    console.error("gateway regua queue failed:", m);
    return Response.json({ ok: false }, { status: 500 });
  }
}
