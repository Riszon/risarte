import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { rodarFilaDaRegua } from "@/lib/asaas/regua-servidor";
import { conferirWebhooks, corrigirBloqueios, limparCelularesDeEstorno, rodarFilaDoSplit } from "@/lib/asaas/split-servidor";
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
    // ASA3 (4009): a fila do split (150 por conta), o bloqueio por divergência
    // e o webhook que se corrige sozinho. Falha de um não derruba os outros.
    const split = await rodarFilaDoSplit().catch((e) => {
      console.error("gateway split queue failed:", e instanceof Error ? e.message : e);
      return null;
    });
    const bloqueios = await corrigirBloqueios().catch(() => 0);
    const webhooks = await conferirWebhooks().catch(() => null);
    const celularesApagados = await limparCelularesDeEstorno().catch(() => 0);
    return Response.json({ ok: true, ...r, split, bloqueios, webhooks, celularesApagados });
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
