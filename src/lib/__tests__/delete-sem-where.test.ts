import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// OC-00103 e AP48 (16/10/2026): a API do Supabase carrega o `safeupdate`, que
// RECUSA DELETE/UPDATE sem WHERE ("DELETE requires a WHERE clause") — também
// dentro de função `security definer`. No SQL Editor e na conexão direta dos
// testes ele não está carregado: a função passa em toda prova e quebra na
// tela. Assim pararam a importação do extrato (0196 → 0298) e o grupo do teste
// coletivo (0272 → 0299).
//
// A Regra 10 do `check-migrations` olha a migração NOVA. Esta régua olha o
// sistema inteiro: a versão MAIS RECENTE de cada função, em todas as
// migrações das três faixas. Esvaziar a tabela inteira é `where true`.

const PASTA = join(__dirname, "..", "..", "..", "supabase", "migrations");

/** Corpo de cada função, pela última migração que a (re)cria. */
function ultimasDefinicoes(): Map<string, { arquivo: string; corpo: string }> {
  const defs = new Map<string, { arquivo: string; corpo: string }>();
  const arquivos = readdirSync(PASTA).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const FN =
    /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\2/gi;
  for (const arquivo of arquivos) {
    const sql = readFileSync(join(PASTA, arquivo), "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    for (const m of sql.matchAll(FN)) {
      const nome = m[1].toLowerCase().replace(/"/g, "");
      defs.set(nome.includes(".") ? nome : `public.${nome}`, { arquivo, corpo: m[3] });
    }
  }
  return defs;
}

/** Os comandos DELETE/UPDATE sem WHERE de um corpo (a mesma regra da Regra 10). */
function semWhere(corpo: string): string[] {
  const achados: string[] = [];
  const semTextos = corpo
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
  for (const comando of semTextos.split(";")) {
    const c = comando.replace(/\s+/g, " ");
    const m = c.match(/\b(delete\s+from|update)\s+(?:only\s+)?([\w."]+)/i);
    if (!m || m.index === undefined) continue;
    const resto = c.slice(m.index);
    if (/^update/i.test(m[1])) {
      if (!/\bset\b/i.test(resto)) continue;
      if (/\bdo\s*$/i.test(c.slice(0, m.index))) continue;
    }
    if (/\bwhere\b/i.test(resto)) continue;
    achados.push(resto.trim().slice(0, 70));
  }
  return achados;
}

describe("nenhuma função tem DELETE/UPDATE sem WHERE (a API recusaria)", () => {
  const defs = ultimasDefinicoes();

  it("a leitura das migrações acha as funções (régua que não acha nada grita)", () => {
    expect(defs.size).toBeGreaterThan(400);
    expect(defs.get("public.import_bank_transactions")?.arquivo).toMatch(/^0298_/);
    expect(defs.get("public.save_training_cohort")?.arquivo).toMatch(/^0299_/);
  });

  it("a detecção reconhece o defeito e deixa passar o que a API aceita", () => {
    expect(semWhere("begin delete from tmp_import_keys; end")).toHaveLength(1);
    expect(semWhere("update public.x set a = 1;")).toHaveLength(1);
    expect(semWhere("delete from tmp_import_keys where true;")).toHaveLength(0);
    expect(semWhere("insert into x values (1) on conflict (id) do update set a = 1;")).toHaveLength(0);
    expect(semWhere("select 1 from x for update;")).toHaveLength(0);
    expect(semWhere("update x set msg = 'a; b' where id = 1;")).toHaveLength(0);
  });

  it("a versão mais recente de cada função declara o alcance", () => {
    const ruins: string[] = [];
    for (const [nome, { arquivo, corpo }] of defs) {
      for (const cmd of semWhere(corpo)) ruins.push(`${nome} (${arquivo}): ${cmd}`);
    }
    expect(ruins).toEqual([]);
  });
});
