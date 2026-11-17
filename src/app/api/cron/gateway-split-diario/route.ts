import { origemDaRotina } from "@/lib/cron-auth";
import { comecarRodada, terminarRodada } from "@/lib/asaas/rodadas";
import { conferirEstornos, conferirSaldosDoSplit } from "@/lib/asaas/split-servidor";
import { conferirReguaDosEstornos } from "@/lib/asaas/estorno-parcial";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { todayInBrazil } from "@/lib/dates";

/**
 * A VIRADA DO DIA do split (ASA3, entrega 2; 4009), às 00:05 de Brasília
 * (`vercel.json`, 03:05 UTC):
 *   - põe na fila as cobranças cujo split muda HOJE (campanha que começa ou
 *     acaba, fim de promoção de tarifa) — U2;
 *   - consulta no Asaas os pedidos de estorno pendentes (o cancelamento não
 *     vem pelo webhook) — 18.7.4;
 *   - confere o saldo das contas que recebem o split (negativo; abaixo do
 *     mínimo da rede) — 18.7.4.
 * Só a Vercel chama (CRON_SECRET). Responde só os números.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  // 4012: a Vercel ou o 2º disparo do banco (pg_cron + pg_net).
  const origem = await origemDaRotina(request);
  if (!origem) return new Response(null, { status: 401 });
  if (!isAdminClientConfigured()) return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
  const admin = createAdminClient();
  const rodada = await comecarRodada("split_diario", origem);
  const fila = await admin.rpc("_gateway_split_enqueue_daily");
  if (fila.error && /does not exist|schema cache/i.test(fila.error.message)) {
    await terminarRodada(rodada, { ok: true, motivo: "sem_migracao" });
    return Response.json({ ok: true, semMigracao: true });
  }
  if (fila.error) console.error("gateway split daily enqueue failed:", fila.error.message);
  const estornos = await conferirEstornos().catch((e) => {
    console.error("gateway refunds routine failed:", e instanceof Error ? e.message : e);
    return null;
  });
  // 4020a (19.37, item 3): a régua dos pedidos pendentes e o saldo que voltou.
  const regua = await conferirReguaDosEstornos().catch((e) => {
    console.error("refund regua failed:", e instanceof Error ? e.message : e);
    return null;
  });
  const saldos = await conferirSaldosDoSplit(todayInBrazil()).catch((e) => {
    console.error("gateway split balance routine failed:", e instanceof Error ? e.message : e);
    return 0;
  });
  await terminarRodada(rodada, { ok: !fila.error, criadas: Number(fila.data ?? 0), detalhes: { avisosDeSaldo: saldos } });
  return Response.json({ ok: true, naFila: fila.data ?? 0, estornos, regua, avisosDeSaldo: saldos });
}
