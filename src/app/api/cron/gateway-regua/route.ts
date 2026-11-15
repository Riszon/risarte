import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { comecarRodada, terminarRodada } from "@/lib/asaas/rodadas";
import { createAdminClient } from "@/lib/supabase/admin";
import { rodarFilaDaRegua } from "@/lib/asaas/regua-servidor";
import { conferirWebhooks, corrigirBloqueios, limparCelularesDeEstorno, rodarFilaDoSplit } from "@/lib/asaas/split-servidor";
import { conferirContestacoes, conferirSplitDosParcelamentos } from "@/lib/asaas/parcelamento";
import { rotinaDasRenegociacoes } from "@/lib/asaas/renegociacao";
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
  const rodada = await comecarRodada("regua", "vercel");
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
    // ASA4 (4012): avisos de link não enviado e de primeira cobrança não aberta.
    const avisosDeLink = await createAdminClient()
      .rpc("charge_link_alerts_run")
      .then((x) => (x.error ? 0 : Number(x.data ?? 0)));
    // ASA4 (4014): o cartão parcelado pelo Asaas — o split pela tarifa do dia da
    // aprovação, o prazo das contestações e os avisos (contestação e link vencido).
    const splitDoParcelado = await conferirSplitDosParcelamentos().catch(() => null);
    const contestacoes = await conferirContestacoes().catch(() => null);
    const admin = createAdminClient();
    const avisosDeContestacao = await admin.rpc("chargeback_alerts_run").then((x) => (x.error ? 0 : Number(x.data ?? 0)));
    const avisosDeVencido = await admin.rpc("card_block_overdue_alerts_run").then((x) => (x.error ? 0 : Number(x.data ?? 0)));
    // 4017: a renegociação — o termo vencido expira; o termo de acordo que acabou
    // sem assinatura é cancelado na ZapSign; o assinado que ficou sem aplicar, aplica.
    const renegociacoes = await rotinaDasRenegociacoes().catch(() => null);
    await terminarRodada(rodada, { ok: true, detalhes: { avisosDeLink, avisosDeContestacao, avisosDeVencido, splitDoParcelado, contestacoes, renegociacoes } });
    return Response.json({ ok: true, ...r, split, bloqueios, webhooks, celularesApagados, avisosDeLink, splitDoParcelado, contestacoes, avisosDeContestacao, avisosDeVencido, renegociacoes });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    // Banco sem a 4007 (o código pode ir ao ar antes): não há fila.
    if (/does not exist|schema cache|Could not find the function/i.test(m)) {
      return Response.json({ ok: true, pagadores: 0, semMigracao: true });
    }
    console.error("gateway regua queue failed:", m);
    await terminarRodada(rodada, { ok: false, motivo: m.slice(0, 120) });
    return Response.json({ ok: false }, { status: 500 });
  }
}
