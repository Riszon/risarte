import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INDICADORES_DE_META } from "@/lib/metas/indicadores";

// ⚠️ INDICADOR É CÓDIGO; META É DADO — e o código mora em DOIS lugares: a
// consulta no banco (`_goal_measure_raw`, 0318) e o catálogo da tela
// (`src/lib/metas/indicadores.ts`). Esta régua lê a lista do banco entre as
// marcas `INDICADORES:INICIO/FIM` e reprova quando os dois lados divergem:
// indicador na tela sem consulta = barra parada em zero para sempre;
// consulta sem indicador = medição que ninguém consegue escolher.
//
// Lê a migração MAIS NOVA que redefine `_goal_indicator_meta`, para continuar
// valendo quando a M2 acrescentar indicadores numa migração nova.

const PASTA = join(process.cwd(), "supabase", "migrations");

function catalogoDoBanco(): Map<string, { kind: string; perPerson: boolean; money: boolean }> {
  const arquivos = readdirSync(PASTA).sort().filter((f) => f.endsWith(".sql"));
  let texto: string | null = null;
  for (const f of arquivos) {
    const s = readFileSync(join(PASTA, f), "utf8");
    if (s.includes("function public._goal_indicator_meta") && s.includes("INDICADORES:INICIO")) texto = s;
  }
  if (!texto) throw new Error("Nenhuma migração define _goal_indicator_meta com as marcas — a régua não mediu nada.");
  const bloco = texto.split("INDICADORES:INICIO")[1].split("INDICADORES:FIM")[0];
  const linhas = [...bloco.matchAll(/\('([a-z_]+)',\s*'(sum|rate)',\s*(true|false),\s*(true|false)\)/g)];
  return new Map(linhas.map((m) => [m[1], { kind: m[2], perPerson: m[3] === "true", money: m[4] === "true" }]));
}

describe("catálogo das metas: código × banco", () => {
  const banco = catalogoDoBanco();

  it("a régua achou a lista do banco (zero = não mediu, nunca 'tudo certo')", () => {
    expect(banco.size).toBeGreaterThan(0);
  });

  it("todo indicador da tela tem consulta no banco", () => {
    const semConsulta = INDICADORES_DE_META.filter((i) => !banco.has(i.chave)).map((i) => i.chave);
    expect(semConsulta).toEqual([]);
  });

  it("toda chave do catálogo do banco tem um ramo na consulta (_goal_measure_raw)", () => {
    const s = readdirSync(PASTA).sort().filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(PASTA, f), "utf8"))
      .filter((t) => t.includes("function public._goal_measure_raw"))
      .pop();
    expect(s, "nenhuma migração define _goal_measure_raw").toBeTruthy();
    const corpo = s!.split("function public._goal_measure_raw")[1].split("$$;")[0];
    const semRamo = [...banco.keys()].filter((k) => !corpo.includes(`'${k}'`));
    expect(semRamo).toEqual([]);
  });

  it("toda consulta do banco aparece na tela", () => {
    const daTela = new Set(INDICADORES_DE_META.map((i) => i.chave as string));
    expect([...banco.keys()].filter((k) => !daTela.has(k))).toEqual([]);
  });

  it("tipo, dinheiro e 'por pessoa' batem dos dois lados", () => {
    for (const i of INDICADORES_DE_META) {
      const b = banco.get(i.chave)!;
      expect({ chave: i.chave, tipo: i.tipo, dinheiro: i.dinheiro, porPessoa: i.porPessoa }).toEqual({
        chave: i.chave,
        tipo: b.kind,
        dinheiro: b.money,
        porPessoa: b.perPerson,
      });
    }
  });

  it("dinheiro é sempre em R$ e R$ é sempre dinheiro", () => {
    for (const i of INDICADORES_DE_META) expect(i.dinheiro).toBe(i.unidade === "brl");
  });

  it("soma só aumenta (o banco recusa reduzir uma soma)", () => {
    for (const i of INDICADORES_DE_META.filter((x) => x.tipo === "sum")) {
      expect(i.direcoes).toEqual(["increase"]);
    }
  });

  it("todo indicador explica o que conta e de quem é o número", () => {
    for (const i of INDICADORES_DE_META) {
      expect(i.ajuda.length).toBeGreaterThan(30);
      expect(i.quemConta.length).toBeGreaterThan(5);
    }
  });
});
