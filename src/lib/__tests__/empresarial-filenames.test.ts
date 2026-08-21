import { describe, expect, it } from "vitest";
import { reportFileName, slugify } from "@/lib/empresarial/filenames";

describe("slugify", () => {
  it("tira acento, símbolo e espaço", () => {
    // O "&" some e os espaços que sobram viram UM hífen só.
    expect(slugify("Padaria do Zé & Cia.")).toBe("padaria-do-ze-cia");
    expect(slugify("AÇÚCAR União")).toBe("acucar-uniao");
  });

  it("não deixa o nome do arquivo crescer sem limite", () => {
    expect(slugify("a".repeat(200)).length).toBe(60);
  });

  it("cai num padrão quando não sobra nada", () => {
    expect(slugify("!!!")).toBe("empresa");
    expect(slugify("")).toBe("empresa");
  });
});

describe("reportFileName", () => {
  it("junta módulo, tipo, empresa e data", () => {
    const name = reportFileName("ficha-da-empresa", "Padaria do Zé");
    expect(name).toMatch(
      /^risarte-empresarial_ficha-da-empresa_padaria-do-ze_\d{4}-\d{2}-\d{2}$/
    );
  });

  it("inclui o complemento antes da data quando informado", () => {
    const name = reportFileName("relatorio", "ACME", "Somente ativos");
    expect(name).toContain("_acme_somente-ativos_");
  });

  it("omite o complemento quando não há", () => {
    const name = reportFileName("relatorio", "ACME", null);
    expect(name).toMatch(/_acme_\d{4}-\d{2}-\d{2}$/);
  });
});
