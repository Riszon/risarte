// Edge Function — Webhook do ASAAS (Risarte Empresarial, Fase 4).
// Recebe o aviso de pagamento do ASAAS, garante idempotência e liquida a
// cobrança (grava o split via RPC empresarial.settle_billing).
//
// ⚠️ ORDEM OBRIGATÓRIA (AP99, 03/11/2026): cadastrar o segredo → publicar a
// função → cadastrar a URL no painel do ASAAS. Sem `ASAAS_WEBHOOK_TOKEN` a
// função RECUSA TUDO (500), antes de ler o corpo — a versão anterior aceitava
// qualquer chamada quando a variável faltava. Mesmo padrão do cron da Vercel
// (`src/lib/cron-auth.ts`): rotina que qualquer um dispara é pior que rotina
// parada. Há uma régua em `src/lib/__tests__/webhook-asaas.test.ts` que lê
// este arquivo e reprova a volta do `if (expected)`.
//
// DEPLOY (o dono faz quando tiver a chave):
//   supabase functions deploy asaas-webhook --no-verify-jwt
// SEGREDOS (no painel Supabase → Edge Functions):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (já existem no projeto)
//   ASAAS_WEBHOOK_TOKEN                        (defina o mesmo no painel do ASAAS)
// No ASAAS: cadastre a URL da função como webhook de pagamentos e informe o token.
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Só o que usamos do corpo do webhook do ASAAS. */
type AsaasWebhookBody = {
  id?: string;
  event?: string;
  payment?: {
    id?: string;
    externalReference?: string;
  };
};

/**
 * Compara dois segredos em tempo constante: o resumo SHA-256 de cada um tem
 * sempre 32 bytes, e a comparação percorre os 32 sem parar no primeiro byte
 * diferente. Comparar com `!==` para no primeiro byte errado, e o tempo de
 * resposta entrega, aos poucos, quantos bytes do segredo o atacante acertou.
 */
async function segredoConfere(recebido: string, esperado: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(recebido)),
    crypto.subtle.digest("SHA-256", enc.encode(esperado)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Sem o segredo cadastrado, a função não serve a ninguém — e diz isso no log,
  // para o deploy sem segredo ser notado na primeira chamada do ASAAS.
  const expected = (Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "").trim();
  if (!expected) {
    console.error("asaas-webhook: ASAAS_WEBHOOK_TOKEN não configurado; recusando tudo");
    return new Response("Webhook não configurado", { status: 500 });
  }
  const got = req.headers.get("asaas-access-token") ?? "";
  if (!(await segredoConfere(got, expected))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: AsaasWebhookBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // O `id` do evento é a chave da idempotência. Sem ele não há como saber se já
  // processamos — e inventar um id (a versão anterior gerava um UUID) faria o
  // mesmo corpo virar um evento novo a cada reenvio.
  const eventId = typeof body?.id === "string" ? body.id.trim() : "";
  if (!eventId) return new Response("Bad request: sem id do evento", { status: 400 });
  const eventType: string = body?.event ?? "UNKNOWN";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "empresarial" } }
  );

  // Idempotência: se já processamos este evento, para aqui.
  const { error: dupErr } = await supabase
    .from("asaas_webhook_events")
    .insert({ event_id: eventId, event_type: eventType, payload: body });
  if (dupErr) {
    // Violação de unique (23505) = já processado → responde OK.
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const paidEvents = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"];
  if (paidEvents.includes(eventType)) {
    // externalReference = id da adhesion_billing (definido ao criar a cobrança).
    const billingId: string | undefined =
      body?.payment?.externalReference ?? undefined;
    const asaasId: string | undefined = body?.payment?.id ?? undefined;

    let targetId = billingId;
    if (!targetId && asaasId) {
      const { data } = await supabase
        .from("adhesion_billing")
        .select("id")
        .eq("asaas_billing_id", asaasId)
        .maybeSingle();
      targetId = data?.id;
    }

    if (targetId) {
      await supabase.rpc("settle_billing", {
        p_billing_id: targetId,
        p_paid_at: new Date().toISOString(),
      });
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
