// Edge Function — Webhook da ZapSign (Risarte Empresarial, Fase 5).
// Recebe o retorno de assinatura e marca o contrato como assinado.
//
// DEPLOY (quando houver token):
//   supabase functions deploy zapsign-webhook --no-verify-jwt
// SEGREDOS: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ZAPSIGN_WEBHOOK_TOKEN.
// Na ZapSign: cadastre a URL da função como webhook e informe o token.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expected = Deno.env.get("ZAPSIGN_WEBHOOK_TOKEN");
  if (expected) {
    const got = req.headers.get("zapsign-access-token") ?? "";
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

  const docId: string | undefined = body?.token ?? body?.doc?.token;
  const eventType: string = body?.event_type ?? body?.status ?? "UNKNOWN";
  const eventId = `${docId ?? "nodoc"}:${eventType}`;

  const { error: dupErr } = await supabase
    .from("zapsign_webhook_events")
    .insert({ event_id: eventId, event_type: eventType, payload: body });
  if (dupErr) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signed = ["doc_signed", "signed", "SIGNED"];
  if (docId && signed.includes(eventType)) {
    await supabase.rpc("mark_contract_signed", {
      p_doc_id: docId,
      p_signed_at: new Date().toISOString(),
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
