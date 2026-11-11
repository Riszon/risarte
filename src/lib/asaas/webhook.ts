/**
 * O EVENTO DO WEBHOOK DO ASAAS — a leitura mínima (ASA0).
 *
 * O Asaas manda `{ id, event, dateCreated, account, payment | … }`. O `id`
 * (`evt_…`) é o mesmo em toda reentrega: é a chave da idempotência. Aqui só se
 * confere que o corpo É um evento; o conteúdo é interpretado na ASA2.
 */
export type EventoDoAsaas = { id: string; event: string };

export function lerEventoDoAsaas(body: unknown): EventoDoAsaas | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const event = typeof o.event === "string" ? o.event.trim() : "";
  if (!id || id.length > 200) return null;
  if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(event)) return null;
  return { id, event };
}
