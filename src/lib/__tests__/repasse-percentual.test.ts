import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  lerPercentual,
  percentualDoValor,
  percentualParaCampo,
  repasseParaGravar,
  textoDoPercentual,
  valorDoPercentual,
} from "@/lib/finance/repasse-percentual";

// O par R$ ⇄ % do repasse (pedido do dono, 27/10/2026). Decisão: grava em R$.

const ler = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

describe("a conta do par", () => {
  it("percentual vira valor sobre o preço, arredondado meio para cima", () => {
    expect(valorDoPercentual(30, 50000)).toBe(15000);
    expect(valorDoPercentual(12.5, 33333)).toBe(4167); // 4166,625
    expect(valorDoPercentual(0, 50000)).toBe(0);
  });

  it("valor vira percentual com até 2 casas", () => {
    expect(percentualDoValor(15000, 50000)).toBe(30);
    expect(percentualDoValor(10000, 30000)).toBe(33.33);
    expect(percentualDoValor(0, 50000)).toBe(0);
  });

  it("sem preço não há percentual — nem nos dois sentidos", () => {
    expect(valorDoPercentual(30, 0)).toBeNull();
    expect(percentualDoValor(15000, 0)).toBeNull();
    expect(valorDoPercentual(-1, 50000)).toBeNull();
  });

  it("ida e volta fecham no preço de hoje", () => {
    const preco = 47390;
    const v = valorDoPercentual(27, preco)!;
    expect(percentualDoValor(v, preco)).toBe(27);
  });

  it("lê e escreve o percentual como no Brasil", () => {
    expect(lerPercentual("12,5")).toBe(12.5);
    expect(lerPercentual("12.5%")).toBe(12.5);
    expect(lerPercentual("")).toBeNull();
    expect(lerPercentual("abc")).toBeNull();
    expect(lerPercentual("-3")).toBeNull();
    expect(percentualParaCampo(33.333)).toBe("33,33");
    expect(textoDoPercentual(30)).toBe("30%");
  });
});

describe("o que fica gravado é o R$", () => {
  it("valor digitado: grava o valor e zera o percentual", () => {
    expect(repasseParaGravar({ valorCents: 15000, percent: 10, precoCents: 50000 })).toEqual({
      valorCents: 15000,
      percent: 0,
    });
  });

  it("só percentual, com preço: converte para R$", () => {
    expect(repasseParaGravar({ valorCents: 0, percent: 30, precoCents: 50000 })).toEqual({
      valorCents: 15000,
      percent: 0,
    });
  });

  it("só percentual, sem preço: fica como percentual (não há como converter)", () => {
    expect(repasseParaGravar({ valorCents: 0, percent: 30, precoCents: 0 })).toEqual({
      valorCents: 0,
      percent: 30,
    });
  });

  it("nada digitado: nada gravado", () => {
    expect(repasseParaGravar({ valorCents: 0, percent: 0, precoCents: 50000 })).toEqual({
      valorCents: 0,
      percent: 0,
    });
  });
});

describe("as telas usam o par", () => {
  const editor = ler("src/app/(app)/procedimentos/procedures-editor.tsx");
  const sugestoes = ler("src/app/(app)/procedimentos/sugestoes.tsx");
  const actions = ler("src/app/(app)/procedimentos/actions.ts");

  it("o cadastro e o repasse por nível desenham o par", () => {
    // Um no formulário do procedimento, um por nível.
    expect(editor.match(/<RepasseValorOuPercentual\b/g)?.length).toBe(2);
    expect(editor).toMatch(/precoCents=\{precoDoFormulario\}/);
    expect(editor).toMatch(/precoCents=\{priceCents\}/);
    expect(editor).toMatch(/priceCents=\{p\.defaultPriceCents\}/);
  });

  it("a aprovação de sugestão também", () => {
    expect(sugestoes).toMatch(/<RepasseValorOuPercentual\b/);
  });

  it("os campos soltos de % e R$ saíram", () => {
    for (const tela of [editor, sugestoes]) {
      expect(tela).not.toMatch(/<Label[^>]*>Comissão \(%\)<\/Label>/);
      expect(tela).not.toMatch(/<Label[^>]*>Comissão fixa \(R\$\)<\/Label>/);
    }
  });

  it("a lista não soma percentual e valor (o repasse paga só o valor)", () => {
    expect(editor).not.toMatch(/parts\.join\(" \+ "\)/);
  });

  it("o servidor grava pela mesma regra", () => {
    const parse = actions.slice(
      actions.indexOf("function parseProcedure("),
      actions.indexOf("async function logChange(")
    );
    expect(parse.length).toBeGreaterThan(0);
    expect(parse).toMatch(/repasseParaGravar\(/);
    expect(parse).toMatch(/commission_percent: repasse\.percent/);
    expect(parse).toMatch(/commission_fixed_cents: repasse\.valorCents/);
  });
});
