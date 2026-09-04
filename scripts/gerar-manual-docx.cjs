// Converte o manual de treinamento (Markdown) num .docx com a identidade Risarte.
// Uso: node md2docx.cjs <entrada.md> <saida.docx>

const fs = require("fs");
const path = require("path");
const D = require("docx");

// ---------------------------------------------------------------- identidade
const NAVY = "1F3253";
const NAVY_DARK = "16253E";
const GOLD = "B98B2E";
const TEXT = "23293D";
const MUTED = "5F6779";
const RULE = "D8D4C8";
const CALLOUT_BG = "F5F3EC";
const ROW_ALT = "F7F6F2";
const CODE_BG = "EFEDE6";

const BODY_SIZE = 21; // meio-ponto: 10,5pt
const CONTENT_WIDTH = 9638; // A4 (11906) menos 2cm de margem de cada lado

// ------------------------------------------------------------------- parsing
function parseBlocks(lines) {
  const blocks = [];
  let i = 0;

  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isTableSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes("-");
  const isUl = (l) => /^[-*]\s+/.test(l);
  const isOl = (l) => /^\d+\.\s+/.test(l);
  const isHeading = (l) => /^#{1,6}\s+/.test(l);
  const isHr = (l) => /^(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
  const isQuote = (l) => /^>\s?/.test(l);
  const isFence = (l) => /^```/.test(l);

  const startsBlock = (l) =>
    isHeading(l) || isHr(l) || isQuote(l) || isFence(l) || isUl(l) || isOl(l) || isTableRow(l);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (isFence(line)) {
      const code = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) code.push(lines[i++]);
      i++; // fecha a cerca
      blocks.push({ type: "code", lines: code });
      continue;
    }

    if (isHeading(line)) {
      const m = /^(#{1,6})\s+(.*)$/.exec(line);
      blocks.push({ type: "heading", level: m[1].length, text: m[2].trim() });
      i++;
      continue;
    }

    if (isHr(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (isQuote(line)) {
      const inner = [];
      while (i < lines.length && isQuote(lines[i])) {
        inner.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(inner) });
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const cells = (l) =>
        l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = cells(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const items = [];
      let current = null;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // Item pode continuar depois de uma linha em branco; só continua se o
          // que vem a seguir ainda for um marcador do mesmo tipo.
          let j = i;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && ((ordered && isOl(lines[j])) || (!ordered && isUl(lines[j])))) {
            i = j;
            continue;
          }
          break;
        }
        if ((ordered && isOl(l)) || (!ordered && isUl(l))) {
          if (current) items.push(current);
          current = l.replace(/^(\d+\.|[-*])\s+/, "").trim();
        } else if (/^\s{2,}\S/.test(l) && current !== null) {
          current += " " + l.trim();
        } else {
          break;
        }
        i++;
      }
      if (current) items.push(current);
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // parágrafo
    const para = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length === 0) {
      i++;
      continue;
    }
    // linhas de checklist (☐) viram parágrafos independentes
    if (para.every((l) => l.startsWith("☐"))) {
      blocks.push({ type: "checklist", items: para.map((l) => l.replace(/^☐\s*/, "")) });
    } else {
      blocks.push({ type: "para", text: para.join(" ") });
    }
  }

  return blocks;
}

// ------------------------------------------------------------- formatação
function inlineRuns(text, base = {}) {
  const out = [];
  const re = /(`[^`]+`)|(\*\*[\s\S]+?\*\*)|(\[[^\]]*\]\([^)]*\))|(\*[^*\n]+\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new D.TextRun({ ...base, text: text.slice(last, m.index) }));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        new D.TextRun({
          ...base,
          text: tok.slice(1, -1),
          font: "Consolas",
          size: (base.size ?? BODY_SIZE) - 2,
          color: NAVY,
          shading: { type: D.ShadingType.CLEAR, fill: CODE_BG, color: "auto" },
        }),
      );
    } else if (tok.startsWith("**")) {
      out.push(...inlineRuns(tok.slice(2, -2), { ...base, bold: true }));
    } else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(tok);
      out.push(...inlineRuns(mm[1], { ...base, color: base.color === "FFFFFF" ? "FFFFFF" : NAVY }));
    } else {
      out.push(...inlineRuns(tok.slice(1, -1), { ...base, italics: true }));
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(new D.TextRun({ ...base, text: text.slice(last) }));
  return out.length ? out : [new D.TextRun({ ...base, text: "" })];
}

const plain = (t) => t.replace(/[`*]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

// -------------------------------------------------------------- renderização
let listInstance = 0;

function renderBlocks(blocks, opts = {}) {
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading": {
        const level =
          b.level === 2
            ? D.HeadingLevel.HEADING_1
            : b.level === 3
              ? D.HeadingLevel.HEADING_2
              : D.HeadingLevel.HEADING_3;
        out.push(
          new D.Paragraph({
            heading: level,
            children: inlineRuns(b.text, {
              color: b.level === 2 ? NAVY : b.level === 3 ? NAVY : GOLD,
            }),
          }),
        );
        break;
      }

      case "para":
        out.push(
          new D.Paragraph({
            spacing: { after: 140, line: 280 },
            children: inlineRuns(b.text, { size: BODY_SIZE, color: TEXT }),
          }),
        );
        break;

      case "checklist":
        for (const it of b.items) {
          out.push(
            new D.Paragraph({
              spacing: { after: 60, line: 260 },
              indent: { left: 340, hanging: 220 },
              children: [
                new D.TextRun({ text: "☐  ", size: BODY_SIZE, color: GOLD }),
                ...inlineRuns(it, { size: BODY_SIZE, color: TEXT }),
              ],
            }),
          );
        }
        break;

      case "list": {
        const instance = ++listInstance;
        for (const it of b.items) {
          out.push(
            new D.Paragraph({
              spacing: { after: 80, line: 270 },
              numbering: {
                reference: b.ordered ? "lista-numerada" : "lista-marcada",
                level: 0,
                instance,
              },
              children: inlineRuns(it, { size: BODY_SIZE, color: TEXT }),
            }),
          );
        }
        break;
      }

      case "code":
        out.push(
          new D.Table({
            width: { size: CONTENT_WIDTH, type: D.WidthType.DXA },
            columnWidths: [CONTENT_WIDTH],
            borders: allBorders(RULE),
            rows: [
              new D.TableRow({
                children: [
                  new D.TableCell({
                    width: { size: CONTENT_WIDTH, type: D.WidthType.DXA },
                    shading: { type: D.ShadingType.CLEAR, fill: CODE_BG, color: "auto" },
                    margins: { top: 140, bottom: 140, left: 180, right: 180 },
                    children: b.lines.map(
                      (l) =>
                        new D.Paragraph({
                          spacing: { after: 0, line: 250 },
                          children: [
                            new D.TextRun({ text: l || " ", font: "Consolas", size: 18, color: TEXT }),
                          ],
                        }),
                    ),
                  }),
                ],
              }),
            ],
          }),
          spacer(120),
        );
        break;

      case "quote": {
        const inner = renderBlocks(b.blocks, { inCallout: true });
        out.push(
          new D.Table({
            width: { size: CONTENT_WIDTH, type: D.WidthType.DXA },
            columnWidths: [CONTENT_WIDTH],
            borders: {
              top: { style: D.BorderStyle.SINGLE, size: 2, color: CALLOUT_BG },
              bottom: { style: D.BorderStyle.SINGLE, size: 2, color: CALLOUT_BG },
              left: { style: D.BorderStyle.SINGLE, size: 18, color: GOLD },
              right: { style: D.BorderStyle.SINGLE, size: 2, color: CALLOUT_BG },
              insideHorizontal: { style: D.BorderStyle.NONE, size: 0, color: "auto" },
              insideVertical: { style: D.BorderStyle.NONE, size: 0, color: "auto" },
            },
            rows: [
              new D.TableRow({
                children: [
                  new D.TableCell({
                    width: { size: CONTENT_WIDTH, type: D.WidthType.DXA },
                    shading: { type: D.ShadingType.CLEAR, fill: CALLOUT_BG, color: "auto" },
                    margins: { top: 160, bottom: 160, left: 220, right: 200 },
                    children: inner.length ? inner : [new D.Paragraph("")],
                  }),
                ],
              }),
            ],
          }),
          spacer(140),
        );
        break;
      }

      case "table":
        out.push(renderTable(b), spacer(140));
        break;

      case "hr":
        if (!opts.inCallout) out.push(spacer(60));
        break;
    }
  }
  return out;
}

function spacer(after) {
  return new D.Paragraph({ spacing: { after, line: 120 }, children: [new D.TextRun({ text: "", size: 2 })] });
}

function allBorders(color) {
  const b = { style: D.BorderStyle.SINGLE, size: 2, color };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

function renderTable(b) {
  const cols = b.header.length;

  // Peso = quanto texto a coluna tem. Piso = a maior PALAVRA da coluna, para o
  // cabeçalho não quebrar no meio ("Compr as", "Plano s").
  const longestWord = (t) =>
    plain(t)
      .split(/\s+/)
      .reduce((a, w) => Math.max(a, Math.min(w.length, 16)), 0);

  const weights = [];
  const mins = [];
  for (let c = 0; c < cols; c++) {
    let len = plain(b.header[c] ?? "").length;
    let word = longestWord(b.header[c] ?? "");
    for (const r of b.rows) {
      len = Math.max(len, plain(r[c] ?? "").length);
      word = Math.max(word, longestWord(r[c] ?? ""));
    }
    weights.push(Math.max(6, Math.min(len, 60)));
    mins.push(Math.round(word * 105) + 280);
  }

  const totalMin = mins.reduce((a, x) => a + x, 0);
  const totalWeight = weights.reduce((a, x) => a + x, 0);
  let widths;
  if (totalMin >= CONTENT_WIDTH) {
    widths = mins.map((m) => Math.round((m / totalMin) * CONTENT_WIDTH));
  } else {
    const free = CONTENT_WIDTH - totalMin;
    widths = mins.map((m, c) => m + Math.round((weights[c] / totalWeight) * free));
  }
  widths[widths.length - 1] += CONTENT_WIDTH - widths.reduce((a, x) => a + x, 0);

  const cell = (text, { header = false, fill, width = 1000 } = {}) =>
    new D.TableCell({
      width: { size: width, type: D.WidthType.DXA },
      shading: fill ? { type: D.ShadingType.CLEAR, fill, color: "auto" } : undefined,
      margins: { top: 90, bottom: 90, left: 110, right: 110 },
      verticalAlign: D.VerticalAlign.CENTER,
      children: [
        new D.Paragraph({
          spacing: { after: 0, line: 250 },
          children: inlineRuns(text, {
            size: header ? BODY_SIZE - 2 : BODY_SIZE - 1,
            color: header ? "FFFFFF" : TEXT,
            bold: header || undefined,
          }),
        }),
      ],
    });

  const rows = [
    new D.TableRow({
      tableHeader: true,
      children: b.header.map((h, c) => cell(h, { header: true, fill: NAVY, width: widths[c] })),
    }),
    ...b.rows.map(
      (r, ri) =>
        new D.TableRow({
          children: Array.from({ length: cols }, (_, c) =>
            cell(r[c] ?? "", { fill: ri % 2 === 1 ? ROW_ALT : undefined, width: widths[c] }),
          ),
        }),
    ),
  ];

  return new D.Table({
    width: { size: CONTENT_WIDTH, type: D.WidthType.DXA },
    columnWidths: widths,
    layout: D.TableLayoutType.FIXED,
    borders: allBorders(RULE),
    rows,
  });
}

// ------------------------------------------------------------------ capa
function cover(logo, meta) {
  const imgW = 230;
  const imgH = Math.round((230 * 548) / 1465);

  const coverCell = new D.TableCell({
    width: { size: CONTENT_WIDTH, type: D.WidthType.DXA },
    shading: { type: D.ShadingType.CLEAR, fill: NAVY, color: "auto" },
    margins: { top: 900, bottom: 900, left: 500, right: 500 },
    children: [
      new D.Paragraph({
        alignment: D.AlignmentType.CENTER,
        spacing: { after: 500 },
        children: [
          new D.ImageRun({ type: "png", data: logo, transformation: { width: imgW, height: imgH } }),
        ],
      }),
      new D.Paragraph({
        alignment: D.AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new D.TextRun({ text: "Manual de Treinamento", bold: true, size: 52, color: "FFFFFF" }),
        ],
      }),
      new D.Paragraph({
        alignment: D.AlignmentType.CENTER,
        spacing: { after: 360 },
        children: [
          new D.TextRun({ text: "r i S Z o n", bold: true, size: 30, color: GOLD, characterSpacing: 60 }),
        ],
      }),
      new D.Paragraph({
        alignment: D.AlignmentType.CENTER,
        spacing: { after: 0 },
        children: [
          new D.TextRun({
            text: "Sistema de gestão da rede Risarte Odontologia",
            size: 22,
            color: "D9DEE8",
          }),
        ],
      }),
    ],
  });

  const els = [
    new D.Table({
      width: { size: CONTENT_WIDTH, type: D.WidthType.DXA },
      columnWidths: [CONTENT_WIDTH],
      borders: {
        top: { style: D.BorderStyle.NONE, size: 0, color: "auto" },
        bottom: { style: D.BorderStyle.NONE, size: 0, color: "auto" },
        left: { style: D.BorderStyle.NONE, size: 0, color: "auto" },
        right: { style: D.BorderStyle.NONE, size: 0, color: "auto" },
        insideHorizontal: { style: D.BorderStyle.NONE, size: 0, color: "auto" },
        insideVertical: { style: D.BorderStyle.NONE, size: 0, color: "auto" },
      },
      rows: [new D.TableRow({ children: [coverCell] })],
    }),
    spacer(500),
  ];

  for (const [rotulo, valor] of meta) {
    els.push(
      new D.Paragraph({
        spacing: { after: 90 },
        children: [
          new D.TextRun({ text: rotulo + "   ", bold: true, size: BODY_SIZE - 1, color: GOLD }),
          new D.TextRun({ text: valor, size: BODY_SIZE - 1, color: TEXT }),
        ],
      }),
    );
  }

  els.push(
    new D.Paragraph({
      spacing: { before: 600, after: 0 },
      children: [
        new D.TextRun({
          text: "Documento interno. Contém regras de operação e de acesso ao sistema — não distribuir fora da rede Risarte.",
          size: 17,
          italics: true,
          color: MUTED,
        }),
      ],
    }),
  );

  return els;
}

// ------------------------------------------------------------------- main
function main() {
  const [, , inPath, outPath] = process.argv;
  const md = fs.readFileSync(inPath, "utf8").replace(/\r\n/g, "\n");
  const logo = fs.readFileSync(
    path.join(path.dirname(inPath), "..", "..", "public", "risarte-logo-branca.png"),
  );

  const blocks = parseBlocks(md.split("\n"));

  const hoje = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const body = [
    ...cover(logo, [
      ["Versão do sistema", "0.225.0 · migração 0246"],
      ["Documento gerado em", hoje],
      ["Origem", "extraído do código-fonte do riSZon (82 rotas, 28 itens de menu, 179 mensagens, 384 ações, 16 papéis)"],
      ["Público", "toda a equipe — um roteiro por função"],
    ]),
    new D.Paragraph({
      heading: D.HeadingLevel.HEADING_1,
      children: [new D.TextRun({ text: "Índice", color: NAVY })],
    }),
    new D.Paragraph({
      spacing: { after: 200 },
      children: [
        new D.TextRun({
          text: "Ao abrir este arquivo, o Word pergunta se deseja atualizar os campos — responda Sim para o índice mostrar os números de página corretos.",
          size: 18,
          italics: true,
          color: MUTED,
        }),
      ],
    }),
    new D.TableOfContents("Índice", { hyperlink: true, headingStyleRange: "1-2" }),
  ];

  let skipping = false;
  for (const b of blocks) {
    if (b.type === "heading" && b.level === 1) continue;
    if (b.type === "heading" && b.level === 2) {
      skipping = plain(b.text).trim() === "Índice";
      if (skipping) continue;
    }
    if (skipping) continue;
    body.push(...renderBlocks([b]));
  }

  const doc = new D.Document({
    creator: "Risarte Odontologia",
    title: "Manual de Treinamento — riSZon",
    description: "Manual de treinamento do sistema riSZon, por função.",
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: BODY_SIZE, color: TEXT },
          paragraph: { spacing: { line: 280, after: 140 } },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 34, bold: true, color: NAVY, font: "Calibri" },
          paragraph: {
            spacing: { before: 240, after: 260 },
            pageBreakBefore: true,
            keepNext: true,
            border: { bottom: { style: D.BorderStyle.SINGLE, size: 10, color: GOLD, space: 8 } },
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 26, bold: true, color: NAVY },
          paragraph: { spacing: { before: 320, after: 160 }, keepNext: true },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 23, bold: true, color: GOLD },
          paragraph: { spacing: { before: 260, after: 120 }, keepNext: true },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "lista-numerada",
          levels: [
            {
              level: 0,
              format: D.LevelFormat.DECIMAL,
              text: "%1.",
              alignment: D.AlignmentType.START,
              style: {
                run: { bold: true, color: NAVY },
                paragraph: { indent: { left: 460, hanging: 340 } },
              },
            },
          ],
        },
        {
          reference: "lista-marcada",
          levels: [
            {
              level: 0,
              format: D.LevelFormat.BULLET,
              text: "•",
              alignment: D.AlignmentType.START,
              style: {
                run: { color: GOLD },
                paragraph: { indent: { left: 460, hanging: 260 } },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134, header: 680, footer: 620 },
          },
        },
        headers: {
          first: new D.Header({ children: [new D.Paragraph("")] }),
          default: new D.Header({
            children: [
              new D.Paragraph({
                alignment: D.AlignmentType.RIGHT,
                spacing: { after: 0 },
                border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
                children: [
                  new D.TextRun({ text: "Manual de Treinamento · riSZon", size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        footers: {
          first: new D.Footer({ children: [new D.Paragraph("")] }),
          default: new D.Footer({
            children: [
              new D.Paragraph({
                alignment: D.AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [
                  new D.TextRun({ text: "", size: 16, color: MUTED }),
                  new D.TextRun({ children: [D.PageNumber.CURRENT], size: 16, color: MUTED }),
                  new D.TextRun({ text: " / ", size: 16, color: MUTED }),
                  new D.TextRun({ children: [D.PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });

  D.Packer.toBuffer(doc).then((buf) => {
    fs.writeFileSync(outPath, buf);
    console.log("gravado:", outPath, (buf.length / 1024).toFixed(0) + " KB");
  });
}

main();
