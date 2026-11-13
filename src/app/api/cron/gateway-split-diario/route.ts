import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { conferirEstornos, conferirSaldosDoSplit } from "@/lib/asaas/split-servidor";
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
  if (!isCronRequestAuthorized(request)) return new Response(null, { status: 401 });
  if (!isAdminClientConfigured()) return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
  const admin = createAdminClient();
  const fila = await admin.rpc("_gateway_split_enqueue_daily");
  if (fila.error && /does not exist|schema cache/i.test(fila.error.message)) {
    return Response.json({ ok: true, semMigracao: true });
  }
  if (fila.error) console.error("gateway split daily enqueue failed:", fila.error.message);
  const estornos = await conferirEstornos().catch((e) => {
    console.error("gateway refunds routine failed:", e instanceof Error ? e.message : e);
    return null;
  });
  const saldos = await conferirSaldosDoSplit(todayInBrazil()).catch((e) => {
    console.error("gateway split balance routine failed:", e instanceof Error ? e.message : e);
    return 0;
  });
  return Response.json({ ok: true, naFila: fila.data ?? 0, estornos, avisosDeSaldo: saldos });
}
