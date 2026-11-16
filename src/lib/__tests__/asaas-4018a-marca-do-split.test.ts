// 4018a — a marca do "split a mais" (spec 20.17.9). O banco é provado no ensaio
// (scripts/asaas-ensaio-4018a-marca-do-split.mjs, quebrado com a regra antiga).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/4018a_asa3_marca_do_split_a_mais.sql", "utf8");

describe("4018a: a marca do split a mais", () => {
  it("sem linha de taxa ligada, a conferência espera", () => {
    expect(SQL).toContain("if not exists (select 1 from public.split_charges where charge_id = c.id) then return; end if;");
  });
  it("a marca é sempre recalculada, e o aviso só acima da tolerância", () => {
    expect(SQL).toContain("v_excess := greatest(w.settled_cents - w.expected, 0);");
    expect(SQL).toContain("if v_excess > v_tol and w.excess_cents is distinct from v_excess then");
    expect(SQL).not.toContain("if w.settled_cents > w.expected and w.excess_cents is distinct from");
  });
  it("as marcas antigas são recalculadas, só a coluna da marca", () => {
    const tail = SQL.slice(SQL.lastIndexOf("-- As marcas que já existem"));
    expect(tail).toContain("set excess_cents = greatest(cs.settled_cents - d.devido, 0)");
    expect(tail).not.toMatch(/update public\.(split_charges|payables|financial_entries)/);
  });
});
