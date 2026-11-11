// AP139 (0394) — NA VENDA DIRETA, QUEM DIZ O PREÇO É O BANCO.
//
// Antes, `create_direct_sale_v2` gravava o preço, o benefício e o valor final
// que vinham da tela, e as tabelas da venda aceitavam UPDATE direto de quem
// lança venda. Esta régua prende as quatro peças do conserto. Provada
// devolvendo o defeito (ver o ESTADO, 0.425.0).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIG = "supabase/migrations";
const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const semComentario = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const arquivos = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const a0394 = arquivos.find((f) => f.startsWith("0394_"));
if (!a0394) throw new Error("NÃO MEDI: a 0394 não está na pasta");
const sql = semComentario(ler(join(MIG, a0394)));
const porta = sql.slice(sql.indexOf("create or replace function public.create_direct_sale_v2("));

describe("AP139 — a venda direta grava o preço do catálogo, não o da tela", () => {
  it("a porta lê o preço do catálogo e recusa o que vier diferente", () => {
    expect(porta).toContain("v_preco := coalesce(public.catalog_price_for(v_clinic, v_proc.id), 0);");
    expect(porta).toMatch(/if v_veio <> v_preco then\s+raise exception 'PRICE_MISMATCH';/);
  });

  it("a lista que a crua grava é a remontada pelo banco, nunca a da tela", () => {
    expect(porta).toContain("'unit_price_cents', v_preco,");
    expect(porta).toContain("'final_cents', v_linha - v_beneficio");
    expect(porta).toContain("'description', v_proc.name,");
    // A chamada final passa a lista REMONTADA (v_itens), não p_items.
    const fim = porta.slice(porta.lastIndexOf("return public._create_direct_sale_v2_raw("));
    expect(fim).toContain("v_itens, p_notes");
    expect(fim).not.toContain("p_items");
  });

  it("benefício só para cliente de programa e nunca maior que a linha", () => {
    expect(porta).toMatch(
      /if v_beneficio < 0 or v_beneficio > v_linha or \(v_beneficio > 0 and not v_programa\) then\s+raise exception 'PROGRAM_DISCOUNT_NOT_ALLOWED';/
    );
  });

  it("o procedimento segue a régua de quem pode lançar (a mesma do app)", () => {
    expect(porta).toMatch(/if v_proc\.id is null or not v_proc\.is_active or not v_proc\.livre or not \(/);
    expect(porta).toContain("or (v_recepcao and v_proc.recepcao)");
    expect(porta).toContain("or (v_sdr and v_proc.sdr)");
    const app = ler("src/lib/direct-sale.ts");
    expect(app).toContain('if (roles.includes("receptionist") && flags.reception) return true;');
    expect(app).toContain('if (roles.includes("sdr") && flags.sdr) return true;');
  });

  it("a crua não responde à API e as tabelas não têm escrita direta", () => {
    expect(sql).toMatch(
      /revoke execute on function public\._create_direct_sale_v2_raw\([^)]*\) from public, anon, authenticated;/
    );
    expect(sql).toContain("drop policy if exists direct_sales_write on public.direct_sales;");
    expect(sql).toContain("drop policy if exists direct_sale_items_write on public.direct_sale_items;");
    // Nenhuma migração DEPOIS da 0394 devolve a escrita direta.
    const depois = arquivos.filter((f) => f > a0394 && /^0\d{3}_/.test(f));
    for (const f of depois) {
      const s = semComentario(ler(join(MIG, f)));
      expect(s, f).not.toMatch(/create policy\s+\w+\s+on public\.direct_sale(s|_items)\s+for (all|insert|update|delete)/i);
    }
  });

  it("o app não grava nas tabelas da venda direta (só lê)", () => {
    const pastas = ["src/app", "src/lib"];
    const achados: string[] = [];
    const varrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__") varrer(p);
        } else if (/\.tsx?$/.test(e.name)) {
          const s = ler(p);
          const r = /\.from\("direct_sale(s|_items)"\)\s*\.(insert|update|upsert|delete)\(/g;
          if (r.test(s)) achados.push(p);
        }
      }
    };
    pastas.forEach(varrer);
    expect(achados).toEqual([]);
  });

  it("a tela traduz as recusas novas ANTES do NOT_ALLOWED genérico", () => {
    const acao = ler("src/app/(app)/prontuarios/[id]/direct-sale-actions.ts");
    const generico = acao.indexOf('if (m.includes("NOT_ALLOWED"))');
    for (const codigo of ["PRICE_MISMATCH", "PROCEDURE_NOT_ALLOWED", "PROGRAM_DISCOUNT_NOT_ALLOWED"]) {
      const i = acao.indexOf(`m.includes("${codigo}")`);
      expect(i, codigo).toBeGreaterThan(0);
      expect(i, codigo).toBeLessThan(generico);
    }
  });
});
