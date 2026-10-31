import { PDFDocument } from "pdf-lib";

/**
 * A MESCLAGEM (plano ZS0 §5.2): `[capa, doc1, doc2, …, anexos]` → um PDF só,
 * com a página inicial e final de cada parte (1 = a primeira página do
 * pacote). A capa, quando existe, é sempre a parte 0.
 */

export type MergePart = { bytes: Uint8Array };

export type MergeResult = {
  bytes: Uint8Array;
  pageCount: number;
  /** Uma faixa por parte, na ordem recebida (capa incluída, quando há). */
  ranges: { first_page: number; last_page: number }[];
};

export const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;

export async function mergePdfs(parts: MergePart[]): Promise<MergeResult> {
  const out = await PDFDocument.create();
  out.setProducer("riSZon");
  out.setCreator("riSZon");
  const ranges: MergeResult["ranges"] = [];
  let cursor = 1;
  for (const part of parts) {
    const src = await PDFDocument.load(part.bytes);
    const indices = src.getPageIndices();
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
    ranges.push({ first_page: cursor, last_page: cursor + indices.length - 1 });
    cursor += indices.length;
  }
  const bytes = await out.save();
  return { bytes, pageCount: out.getPageCount(), ranges };
}

/**
 * Um PDF avulso serve? Abre com o pdf-lib; recusa o protegido por senha (a
 * ZapSign não aceita e a mesclagem não conseguiria copiar as páginas) e o que
 * não é PDF. Devolve as páginas para o índice da capa.
 */
export async function inspectAttachment(bytes: Uint8Array): Promise<{ ok: true; pageCount: number } | { ok: false; error: string }> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    if (doc.isEncrypted) return { ok: false, error: "o PDF está protegido por senha." };
    const n = doc.getPageCount();
    if (n === 0) return { ok: false, error: "o PDF não tem páginas." };
    return { ok: true, pageCount: n };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) return { ok: false, error: "o PDF está protegido por senha." };
    return { ok: false, error: "o arquivo não é um PDF válido." };
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
