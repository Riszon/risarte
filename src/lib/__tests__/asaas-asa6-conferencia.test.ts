// ASA6 (4021a) — a conferência das taxas (spec 20.17). O banco é provado no ensaio
// (scripts/asaas-ensaio-asa6-conferencia.mjs, quebrado de propósito).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/4021a_asa6_conferencia_das_taxas.sql", "utf8");
const TELA = readFileSync("src/app/(app)/financeiro/cobranca-da-rede/page.tsx", "utf8");
const ROTA = readFileSync("src/app/api/cron/gateway-cobrancas/route.ts", "utf8");

describe("a conferência só confere e mostra (20.17)", () => {
  it("não lança, não paga e não dispensa nada", () => {
    expect(SQL).not.toMatch(/insert into public\.financial_entries|update public\.(payables|financial_entries|split_charges|charge_splits)/i);
  });
  it("parte do 1º mês da cobrança mensal de cada unidade, sem mês fixo", () => {
    expect(SQL).toContain("if cfg.monthly_from is null then return; end if;");
    expect(SQL).not.toMatch(/'2026-1[12]-01'/);
  });
  it("ignorar: só Financeiro ou Admin, com motivo; reabre se o valor mudar", () => {
    expect(SQL).toContain("if not public._franchise_can_manage() then raise exception 'NOT_ALLOWED'; end if;");
    expect(SQL).toContain("elsif r.status = 'ignorada' and r.ignored_amount_cents is distinct from f.amount_cents then");
  });
  it("o split a mais usa a tolerância da Central; a conta, tolerância zero", () => {
    expect(SQL).toContain("cs.excess_cents > v_tol");
    expect(SQL).toContain("if (v_acc->>'diferenca')::bigint <> 0 then");
  });
  it("o resumo do dia só com divergência nova, e a rotina no cron", () => {
    expect(SQL).toContain("if v_new > 0 and (select notified_at from public.reconciliation_runs where run_on = public.today_br()) is null then");
    expect(ROTA).toContain('admin.rpc("_franchise_reconcile_run")');
  });
  it("a aba se chama Conferência das taxas", () => {
    expect(TELA).toContain('"Conferência das taxas"');
  });
});
