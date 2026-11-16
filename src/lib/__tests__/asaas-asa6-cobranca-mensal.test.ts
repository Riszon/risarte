// ASA6 (4021) — a cobrança mensal da rede (spec 20 e 20.15). O banco é provado no
// ensaio (scripts/asaas-ensaio-asa6-cobranca-mensal.mjs, quebrado de propósito) e
// o Asaas no sandbox (asaas-asa6-cobranca-mensal.integracao.test.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planilhaDoLote, podeVerCobrancaDaRede, resumoDoLote, type ItemDoLote, type LoteLido } from "@/lib/finance/cobranca-da-rede";
import type { SessionContext } from "@/lib/auth";

const SQL = readFileSync("supabase/migrations/4021_asa6_cobranca_mensal_das_unidades.sql", "utf8");
const ROTA = readFileSync("src/app/api/cron/gateway-cobrancas/route.ts", "utf8");
const SERVIDOR = readFileSync("src/lib/asaas/cobranca-mensal.ts", "utf8");
const ACOES = readFileSync("src/app/(app)/financeiro/cobranca-da-rede/actions.ts", "utf8");

const sessao = (papeis: string[], admin = false) =>
  ({ isAdminMaster: admin, rolesByClinic: { u1: papeis } }) as unknown as SessionContext;

describe("quem vê (20.15.5)", () => {
  it("Gerente, franqueado, Financeiro da Franqueadora e Admin veem", () => {
    expect(podeVerCobrancaDaRede(sessao(["unit_manager"]))).toBe(true);
    expect(podeVerCobrancaDaRede(sessao(["franchisee"]))).toBe(true);
    expect(podeVerCobrancaDaRede(sessao(["finance_franchisor"]))).toBe(true);
    expect(podeVerCobrancaDaRede(sessao([], true))).toBe(true);
  });
  it("Dentista, Planner, ASB, TSB, SDR e Recepcionista não veem", () => {
    for (const p of ["dentist", "planner_dentist", "asb", "tsb", "sdr", "receptionist"]) {
      expect(podeVerCobrancaDaRede(sessao([p]))).toBe(false);
    }
  });
  it("o banco confere de novo: só Gerente e franqueado na unidade, e as tabelas sem leitura direta", () => {
    expect(SQL).toContain("public.has_role_in_clinic(p_clinic_id, array['unit_manager', 'franchisee']::public.user_role[])");
    expect(SQL).not.toMatch(/create policy [a-z_]* on public\.franchise_/);
  });
});

describe("a configuração nasce em branco (20.15.6)", () => {
  it("nenhum valor do contrato é preenchido pela migração", () => {
    const tabela = SQL.slice(SQL.indexOf("create table if not exists public.franchise_billing_settings"), SQL.indexOf("create table if not exists public.franchise_billing_unit_settings"));
    expect(tabela).not.toMatch(/default [0-9]/);
    expect(tabela).toContain("insert into public.franchise_billing_settings (id) values (true)");
    expect(SQL).not.toContain("set fine_percent = coalesce(f.fine_percent, s.unit_charge_fine_percent)");
  });
  it("sem a configuração, nada é emitido; a rotina pula a unidade incompleta", () => {
    expect(SQL).toContain("raise exception 'CONFIG_MISSING: %'");
    expect(SQL).toContain("continue when cardinality(cfg.missing) > 0;");
  });
  it("o exemplo nunca com a conta de produção", () => {
    expect(ACOES).toContain('return data?.root_account?.environment !== "production";');
  });
});

describe("as regras confirmadas (20.15.5)", () => {
  it("mês sem nada não gera cobrança; abaixo de R$ 5,00 acumula", () => {
    expect(SQL).toContain("select 500::bigint;");
    expect(SQL).toContain("when v_n = 0 or v_total = 0 then 'sem_cobranca'");
    expect(SQL).toContain("when v_total < public._franchise_min_charge_cents() then 'acumulada'");
  });
  it("o \"a reter\" e o retido nunca entram: a linha vale o devido menos o retido", () => {
    expect(SQL).toContain("else greatest(sc.amount_cents - sc.retained_cents, 0) end");
  });
  it("cada linha pelo delta: o que vale hoje menos o já faturado (nunca duas vezes)", () => {
    expect(SQL).toContain("v_inv := public._franchise_invoiced_line(r.id, v_batch);");
    expect(SQL).toContain("v_delta := v_due - v_inv;");
  });
  it("multa e juros sem taxa sobre taxa: só no financeiro (4.2.01 e 4.1.01)", () => {
    expect(SQL).toContain("'franchise_monthly_late_unit'");
    expect(SQL).toContain("'franchise_monthly_late_hq'");
    const baixa = SQL.slice(SQL.indexOf("create or replace function public._franchise_monthly_settle"), SQL.indexOf("create or replace function public._franchise_monthly_event"));
    expect(baixa).not.toMatch(/split_charges|_apply_fee_split/);
  });
  it("a tarifa do Asaas é da franqueadora", () => {
    expect(SQL).toContain("'gateway_fee_charge', c.id, 'Tarifa do Asaas — cobrança mensal da rede'");
  });
  it("a emissão é sempre à mão: a rotina só abre a prévia e avisa", () => {
    const rotina = SQL.slice(SQL.indexOf("create or replace function public._franchise_monthly_cron"), SQL.indexOf("create or replace function public._franchise_monthly_split_plan"));
    expect(rotina).not.toMatch(/franchise_monthly_approve|insert into public\.charges/);
    expect(ROTA).toContain('admin.rpc("_franchise_monthly_cron")');
  });
});

describe("a emissão pela conta da franqueadora (20.6)", () => {
  it("o pagador é a unidade, com o e-mail financeiro e os avisos do Asaas ligados", () => {
    expect(SERVIDOR).toContain("createUnitCustomer(");
    expect(SERVIDOR).toContain("notificationDisabled: false");
    expect(SERVIDOR).toContain("aplicarRegua: undefined");
  });
  it("só o fundo com conta própria vai por split, valor fixo", () => {
    expect(SQL).toContain("where t.key = 'fundo';");
    expect(SERVIDOR).toContain("fixedValue: Math.round(Number(s.fixedCents)) / 100");
  });
});

const item = (p: Partial<ItemDoLote>): ItemDoLote =>
  ({
    id: Math.random().toString(),
    kind: "percentual",
    fee: "royalty",
    fee_label: "Royalties",
    origin_period: "2026-10-01",
    split_charge_id: null,
    payable_id: null,
    credit_of_item_id: null,
    received_on: "2026-10-05",
    method: "dinheiro",
    origin_label: "Dinheiro",
    patient_code: "LDN-1",
    patient_short: "Maria S.",
    base_cents: 100000,
    percent: 6,
    amount_cents: 6000,
    description: null,
    status: "ativo",
    contest_reason: null,
    contest_attachment_path: null,
    contested_at: null,
    decision: null,
    decision_reason: null,
    decided_at: null,
    after_issue: false,
    ...p,
  }) as ItemDoLote;

describe("o demonstrativo (20.4)", () => {
  const itens = [
    item({ kind: "fixa", fee: "sistema", fee_label: "Taxa de sistema", amount_cents: 30000, base_cents: null }),
    item({}),
    item({ fee: "fundo", fee_label: "Fundo", amount_cents: 2000, status: "dispensado" }),
    item({ kind: "credito", amount_cents: -2500 }),
    item({ kind: "saldo_anterior", amount_cents: 5000 }),
  ];
  it("o resumo soma por tipo e taxa, sem o dispensado", () => {
    const r = resumoDoLote(itens);
    expect(r.fixas).toBe(30000);
    expect(r.porTaxa).toEqual([{ label: "Royalties", total: 6000 }]);
    expect(r.ajustes).toBe(-2500);
    expect(r.saldoAnterior).toBe(5000);
    expect(r.total).toBe(38500);
  });
  it("a planilha tem uma linha por item, com vírgula decimal e o paciente abreviado", () => {
    const csv = planilhaDoLote({ items: itens } as LoteLido);
    const linhas = csv.split("\r\n");
    expect(linhas).toHaveLength(6);
    expect(linhas[2]).toContain("LDN-1;Maria S.;1000,00;6;60,00");
    expect(linhas[4]).toContain("-25,00");
  });
});
