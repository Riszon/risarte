import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

// ZS4: o visualizador de PDF (react-pdf/pdf.js) usa o "trabalhador" servido
// pelo PRÓPRIO site, sem CDN (`public/pdfjs/pdf.worker.min.mjs`). Ele tem de
// ser exatamente o da versão instalada do pdfjs-dist: trabalhador de outra
// versão faz o PDF não abrir ("API version does not match Worker version").
// Atualizou o react-pdf? Copie de novo:
//   cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdfjs/

const hash = (p: string) => createHash("sha256").update(readFileSync(join(process.cwd(), p))).digest("hex");

describe("o trabalhador do pdf.js", () => {
  it("a cópia em public/ é a da versão instalada", () => {
    expect(hash("public/pdfjs/pdf.worker.min.mjs")).toBe(hash("node_modules/pdfjs-dist/build/pdf.worker.min.mjs"));
  });

  it("o visualizador aponta para ela, não para CDN", () => {
    const core = readFileSync(join(process.cwd(), "src/components/pdf-viewer-core.tsx"), "utf8");
    expect(core).toContain('pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";');
    expect(core).not.toMatch(/unpkg|jsdelivr|cdnjs/);
  });
});
