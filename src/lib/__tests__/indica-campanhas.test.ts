import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACOES_CAMPANHA,
  CAMPANHA_STATUS,
  acoesDaCampanha,
  lerRegras,
  marcosEmTexto,
  reducaoDeRegras,
  resumoPublico,
  resumoRegras,
  situacaoOrcamento,
  type CampanhaStatus,
} from "@/lib/indica/campanhas";

const SQL = readFileSync("supabase/migrations/2007_indica_campanhas_metas.sql", "utf8");
const vazio = { multiplicador: "", registro: "", comparecimento: "", fechamento: "", marcos: "" };

describe("situação da campanha — espelho de indica.mudar_campanha", () => {
  // Lê as transições do próprio SQL: se a porta mudar, este teste acusa.
  const corpo = SQL.slice(SQL.indexOf("function indica.mudar_campanha"));
  const permitidas = new Map<CampanhaStatus, Set<string>>();
  for (const m of corpo.matchAll(/when p_acao = '(\w+)' and c\.status (?:= '(\w+)'|in \(([^)]+)\))/g)) {
    const estados = m[2] ? [m[2]] : m[3].split(",").map((s) => s.trim().replace(/'/g, ""));
    for (const e of estados) {
      const s = permitidas.get(e as CampanhaStatus) ?? new Set<string>();
      s.add(m[1]);
      permitidas.set(e as CampanhaStatus, s);
    }
  }

  it("a régua achou as transições no SQL (zero = régua quebrada)", () => {
    expect(permitidas.size).toBeGreaterThan(3);
  });

  it.each(CAMPANHA_STATUS)("%s: a tela oferece exatamente o que o banco aceita", (status) => {
    expect(new Set(acoesDaCampanha(status))).toEqual(permitidas.get(status) ?? new Set());
  });

  it("toda ação da tela existe no banco", () => {
    for (const a of ACOES_CAMPANHA) expect(corpo).toContain(`p_acao = '${a}'`);
  });
});

describe("lerRegras", () => {
  it("multiplicador com vírgula, extras e marcos ordenados", () => {
    const r = lerRegras({ ...vazio, multiplicador: "1,5", comparecimento: "100", marcos: "5:600, 3:300" });
    expect(r).toEqual({
      ok: true,
      valor: { multiplicador: 1.5, pontos_extra: { comparecimento: 100 }, marcos: [{ conversoes: 3, bonus: 300 }, { conversoes: 5, bonus: 600 }] },
    });
  });

  it("campanha só amplia: multiplicador abaixo de 1 é recusado", () => {
    expect(lerRegras({ ...vazio, multiplicador: "0,8" }).ok).toBe(false);
  });

  it("campanha sem vantagem nenhuma é recusada", () => {
    expect(lerRegras(vazio).ok).toBe(false);
    expect(lerRegras({ ...vazio, multiplicador: "1" }).ok).toBe(false);
  });

  it("marco malformado ou repetido é recusado", () => {
    expect(lerRegras({ ...vazio, marcos: "3-300" }).ok).toBe(false);
    expect(lerRegras({ ...vazio, marcos: "3:300, 3:500" }).ok).toBe(false);
    expect(lerRegras({ ...vazio, registro: "-5" }).ok).toBe(false);
  });

  it("marcos voltam ao texto do formulário", () => {
    expect(marcosEmTexto([{ conversoes: 3, bonus: 300 }, { conversoes: 5, bonus: 600 }])).toBe("3:300, 5:600");
  });
});

describe("reducaoDeRegras — espelho de campanha_protege_regras", () => {
  it("aumentar passa; reduzir multiplicador ou extra acusa", () => {
    expect(reducaoDeRegras({ multiplicador: 1.5 }, { multiplicador: 2 })).toBeNull();
    expect(reducaoDeRegras({ multiplicador: 2 }, { multiplicador: 1.5 })).toBe("o multiplicador");
    expect(reducaoDeRegras({ pontos_extra: { registro: 50 } }, {})).toContain("registro");
  });

  it("o SQL também confere multiplicador e as três etapas", () => {
    const corpo = SQL.slice(SQL.indexOf("function indica.campanha_protege_regras"));
    expect(corpo).toContain("'multiplicador'");
    expect(corpo).toContain("array['registro', 'comparecimento', 'fechamento']");
  });
});

describe("resumos", () => {
  it("regras em frases, sem somar multiplicadores", () => {
    const l = resumoRegras({ multiplicador: 2, marcos: [{ conversoes: 3, bonus: 300 }] });
    expect(l[0]).toContain("×2");
    expect(l[0]).toContain("vale o maior");
    expect(l[1]).toBe("Bônus de 300 na 3ª conversão na campanha");
    expect(resumoRegras({})).toEqual(["Sem vantagem definida"]);
  });

  it("público vazio = todos; segmentos com nomes", () => {
    expect(resumoPublico({})).toBe("Todos os Embaixadores");
    const s = resumoPublico(
      { niveis: ["ouro"], especialidades: ["Implante"], empresas: ["e1"] },
      { niveis: new Map([["ouro", "Embaixador Ouro"]]), empresas: new Map([["e1", "Acme"]]) }
    );
    expect(s).toBe("níveis: Embaixador Ouro · tratamento em: Implante · empresas: Acme");
  });
});

describe("situacaoOrcamento", () => {
  it("sem orçamento, ok, alerta no % configurado e esgotado em 100%", () => {
    expect(situacaoOrcamento(null, 80)).toBe("sem_orcamento");
    expect(situacaoOrcamento(79.9, 80)).toBe("ok");
    expect(situacaoOrcamento(80, 80)).toBe("alerta");
    expect(situacaoOrcamento(100, 80)).toBe("esgotado");
  });
});
