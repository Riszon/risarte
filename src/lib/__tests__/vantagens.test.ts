import { describe, expect, it } from "vitest";
import {
  aplicarVantagensDoGrupo,
  limparDetalhe,
  problemasDasVantagens,
  resumoDosCompromissos,
  textoDaVantagem,
} from "@/lib/empresarial/vantagens";

/** AS OUTRAS VANTAGENS DO PROGRAMA (1033, dono em 26/10/2026). */

describe("o texto da vantagem", () => {
  it("o detalhe da empresa vem depois do nome", () => {
    expect(textoDaVantagem("Palestras na empresa", "2 por ano", "Palestras de saúde")).toBe(
      "Palestras na empresa — 2 por ano"
    );
  });
  it("sem detalhe, vale a descrição da rede; sem as duas, só o nome", () => {
    expect(textoDaVantagem("Palestras", "  ", "Palestras de saúde")).toBe(
      "Palestras — Palestras de saúde"
    );
    expect(textoDaVantagem("Palestras", null, null)).toBe("Palestras");
  });
  it("espaço em branco não é detalhe", () => {
    expect(limparDetalhe("   ")).toBeNull();
    expect(limparDetalhe(" x ")).toBe("x");
  });
});

describe("inserir as vantagens de um grupo", () => {
  it("o grupo troca o detalhe da mesma vantagem e mantém o resto", () => {
    const r = aplicarVantagensDoGrupo(
      [
        { perkId: "a", detail: "combinado à parte" },
        { perkId: "b", detail: null },
      ],
      [
        { perkId: "a", detail: "do grupo" },
        { perkId: "c", detail: " 1 por semestre " },
      ]
    );
    expect(r.lista).toEqual([
      { perkId: "a", detail: "do grupo" },
      { perkId: "b", detail: null },
      { perkId: "c", detail: "1 por semestre" },
    ]);
    expect(r.incluidas).toBe(1);
    expect(r.trocadas).toBe(1);
  });
});

describe("o que impede salvar", () => {
  it("a mesma vantagem duas vezes e detalhe gigante", () => {
    expect(
      problemasDasVantagens([
        { perkId: "a", detail: null },
        { perkId: "a", detail: "x".repeat(501) },
      ])
    ).toHaveLength(2);
    expect(problemasDasVantagens([{ perkId: "a", detail: "ok" }])).toEqual([]);
  });
});

describe("o resumo dos compromissos", () => {
  it("conta só o que existe", () => {
    expect(
      resumoDosCompromissos([
        { status: "DELIVERED" },
        { status: "DELIVERED" },
        { status: "PENDING" },
      ])
    ).toBe("2 entregues · 1 pendente");
    expect(resumoDosCompromissos([])).toBe("nenhuma vantagem combinada");
  });
});
