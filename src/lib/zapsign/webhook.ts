import type { ZapsignSignerStatus, ZapsignWebhookEventType, ZapsignWebhookPayload } from "./types";

/**
 * O WEBHOOK DA ZAPSIGN, NORMALIZADO (plano ZS0 §5.5). Regra pura, sem
 * `server-only`, para o teste e a Route Handler (ZS3) usarem a mesma leitura.
 *
 * `parseWebhook` devolve `null` para corpo que não é um evento da ZapSign
 * (sem `event_type` ou sem `token`): a rota responde 400 sem tocar no banco.
 * `webhookEventKey` é a chave de idempotência gravada em
 * `signature_events.event_key` (único): o mesmo evento chegando duas vezes
 * (a ZapSign reenvia quando não recebe 200) entra uma vez só.
 */

export const ZAPSIGN_WEBHOOK_EVENTS: readonly ZapsignWebhookEventType[] = [
  "doc_created",
  "doc_signed",
  "doc_refused",
  "doc_deleted",
  "doc_viewed",
  "doc_read_confirmation",
  "signature_notification_sent",
  "email_bounce",
  "signer_authentication_failed",
  "doc_expired",
  "doc_expiration_alert",
] as const;

export type ZapsignWebhookSigner = {
  token: string;
  status: ZapsignSignerStatus | null;
  signedAt: string | null;
  authMode: string | null;
  externalId: string | null;
};

export type ZapsignWebhookEvent = {
  eventType: ZapsignWebhookEventType | "unknown";
  /** O tipo cru, para registrar o que a ZapSign mandou mesmo quando é novo. */
  rawEventType: string;
  docToken: string;
  openId: number | null;
  /** O id do pacote no riSZon (`external_id`), quando veio. */
  externalId: string | null;
  docStatus: string | null;
  /** URL que expira em 60 min — baixar NA HORA. */
  signedFileUrl: string | null;
  sandbox: boolean;
  rejectedReason: string | null;
  /** Em `doc_signed`: quem acabou de assinar. */
  signerWhoSigned: ZapsignWebhookSigner | null;
  signers: ZapsignWebhookSigner[];
  /** `last_update_at` ou `created_at` do payload — entra na chave de idempotência. */
  occurredAt: string | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function signer(raw: unknown): ZapsignWebhookSigner | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const token = str(s.token);
  if (!token) return null;
  const status = str(s.status);
  return {
    token,
    status: status === "new" || status === "link-opened" || status === "signed" ? status : null,
    signedAt: str(s.signed_at),
    authMode: str(s.auth_mode),
    externalId: str(s.external_id),
  };
}

export function parseWebhook(body: unknown): ZapsignWebhookEvent | null {
  if (!body || typeof body !== "object") return null;
  const p = body as ZapsignWebhookPayload;
  const rawEventType = str(p.event_type);
  const docToken = str(p.token);
  if (!rawEventType || !docToken) return null;

  const eventType = (ZAPSIGN_WEBHOOK_EVENTS as readonly string[]).includes(rawEventType)
    ? (rawEventType as ZapsignWebhookEventType)
    : "unknown";

  return {
    eventType,
    rawEventType,
    docToken,
    openId: typeof p.open_id === "number" ? p.open_id : null,
    externalId: str(p.external_id),
    docStatus: str(p.status),
    signedFileUrl: str(p.signed_file),
    sandbox: p.sandbox === true,
    rejectedReason: str(p.rejected_reason),
    signerWhoSigned: signer(p.signer_who_signed),
    signers: Array.isArray(p.signers) ? p.signers.map(signer).filter((s): s is ZapsignWebhookSigner => s !== null) : [],
    occurredAt: str(p.last_update_at) ?? str(p.created_at),
  };
}

/**
 * A chave de idempotência. `doc_signed` chega UMA VEZ POR ASSINATURA, então o
 * signatário entra na chave; eventos repetíveis (visualização, lembrete) levam
 * o instante do payload para não engolir ocorrências novas.
 */
export function webhookEventKey(event: ZapsignWebhookEvent): string {
  const parts = [event.rawEventType, event.docToken];
  if (event.signerWhoSigned) parts.push(event.signerWhoSigned.token);
  if (["doc_viewed", "signature_notification_sent", "doc_expiration_alert", "email_bounce", "signer_authentication_failed"].includes(event.rawEventType)) {
    parts.push(event.occurredAt ?? "");
  }
  return parts.join("|");
}

/**
 * O webhook do sandbox não vale na produção, e vice-versa: cada ambiente só
 * aceita os eventos do seu.
 */
export function webhookMatchesEnvironment(event: ZapsignWebhookEvent, env: "sandbox" | "production"): boolean {
  return env === "sandbox" ? event.sandbox : !event.sandbox;
}
