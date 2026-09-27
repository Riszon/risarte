import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ⚠️ AP13 — QUEM GERA VALOR QUE ALGUÉM PAGA NÃO USA A LEITURA TOLERANTE.
//
// `carregarFaixasDaEmpresa` devolve "sem faixa" quando a leitura falha: certo
// para uma TELA (a ficha abre com o preço combinado). Numa COBRANÇA, a mesma
// falha mandava o boleto pelo preço de 1 titular a quem negociou volume — mais
// caro, sem ninguém saber por quê. Estes arquivos geram cobrança, proposta e
// termo; eles usam `carregarFaixasParaCobrar`, que devolve nulo na falha.
const QUEM_COBRA = [
  "src/app/(app)/empresarial/[companyId]/billing-actions.ts",
  "src/app/(app)/empresarial/[companyId]/contract-actions.ts",
];

describe("faixas: quem cobra usa a leitura que falha fechada (AP13)", () => {
  for (const arq of QUEM_COBRA) {
    it(arq.split("/").pop()!, () => {
      const t = readFileSync(join(process.cwd(), arq), "utf8");
      expect(t).toContain("carregarFaixasParaCobrar");
      expect(t).not.toMatch(/\bcarregarFaixasDaEmpresa\b/);
    });
  }

  it("a leitura para cobrar devolve NULO na falha — nunca lista vazia", () => {
    const t = readFileSync(join(process.cwd(), "src/lib/empresarial/faixas-da-empresa.ts"), "utf8");
    const corpo = t.slice(t.indexOf("export async function carregarFaixasParaCobrar"));
    expect(corpo).toMatch(/if \(error \|\| !data\)[\s\S]*?return null;/);
    expect(corpo.slice(0, corpo.indexOf("return data.map"))).not.toMatch(/return \[\]/);
  });
});
