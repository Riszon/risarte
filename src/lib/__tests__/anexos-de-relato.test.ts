import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAXIMO_POR_ENVIO,
  TAMANHO_MAXIMO,
  TIPOS_ACEITOS,
  caminhoDoAnexo,
  midiaDo,
  nomeDaCaptura,
  rotuloDeTamanho,
  triarArquivos,
} from "@/lib/anexos-de-relato";

const MB = 1024 * 1024;
const arq = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("a lista da tela é a mesma do bucket (0257)", () => {
  const sql = readFileSync("supabase/migrations/0257_relatos_anexos.sql", "utf8");

  it("mesmos tipos", () => {
    const bloco = /allowed_mime_types\)\s*values\s*\(([\s\S]*?)\)\s*on conflict/.exec(sql)?.[1];
    expect(bloco, "não achei a criação do bucket na migração").toBeTruthy();
    const doBanco = [...bloco!.matchAll(/'([a-z]+\/[a-z0-9.+-]+)'/g)].map((m) => m[1]).sort();
    expect(doBanco.length).toBeGreaterThan(0);
    expect([...TIPOS_ACEITOS].sort()).toEqual(doBanco);
  });

  it("mesmo tamanho", () => {
    expect(sql).toContain(`false, ${TAMANHO_MAXIMO},`);
  });
});

describe("triagem antes de enviar", () => {
  it("aceita imagem, PDF e vídeo", () => {
    const r = triarArquivos(
      [arq("a.png", "image/png"), arq("b.pdf", "application/pdf"), arq("c.mp4", "video/mp4")],
      0
    );
    expect(r.aceitos).toEqual([0, 1, 2]);
    expect(r.avisos).toEqual([]);
  });

  it("recusa outro tipo DIZENDO por quê", () => {
    const r = triarArquivos([arq("planilha.xlsx", "application/vnd.ms-excel")], 0);
    expect(r.aceitos).toEqual([]);
    expect(r.avisos[0]).toContain("planilha.xlsx");
    expect(r.avisos[0]).toContain("só imagem, PDF ou vídeo");
  });

  it("recusa acima de 10 MB com o tamanho do arquivo", () => {
    const r = triarArquivos([arq("video.mp4", "video/mp4", 12 * MB)], 0);
    expect(r.aceitos).toEqual([]);
    expect(r.avisos[0]).toContain("12 MB");
  });

  it("exatamente 10 MB passa", () => {
    expect(triarArquivos([arq("x.png", "image/png", TAMANHO_MAXIMO)], 0).aceitos).toEqual([0]);
  });

  it("arquivo vazio não passa", () => {
    expect(triarArquivos([arq("x.png", "image/png", 0)], 0).aceitos).toEqual([]);
  });

  it(`no máximo ${MAXIMO_POR_ENVIO} por envio, contando o que já estava na lista`, () => {
    const seis = Array.from({ length: 6 }, (_, i) => arq(`${i}.png`, "image/png"));
    expect(triarArquivos(seis, 0).aceitos).toHaveLength(5);
    const r = triarArquivos(seis, 3);
    expect(r.aceitos).toEqual([0, 1]);
    expect(r.avisos).toHaveLength(4);
  });

  it("recusado por tipo não gasta vaga", () => {
    const r = triarArquivos([arq("a.txt", "text/plain"), arq("b.png", "image/png")], 4);
    expect(r.aceitos).toEqual([1]);
  });
});

describe("caminho e nomes", () => {
  it("⚠️ o caminho NÃO leva o nome original do arquivo", () => {
    const c = caminhoDoAnexo("rel-1", "abc", "image/jpeg");
    expect(c).toBe("rel-1/abc.jpg");
  });

  it("tamanho legível", () => {
    expect(rotuloDeTamanho(200)).toBe("1 KB");
    expect(rotuloDeTamanho(820 * 1024)).toBe("820 KB");
    expect(rotuloDeTamanho(1.5 * MB)).toBe("1,5 MB");
  });

  it("tipo de mídia", () => {
    expect(midiaDo("image/webp")).toBe("imagem");
    expect(midiaDo("video/webm")).toBe("video");
    expect(midiaDo("application/pdf")).toBe("pdf");
  });

  it("nome da captura com data e hora", () => {
    expect(nomeDaCaptura(new Date(2026, 8, 17, 9, 5, 3))).toBe("captura-20260917-090503.png");
  });
});
