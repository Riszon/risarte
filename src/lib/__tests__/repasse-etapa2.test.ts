import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_REASON,
  candidateFromDb,
  eventLabel,
  monthError,
  reasonError,
  reportErrorText,
  reportItemFromDb,
  totalReady,
} from "@/lib/finance/payout-report";
import { CAPACIDADES } from "@/lib/permissions";

/**
 * REPASSE DOS DENTISTAS, ETAPA 2 (0390) — o relatório de repasse.
 *
 * A prova de comportamento é `scripts/repasse-ensaio-0390.mjs --confirmar`
 * (transação desfeita no treino, 38 conferências). Estas réguas prendem as
 * travas no texto da migração — a que impede pagar duas vezes, sobretudo — e
 * as frases da tela.
 */
const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/0390_repasse_relatorio.sql"),
  "utf8"
)
  .replace(/\r\n/g, "\n")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

const corpo = (inicio: string, fim: string) =>
  sql.slice(sql.indexOf(inicio), sql.indexOf(fim, sql.indexOf(inicio) + 1));

describe("0390 — as travas do relatório moram no banco", () => {
  it("um procedimento só está em UM relatório por vez", () => {
    expect(sql).toMatch(
      /create unique index if not exists payout_report_items_one_active\s+on public\.payout_report_items \(payout_id\) where active;/
    );
  });

  it("um rascunho por dentista e unidade", () => {
    expect(sql).toMatch(
      /create unique index if not exists payout_reports_one_draft\s+on public\.payout_reports \(clinic_id, provider_id\) where status = 'rascunho';/
    );
  });

  it("ninguém grava nas três tabelas pela API: só há regra de leitura", () => {
    const regras = [...sql.matchAll(/create policy "[^"]+" on public\.(payout_\w+)\s+for (\w+)/g)];
    expect(regras.map((r) => r[1]).sort()).toEqual([
      "payout_report_events",
      "payout_report_items",
      "payout_reports",
    ]);
    expect(regras.every((r) => r[2] === "select")).toBe(true);
  });

  it("gerar, excluir, devolver, cancelar e reverter são do Financeiro da Franqueadora", () => {
    expect(sql).toContain("select public.is_admin_master() or public.is_finance_franchisor();");
    for (const f of [
      "function public.payout_report_generate(",
      "function public.payout_report_exclude_item(",
      "function public.payout_report_restore_item(",
      "function public.payout_report_cancel(",
      "function public.payout_release_withheld(",
    ]) {
      const c = corpo(f, "revoke execute on function");
      expect(c, f).toContain("if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'");
    }
  });

  it("o relatório só pega o que tem valor, não está fechado, nem em 'não pagar', nem em outro relatório", () => {
    const g = corpo("function public.payout_report_generate(", "revoke execute on function");
    for (const cond of [
      "p.accrual_date < v_next",
      "p.closing_id is null",
      "p.amount_cents > 0",
      "not p.no_payout",
      "not p.withheld",
    ]) {
      // Nos dois lugares: ao escolher os dentistas e ao inserir os itens.
      expect(g.split(cond).length - 1, cond).toBe(2);
    }
    expect(g).toContain("where i.payout_id = p.id and i.active)");
    // O adiado não volta para o MESMO rascunho.
    expect(g).toContain("where i.payout_id = p.id and (i.active or i.report_id = v_report)");
    expect(g).toContain("raise exception 'FUTURE_MONTH'");
  });

  it("excluir exige tipo conhecido e motivo; 'não pagar' marca o procedimento", () => {
    const e = corpo("function public.payout_report_exclude_item(", "revoke execute on function");
    expect(e).toContain("if v_status <> 'rascunho' then raise exception 'REPORT_NOT_DRAFT'");
    expect(e).toContain("p_kind not in ('adiar', 'nao_pagar') then raise exception 'INVALID_KIND'");
    expect(e).toContain(`length(v_reason) < ${MIN_REASON} then raise exception 'REASON_REQUIRED'`);
    expect(e).toMatch(/if p_kind = 'nao_pagar' then\s+update public\.provider_payouts\s+set withheld = true/);
  });

  it("cancelar e reverter também exigem motivo", () => {
    for (const f of ["function public.payout_report_cancel(", "function public.payout_release_withheld("]) {
      expect(corpo(f, "revoke execute on function"), f).toContain("raise exception 'REASON_REQUIRED'");
    }
  });

  it("o fechamento antigo não leva o que está em relatório nem em 'não pagar'", () => {
    expect(sql).toMatch(/before update of closing_id on public\.provider_payouts/);
    expect(sql).toContain("raise exception 'PAYOUT_IN_REPORT'");
    const f = corpo("function public.close_payout_month(", "revoke execute on function");
    // A soma e a trava do período usam o MESMO filtro.
    expect(f.split("and not pp.withheld").length - 1).toBe(2);
    expect(f.split("where i.payout_id = pp.id and i.active)").length - 1).toBe(2);
  });

  it("as leituras conferem a unidade de quem pede", () => {
    for (const f of [
      "function public.payout_report_candidates(",
      "function public.payout_report_list(",
      "function public.payout_report_items_detail(",
      "function public.payout_report_history(",
      "function public.payout_withheld_list(",
    ]) {
      expect(corpo(f, "revoke execute on function"), f).toContain("public.finance_visible_clinic_ids()");
    }
  });

  it("nenhuma função nova responde sem login; as internas nem a logado", () => {
    const criadas = [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(/g)].map((m) => m[1]);
    expect(criadas.length).toBeGreaterThanOrEqual(14);
    for (const nome of new Set(criadas)) {
      expect(sql, nome).toMatch(
        new RegExp(`revoke execute on function public\\.${nome}\\([^)]*\\) from public, anon, authenticated;`)
      );
    }
    for (const interna of ["_payout_report_refresh", "_payout_report_event", "provider_payouts_report_guard"]) {
      expect(sql, interna).not.toMatch(
        new RegExp(`grant execute on function public\\.${interna}\\(`)
      );
    }
  });

  it("a tabela nova entra na auditoria e a permissão nasce semeada", () => {
    expect(sql).toContain("select public.audit_attach_all();");
    expect(sql).toContain("('acao.financeiro.repasse.relatorio', 'finance_franchisor')");
    const cap = CAPACIDADES.find((c) => c.id === "acao.financeiro.repasse.relatorio");
    expect(cap?.padrao).toEqual(["finance_franchisor"]);
    expect(cap?.dependeDoBanco).toBe(true);
  });
});

describe("0390 — o relatório, na tela", () => {
  it("o motivo tem o mesmo mínimo do banco", () => {
    expect(reasonError("    ")).not.toBeNull();
    expect(reasonError("abcd")).not.toBeNull();
    expect(reasonError("abcde")).toBeNull();
  });

  it("mês futuro e mês malformado são recusados antes de ir ao banco", () => {
    expect(monthError("2026-12", "2026-11-10")).toContain("futuro");
    expect(monthError("2026-11", "2026-11-10")).toBeNull();
    expect(monthError("2026-10", "2026-11-10")).toBeNull();
    expect(monthError("2026-13", "2026-11-10")).not.toBeNull();
    expect(monthError("", "2026-11-10")).not.toBeNull();
  });

  it("o resumo conta só quem tem procedimento com valor, e avisa dos zerados", () => {
    const c = (p: Partial<Parameters<typeof candidateFromDb>[0]>) =>
      candidateFromDb({
        provider_id: "x", provider_name: "X", level_name: null, ready_count: 0,
        ready_cents: 0, zero_count: 0, draft_id: null, draft_code: null, ...p,
      });
    expect(
      totalReady([
        c({ ready_count: 2, ready_cents: "25500" }),
        c({ ready_count: 0, zero_count: 3 }),
        c({ ready_count: 1, ready_cents: 10000, zero_count: 1 }),
      ])
    ).toEqual({ dentists: 2, count: 3, cents: 35500, zeros: 4 });
  });

  it("o item lido do banco não inventa tipo de exclusão", () => {
    const i = reportItemFromDb({
      item_id: "i", payout_id: "p", finished_on: "2026-11-10", procedure_name: null,
      client_id: null, client_name: null, session_id: null, origin: "ortodontia",
      amount_cents: "15500", status: "excluido", exclusion_kind: "outro",
      exclusion_reason: "x", excluded_by_name: null, excluded_at: null,
    });
    expect(i.amountCents).toBe(15500);
    expect(i.origin).toBe("ortodontia");
    expect(i.exclusionKind).toBeNull();
    expect(i.procedureName).toBe("Procedimento");
  });

  it("toda ação que o banco grava na linha do tempo tem frase", () => {
    // A ação é o 4º argumento: ou um texto direto, ou o `case` do adiar/não pagar.
    const acoes = [
      ...sql.matchAll(/perform public\._payout_report_event\([^,]+,[^,]+,[^,]+,\s*'(\w+)'/g),
    ].map((m) => m[1]);
    const noCase = [...sql.matchAll(/then '(item_\w+)' else '(item_\w+)'/g)].flatMap((m) => [m[1], m[2]]);
    const todas = new Set([...acoes, ...noCase]);
    expect(todas.size).toBeGreaterThanOrEqual(7);
    for (const a of todas) expect(eventLabel(a), a).not.toBe(a);
  });

  it("os erros do banco chegam em português", () => {
    for (const cod of [
      "NOT_ALLOWED", "REASON_REQUIRED", "REPORT_NOT_DRAFT", "ALREADY_EXCLUDED",
      "NOT_EXCLUDED", "PAYOUT_IN_OTHER_REPORT", "FUTURE_MONTH", "NOT_WITHHELD",
      "INVALID_KIND", "NOT_FOUND",
    ]) {
      const t = reportErrorText(cod);
      expect(t, cod).not.toContain(cod);
      expect(t, cod).not.toBe("Não foi possível concluir. Tente de novo.");
    }
  });
});
