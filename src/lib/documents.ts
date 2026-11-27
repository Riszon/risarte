// Documentos clínicos emitidos pelo dentista (H4.6 C). Tipos compartilhados
// entre a página (server), a seção (client) e a impressão.

export const DOCUMENT_KINDS = [
  "prescription",
  "certificate",
  "declaration",
  "guidance",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  prescription: "Prescrição",
  certificate: "Atestado",
  declaration: "Declaração",
  guidance: "Orientações e cuidados",
};

/**
 * OC-00192: a prescrição não tem título. O cabeçalho impresso já diz
 * "PRESCRIÇÃO"; o título virava o 1º remédio em negrito e os outros não.
 * Na lista da ficha ela se chama "Prescrição" (com a data ao lado).
 */
export function documentoTemTitulo(kind: DocumentKind): boolean {
  return kind !== "prescription";
}

export function isDocumentKind(v: string): v is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(v);
}

export type DocumentTemplate = {
  id: string;
  kind: DocumentKind;
  title: string;
  body: string;
  /** null = modelo da rede (franqueadora); senão, da unidade. */
  clinicId: string | null;
};

export type ClinicalDocumentItem = {
  id: string;
  kind: DocumentKind;
  title: string;
  createdAt: string;
  authorName: string | null;
};
