import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFRawStream, StandardFonts } from "pdf-lib";
import { extrairPaginas, gerarCopia, nomeDoArquivo, textoDaFaixa } from "@/lib/signatures/pdf/copy";

// ZS4: a cópia individual sai do PDF MESCLADO ORIGINAL, só com as páginas do
// documento, e com a faixa "CÓPIA — não assinada digitalmente" em TODAS elas.

/** Um "pacote" de 5 páginas com larguras diferentes: dá para saber qual página veio. */
async function pacote(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 5; i++) doc.addPage([100 * i + 300, 842]);
  return doc.save();
}

/** O texto que a página desenha (o pdf-lib grava o texto da fonte padrão em hexadecimal). */
async function textoDasPaginas(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents && "asArray" in contents ? (contents as unknown as { asArray(): unknown[] }).asArray() : [contents];
    let all = "";
    for (const ref of streams) {
      const s = doc.context.lookup(ref as never);
      if (s instanceof PDFRawStream) {
        const raw = s.getContents();
        let text: string;
        try {
          text = Buffer.from(inflateSync(raw)).toString("latin1");
        } catch {
          text = Buffer.from(raw).toString("latin1");
        }
        all += text;
      }
    }
    return all;
  });
}

async function hexDe(text: string): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  return font.encodeText(text).toString().replace(/[<>]/g, "").toUpperCase();
}

describe("as páginas da cópia", () => {
  it("leva só first..last (1 = a capa do pacote), na ordem", async () => {
    const copia = await gerarCopia({ merged: await pacote(), firstPage: 2, lastPage: 4, packageNumber: "ASS-000099", title: "Contrato" });
    expect(copia.pageCount).toBe(3);
    const doc = await PDFDocument.load(copia.bytes);
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([500, 600, 700]);
  });

  it("documento de uma página só", async () => {
    const copia = await gerarCopia({ merged: await pacote(), firstPage: 5, lastPage: 5, packageNumber: "ASS-000099", title: "TCLE" });
    expect(copia.pageCount).toBe(1);
    expect((await PDFDocument.load(copia.bytes)).getPage(0).getWidth()).toBe(800);
  });

  it("faixa fora do pacote é recusada (nunca devolve página errada)", async () => {
    const merged = await pacote();
    await expect(extrairPaginas(merged, 0, 2)).rejects.toThrow(/COPY_RANGE_INVALID/);
    await expect(extrairPaginas(merged, 4, 6)).rejects.toThrow(/COPY_RANGE_INVALID/);
    await expect(extrairPaginas(merged, 3, 2)).rejects.toThrow(/COPY_RANGE_INVALID/);
  });
});

describe("a faixa", () => {
  it("diz que é cópia, que não é assinada e qual é o pacote", () => {
    expect(textoDaFaixa("ASS-000123")).toBe("CÓPIA — não assinada digitalmente — pacote ASS-000123");
  });

  it("está em TODAS as páginas da cópia", async () => {
    const copia = await gerarCopia({ merged: await pacote(), firstPage: 1, lastPage: 5, packageNumber: "ASS-000123", title: "Pacote" });
    const hex = await hexDe(textoDaFaixa("ASS-000123"));
    const paginas = await textoDasPaginas(copia.bytes);
    expect(paginas).toHaveLength(5);
    // A régua precisa achar ALGUMA coisa: zero páginas lidas não é "tem faixa".
    expect(paginas.every((t) => t.length > 0)).toBe(true);
    for (const t of paginas) expect(t.toUpperCase().replace(/\s/g, "")).toContain(hex);
  });

  it("o PDF original não é alterado (a cópia é um arquivo novo)", async () => {
    const merged = await pacote();
    const antes = Buffer.from(merged).toString("base64");
    await gerarCopia({ merged, firstPage: 2, lastPage: 3, packageNumber: "ASS-000001", title: "X" });
    expect(Buffer.from(merged).toString("base64")).toBe(antes);
  });
});

describe("o nome do arquivo", () => {
  it("sem acento nem espaço, com o número do pacote", () => {
    expect(nomeDoArquivo("ASS-000013", "Termo de Consentimento (TCLE)", "copia")).toBe("ASS-000013-termo-de-consentimento-tcle-copia.pdf");
    expect(nomeDoArquivo("ASS-000013", "Orçamento aprovado", "assinado")).toBe("ASS-000013-orcamento-aprovado-assinado.pdf");
  });
});
