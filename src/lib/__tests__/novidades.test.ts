import { describe, expect, it } from "vitest";
import {
  anosDasNovidades,
  filtrarNovidades,
  paginarNovidades,
  type Versao,
} from "../changelog";

const versoes: Versao[] = [
  {
    versao: "0.3.0",
    data: "2026-09-19",
    migracao: "0263",
    titulo: "Boas-vindas no primeiro login",
    mudancas: [
      { tipo: "novidade", texto: "Quem entra pela primeira vez é recebido.", papeis: "todos" },
      { tipo: "correcao", texto: "O estoque parava de contar.", papeis: ["unit_manager"] },
    ],
  },
  {
    versao: "0.2.0",
    data: "2026-08-10",
    migracao: null,
    titulo: "Agenda por semana",
    mudancas: [{ tipo: "melhoria", texto: "A agenda ganhou a visão de semana.", papeis: "todos" }],
  },
  {
    versao: "0.1.0",
    data: "2025-12-01",
    migracao: null,
    titulo: "Primeira entrega",
    mudancas: [{ tipo: "aviso", texto: "Atenção ao novo fluxo de correção.", papeis: "todos" }],
  },
];

describe("anosDasNovidades", () => {
  it("lista os anos, do mais novo para o mais velho, sem repetir", () => {
    expect(anosDasNovidades(versoes)).toEqual(["2026", "2025"]);
  });
});

describe("filtrarNovidades", () => {
  it("sem filtro, devolve tudo", () => {
    expect(filtrarNovidades(versoes, {})).toHaveLength(3);
  });

  it("a busca ignora acento e caixa", () => {
    const r = filtrarNovidades(versoes, { busca: "CORRECAO" });
    // Acha o "correção" do aviso de 2025 — e não a entrega inteira de 2026.
    expect(r.map((v) => v.versao)).toEqual(["0.1.0"]);
  });

  it("a busca deixa na entrega só as linhas que casam", () => {
    const r = filtrarNovidades(versoes, { busca: "estoque" });
    expect(r).toHaveLength(1);
    expect(r[0].mudancas).toHaveLength(1);
    expect(r[0].mudancas[0].tipo).toBe("correcao");
  });

  it("a busca também olha o título da entrega", () => {
    expect(filtrarNovidades(versoes, { busca: "agenda" }).map((v) => v.versao)).toEqual(["0.2.0"]);
  });

  it("filtra por tipo", () => {
    expect(filtrarNovidades(versoes, { tipo: "melhoria" }).map((v) => v.versao)).toEqual(["0.2.0"]);
  });

  it("filtra por ano", () => {
    expect(filtrarNovidades(versoes, { ano: "2025" }).map((v) => v.versao)).toEqual(["0.1.0"]);
  });

  it("combina os filtros e devolve vazio quando nada casa", () => {
    expect(filtrarNovidades(versoes, { tipo: "novidade", ano: "2025" })).toEqual([]);
  });
});

describe("paginarNovidades", () => {
  it("corta a página pedida e conta o total", () => {
    const p = paginarNovidades(versoes, 2, 2);
    expect(p.versoes.map((v) => v.versao)).toEqual(["0.1.0"]);
    expect(p).toMatchObject({ pagina: 2, totalDePaginas: 2, total: 3 });
  });

  it("página fora do intervalo volta para a mais próxima, nunca em branco", () => {
    expect(paginarNovidades(versoes, 99, 2).pagina).toBe(2);
    expect(paginarNovidades(versoes, 0, 2).pagina).toBe(1);
    expect(paginarNovidades(versoes, Number.NaN, 2).pagina).toBe(1);
  });

  it("lista vazia continua tendo uma página", () => {
    expect(paginarNovidades([], 1, 10)).toMatchObject({ pagina: 1, totalDePaginas: 1, total: 0 });
  });
});
