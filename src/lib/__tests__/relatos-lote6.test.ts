import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentoTemTitulo } from "@/lib/documents";

// Relatos de 26/11/2026 (lote 6): OC-00191 e OC-00192, da Gleyce (treino).

const ler = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("OC-00192 — a prescrição não tem título", () => {
  it("só a prescrição perde o título", () => {
    expect(documentoTemTitulo("prescription")).toBe(false);
    expect(documentoTemTitulo("certificate")).toBe(true);
    expect(documentoTemTitulo("declaration")).toBe(true);
    expect(documentoTemTitulo("guidance")).toBe(true);
  });

  it("o servidor grava \"Prescrição\" como nome na lista", () => {
    const t = ler("src", "app", "(app)", "prontuarios", "[id]", "documents-actions.ts");
    expect(t).toMatch(/documentoTemTitulo\(input\.kind\)\s+\? input\.title\.trim\(\)\s+: DOCUMENT_KIND_LABELS\[input\.kind\]/);
  });

  it("a impressão não põe a prescrição em negrito, e a antiga não perde o 1º remédio", () => {
    const t = ler("src", "app", "documentos", "[id]", "imprimir", "page.tsx");
    expect(t).toMatch(/documentoTemTitulo\(doc\.kind\) \? \(\s+<h1/);
    expect(t).toMatch(/doc\.title\.trim\(\) !== DOCUMENT_KIND_LABELS\[doc\.kind\]\s+\? `\$\{doc\.title\}\n`/);
  });

  it("o formulário esconde o título na prescrição", () => {
    const t = ler("src", "app", "(app)", "prontuarios", "[id]", "documents-section.tsx");
    expect(t).toMatch(/\{documentoTemTitulo\(kind\) && \(\s+<div className="space-y-1\.5">\s+<Label htmlFor="doc-title">/);
  });
});

describe("OC-00191 — voltar ao Atendimento depois de concluir", () => {
  it("o aviso de concluído leva ao Atendimento, sem tirar da ficha sozinho", () => {
    const t = ler("src", "app", "(app)", "prontuarios", "[id]", "attendance-conclude-block.tsx");
    expect(t).toMatch(/label: "Voltar ao Atendimento",\s+onClick: \(\) => router\.push\("\/atendimento"\)/);
    expect(t).toMatch(/router\.refresh\(\);/);
  });
});
