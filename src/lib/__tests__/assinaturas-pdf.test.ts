import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderCoverPdf } from "@/lib/signatures/pdf/cover";
import { inspectAttachment, mergePdfs } from "@/lib/signatures/pdf/merge";
import { renderTemplatePdf } from "@/lib/signatures/pdf/render-template";
import { montarRubricas } from "@/lib/signatures/pdf/signature-block";
import { wrapText } from "@/lib/signatures/pdf/text";
import { embedFonts, FEATURES } from "@/lib/signatures/pdf/fonts";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// O PDF do pacote (ZS2): o modelo vira páginas, a capa indexa, a mesclagem
// soma as páginas e as caixas de assinatura viram as marcas da ZapSign. Tudo
// com as fontes da marca, lidas do disco — se faltarem, aqui quebra primeiro.

const corpo = {
  preamble: "Pelo presente instrumento, {{paciente_nome}} contrata a unidade.",
  sections: Array.from({ length: 12 }, (_, i) => ({
    title: `Cláusula ${i + 1}ª — Objeto`,
    body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(18),
  })),
  closing: "E, por estarem assim justas e contratadas, assinam o presente.",
};

const signers = [
  { key: "c", name: "Maria da Silva Teste", qualification: "Paciente" },
  { key: "t1", name: "Testemunha Um", qualification: "Testemunha" },
  { key: "r", name: "Gerente da Unidade", qualification: "Representante da Risarte" },
];

// Gera PDFs de verdade (fontes embutidas): com a máquina ocupada passa dos 5 s
// padrão do Vitest, e tempo não é defeito.
describe("PDF do pacote (ZS2)", { timeout: 60_000 }, () => {
  it("quebra o texto por largura e respeita quebras explícitas", async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc);
    const lines = wrapText("uma frase curta\n\n" + "palavra ".repeat(60), fonts.regular, 10.5, 200);
    expect(lines[0]).toBe("uma frase curta");
    expect(lines[1]).toBe("");
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.every((l) => fonts.regular.widthOfTextAtSize(l, 10.5) <= 200)).toBe(true);
  });

  it("a fonte vai INTEIRA no PDF, nunca em subconjunto (AP89)", async () => {
    // O subconjunto da Inter que o fontkit grava é recusado pelo navegador
    // ("Bad offSize") e o leitor mostra quadradinhos. Duas palavras com a
    // fonte inteira passam de 200 KB; em subconjunto, ficam perto de 10 KB.
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc);
    const page = doc.addPage();
    page.drawText("Ação", { x: 40, y: 700, size: 12, font: fonts.regular });
    page.drawText("Cláusula", { x: 40, y: 680, size: 12, font: fonts.bold });
    const bytes = await doc.save();
    expect(bytes.length).toBeGreaterThan(200_000);
  });

  it("o r não vira a variante de largura errada (ligadura desligada, AP89)", async () => {
    // Com a ligadura ligada, "rm" usa o "r.1", mais estreito, e o PDF da fonte
    // inteira abria com um buraco depois do r. Desligada, "rm" = "r" + "m".
    const doc = await PDFDocument.create();
    const { regular, bold } = await embedFonts(doc);
    for (const f of [regular, bold]) {
      const junto = f.widthOfTextAtSize("rm", 10);
      const separado = f.widthOfTextAtSize("r", 10) + f.widthOfTextAtSize("m", 10);
      expect(junto).toBeCloseTo(separado, 5);
    }
  });

  it("a fonte não troca NENHUMA letra do nosso texto (liga e calt desligadas, AP89/ZS5)", () => {
    // Letra trocada pela Inter sai com largura errada no PDF da fonte inteira
    // ("platafor ma", "0003- 28"). A régua confere todos os pares de caracteres
    // que um contrato usa, e trios em volta de número: o desenho tem de ser
    // exatamente o glifo de cada caractere.
    const chars: string[] = [];
    for (let c = 0x20; c <= 0x7e; c++) chars.push(String.fromCharCode(c));
    for (const c of "ÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúüºª°§–—“”‘’•…") chars.push(c);
    const contexto = "0123456789-:x/.,()".split("");
    for (const arquivo of ["Inter-Regular.otf", "Inter-Bold.otf"]) {
      const f = fontkit.create(readFileSync(path.join(process.cwd(), "src/lib/signatures/pdf/assets", arquivo)));
      const trocados: string[] = [];
      const confere = (t: string) => {
        const ids = f.layout(t, FEATURES).glyphs.map((g) => g.id);
        const esperado = [...t].map((ch) => f.glyphForCodePoint(ch.codePointAt(0)!).id);
        if (ids.length !== esperado.length || ids.some((id, i) => id !== esperado[i])) trocados.push(t);
      };
      for (const a of chars) for (const b of chars) confere(a + b);
      for (const a of contexto) for (const b of contexto) for (const c of contexto) confere(a + b + c);
      expect(trocados.slice(0, 10), arquivo).toEqual([]);
    }
  });

  it("toda tela com o envio para assinatura leva as fontes do PDF para a Vercel (achado na ZS7)", () => {
    // A Server Action roda na função da ROTA que a chamou: tela com o botão
    // sem a pasta das fontes no pacote quebra na Vercel ("arquivo não
    // encontrado") e passa em todo teste local. A ZS5 esqueceu o Empresarial.
    const config = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    const raiz = path.join(process.cwd(), "src", "app", "(app)");
    const usa = /EnviarParaAssinaturaDialog|EnviarEmpresaParaAssinaturaDialog|AssinaturasDaEmpresa|AssinaturasDoCliente/;
    const segmentos = new Set<string>();
    const varrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) varrer(p);
        else if (/\.tsx?$/.test(e.name) && usa.test(readFileSync(p, "utf8"))) segmentos.add(path.relative(raiz, p).split(path.sep)[0]);
      }
    };
    varrer(raiz);
    expect(segmentos.size).toBeGreaterThan(3);
    for (const s of segmentos) {
      expect(config, `/${s}/** fora do outputFileTracingIncludes`).toContain(`"/${s}/**": ["src/lib/signatures/pdf/assets/**"]`);
    }
  });

  it("as duas fontes embutem com as MESMAS trocas desligadas", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/signatures/pdf/fonts.ts"), "utf8");
    expect(src.match(/features: FEATURES/g)?.length).toBe(2);
  });

  it("o modelo vira várias páginas, com uma caixa por signatário no fim", async () => {
    const r = await renderTemplatePdf({ title: "Contrato de teste", body: corpo, provisional: true, footer: "ASS-000001 · Risarte", signers });
    expect(r.pageCount).toBeGreaterThanOrEqual(3);
    expect(r.boxes.map((b) => b.signerKey)).toEqual(["c", "t1", "r"]);
    // Todas as caixas ficam na última página (ou nas duas últimas) e dentro da folha.
    for (const b of r.boxes) {
      expect(b.page).toBeGreaterThanOrEqual(r.pageCount - 2);
      expect(b.left).toBeGreaterThan(0);
      expect(b.bottom).toBeGreaterThan(0);
      expect(b.left + b.width).toBeLessThan(596);
    }
    const reaberto = await PDFDocument.load(r.bytes);
    expect(reaberto.getPageCount()).toBe(r.pageCount);
  });

  it("a capa, os documentos e um anexo mesclam com as faixas certas; a capa não leva rubrica", async () => {
    const d1 = await renderTemplatePdf({ title: "Doc 1", body: corpo, provisional: false, footer: "x", signers });
    const d2 = await renderTemplatePdf({ title: "Doc 2", body: { ...corpo, sections: corpo.sections.slice(0, 2) }, provisional: false, footer: "x", signers });
    const anexo = await PDFDocument.create();
    anexo.addPage();
    anexo.addPage();
    const anexoBytes = await anexo.save();
    expect(await inspectAttachment(anexoBytes)).toEqual({ ok: true, pageCount: 2 });
    expect((await inspectAttachment(new Uint8Array([1, 2, 3]))).ok).toBe(false);

    const capa = await renderCoverPdf({
      packageNumber: "ASS-000001",
      clientName: "Maria da Silva Teste",
      clinicName: "Risarte Unidade Teste",
      dateLabel: "31/10/2026",
      items: [
        { title: "Doc 1", firstPage: 2, lastPage: 1 + d1.pageCount },
        { title: "Doc 2", firstPage: 2 + d1.pageCount, lastPage: 1 + d1.pageCount + d2.pageCount },
        { title: "Anexo", firstPage: 2 + d1.pageCount + d2.pageCount, lastPage: 3 + d1.pageCount + d2.pageCount },
      ],
      signers: signers.map((s) => ({ name: s.name, qualification: s.qualification })),
    });
    const m = await mergePdfs([{ bytes: capa }, { bytes: d1.bytes }, { bytes: d2.bytes }, { bytes: anexoBytes }]);
    expect(m.ranges[0]).toEqual({ first_page: 1, last_page: 1 });
    expect(m.ranges[1]).toEqual({ first_page: 2, last_page: 1 + d1.pageCount });
    expect(m.ranges[3].last_page).toBe(m.pageCount);
    expect(m.pageCount).toBe(1 + d1.pageCount + d2.pageCount + 2);

    const rubricas = montarRubricas({
      pageCount: m.pageCount,
      skipPages: [0],
      documents: [
        { firstPage: m.ranges[1].first_page, boxes: d1.boxes },
        { firstPage: m.ranges[2].first_page, boxes: d2.boxes },
      ],
      signerTokens: [
        { key: "c", token: "tc" },
        { key: "t1", token: "tt" },
        { key: "r", token: "tr" },
      ],
    });
    const assinaturas = rubricas.filter((r) => r.type === "signature");
    const vistos = rubricas.filter((r) => r.type === "visto");
    expect(assinaturas).toHaveLength(6);
    expect(vistos).toHaveLength((m.pageCount - 1) * 3);
    expect(rubricas.some((r) => r.page === 0)).toBe(false);
    // A assinatura do cliente no Doc 1 cai na última página do Doc 1 (índice 0-based).
    const ultimaDoDoc1 = m.ranges[1].last_page - 1;
    expect(assinaturas.find((r) => r.signer_token === "tc")?.page).toBeGreaterThanOrEqual(ultimaDoDoc1 - 1);
    for (const r of rubricas) {
      for (const v of [r.relative_position_left, r.relative_position_bottom, r.relative_size_x, r.relative_size_y]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(r.relative_position_left + r.relative_size_x).toBeLessThanOrEqual(100);
    }
  });
});
