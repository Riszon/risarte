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
