import { webhookEventKey, type ZapsignWebhookEvent } from "@/lib/zapsign/webhook";

/**
 * O EVENTO DA ZAPSIGN NA FORMA QUE A PORTA DO BANCO ENTENDE
 * (`signature_apply_webhook`, 0343). Regra pura, testada em
 * `assinaturas-webhook.test.ts`: o que entra no banco é o MÍNIMO — tokens,
 * situações e datas. Nunca o PDF, nunca dado pessoal além do que o pacote já
 * tem (nome e e-mail do signatário ficam de fora do `payload`).
 */

export type PortaEventType = "doc_signed" | "doc_refused" | "doc_expired" | "doc_deleted" | "doc_viewed" | "other";

export type PortaEvent = {
  event_key: string;
  event_type: PortaEventType;
  raw_event_type: string;
  doc_token: string;
  external_id: string | null;
  doc_status: string | null;
  occurred_at: string | null;
  rejected_reason: string | null;
  signer_token: string | null;
  signer_signed_at: string | null;
  signers: { token: string; status: string | null; signed_at: string | null }[];
  payload: Record<string, unknown>;
};

export function tipoDaPorta(raw: string): PortaEventType {
  switch (raw) {
    case "doc_signed":
    case "doc_refused":
    case "doc_expired":
    case "doc_deleted":
    case "doc_viewed":
      return raw;
    default:
      return "other";
  }
}

export function eventoParaPorta(event: ZapsignWebhookEvent): PortaEvent {
  return {
    event_key: webhookEventKey(event),
    event_type: tipoDaPorta(event.rawEventType),
    raw_event_type: event.rawEventType,
    doc_token: event.docToken,
    external_id: event.externalId,
    doc_status: event.docStatus,
    occurred_at: event.occurredAt,
    rejected_reason: event.rejectedReason,
    signer_token: event.signerWhoSigned?.token ?? null,
    signer_signed_at: event.signerWhoSigned?.signedAt ?? null,
    signers: event.signers.map((s) => ({ token: s.token, status: s.status, signed_at: s.signedAt })),
    payload: {
      event_type: event.rawEventType,
      doc_status: event.docStatus,
      open_id: event.openId,
      sandbox: event.sandbox,
      occurred_at: event.occurredAt,
      signed_file: event.signedFileUrl ? "present" : "absent",
      signers: event.signers.map((s) => ({ token: s.token, status: s.status, signed_at: s.signedAt })),
    },
  };
}

/** O que a porta devolve (as chaves que a rota lê). */
export type PortaResult = {
  duplicate: boolean;
  matched: boolean;
  package_id?: string;
  client_id?: string | null;
  clinic_id?: string;
  number?: string;
  status?: string;
  stage?: string;
  changed?: boolean;
  newly_signed?: boolean;
  signed_file_needed?: boolean;
  notified?: string[];
  closing?: unknown;
};
