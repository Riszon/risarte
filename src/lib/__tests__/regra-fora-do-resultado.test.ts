import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PREFIXOS_FORA_DO_RESULTADO,
  atividadeDoCaixa,
  contaForaDoResultado,
} from "@/lib/finance/regra-do-resultado";

// RÉGUA DA FASE 3 (D5 e ajuste 4 do dono, 13/11/2026): a regra "fora do
// resultado" mora num lugar só. O ensaio no banco (`scripts/dividas-ensaio-
// 0406.mjs`) prova que os indicadores não mudam; esta régua prende o código.

const DIR = "supabase/migrations";
const SQL = readFileSync(join(DIR, "0406_dividas_contas_a_pagar.sql"), "utf8").replace(/\r\n/g, "\n");
const funcao = (nome: string) => {
  const i = SQL.indexOf(`create or replace function public.${nome}(`);
  return SQL.slice(i, SQL.indexOf("$$;", SQL.indexOf("as $$", i)) + 3);
};

describe("a regra única — código e banco iguais", () => {
  it("os prefixos do TypeScript são os da função do banco", () => {
    const corpo = funcao("account_outside_result");
    const doBanco = [...corpo.matchAll(/like '([\d.]+)%'/g)].map((m) => m[1]).sort();
    expect(doBanco).toEqual([...PREFIXOS_FORA_DO_RESULTADO].sort());
  });

  it("dívidas (5.5) estão fora do resultado; custas (3.3.05) e descontos obtidos (4.1.03) dentro", () => {
    expect(contaForaDoResultado("5.5.01")).toBe(true);
    expect(contaForaDoResultado("5.5.02")).toBe(true);
    expect(contaForaDoResultado("5.3.01")).toBe(true);
    expect(contaForaDoResultado("6.2.01")).toBe(true);
    expect(contaForaDoResultado("5.2.01")).toBe(false); // depreciação entra
    expect(contaForaDoResultado("3.3.05")).toBe(false);
    expect(contaForaDoResultado("4.1.03")).toBe(false);
    expect(contaForaDoResultado(null)).toBe(false);
  });

  it("a atividade do caixa é a do banco, com as dívidas em linha própria", () => {
    const corpo = funcao("account_cash_activity");
    expect(corpo).toMatch(/like '5\.5%' then 'dividas'/);
    expect(atividadeDoCaixa("5.5.01")).toBe("dividas");
    expect(atividadeDoCaixa("5.3.01")).toBe("financiamento");
    expect(atividadeDoCaixa("5.1.01")).toBe("investimento");
    expect(atividadeDoCaixa("6.3.01")).toBe("investimento");
    expect(atividadeDoCaixa("2.1.01")).toBe("operacional");
  });
});

describe("ninguém volta a filtrar prefixo por conta própria", () => {
  it("as 9 funções leitoras da 0406 chamam a regra única e não têm mais o trecho repetido", () => {
    const nomes = ["_dre_lines_raw", "breakeven_lines_raw", "profit_cash_bridge", "budget_vs_actual",
      "fill_budget_from_actual", "consolidated_dre", "network_units_summary", "clinic_fixed_costs_by_month"];
    for (const n of nomes) {
      const i = SQL.toLowerCase().indexOf(`create or replace function public.${n.toLowerCase()}`);
      expect(i, n).toBeGreaterThan(0);
      const trecho = SQL.slice(i, SQL.indexOf("\n-- ", i + 10) > 0 ? SQL.indexOf("\n-- ", i + 10) : undefined);
      expect(trecho, n).toMatch(/not public\.account_outside_result\(e\.account_code\)/);
      expect(trecho, n).not.toMatch(/not like '5\.[1345]%'/);
    }
    expect(SQL).toMatch(/public\.account_cash_activity\(e\.account_code\)/);
    expect(SQL).toMatch(/public\.account_cash_activity\(p\.account_code\)/);
  });

  it("migração depois da 0406 não repete a lista de prefixos (usa account_outside_result)", () => {
    const depois = readdirSync(DIR).filter((f) => /^0\d{3}_/.test(f) && f > "0406");
    for (const f of depois) {
      const s = readFileSync(join(DIR, f), "utf8");
      expect(s, f).not.toMatch(/account_code\s+not\s+like\s+'(6|5\.[1345])%'/i);
    }
  });

  it("o código das telas não decide 'fora da DRE' por prefixo (só a regra e os rótulos da ponte)", () => {
    const permitidos = new Set(["regra-do-resultado.ts", "bridge.ts"]);
    const varrer = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? varrer(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []
      );
    const arquivos = [...varrer("src/lib/finance"), ...varrer("src/app/(app)/financeiro")];
    const culpados = arquivos.filter((a) => {
      if (permitidos.has(a.split(/[\\/]/).pop()!)) return false;
      return /startsWith\(\s*["'](5\.[1345]|6)["']\s*\)/.test(readFileSync(a, "utf8"));
    });
    expect(culpados).toEqual([]);
  });

  it("a ponte lucro × caixa nomeia o pagamento de dívida antiga (nada cai em 'outros')", () => {
    const ponte = readFileSync("src/lib/finance/bridge.ts", "utf8");
    expect(ponte).toMatch(/startsWith\("5\.5"\)/);
  });
});
