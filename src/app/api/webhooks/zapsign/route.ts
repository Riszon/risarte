import { segredoConfere } from "@/lib/segredo-de-webhook";
import { aplicarWebhook } from "@/lib/signatures/webhook-apply";
import { zapsignEnv, zapsignWebhookSecret } from "@/lib/zapsign/env";
import { parseWebhook, webhookMatchesEnvironment } from "@/lib/zapsign/webhook";

/**
 * O WEBHOOK DA ZAPSIGN (plano ZS0 §5.5). Pública no `proxy.ts`
 * (`/api/webhooks/`); o que a protege é o cabeçalho `x-riszon-webhook-secret`,
 * cadastrado no webhook da conta ZapSign e na Vercel (`ZAPSIGN_WEBHOOK_SECRET`).
 *
 * Responde 200 sempre que o corpo foi aceito — mesmo que um efeito tenha
 * falhado (fica em `signature_events`) — para a ZapSign não reenviar em laço.
 * 401 sem segredo ou com segredo errado (sem registrar o corpo); 400 para
 * corpo que não é um evento; 500 só quando a porta do banco recusou.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = zapsignWebhookSecret();
  const got = request.headers.get("x-riszon-webhook-secret") ?? "";
  // Tempo constante (AP99): `!==` para no primeiro byte errado e entrega o
  // segredo aos poucos pelo tempo de resposta. Segredo ausente nunca confere.
  if (!secret || !segredoConfere(got, secret)) {
    if (!secret) console.error("zapsign webhook: ZAPSIGN_WEBHOOK_SECRET não configurado");
    return new Response(null, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const event = parseWebhook(body);
  if (!event) return Response.json({ ok: false, error: "not_an_event" }, { status: 400 });

  if (!webhookMatchesEnvironment(event, zapsignEnv())) {
    return Response.json({ ok: true, ignored: "environment" });
  }

  try {
    const r = await aplicarWebhook(event);
    return Response.json({
      ok: true,
      duplicate: r.duplicate,
      matched: r.matched,
      status: r.status,
      signed_file: r.signedFile,
      copy: r.copy,
    });
  } catch (e) {
    console.error("zapsign webhook:", e instanceof Error ? e.message : String(e));
    return Response.json({ ok: false, error: "apply_failed" }, { status: 500 });
  }
}
