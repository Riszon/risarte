import { PDFDocument } from "pdf-lib";
import type { TemplateBody } from "../types";
import { embedFonts } from "./fonts";
import { A4, GOLD, INK, LINE, MUTED, NAVY, PageWriter, drawFooters } from "./text";

/**
 * UM MODELO PREENCHIDO VIRA UM PDF (plano ZS0 §5.2): título, preâmbulo,
 * cláusulas, fecho e, no fim, o bloco "Assinaturas" com uma caixa por
 * signatário. As caixas voltam em pontos, com a página em que ficaram — a
 * mesclagem soma o deslocamento e `montarRubricas` converte para o que a
 * ZapSign pede (percentual, origem no canto inferior esquerdo).
 */

export type SignerBoxSpec = { key: string; name: string; qualification: string };

export type SignatureBox = {
  signerKey: string;
  /** Índice da página DENTRO deste documento (0 = primeira). */
  page: number;
  left: number;
  bottom: number;
  width: number;
  height: number;
};

export type RenderedDocument = {
  bytes: Uint8Array;
  pageCount: number;
  boxes: SignatureBox[];
};

export const WATERMARK_PROVISIONAL = "TEXTO PROVISÓRIO";

export async function renderTemplatePdf(input: {
  title: string;
  body: TemplateBody;
  provisional: boolean;
  /** O texto do rodapé: "ASS-000001 · Risarte Odontologia". */
  footer: string;
  signers: SignerBoxSpec[];
}): Promise<RenderedDocument> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setProducer("riSZon");
  doc.setCreator("riSZon");
  const fonts = await embedFonts(doc);
  const w = new PageWriter(doc, fonts, { watermark: input.provisional ? WATERMARK_PROVISIONAL : null });

  w.paragraph(input.title.toUpperCase(), { font: fonts.bold, size: 14, color: NAVY, align: "center", spaceAfter: 6 });
  w.rule(GOLD);
  w.space(4);
  if (input.body.preamble.trim()) {
    w.paragraph(input.body.preamble, { align: "justify", spaceAfter: 10 });
  }
  input.body.sections.forEach((s) => {
    if (s.title.trim()) w.heading(s.title, { size: 11 });
    if (s.body.trim()) w.paragraph(s.body, { align: "justify", spaceAfter: 8 });
  });
  if (input.body.closing.trim()) {
    w.space(6);
    w.paragraph(input.body.closing, { align: "justify", spaceAfter: 10 });
  }

  const boxes = drawSignatureBlock(w, input.signers);
  drawFooters(doc, fonts, input.footer);

  const bytes = await doc.save();
  return { bytes, pageCount: doc.getPageCount(), boxes };
}

/**
 * O bloco de assinaturas: duas caixas por linha, cada uma com a linha, o nome
 * e a qualificação. Se não couber a linha inteira, abre página nova — a caixa
 * nunca é partida entre páginas.
 */
function drawSignatureBlock(w: PageWriter, signers: SignerBoxSpec[]): SignatureBox[] {
  const boxes: SignatureBox[] = [];
  if (signers.length === 0) return boxes;

  const gap = 24;
  const cols = 2;
  const boxWidth = (w.contentWidth - gap * (cols - 1)) / cols;
  const boxHeight = 64;
  const rowHeight = boxHeight + 26 + 14;

  w.ensure(rowHeight + 40);
  w.heading("Assinaturas", { size: 12 });
  w.paragraph(
    "Assinado digitalmente pela plataforma ZapSign. A validade e a integridade de cada assinatura constam do relatório de assinaturas anexado pela plataforma ao documento final.",
    { size: 8.5, color: MUTED, spaceAfter: 10 }
  );

  for (let i = 0; i < signers.length; i += cols) {
    w.ensure(rowHeight);
    const row = signers.slice(i, i + cols);
    const top = w.y;
    row.forEach((s, j) => {
      const x = w.margins.left + j * (boxWidth + gap);
      const bottom = top - boxHeight;
      w.page.drawRectangle({
        x,
        y: bottom,
        width: boxWidth,
        height: boxHeight,
        borderColor: LINE,
        borderWidth: 0.6,
        color: undefined,
      });
      w.page.drawLine({
        start: { x: x + 10, y: bottom - 2 },
        end: { x: x + boxWidth - 10, y: bottom - 2 },
        thickness: 0.6,
        color: INK,
      });
      w.page.drawText(trimTo(s.name, w.fonts.bold, 9.5, boxWidth - 20), {
        x: x + 10,
        y: bottom - 14,
        size: 9.5,
        font: w.fonts.bold,
        color: INK,
      });
      w.page.drawText(trimTo(s.qualification, w.fonts.regular, 8.5, boxWidth - 20), {
        x: x + 10,
        y: bottom - 25,
        size: 8.5,
        font: w.fonts.regular,
        color: MUTED,
      });
      boxes.push({ signerKey: s.key, page: w.pageIndex, left: x, bottom, width: boxWidth, height: boxHeight });
    });
    w.y = top - rowHeight;
  }
  return boxes;
}

function trimTo(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number, maxWidth: number): string {
  let t = (text ?? "").replace(/[\r\n]+/g, " ");
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

export const PAGE = A4;
