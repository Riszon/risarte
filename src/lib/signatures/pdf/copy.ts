import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { normalizar } from "@/lib/busca";

/**
 * A CÓPIA INDIVIDUAL DE CONSULTA (plano ZS0 §5.2, ZS4): as páginas de UM
 * documento do pacote, tiradas do PDF MESCLADO ORIGINAL (`merged.pdf`) —
 * nunca do assinado: recortar o assinado produziria um arquivo que parece
 * assinado e não tem a validade do certificado da ZapSign. Toda página leva a
 * faixa "CÓPIA — não assinada digitalmente — pacote {número}" no alto e a
 * marca d'água "CÓPIA" atravessada.
 *
 * As páginas são as do pacote (1 = a capa), como `first_page`/`last_page`
 * dos itens. Regra pura (só bytes), testada em `assinaturas-copia.test.ts`.
 */

export function textoDaFaixa(packageNumber: string): string {
  return `CÓPIA — não assinada digitalmente — pacote ${packageNumber}`;
}

/** Copia as páginas `first..last` (1 = primeira do pacote) para um PDF novo. */
export async function extrairPaginas(merged: Uint8Array, firstPage: number, lastPage: number): Promise<PDFDocument> {
  const src = await PDFDocument.load(merged);
  const total = src.getPageCount();
  if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage) || firstPage < 1 || lastPage < firstPage || lastPage > total) {
    throw new Error(`COPY_RANGE_INVALID ${firstPage}-${lastPage} of ${total}`);
  }
  const out = await PDFDocument.create();
  out.setProducer("riSZon");
  out.setCreator("riSZon");
  const indices = Array.from({ length: lastPage - firstPage + 1 }, (_, i) => firstPage - 1 + i);
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out;
}

export async function gerarCopia(input: {
  merged: Uint8Array;
  firstPage: number;
  lastPage: number;
  packageNumber: string;
  title: string;
}): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const out = await extrairPaginas(input.merged, input.firstPage, input.lastPage);
  out.setTitle(`${input.title} — cópia (${input.packageNumber})`);
  const font = await out.embedFont(StandardFonts.HelveticaBold);
  const faixa = textoDaFaixa(input.packageNumber);

  for (const page of out.getPages()) {
    const { width, height } = page.getSize();
    const band = 20;
    const size = Math.min(10, (width - 24) / Math.max(1, font.widthOfTextAtSize(faixa, 1)));
    page.drawRectangle({ x: 0, y: height - band, width, height: band, color: rgb(0.99, 0.89, 0.89), opacity: 0.95 });
    const tw = font.widthOfTextAtSize(faixa, size);
    page.drawText(faixa, { x: (width - tw) / 2, y: height - band + (band - size) / 2 + 1, size, font, color: rgb(0.6, 0.07, 0.07) });

    const mark = "CÓPIA";
    const markSize = Math.min(width, height) / 4;
    const mw = font.widthOfTextAtSize(mark, markSize);
    const angle = 35;
    const rad = (angle * Math.PI) / 180;
    page.drawText(mark, {
      x: width / 2 - (mw / 2) * Math.cos(rad) + (markSize / 3) * Math.sin(rad),
      y: height / 2 - (mw / 2) * Math.sin(rad) - (markSize / 3) * Math.cos(rad),
      size: markSize,
      font,
      color: rgb(0.75, 0.1, 0.1),
      opacity: 0.08,
      rotate: degrees(angle),
    });
  }

  const bytes = await out.save();
  return { bytes, pageCount: out.getPageCount() };
}

/** Nome do arquivo para baixar: sem acento nem espaço, com o número do pacote. */
export function nomeDoArquivo(packageNumber: string, title: string, sufixo: "copia" | "assinado"): string {
  const base = normalizar(title)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${packageNumber}${base ? `-${base}` : ""}-${sufixo}.pdf`;
}
