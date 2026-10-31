import { PDFDocument } from "pdf-lib";
import { embedFonts, logoPng } from "./fonts";
import { A4, GOLD, INK, MUTED, NAVY, PageWriter } from "./text";

/**
 * A CAPA DO PACOTE (plano ZS0 §5.2): logotipo, para quem é, o número, a data,
 * o índice dos documentos com a página em que cada um começa, quem assina e
 * um aviso curto. Sem dado além do que já está nos próprios documentos.
 */

export type CoverInput = {
  packageNumber: string;
  clientName: string;
  clinicName: string;
  dateLabel: string;
  items: { title: string; firstPage: number; lastPage: number }[];
  signers: { name: string; qualification: string }[];
};

export async function renderCoverPdf(input: CoverInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Capa — ${input.packageNumber}`);
  const fonts = await embedFonts(doc);
  const w = new PageWriter(doc, fonts, { margins: { top: 56 } });

  const logo = await doc.embedPng(logoPng());
  const logoWidth = 230;
  const logoHeight = (logo.height / logo.width) * logoWidth;
  w.page.drawImage(logo, {
    x: w.margins.left,
    y: w.y - logoHeight,
    width: logoWidth,
    height: logoHeight,
  });
  w.y -= logoHeight + 36;

  w.paragraph("Documentos para assinatura digital", { font: fonts.bold, size: 20, color: NAVY, spaceAfter: 4 });
  w.paragraph(`Pacote ${input.packageNumber}  ·  ${input.dateLabel}`, { size: 10.5, color: MUTED, spaceAfter: 18 });

  w.rule(GOLD);
  w.paragraph("Para", { font: fonts.bold, size: 9, color: MUTED, spaceAfter: 2 });
  w.paragraph(input.clientName, { font: fonts.bold, size: 13, color: INK, spaceAfter: 10 });
  w.paragraph("Emitido por", { font: fonts.bold, size: 9, color: MUTED, spaceAfter: 2 });
  w.paragraph(input.clinicName, { size: 11, color: INK, spaceAfter: 18 });

  w.heading("O que está neste pacote", { size: 12 });
  input.items.forEach((it, i) => {
    const paginas = it.firstPage === it.lastPage ? `página ${it.firstPage}` : `páginas ${it.firstPage} a ${it.lastPage}`;
    w.paragraph(`${i + 1}. ${it.title}`, { font: fonts.bold, size: 10.5, spaceAfter: 0 });
    w.paragraph(paginas, { size: 9, color: MUTED, indent: 14, spaceAfter: 6 });
  });

  w.space(8);
  w.heading("Quem assina", { size: 12 });
  input.signers.forEach((s) => {
    w.paragraph(`${s.name}  —  ${s.qualification}`, { size: 10, spaceAfter: 2 });
  });

  w.space(16);
  w.rule();
  w.paragraph(
    "Leia cada documento antes de assinar. A assinatura é feita na plataforma ZapSign, pelo link que você recebeu; ela registra data, hora e a identificação de cada signatário. Esta capa não é assinada e serve só de índice.",
    { size: 9, color: MUTED, align: "justify" }
  );

  // Rodapé da capa: só o número (as páginas são contadas no pacote inteiro).
  const label = `${input.packageNumber}  ·  ${input.clinicName}`;
  const width = fonts.regular.widthOfTextAtSize(label, 8);
  w.page.drawText(label, { x: (A4.width - width) / 2, y: 44, size: 8, font: fonts.regular, color: MUTED });

  return doc.save();
}
