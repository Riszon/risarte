// Edge Function — Webhook do ASAAS (Risarte Empresarial, Fase 4).
// Recebe o aviso de pagamento do ASAAS, garante idempotência e liquida a
// cobrança (grava o split via RPC empresarial.settle_billing).
//
// DEPLOY (o dono faz quando tiver a chave):
//   supabase functions deploy asaas-webhook --no-verify-jwt
// SEGREDOS (no painel Supabase → Edge Functions):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (já existem no projeto)
//   ASAAS_WEBHOOK_TOKEN                        (defina o mesmo no painel do ASAAS)
// No ASAAS: cadastre a URL da função como webhook de pagamentos e informe o token.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Autenticação simples do webhook (token combinado com o ASAAS).
  const expected = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  if (expected) {
    const got = req.headers.get("asaas-access-token") ?? "";
    if (got !== expected) return new Response("Unauthorized", { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "empresarial" } }
  );

  const eventId: string = body?.id ?? body?.event?.id ?? crypto.randomUUID();
  const eventType: string = body?.event ?? "UNKNOWN";

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
