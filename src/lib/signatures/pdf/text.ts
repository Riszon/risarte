import { PDFDocument, PDFPage, rgb, type PDFFont, type RGB, degrees } from "pdf-lib";
import { sanitize, type Fonts } from "./fonts";

/**
 * O ESCRITOR DE PÁGINAS: texto corrido em A4 com quebra de linha por largura,
 * páginas novas quando acaba o espaço, rodapé e marca d'água. É tudo que os
 * modelos (contrato, TCLE, orçamento…) precisam — sem Chromium, sem
 * biblioteca de layout (plano ZS0 §5.2 e §14).
 */

export const A4 = { width: 595.28, height: 841.89 } as const;

export const NAVY = rgb(0.07, 0.17, 0.33);
export const GOLD = rgb(0.72, 0.56, 0.2);
export const INK = rgb(0.13, 0.13, 0.13);
export const MUTED = rgb(0.45, 0.45, 0.45);
export const LINE = rgb(0.8, 0.8, 0.8);

export type Margins = { top: number; right: number; bottom: number; left: number };

export const MARGINS: Margins = { top: 64, right: 56, bottom: 72, left: 56 };

export type ParagraphOptions = {
  font?: PDFFont;
  size?: number;
  color?: RGB;
  lineHeight?: number;
  spaceAfter?: number;
  align?: "left" | "center" | "justify";
  indent?: number;
};

/** Quebra o texto em linhas que cabem na largura (respeita quebras explícitas). */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of sanitize(text).split("\n")) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // Palavra maior que a linha inteira: parte no meio, para não estourar.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let piece = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(piece + ch, size) > maxWidth) {
            lines.push(piece);
            piece = ch;
          } else piece += ch;
        }
        line = piece;
      } else line = word;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * As linhas de um texto, marcando a ÚLTIMA DE CADA PARÁGRAFO (até a quebra de
 * linha): essa não se estica no justificado. Antes só a última do texto
 * inteiro era marcada, e uma cláusula com vários parágrafos saía com a frase
 * final de cada um espalhada pela largura (achado no ensaio da 0349).
 */
export function linhasDoParagrafo(text: string, font: PDFFont, size: number, maxWidth: number): { t: string; last: boolean }[] {
  return text.split("\n").flatMap((segment) => {
    const ls = wrapText(segment, font, size, maxWidth);
    return ls.map((t, i) => ({ t, last: i === ls.length - 1 }));
  });
}

export class PageWriter {
  readonly doc: PDFDocument;
  readonly fonts: Fonts;
  readonly margins: Margins;
  page!: PDFPage;
  y = 0;
  private watermark: string | null;

  constructor(doc: PDFDocument, fonts: Fonts, options: { margins?: Partial<Margins>; watermark?: string | null } = {}) {
    this.doc = doc;
    this.fonts = fonts;
    this.margins = { ...MARGINS, ...options.margins };
    this.watermark = options.watermark ?? null;
    this.newPage();
  }

  get contentWidth(): number {
    return A4.width - this.margins.left - this.margins.right;
  }

  get pageIndex(): number {
    return this.doc.getPageCount() - 1;
  }

  newPage(): PDFPage {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - this.margins.top;
    if (this.watermark) this.drawWatermark(this.page, this.watermark);
    return this.page;
  }

  /** Garante `height` pontos de espaço; senão abre página nova. */
  ensure(height: number): void {
    if (this.y - height < this.margins.bottom) this.newPage();
  }

  space(points: number): void {
    this.y -= points;
    if (this.y < this.margins.bottom) this.newPage();
  }

  paragraph(text: string, options: ParagraphOptions = {}): void {
    const font = options.font ?? this.fonts.regular;
    const size = options.size ?? 10.5;
    const lineHeight = options.lineHeight ?? size * 1.45;
    const color = options.color ?? INK;
    const indent = options.indent ?? 0;
    const width = this.contentWidth - indent;
    const lines = linhasDoParagrafo(text, font, size, width);
    lines.forEach(({ t: line, last: isLast }) => {
      this.ensure(lineHeight);
      let x = this.margins.left + indent;
      if (options.align === "center") {
        x = this.margins.left + indent + (width - font.widthOfTextAtSize(line, size)) / 2;
      }
      if (options.align === "justify" && !isLast && line.includes(" ")) {
        this.drawJustified(line, x, this.y - size, font, size, color, width);
      } else {
        this.page.drawText(line, { x, y: this.y - size, size, font, color });
      }
      this.y -= lineHeight;
    });
    this.y -= options.spaceAfter ?? size * 0.6;
  }

  heading(text: string, options: { size?: number; color?: RGB; spaceBefore?: number } = {}): void {
    const size = options.size ?? 12;
    this.ensure(size * 3.2);
    this.y -= options.spaceBefore ?? 6;
    this.paragraph(text, { font: this.fonts.bold, size, color: options.color ?? NAVY, spaceAfter: 4 });
  }

  rule(color: RGB = LINE): void {
    this.ensure(8);
    this.page.drawLine({
      start: { x: this.margins.left, y: this.y - 2 },
      end: { x: A4.width - this.margins.right, y: this.y - 2 },
      thickness: 0.6,
      color,
    });
    this.y -= 10;
  }

  private drawJustified(line: string, x: number, y: number, font: PDFFont, size: number, color: RGB, width: number): void {
    const words = line.split(" ");
    const textWidth = words.reduce((w, word) => w + font.widthOfTextAtSize(word, size), 0);
    const gap = (width - textWidth) / (words.length - 1);
    // Espaçamento maior que o dobro do normal fica feio: cai no alinhamento à esquerda.
    const normalGap = font.widthOfTextAtSize(" ", size);
    if (gap > normalGap * 3) {
      this.page.drawText(line, { x, y, size, font, color });
      return;
    }
    let cursor = x;
    for (const word of words) {
      this.page.drawText(word, { x: cursor, y, size, font, color });
      cursor += font.widthOfTextAtSize(word, size) + gap;
    }
  }

  private drawWatermark(page: PDFPage, text: string): void {
    const size = 54;
    const font = this.fonts.bold;
    const width = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: A4.width / 2 - (width / 2) * Math.cos(Math.PI / 4) - 90,
      y: A4.height / 2 - 150,
      size,
      font,
      color: rgb(0.93, 0.93, 0.93),
      rotate: degrees(45),
    });
  }
}

/** Rodapé em todas as páginas do documento: "texto · página n de m". */
export function drawFooters(doc: PDFDocument, fonts: Fonts, text: string, options: { skipFirst?: boolean } = {}): void {
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page, i) => {
    if (options.skipFirst && i === 0) return;
    const label = `${sanitize(text)}  ·  página ${i + 1} de ${total}`;
    const size = 8;
    const width = fonts.regular.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: (A4.width - width) / 2,
      y: 44,
      size,
      font: fonts.regular,
      color: MUTED,
    });
  });
}
