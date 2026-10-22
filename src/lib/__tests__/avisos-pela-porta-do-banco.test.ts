import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// AP58 (22/10/2026): a tabela `notifications` não tem regra de GRAVAR, de
// propósito — aviso nasce dentro de função do banco. Duas ações gravavam
// direto da tela, sem conferir o erro, e o banco recusava em silêncio: o
// motivo da devolução ao Coordenador e o aviso de adesão ao PPR+ nunca
// chegaram. A 0316 trouxe as duas portas; esta régua impede a terceira.

const SRC = join(__dirname, "..", "..");

/** Gravações diretas na tabela de avisos: `.from("notifications")` seguido de insert/upsert. */
export function gravacoesDiretas(texto: string): number {
  const t = texto.replace(/\s+/g, " ");
  return (t.match(/\.from\(\s*["']notifications["']\s*\)\s*\.(insert|upsert)\(/g) ?? []).length;
}

describe("aviso só nasce pela porta do banco", () => {
  it("a régua pega a gravação direta, inclusive quebrada em linhas", () => {
    expect(gravacoesDiretas(`await supabase.from("notifications").insert(avisos)`)).toBe(1);
    expect(gravacoesDiretas(`supabase\n  .from("notifications")\n  .upsert({})`)).toBe(1);
    expect(gravacoesDiretas(`supabase.from("notifications").select("id")`)).toBe(0);
    expect(gravacoesDiretas(`supabase.from("notifications").update({ read_at })`)).toBe(0);
  });

  it("nenhum arquivo do sistema grava aviso direto na tabela", () => {
    const achados: string[] = [];
    let arquivos = 0;
    const varrer = (dir: string) => {
      for (const nome of readdirSync(join(SRC, dir))) {
        const rel = `${dir}/${nome}`;
        if (nome === "__tests__" || nome === "node_modules") continue;
        if (statSync(join(SRC, rel)).isDirectory()) varrer(rel);
        else if (/\.(ts|tsx)$/.test(nome)) {
          arquivos++;
          if (gravacoesDiretas(readFileSync(join(SRC, rel), "utf8")) > 0) achados.push(rel);
        }
      }
    };
    varrer("app");
    varrer("components");
    varrer("lib");
    // Régua que não achou arquivo nenhum não mediu nada.
    expect(arquivos).toBeGreaterThan(100);
    expect(achados).toEqual([]);
  });

  it("as duas ações usam as portas da 0316 e conferem o erro", () => {
    const jornada = readFileSync(join(SRC, "app/(app)/jornada/actions.ts"), "utf8");
    const ppr = readFileSync(join(SRC, "app/(app)/ppr/actions.ts"), "utf8");
    expect(jornada).toMatch(/rpc\("notify_case_returned"/);
    expect(jornada).toMatch(/error: avisoErro \} = await supabase\.rpc\("notify_case_returned"/);
    expect(ppr).toMatch(/"notify_ppr_membership_created"/);
    expect(ppr).toMatch(/error: avisoErro \} = await supabase\.rpc\(\s*"notify_ppr_membership_created"/);
  });
});
