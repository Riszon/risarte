import "server-only";
import { zapsignRequest, type ZapsignRequestOptions } from "./client";
import type {
  ZapsignCreateDocInput,
  ZapsignDocList,
  ZapsignDocument,
  ZapsignListDocsQuery,
  ZapsignPlanInfo,
  ZapsignRefuseInput,
  ZapsignRubrica,
  ZapsignSigner,
  ZapsignSignerInput,
  ZapsignSignInBatchInput,
  ZapsignUpdateSignerInput,
} from "./types";

/**
 * AS CHAMADAS TIPADAS À ZAPSIGN (plano ZS0 §3 e §5.1). Cada função é um
 * endpoint; a montagem do corpo e a ordem dos signatários são conferidas por
 * teste com `fetch` falso (`zapsign.test.ts`).
 */

/** O limite da ZapSign para o PDF (10 MB). O base64 é ~4/3 do arquivo. */
export const ZAPSIGN_MAX_PDF_BYTES = 10 * 1024 * 1024;

function requireToken(token: string, what: string): string {
  const t = (token ?? "").trim();
  if (!t) throw new Error(`${what} token is required`);
  return encodeURIComponent(t);
}

/**
 * Cria o documento a partir do PDF. Garante o que o módulo sempre quer:
 * `lang pt-br`, ordem de assinatura ligada e o `external_id` (o id do pacote).
 * A validação do tamanho fica aqui também — a documentação não diz o limite do
 * base64, então o riSZon recusa antes de enviar.
 */
export async function createDocumentFromPdf(
  input: ZapsignCreateDocInput,
  options?: ZapsignRequestOptions
): Promise<ZapsignDocument> {
  if (!input.base64_pdf && !input.url_pdf) {
    throw new Error("createDocumentFromPdf: base64_pdf or url_pdf is required");
  }
  if (input.base64_pdf) {
    const bytes = Math.floor((input.base64_pdf.length * 3) / 4);
    if (bytes > ZAPSIGN_MAX_PDF_BYTES) {
      throw new Error(`createDocumentFromPdf: PDF above ${ZAPSIGN_MAX_PDF_BYTES} bytes`);
    }
  }
  if (!input.signers?.length) {
    throw new Error("createDocumentFromPdf: at least one signer is required");
  }
  const body: ZapsignCreateDocInput = {
    lang: "pt-br",
    signature_order_active: true,
    ...input,
    // A ordem no corpo é a ordem dos grupos: o teste prende isto.
    signers: [...input.signers].sort((a, b) => (a.order_group ?? 1) - (b.order_group ?? 1)),
  };
  return zapsignRequest<ZapsignDocument>("POST", "/docs/", body, options);
}

export async function getDocument(docToken: string, options?: ZapsignRequestOptions): Promise<ZapsignDocument> {
  return zapsignRequest<ZapsignDocument>("GET", `/docs/${requireToken(docToken, "document")}/`, undefined, options);
}

/** Lista (para conferir o consumo do mês pelo `count`). */
export async function listDocuments(query: ZapsignListDocsQuery = {}, options?: ZapsignRequestOptions): Promise<ZapsignDocList> {
  return zapsignRequest<ZapsignDocList>("GET", "/docs/", undefined, {
    ...options,
    query: { ...(options?.query ?? {}), ...query },
  });
}

export async function addSigner(docToken: string, signer: ZapsignSignerInput, options?: ZapsignRequestOptions): Promise<ZapsignSigner> {
  return zapsignRequest<ZapsignSigner>("POST", `/docs/${requireToken(docToken, "document")}/add-signer/`, signer, options);
}

export async function updateSigner(
  signerToken: string,
  changes: ZapsignUpdateSignerInput,
  options?: ZapsignRequestOptions
): Promise<ZapsignSigner> {
  return zapsignRequest<ZapsignSigner>("POST", `/signers/${requireToken(signerToken, "signer")}/`, changes, options);
}

/** Só quem ainda não assinou, e nunca o único signatário (regra da ZapSign). */
export async function removeSigner(signerToken: string, options?: ZapsignRequestOptions): Promise<void> {
  await zapsignRequest<unknown>("DELETE", `/signer/${requireToken(signerToken, "signer")}/remove/`, undefined, options);
}

/**
 * Posiciona assinaturas e rubricas. ⚠️ Cada chamada SUBSTITUI todas as marcas
 * anteriores — mandar a lista completa sempre. Coordenadas 0–100, origem no
 * canto inferior esquerdo; um objeto por página por signatário.
 */
export async function placeSignatures(
  docToken: string,
  rubricas: ZapsignRubrica[],
  options?: ZapsignRequestOptions
): Promise<ZapsignDocument> {
  for (const r of rubricas) {
    for (const k of ["relative_position_left", "relative_position_bottom", "relative_size_x", "relative_size_y"] as const) {
      const v = r[k];
      if (typeof v !== "number" || v < 0 || v > 100) {
        throw new Error(`placeSignatures: ${k} must be between 0 and 100`);
      }
    }
    if (!Number.isInteger(r.page) || r.page < 0) throw new Error("placeSignatures: page must be a non-negative integer");
  }
  return zapsignRequest<ZapsignDocument>(
    "POST",
    `/docs/${requireToken(docToken, "document")}/place-signatures/`,
    { rubricas },
    options
  );
}

/** Reenvia a notificação a TODOS os pendentes (respeita a ordem; 429 em cooldown). */
export async function resendNotifications(docToken: string, options?: ZapsignRequestOptions): Promise<void> {
  await zapsignRequest<unknown>(
    "POST",
    `/docs/${requireToken(docToken, "document")}/resend-notifications-bulk/`,
    {},
    options
  );
}

/** Cancela (recusa) um documento em andamento. Assinado → 403 `document_already_signed`. */
export async function refuseDocument(input: ZapsignRefuseInput, options?: ZapsignRequestOptions): Promise<void> {
  if (!input.doc_token?.trim()) throw new Error("refuseDocument: doc_token is required");
  if (!input.rejected_reason?.trim()) throw new Error("refuseDocument: rejected_reason is required");
  await zapsignRequest<unknown>(
    "POST",
    "/refuse/",
    { doc_token: input.doc_token, rejected_reason: input.rejected_reason.trim(), notify_signer: input.notify_signer ?? false },
    options
  );
}

/** O plano da conta (não informa o consumo do mês — o riSZon conta). */
export async function getPlanInfo(options?: ZapsignRequestOptions): Promise<ZapsignPlanInfo> {
  return zapsignRequest<ZapsignPlanInfo>("GET", "/info-plan", undefined, options);
}

/** Pede à ZapSign para mandar o webhook do documento de novo. */
export async function reprocessWebhook(docToken: string, options?: ZapsignRequestOptions): Promise<void> {
  await zapsignRequest<unknown>(
    "POST",
    `/docs/${requireToken(docToken, "document")}/reprocess-doc/`,
    { send_webhook: true },
    options
  );
}

/**
 * Assinar em lote via API — TIPADO, NÃO USADO (decisão do dono, plano §4.2:
 * o representante da Risarte assina pela tela "Minhas assinaturas pendentes").
 * Fica aqui para ligar depois como configuração por representante.
 */
export async function signInBatch(input: ZapsignSignInBatchInput, options?: ZapsignRequestOptions): Promise<unknown> {
  if (!input.user_token?.trim()) throw new Error("signInBatch: user_token is required");
  if (!input.signer_tokens?.length) throw new Error("signInBatch: signer_tokens is required");
  return zapsignRequest<unknown>("POST", "/sign/", input, options);
}
