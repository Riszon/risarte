import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  REGRA_FRAUDE_LABEL,
  descreverAlerta,
  paraCsv,
  perdaEntre,
  reaisCsv,
  variacao,
} from "@/lib/indica/painel";

const SQL = readFileSync("supabase/migrations/2008_indica_painel_antifraude_relatorios.sql", "utf8");

describe("variacao", () => {
  it("sobe e melhora; custo subindo piora", () => {
    expect(variacao(12, 10)).toEqual({ percentual: 20, melhorou: true });
    expect(variacao(12, 10, true)).toEqual({ percentual: 20, melhorou: false });
    expect(variacao(8, 10, true)).toEqual({ percentual: -20, melhorou: true });
  });
  it("sem base não inventa percentual", () => {
    expect(variacao(5, 0)).toEqual({ percentual: null, melhorou: true });
    expect(variacao(null, 3)).toEqual({ percentual: null, melhorou: null });
    expect(variacao(0, 0)).toEqual({ percentual: null, melhorou: null });
  });
});

describe("perdaEntre", () => {
  it("perda em % entre etapas", () => {
    expect(perdaEntre(10, 7)).toBe(30);
    expect(perdaEntre(0, 0)).toBeNull();
  });
});

describe("regras antifraude — espelho do banco", () => {
  // Cada regra que o SQL grava ('regra', ...) precisa de rótulo na tela.
  const regras = [...SQL.matchAll(/select '(\w+):' \|\|[^,]+, '(\w+)',/g)].map((m) => m[2]);
  it("a régua achou as regras no SQL (zero = régua quebrada)", () => {
    expect(regras.length).toBe(7);
  });
  it.each(regras)("%s tem rótulo e descrição", (r) => {
    expect(REGRA_FRAUDE_LABEL[r]).toBeTruthy();
    expect(descreverAlerta(r, {})).not.toBe("");
  });
  it("as severidades padrão cobrem todas as regras", () => {
    const m = /'fraude_severidades',\s*'(\{[^']+\})'/.exec(SQL);
    const sev = m ? JSON.parse(m[1]) : {};
    expect(Object.keys(sev).sort()).toEqual([...regras].sort());
  });
});

describe("paraCsv", () => {
  it("separador ;, BOM, aspas quando preciso", () => {
    const csv = paraCsv(["a", "b"], [["x;y", 'dis"se'], [1, null]]);
    expect(csv.startsWith("﻿a;b\r\n")).toBe(true);
    expect(csv).toContain('"x;y";"dis""se"');
    expect(csv).toContain("1;\r\n");
  });
  it("neutraliza fórmula injetada", () => {
    expect(paraCsv(["n"], [["=HYPERLINK(1)"]])).toContain("'=HYPERLINK(1)");
  });
  it("reais com vírgula", () => {
    expect(reaisCsv(123456)).toBe("1234,56");
    expect(reaisCsv(null)).toBe("");
  });
});

describe("retornoPct", () => {
  it("retorno em % com sinal", async () => {
    const { retornoPct } = await import("@/lib/indica/painel");
    expect(retornoPct(-1)).toBe("-100%");
    expect(retornoPct(3)).toBe("+300%");
    expect(retornoPct(null)).toBe("—");
  });
});
