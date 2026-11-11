// 0399 (11/11/2026) — VENDA DIRETA VOLTA A FECHAR.
//
// A 0373 ligou UMA função (`post_sale_accruals_on_close`) como gatilho de
// `commercial_sales` e de `direct_sales`, com uma consulta que citava
// `new.negotiation_id` e `new.id` juntos, separados por
// `tg_table_name = ...`. O PL/pgSQL avalia todo `new.<coluna>` da consulta,
// mesmo no lado falso do `and`: a venda direta (sem `negotiation_id`) parou
// de fechar — e a de valor zero, que fecha sozinha ao nascer, parou de nascer.
//
// O ensaio `scripts/receita-ensaio-0399.mjs` prova no PostgreSQL (e reprova
// com QUEBRA=ramo). Esta régua prende o TEXTO: quem recriar a função juntando
// os dois casos numa consulta só reprova aqui.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PASTA = join(__dirname, "..", "..", "..", "supabase", "migrations");
const arquivos = readdirSync(PASTA).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const ler = (f: string) =>
  readFileSync(join(PASTA, f), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const RE =
  /create\s+or\s+replace\s+function\s+public\.post_sale_accruals_on_close\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1/gi;

function definicoes(): { arquivo: string; corpo: string }[] {
  const todas: { arquivo: string; corpo: string }[] = [];
  for (const f of arquivos) for (const m of ler(f).matchAll(RE)) todas.push({ arquivo: f, corpo: m[2] });
  if (todas.length === 0) throw new Error("NÃO MEDI: não achei public.post_sale_accruals_on_close");
  return todas;
}

/** Comando SQL (entre `;`) que cita colunas das DUAS tabelas pelo `new`. */
function misturaAsDuasVendas(corpo: string): string | null {
  for (const cmd of corpo.split(";")) {
    const c = cmd.toLowerCase();
    if (/\bnew\.negotiation_id\b/.test(c) && /\bdirect_sale_id\b/.test(c)) return cmd.trim();
  }
  return null;
}

describe("0399 — o gatilho da receita separa venda direta de venda comercial", () => {
  const todas = definicoes();
  const ultima = todas[todas.length - 1];

  it("a régua reconhece o defeito da 0373 (senão ela passaria por cegueira)", () => {
    const da0373 = todas.find((d) => d.arquivo.startsWith("0373_"));
    expect(da0373, "a 0373 sumiu da pasta").toBeTruthy();
    expect(misturaAsDuasVendas(da0373!.corpo)).not.toBeNull();
  });

  it("nenhum comando da versão em vigor cita new.negotiation_id junto com a venda direta", () => {
    expect(ultima.arquivo >= "0399").toBe(true);
    expect(misturaAsDuasVendas(ultima.corpo)).toBeNull();
  });

  it("um ramo por tabela: a venda direta procura pela própria venda", () => {
    const c = ultima.corpo.toLowerCase();
    expect(c).toMatch(
      /if tg_table_name = 'direct_sales' then[\s\S]*?where i\.direct_sale_id = new\.id[\s\S]*?elsif tg_table_name = 'commercial_sales' then[\s\S]*?where i\.negotiation_id = new\.negotiation_id/
    );
    expect(c).toMatch(/perform public\.post_installment_accrual\(v_id\)/);
    // A regra da 0373: mês fechado não derruba o fechamento da venda.
    expect(c).toMatch(/if sqlerrm = 'period_closed' then\s+raise warning/);
  });
});
