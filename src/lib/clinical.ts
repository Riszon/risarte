// Shared constants/types for the clinical evaluation (Coordenador Clínico).
// Kept out of the "use server" actions file (which may only export functions).

export const CLINICAL_BUCKET = "clinical-media";

export const CLINICAL_MEDIA_KINDS = [
  "photo",
  "radiograph",
  "scan",
  "exam",
  "document",
  "video",
  "audio",
] as const;

export type ClinicalMediaKind = (typeof CLINICAL_MEDIA_KINDS)[number];

export const CLINICAL_MEDIA_LABELS: Record<ClinicalMediaKind, string> = {
  photo: "Foto",
  radiograph: "Radiografia",
  scan: "Escaneamento",
  exam: "Exame",
  document: "Documento",
  video: "Vídeo",
  audio: "Áudio",
};

export type ClinicalResult = { ok: boolean; error?: string };

export type ClinicalMediaInput = {
  kind: ClinicalMediaKind;
  storagePath: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
};

// ---- Display types (shared by the ficha page, the section and the gallery) --

export type ConsentInfo = { grantedAt: string; recordedByName: string | null };

export type ClinicalNoteItem = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  updatedAt: string | null;
  editedByName: string | null;
};

export type ClinicalMediaItem = {
  id: string;
  kind: ClinicalMediaKind;
  originalName: string | null;
  url: string | null;
  externalUrl: string | null;
  contentType: string | null;
  createdAt: string;
  uploaderName: string | null;
  sizeBytes: number | null;
};

/** How a Storage-backed item can be shown inline (no download). */
export function mediaPreviewType(
  m: ClinicalMediaItem
): "image" | "video" | "audio" | "pdf" | null {
  const ct = m.contentType ?? "";
  const name = (m.originalName ?? "").toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (m.kind === "photo" || m.kind === "radiograph") return "image";
  if (m.kind === "video") return "video";
  if (m.kind === "audio") return "audio";
  return null;
}
