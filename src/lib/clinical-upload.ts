// Helpers de upload de mídia clínica, compartilhados entre a ficha (ClinicalSection)
// e o cockpit do Coordenador (ferramentas por passo). Client-only.

import type { ClinicalMediaKind } from "@/lib/clinical";

/** id seguro que também funciona fora de contexto seguro (IP de LAN, etc.). */
export function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Adivinha o tipo de mídia a partir do arquivo. */
export function guessKind(file: File): ClinicalMediaKind {
  const t = file.type;
  const n = file.name.toLowerCase();
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  if (
    t.startsWith("image/") ||
    /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif)$/i.test(n)
  ) {
    return "photo";
  }
  if (t === "application/pdf" || n.endsWith(".pdf")) return "exam";
  return "document";
}

/** Fotos HEIC do iPhone não renderizam no navegador — converte para JPEG. */
export async function maybeConvertHeic(
  file: File
): Promise<{ blob: Blob; name: string; type: string }> {
  const isHeic =
    /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!isHeic) {
    return {
      blob: file,
      name: file.name,
      type: file.type || "application/octet-stream",
    };
  }
  try {
    const heic2any = (await import("heic2any")).default;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    const blob = (Array.isArray(out) ? out[0] : out) as Blob;
    return {
      blob,
      name: file.name.replace(/\.(heic|heif)$/i, ".jpg"),
      type: "image/jpeg",
    };
  } catch {
    return {
      blob: file,
      name: file.name,
      type: file.type || "application/octet-stream",
    };
  }
}
