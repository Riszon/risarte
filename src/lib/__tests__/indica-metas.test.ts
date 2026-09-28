import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  faixaAtingida,
  proximaFaixa,
  totaisDaFolha,
  validarFaixas,
  type Faixa,
  type PremioApurado,
} from "@/lib/indica/metas";

const SQL = readFileSync("supabase/migrations/2007_indica_campanhas_metas.sql", "utf8");

// As faixas padrão são as da CONFIGURAÇÃO (modelo 2025), lidas do SQL.
const m = /'metas_faixas_padrao',\s*'(\[[\s\S]*?\])',/.exec(SQL);
const PADRAO: Faixa[] = m ? JSON.parse(m[1]) : [];

describe("faixas padrão (modelo 2025, da configuração)", () => {
  it("a régua achou as faixas no SQL", () => {
    expect(PADRAO.length).toBe(4);
  });

  it("25/40/50/55 conversões; recepção R$ 500/1.000/1.500; demais voucher R$ 100/200/300", () => {
    expect(PADRAO.map((f) => f.gatilho)).toEqual([25, 40, 50, 55]);
    expect(PADRAO.slice(0, 3).map((f) => f.premios.recepcao_crc.valor_centavos)).toEqual([50000, 100000, 150000]);
    expect(PADRAO.slice(0, 3).map((f) => f.premios.demais)).toEqual([
      { tipo: "voucher", valor_centavos: 10000 },
      { tipo: "voucher", valor_centavos: 20000 },
      { tipo: "voucher", valor_centavos: 30000 },
    ]);
    expect(PADRAO[3].premios.recepcao_crc.descricao).toContain("experiência");
  });

  it("são válidas pela mesma régua da tela", () => {
    expect(validarFaixas(PADRAO)).toBeNull();
  });
});

describe("validarFaixas", () => {
  const f = (nome: string, gatilho: number): Faixa => ({
    nome,
    gatilho,
    premios: { recepcao_crc: { tipo: "dinheiro", valor_centavos: 100 }, demais: { tipo: "voucher", valor_centavos: 100 } },
  });
  it("recusa lista vazia, gatilho fora de ordem e nome repetido", () => {
    expect(validarFaixas([])).not.toBeNull();
    expect(validarFaixas([f("A", 10), f("B", 5)])).toContain("crescentes");
    expect(validarFaixas([f("A", 10), f("A", 20)])).toContain("repetida");
    expect(validarFaixas([f("A", 0)])).toContain("maior que zero");
  });
  it("recusa prêmio com valor quebrado", () => {
    const x = f("A", 10);
    x.premios.demais.valor_centavos = 10.5;
    expect(validarFaixas([x])).toContain("inválido");
  });
});

describe("faixa atingida e próxima", () => {
  it("a maior faixa alcançada (espelho do banco)", () => {
    expect(faixaAtingida(PADRAO, 24)).toBeNull();
    expect(faixaAtingida(PADRAO, 25)?.nome).toBe("Meta 1");
    expect(faixaAtingida(PADRAO, 52)?.nome).toBe("Super Meta");
    expect(faixaAtingida(PADRAO, 99)?.nome).toBe("Bônus");
  });
  it("quanto falta para a próxima", () => {
    expect(proximaFaixa(PADRAO, 30)).toEqual({ faixa: PADRAO[1], falta: 10 });
    expect(proximaFaixa(PADRAO, 55)).toBeNull();
  });
  it("o banco escolhe do mesmo jeito (maior gatilho <= valor)", () => {
    const corpo = SQL.slice(SQL.indexOf("function indica.apurar_meta"));
    expect(corpo).toMatch(/where \(f ->> 'gatilho'\)::numeric <= v_valor\s+order by \(f ->> 'gatilho'\)::numeric desc/);
  });
});

describe("relatório para a folha", () => {
  it("dinheiro separado de voucher e experiência", () => {
    const p = (grupo: "recepcao_crc" | "demais", tipo: "dinheiro" | "voucher" | "experiencia", v: number): PremioApurado => ({
      user_id: `${grupo}${tipo}${v}`, nome: "x", funcao: "x", grupo, premio: { tipo, valor_centavos: v },
    });
    expect(totaisDaFolha([p("recepcao_crc", "dinheiro", 50000), p("recepcao_crc", "dinheiro", 50000), p("demais", "voucher", 10000), p("demais", "experiencia", 0)]))
      .toEqual({ dinheiroCentavos: 100000, vouchers: 1, voucherCentavos: 10000, experiencias: 1 });
  });
});
