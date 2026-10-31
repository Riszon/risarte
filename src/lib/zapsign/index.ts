import "server-only";

/**
 * O MÓDULO ZAPSIGN DO riSZon (plano ZS0 §5.1). Importar daqui:
 *
 *   import { createDocumentFromPdf, ZapsignError, isZapsignConfigured } from "@/lib/zapsign";
 *
 * `webhook.ts` é regra pura (sem server-only) e pode ser importado direto.
 */

export { isZapsignConfigured, zapsignBaseUrl, zapsignEnv, zapsignWebhookSecret, type ZapsignEnv } from "./env";
export { ZapsignError, mensagemDaZapsign, zapsignRequest, type ZapsignErrorCode, type ZapsignRequestOptions } from "./client";
export {
  ZAPSIGN_MAX_PDF_BYTES,
  addSigner,
  createDocumentFromPdf,
  getDocument,
  getPlanInfo,
  listDocuments,
  placeSignatures,
  refuseDocument,
  removeSigner,
  reprocessWebhook,
  resendNotifications,
  signInBatch,
  updateSigner,
} from "./api";
export * from "./types";
export { parseWebhook, webhookEventKey, webhookMatchesEnvironment, type ZapsignWebhookEvent } from "./webhook";
