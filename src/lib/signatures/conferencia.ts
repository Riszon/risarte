import type { ZapsignDocument } from "@/lib/zapsign/types";
import type { ZapsignWebhookEvent, ZapsignWebhookSigner } from "@/lib/zapsign/webhook";

/**
 * A CONFERÊNCIA COM A ZAPSIGN (ZS6, plano ZS0 §5.7). Regra pura, testada em
 * `assinaturas-rotinas.test.ts`.
 *
 * Pacote aguardando assinatura e sem notícia há horas: o servidor consulta o
 * documento na ZapSign (`getDocument`) e esta regra transforma a diferença em
 * EVENTOS NO FORMATO DO WEBHOOK — os mesmos que a ZapSign teria mandado. Eles
 * passam pela mesma porta (`signature_apply_webhook`), com a mesma chave de
 * idempotência: se o webhook de verdade chegar depois, ele é reconhecido como
 * repetido e nada dobra.
 *
 *   * cada pessoa que já assinou lá e aqui ainda não → um `doc_signed` (um por
 *     assinatura, na ordem em que assinaram);
 *   * documento recusado lá → um `doc_refused`.
 */

export type SignatarioLocal = { token: string | null; status: string };

function signerDoDocumento(s: NonNullable<ZapsignDocument["signers"]>[number]): ZapsignWebhookSigner {
  const status = s.status === "new" || s.status === "link-opened" || s.status === "signed" ? s.status : null;
  return { token: s.token, status, signedAt: s.signed_at ?? null, authMode: s.auth_mode ? String(s.auth_mode) : null, externalId: s.external_id ?? null };
}

export function eventosDaConferencia(input: {
  doc: ZapsignDocument;
  locais: SignatarioLocal[];
  packageId: string;
  sandbox: boolean;
}): ZapsignWebhookEvent[] {
  const { doc } = input;
  const signers = (doc.signers ?? []).filter((s) => !!s.token).map(signerDoDocumento);
  const assinadosAqui = new Set(input.locais.filter((l) => l.status === "signed" && l.token).map((l) => l.token as string));
  const conhecidos = new Set(input.locais.map((l) => l.token).filter((t): t is string => !!t));
  const base = {
    docToken: doc.token,
    openId: typeof doc.open_id === "number" ? doc.open_id : null,
    externalId: input.packageId,
    signedFileUrl: doc.signed_file ?? null,
    sandbox: input.sandbox,
    rejectedReason: null,
    signers,
    occurredAt: doc.last_update_at ?? null,
  };

  const eventos: ZapsignWebhookEvent[] = [];
  const novas = signers
    .filter((s) => s.status === "signed" && conhecidos.has(s.token) && !assinadosAqui.has(s.token))
    .sort((a, b) => (a.signedAt ?? "").localeCompare(b.signedAt ?? ""));
  novas.forEach((s, i) => {
    const ultima = i === novas.length - 1;
    eventos.push({
      ...base,
      eventType: "doc_signed",
      rawEventType: "doc_signed",
      // Só o último evento leva a situação do documento (como na ZapSign: o
      // `doc_signed` da última assinatura é que chega com status "signed").
      docStatus: ultima ? (doc.status ?? null) : "pending",
      signedFileUrl: ultima ? base.signedFileUrl : null,
      signerWhoSigned: s,
    });
  });
  if (doc.status === "refused") {
    eventos.push({ ...base, eventType: "doc_refused", rawEventType: "doc_refused", docStatus: "refused", signerWhoSigned: null });
  }
  return eventos;
}
