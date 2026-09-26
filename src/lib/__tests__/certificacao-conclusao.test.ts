import { describe, expect, it } from "vitest";
import {
  deveRegistrarConclusao,
  ehResultadoDaConclusao,
  lerRetrato,
  recadoDaConclusao,
  retratoDaMedicao,
  RESULTADOS_DA_CONCLUSAO,
} from "@/lib/certificacao-conclusao";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Medicao } from "@/lib/certificacao";

const medido = (itens: { minimo: number; feito: number | null }[]): Medicao => {
  const lista = itens.map((i, n) => ({
    chave: `c${n}`,
    rotulo: `Critério ${n}`,
    minimo: i.minimo,
    feito: i.feito,
    cumprido: i.feito !== null && i.feito >= i.minimo,
  }));
  const semMedida = lista.filter((i) => i.feito === null).length;
  return {
    estado: "medido",
    progresso: {
      itens: lista,
      cumprida: lista.length > 0 && semMedida === 0 && lista.every((i) => i.cumprido),
      semMedida,
      percentual: 0,
    },
  };
};

describe("conclusão da missão (0281)", () => {
  it("registra só com todos os critérios medidos e atingidos", () => {
    expect(deveRegistrarConclusao(medido([{ minimo: 3, feito: 3 }, { minimo: 1, feito: 5 }]))).toBe(true);
    expect(deveRegistrarConclusao(medido([{ minimo: 3, feito: 2 }, { minimo: 1, feito: 5 }]))).toBe(false);
  });

  it("⚠️ banco de treino fora do ar NUNCA abre o sistema real", () => {
    expect(deveRegistrarConclusao(medido([{ minimo: 1, feito: 9 }, { minimo: 1, feito: null }]))).toBe(false);
    expect(deveRegistrarConclusao({ estado: "sem_medicao", motivo: "fora do ar" })).toBe(false);
    expect(deveRegistrarConclusao({ estado: "nao_comecou" })).toBe(false);
    expect(deveRegistrarConclusao(null)).toBe(false);
  });

  it("⚠️ segunda trava: mesmo que 'cumprida' venha errado, sem os números não registra", () => {
    const m = medido([{ minimo: 3, feito: 1 }]);
    if (m.estado === "medido") m.progresso.cumprida = true; // simula um defeito em progressoDaMissao
    expect(deveRegistrarConclusao(m)).toBe(false);
  });

  it("missão sem critério nenhum não é 'cumprida'", () => {
    expect(deveRegistrarConclusao(medido([]))).toBe(false);
  });

  it("o retrato guarda os números e volta igual", () => {
    const m = medido([{ minimo: 3, feito: 4 }]);
    if (m.estado !== "medido") throw new Error("régua");
    const r = retratoDaMedicao(m.progresso, new Date("2026-09-26T12:00:00Z"));
    expect(r.medido_em).toBe("2026-09-26T12:00:00.000Z");
    expect(lerRetrato(r)).toEqual([{ chave: "c0", rotulo: "Critério 0", minimo: 3, feito: 4 }]);
  });

  it("retrato estranho vindo do banco vira lista vazia, não erro", () => {
    expect(lerRetrato(null)).toEqual([]);
    expect(lerRetrato({ itens: "x" })).toEqual([]);
  });

  it("todo resultado tem recado, e os resultados são os que a 0281 devolve", () => {
    for (const r of RESULTADOS_DA_CONCLUSAO) expect(recadoDaConclusao(r).length).toBeGreaterThan(10);
    expect(ehResultadoDaConclusao("liberado")).toBe(true);
    expect(ehResultadoDaConclusao("outra_coisa")).toBe(false);
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0281_liberacao_do_portao.sql"), "utf8");
    // Só o que a função DEVOLVE: `v_resultado := '…'`, `return '…'` e os ramos
    // do `return case … end;` (o CASE do approval_status é valor de coluna).
    const blocosDoReturnCase = [...sql.matchAll(/return case([\s\S]*?)end;/g)].map((m) => m[1]).join("\n");
    const devolvidos = new Set([
      ...[...sql.matchAll(/v_resultado := '([a-z_]+)'/g)].map((m) => m[1]),
      ...[...sql.matchAll(/return '([a-z_]+)'/g)].map((m) => m[1]),
      ...[...blocosDoReturnCase.matchAll(/(?:then|else) '([a-z_]+)'/g)].map((m) => m[1]),
    ]);
    expect(devolvidos.size).toBeGreaterThan(2); // a régua precisa ter achado algo
    for (const d of devolvidos) expect(RESULTADOS_DA_CONCLUSAO as readonly string[]).toContain(d);
  });
});
