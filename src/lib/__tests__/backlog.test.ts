import { describe, expect, it } from "vitest";
import {
  FILTRO_INICIAL,
  contar,
  filtrar,
  ordenar,
  valorDoEvento,
  mensagemDoErro,
  type ItemDoBacklog,
} from "@/lib/backlog";

function item(code: string, extra: Partial<ItemDoBacklog> = {}): ItemDoBacklog {
  return {
    code,
    title: `Título de ${code}`,
    category: "Defeito",
    categoryId: "c1",
    module: null,
    priority: "media",
    status: "aberto",
    origin: "sessao",
    foundOn: "2026-11-01",
    resolvedAt: null,
    resolvedVersion: null,
    updatedAt: "2026-11-01T12:00:00Z",
    ...extra,
  };
}

const itens = [
  item("AP10", { priority: "baixa" }),
  item("AP2", { priority: "urgente" }),
  item("AP30", { priority: "urgente" }),
  item("AP4", { status: "aguardando_dono", priority: "alta", categoryId: "c2", category: "Decisão do dono" }),
  item("AP5", { status: "resolvido", resolvedAt: "2026-10-01T10:00:00Z" }),
  item("AP6", { status: "descartado", resolvedAt: "2026-11-02T10:00:00Z" }),
  item("AP7", { status: "em_andamento", module: "agenda" }),
];

describe("backlog na tela", () => {
  it("conta abertos (inclui aguardando e em andamento) e resolvidos (inclui descartados)", () => {
    const c = contar(itens);
    expect(c.abertos).toBe(5);
    expect(c.resolvidos).toBe(2);
    expect(c.todos).toBe(7);
    expect(c.aguardandoDono).toBe(1);
    expect(c.porPrioridade).toEqual({ urgente: 2, alta: 1, media: 1, baixa: 1 });
  });

  it("abas: abertos, resolvidos e todos", () => {
    expect(filtrar(itens, FILTRO_INICIAL).map((i) => i.code).sort()).toEqual(["AP10", "AP2", "AP30", "AP4", "AP7"]);
    expect(filtrar(itens, { ...FILTRO_INICIAL, aba: "resolvidos" }).map((i) => i.code).sort()).toEqual(["AP5", "AP6"]);
    expect(filtrar(itens, { ...FILTRO_INICIAL, aba: "todos" })).toHaveLength(7);
  });

  it("filtros somam: categoria, prioridade, módulo, situação e busca", () => {
    expect(filtrar(itens, { ...FILTRO_INICIAL, categoria: "c2" }).map((i) => i.code)).toEqual(["AP4"]);
    expect(filtrar(itens, { ...FILTRO_INICIAL, prioridade: "urgente" })).toHaveLength(2);
    expect(filtrar(itens, { ...FILTRO_INICIAL, modulo: "agenda" }).map((i) => i.code)).toEqual(["AP7"]);
    expect(filtrar(itens, { ...FILTRO_INICIAL, situacao: "aguardando_dono" }).map((i) => i.code)).toEqual(["AP4"]);
    expect(filtrar(itens, { ...FILTRO_INICIAL, busca: "ap30" }).map((i) => i.code)).toEqual(["AP30"]);
    expect(filtrar(itens, { ...FILTRO_INICIAL, busca: "decisao" }).map((i) => i.code)).toEqual(["AP4"]);
  });

  it("ordem: abertos por prioridade e número (AP2 antes de AP10); fechados do mais recente", () => {
    expect(ordenar(itens).map((i) => i.code)).toEqual(["AP2", "AP30", "AP4", "AP7", "AP10", "AP6", "AP5"]);
  });

  it("linha do tempo e erros em português", () => {
    expect(valorDoEvento("prioridade", "urgente")).toBe("Urgente");
    expect(valorDoEvento("situacao", "aguardando_dono")).toBe("Aguardando você");
    expect(valorDoEvento("categoria", "Defeito")).toBe("Defeito");
    expect(mensagemDoErro("NOT_ALLOWED")).toMatch(/Admin Master/);
    expect(mensagemDoErro("CATEGORY_EXISTS")).toMatch(/Já existe/);
  });
});
