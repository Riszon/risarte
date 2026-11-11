import { segredoConfere } from "@/lib/segredo-de-webhook";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { lerEventoDoAsaas } from "@/lib/asaas/webhook";

/**
 * O WEBHOOK DO ASAAS (ASA0: a rota mínima). Pública no `proxy.ts`
 * (`/api/webhooks/`). Uma URL por conta: `/api/webhooks/asaas/<ref>`, onde
 * `<ref>` é um trecho opaco gravado na conta — diz DE QUAL conta veio antes
 * de comparar o token.
 *
 * O que ela faz, e só isto:
 *   1. acha a conta pelo `<ref>` e compara o cabeçalho `asaas-access-token`
 *      com o token daquela conta, guardado no Vault (tempo constante);
 *   2. grava o evento BRUTO em `gateway_webhook_events` (repetido não entra
 *      duas vezes: o identificador do evento é único por conta);
 *   3. responde **200**.
 * Quem PROCESSA o evento (baixa, venda, repasse) é a ASA2.
 *
 * ⚠️ O ASAAS SÓ CONTA O 200 COMO SUCESSO, espera no máximo 10 segundos, não
 * segue redirecionamento e pausa a fila depois de 15 falhas seguidas. Por
 * isso: token errado ou conta desconhecida → 401 (sem ler o corpo); corpo que
 * não é um evento → 400; banco fora do ar → 500 (o Asaas tenta de novo).
 * Nada do corpo vai para o log.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const REF = /^[0-9a-f]{32}$/;

export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const recebido = request.headers.get("asaas-access-token");

  if (!isAdminClientConfigured()) {
    console.error("asaas webhook: service role key is not configured");
    return new Response(null, { status: 500 });
  }

  let conta: { account_id: string; token: string } | null = null;
  if (REF.test(ref)) {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("_gateway_webhook_secret", { p_ref: ref });
    if (error) {
      console.error("asaas webhook: secret lookup failed:", error.message);
      return new Response(null, { status: 500 });
    }
    conta = (Array.isArray(data) ? data[0] : data) ?? null;
  }

  // A comparação roda SEMPRE (mesmo sem conta), para o tempo de resposta não
  // dizer se o endereço existe. Segredo ausente nunca confere.
  const confere = segredoConfere(recebido, conta?.token ?? null);
  if (!conta || !confere) return new Response(null, { status: 401 });

  const body = await request.json().catch(() => null);
  const evento = lerEventoDoAsaas(body);
  if (!evento) return Response.json({ ok: false, error: "not_an_event" }, { status: 400 });

  const admin = createAdminClient();
  const { data: novo, error } = await admin.rpc("_gateway_record_event", {
    p_account_id: conta.account_id,
    p_event_id: evento.id,
    p_event: evento.event,
    p_payload: body,
  });
  if (error) {
    console.error("asaas webhook: record failed:", error.message);
    return new Response(null, { status: 500 });
  }

  return Response.json({ ok: true, duplicate: novo !== true }, { status: 200 });
}
