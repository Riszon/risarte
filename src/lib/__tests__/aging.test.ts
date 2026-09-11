import { describe, expect, it } from "vitest";
import {
  AGING_LABELS,
  agingBand,
  daysApart,
  groupByAging,
} from "@/lib/finance/aging";

// ⚠️ ESTES TESTES EXISTEM PORQUE A ESCADA DE PRAZO ERRA POR UM DIA, EM SILÊNCIO.
// Se o que vence em 30 dias cair na faixa errada, o TOTAL continua batendo —
// nada se perde, só troca de coluna — e ninguém descobre. E é sobre essas
// colunas que se decide antecipar recebível e priorizar cobrança.

describe("agingBand — a faixa 'até N' inclui o dia N", () => {
  it("os limites de cada faixa", () => {
    expect(agingBand(0)).toBe(0);
    expect(agingBand(30)).toBe(0); // o dia 30 ainda é "até 30"
    expect(agingBand(31)).toBe(1); // e o 31 já é a faixa seguinte
    expect(agingBand(60)).toBe(1);
    expect(agingBand(61)).toBe(2);
    expect(agingBand(90)).toBe(2);
    expect(agingBand(91)).toBe(3); // "mais de 90"
    expect(agingBand(9999)).toBe(3);
  });

  it("nunca devolve faixa fora da lista de rótulos", () => {
    for (const d of [-5, 0, 1, 30, 31, 90, 91, 100000]) {
      const i = agingBand(d);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(AGING_LABELS.length);
    }
  });
});

describe("daysApart — data civil, sem o fuso da máquina", () => {
  it("conta dias inteiros", () => {
    expect(daysApart("2026-09-10", "2026-09-10")).toBe(0);
    expect(daysApart("2026-09-10", "2026-10-10")).toBe(30);
    expect(daysApart("2026-09-10", "2026-09-09")).toBe(-1);
  });

  it("atravessa a virada do ano e o mês de fevereiro", () => {
    expect(daysApart("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysApart("2028-02-28", "2028-03-01")).toBe(2); // 2028 é bissexto
    expect(daysApart("2026-02-28", "2026-03-01")).toBe(1);
  });

  it("aceita data com hora junto (usa só a parte da data)", () => {
    expect(daysApart("2026-09-10T23:00:00Z", "2026-09-11T01:00:00Z")).toBe(1);
  });
});

describe("groupByAging", () => {
  const itens = [
    { d: 5, v: 100 },
    { d: 30, v: 200 },
    { d: 31, v: 400 },
    { d: 90, v: 800 },
    { d: 91, v: 1600 },
  ];

  it("põe cada item na faixa certa", () => {
    const faixas = groupByAging(itens, (i) => i.d, (i) => i.v);
    expect(faixas[0]).toMatchObject({ cents: 300, quantidade: 2 }); // 5 e 30
    expect(faixas[1]).toMatchObject({ cents: 400, quantidade: 1 }); // 31
    expect(faixas[2]).toMatchObject({ cents: 800, quantidade: 1 }); // 90
    expect(faixas[3]).toMatchObject({ cents: 1600, quantidade: 1 }); // 91
  });

  it("A SOMA DAS FAIXAS É A SOMA DOS ITENS — é o que permite conferir a tela", () => {
    const faixas = groupByAging(itens, (i) => i.d, (i) => i.v);
    const total = itens.reduce((s, i) => s + i.v, 0);
    expect(faixas.reduce((s, f) => s + f.cents, 0)).toBe(total);
    expect(faixas.reduce((s, f) => s + f.quantidade, 0)).toBe(itens.length);
  });

  it("lista vazia devolve as quatro faixas zeradas, não uma lista vazia", () => {
    // A tela desenha as quatro colunas sempre; devolver menos faria a escada
    // mudar de forma conforme o movimento, e ninguém compararia dois meses.
    const faixas = groupByAging([], (i: { d: number }) => i.d, () => 0);
    expect(faixas).toHaveLength(AGING_LABELS.length);
    expect(faixas.every((f) => f.cents === 0 && f.quantidade === 0)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// A MESMA RÉGUA NOS DOIS LADOS — TypeScript e SQL.
//
// ⚠️ ESTE TESTE EXISTE PORQUE EU DUPLIQUEI UMA REGRA DE PROPÓSITO. A tela da
// UNIDADE agrupa por prazo em TypeScript (as funções acima); a tela da REDE
// agrupa no banco (`network_receivables`, migração 0254), porque roda sobre
// todas as unidades sem trazer parcela nenhuma para o aplicativo.
//
// Duas implementações da mesma régua é exatamente como elas passam a divergir —
// e a divergência aqui é invisível: o TOTAL continua batendo quando a faixa
// está errada, só troca de coluna. A unidade diria uma coisa e a rede outra
// sobre a mesma parcela, e ninguém descobriria.
//
// Então o teste LÊ O ARQUIVO DA MIGRAÇÃO e confere que os cortes são os mesmos.
// Mudar um lado sem o outro quebra o portão de entrega.
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { AGING_LIMITS } from "@/lib/finance/aging";

describe("as faixas do SQL batem com as do TypeScript", () => {
  const sql = readFileSync(
    "supabase/migrations/0254_recebiveis_da_rede.sql",
    "utf8"
  );

  it("a migração usa exatamente os mesmos cortes", () => {
    // Os cortes aparecem como `dias <= N` e `dias > N` nos filtros.
    const cortes = [
      ...new Set(
        [...sql.matchAll(/dias\s*(?:<=|>)\s*(\d+)/g)].map((m) => Number(m[1]))
      ),
    ].sort((a, b) => a - b);

    // ⚠️ RÉGUA VAZIA GRITA: se o padrão não achar corte nenhum, isto é "não
    // consegui medir", nunca "está tudo certo".
    expect(cortes.length).toBeGreaterThan(0);
    expect(cortes).toEqual([...AGING_LIMITS]);
  });

  it("a convenção 'até N inclui o dia N' vale no SQL também", () => {
    // No SQL, a primeira faixa é `dias <= 30` (inclui o 30) e a seguinte abre
    // em `dias > 30`. Se alguém trocasse para `dias < 30`, o dia 30 cairia na
    // faixa seguinte no banco e na primeira no TypeScript.
    for (const limite of AGING_LIMITS) {
      expect(sql).toContain(`dias <= ${limite}`);
      expect(sql).toContain(`dias > ${limite}`);
    }
  });
});
