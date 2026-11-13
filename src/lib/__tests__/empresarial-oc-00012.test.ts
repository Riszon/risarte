import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isOpenStage } from "@/lib/empresarial/funnel";

// OC-00012 (13/11/2026, produção): o Painel do programa somava no "Funil
// aberto" a empresa já em Implantação; e o início do contrato (base da
// carência da empresa) só era preenchido à mão.

const ler = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("OC-00012 — os dois painéis com a mesma regra de 'em aberto'", () => {
  it("Implantação, ganho e perda não estão em aberto", () => {
    expect(isOpenStage("IMPLEMENTATION")).toBe(false);
    expect(isOpenStage("CLOSED_WON")).toBe(false);
    expect(isOpenStage("CLOSED_LOST")).toBe(false);
    expect(isOpenStage("PRESENTED")).toBe(true);
  });

  it("o Painel do programa e o Painel do funil usam isOpenStage (régua)", () => {
    for (const f of [
      ["src", "app", "(app)", "empresarial", "painel", "page.tsx"],
      ["src", "app", "(app)", "empresarial", "funil", "painel", "page.tsx"],
    ]) {
      const t = ler(...f);
      expect(t).toMatch(/isOpenStage\(l\.stage\)/);
      expect(t).not.toMatch(/l\.stage !== "CLOSED_WON" && l\.stage !== "CLOSED_LOST"\)/);
    }
  });
});

describe("OC-00012 — o início do contrato nasce no 1º pagamento (1044)", () => {
  const sql = ler("supabase", "migrations", "1044_inicio_do_contrato_no_primeiro_pagamento.sql");
  it("o gatilho preenche só o que está vazio, com o dia do Brasil", () => {
    expect(sql).toMatch(/after insert or update of status, paid_at on empresarial\.adhesion_billing/);
    expect(sql).toMatch(/\(new\.paid_at at time zone 'America\/Sao_Paulo'\)::date/);
    expect(sql).toMatch(/and contract_started_at is null;/);
  });
  it("é blindado (a baixa nunca cai por causa dele) e não executa sem login", () => {
    expect(sql).toMatch(/exception when others then\s+raise warning/);
    expect(sql).toContain("revoke execute on function empresarial.billing_starts_contract() from public, anon, authenticated;");
  });
});
