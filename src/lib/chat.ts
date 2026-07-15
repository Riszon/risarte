// Constantes compartilhadas do Chat Hub (client + server).

/** Bucket privado dos anexos do chat (link assinado). */
export const CHAT_BUCKET = "chat-media";

/** Tamanho máximo de anexo (25 MB). */
export const CHAT_MAX_BYTES = 25 * 1024 * 1024;

export type ChatAttachmentKind = "file" | "image" | "audio";

/** Classifica o anexo pelo mime type. */
export function attachmentKindFor(mime: string): ChatAttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}
