import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cobrancaEhSoProposta, seloDaVenda } from "@/lib/venda-fechada";

// 0373 (CBE-00001, Cambé, 09/11/2026): negociação aberta, mas o prontuário
// dizia "Comprada pelo cliente" e mostrava 8 cobranças, uma "em atraso".
// A venda só vale com o contrato assinado (fechamento).

describe("o selo da opção no prontuário", () => {
  it("em negociação NÃO é comprada (o caso do dono)", () => {
    expect(seloDaVenda({ status: "em_negociacao", closed: false })).toBeNull();
    expect(seloDaVenda({ status: "aguardando_autorizacao", closed: false })).toBeNull();
    expect(seloDaVenda({ status: "devolvida", closed: false })).toBeNull();
  });
  it("aceita sem assinatura avisa que falta assinar", () => {
    expect(seloDaVenda({ status: "aceita", closed: false })?.texto).toBe(
      "Aceita — aguardando assinatura"
    );
  });
  it("comprada só com a venda fechada", () => {
    expect(seloDaVenda({ status: "aceita", closed: true })?.texto).toBe("Comprada pelo cliente");
  });
  it("cancelada continua dizendo que foi cancelada", () => {
    expect(seloDaVenda({ status: "cancelada", closed: true })?.tom).toBe("cancelada");
  });
});

describe("cobrança que é só a proposta não aparece como cobrança", () => {
  const base = {
    origin: "negotiation" as const,
    negotiationStatus: "em_negociacao",
    saleClosed: false,
    paidAmountCents: 0,
  };
  it("negociação aberta: é proposta (o caso do dono)", () => {
    expect(cobrancaEhSoProposta(base)).toBe(true);
  });
  it("aceita (a equipe emite a cobrança antes da assinatura), fechada ou paga: é cobrança", () => {
    expect(cobrancaEhSoProposta({ ...base, negotiationStatus: "aceita" })).toBe(false);
    expect(cobrancaEhSoProposta({ ...base, saleClosed: true })).toBe(false);
    expect(cobrancaEhSoProposta({ ...base, paidAmountCents: 1 })).toBe(false);
  });
  it("renegociação e venda direta não passam por esta regra", () => {
    expect(cobrancaEhSoProposta({ ...base, origin: "renegotiation" })).toBe(false);
    expect(cobrancaEhSoProposta({ ...base, origin: "direct_sale" })).toBe(false);
  });
  it("sem conseguir ler a situação, mostra (nunca some com cobrança de verdade)", () => {
    expect(cobrancaEhSoProposta({ ...base, negotiationStatus: null })).toBe(false);
  });
});

describe("as telas usam a regra única", () => {
  const RAIZ = join(__dirname, "..", "..");
  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return n === "__tests__" ? [] : arquivos(p);
      return /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  }
  const todos = arquivos(RAIZ);
  const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

  it("a leitura acha os arquivos (régua que não acha nada grita)", () => {
    expect(todos.length).toBeGreaterThan(500);
  });

  it('"Comprada pelo cliente" só nasce de seloDaVenda', () => {
    const fora = todos
      .filter((p) => !p.endsWith("venda-fechada.ts"))
      // As Novidades CONTAM a mudança em texto; não desenham selo.
      .filter((p) => !p.endsWith("changelog.ts"))
      .filter((p) =>
        ler(p)
          .split("\n")
          // Comentário que cita o texto não desenha selo nenhum.
          .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
          .some((l) => /["'`>]\s*Comprada pelo cliente/.test(l))
      );
    expect(fora).toEqual([]);
  });

  it("o Financeiro do cliente tira as propostas antes de montar as cobranças", () => {
    const loader = todos.find((p) => /prontuarios[\\/]\[id\][\\/]receivables-loader\.ts$/.test(p));
    expect(loader).toBeDefined();
    const src = ler(loader!);
    expect(src).toMatch(/const instRows = await semAsPropostas\(/);
    expect(src).toMatch(/cobrancaEhSoProposta\(/);
  });

  it("o selo do plano lê a venda fechada", () => {
    const sec = todos.find((p) => /prontuarios[\\/]\[id\][\\/]planning-section\.tsx$/.test(p));
    expect(ler(sec!)).toMatch(/seloDaVenda\(\{\s*status: commercial\.status,\s*closed:/);
    const page = todos.find((p) => /prontuarios[\\/]\[id\][\\/]page\.tsx$/.test(p));
    expect(ler(page!)).toMatch(/closed: negociacoesFechadas\.has\(/);
  });
});
