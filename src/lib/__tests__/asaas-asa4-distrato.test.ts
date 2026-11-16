// ASA4, entrega 6 (4020) — o distrato com checklist (19.35). O banco é provado no
// ensaio (scripts/asaas-ensaio-asa4-distrato.mjs) e o Asaas no sandbox
// (asaas-asa4-distrato.integracao.test.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/4020_asa4_distrato_com_checklist.sql", "utf8");
const ACAO = readFileSync("src/app/(app)/apresentacao/[clientId]/cancellation-actions.ts", "utf8");
const TERMO = readFileSync("src/app/cancelamentos/[id]/termo/page.tsx", "utf8");
const PASSOS = readFileSync("src/app/cancelamentos/[id]/termo/cancellation-steps.tsx", "utf8");
const ROTA = readFileSync("src/app/api/cron/gateway-cobrancas/route.ts", "utf8");

describe("D12: nada é cancelado antes da checklist", () => {
  it("efetivar exige os 8 itens e o termo assinado, e recusa se entrou pagamento depois do termo", () => {
    expect(SQL).toContain("if v_n < 8 then raise exception 'CHECKLIST_INCOMPLETE: %', 8 - v_n; end if;");
    expect(SQL).toContain("raise exception 'SETTLEMENT_CHANGED';");
    expect(SQL).toContain("perform public._distrato_ready(p_id);");
  });
  it("o servidor confere a checklist ANTES de cancelar qualquer boleto no Asaas", () => {
    const i = ACAO.indexOf('admin.rpc("_distrato_ready"');
    const j = ACAO.indexOf("comBoletosCancelados<unknown>({");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(j);
  });
  it("a tela bloqueia o Efetivar com itens abertos", () => {
    expect(PASSOS).toContain("disabled={isPending || !signed || checklistPendente > 0}");
  });
});

describe("o distrato não é automático (19.35.3)", () => {
  it("o atraso e o pedido avisam o Gerente a cada 7 dias; o aberto, o Financeiro depois de 30", () => {
    expect(SQL).toContain("d.last_alert_at < now() - interval '7 days'");
    expect(SQL).toContain("if r.created_at < now() - interval '30 days' then");
    // A rotina só avisa: ela nunca efetiva nem cancela venda.
    const rotina = SQL.slice(SQL.indexOf("create or replace function public._distrato_watch_run"), SQL.indexOf("-- 3) A PARTE DA VENDA NOS ACORDOS"));
    expect(rotina).not.toMatch(/apply_plan_cancellation|cancel_direct_sale|cancelled_at = now\(\)/);
  });
  it("os dias do aviso vêm da Central (rede), com padrão 60", () => {
    expect(SQL).toContain("add column if not exists distrato_overdue_days integer not null default 60");
    expect(SQL).toContain("check (distrato_overdue_days between 15 and 365)");
  });
  it("a rotina diária roda o aviso", () => {
    expect(ROTA).toContain('admin.rpc("_distrato_watch_run")');
  });
});

describe("o acordo de várias vendas (19.35.5, 2a)", () => {
  it("a parte da venda é a proporção da origem, multiplicada na cadeia", () => {
    expect(SQL).toContain("v_part := v_part + r.base * public._distrato_share(r.renegotiation_id, p_neg, p_ds, p_depth + 1);");
  });
  it("só desta venda: as abertas caem; de várias: são reduzidas, com os centavos na última", () => {
    expect(SQL).toContain("if a.share >= 0.9999 then");
    expect(SQL).toContain("v_c := case when v_i = v_n then v_cut - v_done else round(k.amount_cents * a.share) end;");
  });
  it("o termo mostra antes e depois, marcado para a revisão do jurídico", () => {
    expect(TERMO).toContain("[REVISÃO JURÍDICA]");
    expect(TERMO).toContain("[/REVISÃO JURÍDICA]");
    expect(TERMO).toContain("As cobranças em aberto continuam valendo até a assinatura deste termo.");
  });
});

describe("as regras travadas", () => {
  it("a venda direta com algo pago só sai pelo distrato, sem multa, e as sessões feitas ficam feitas", () => {
    expect(SQL).toContain("raise exception 'DISTRATO_REQUIRED';");
    expect(SQL).toContain("where direct_sale_id = v_c.direct_sale_id and status not in ('cancelled', 'done');");
  });
  it("a parcela parcial cai no distrato (6a)", () => {
    expect(SQL).toContain("(status = 'em_aberto' or (v_c.checklist_required and status = 'parcial'))");
  });
  it("a devolução por Pix da unidade: o Gerente pede com o termo; o Financeiro ou o Admin autorizam, nunca quem pediu", () => {
    expect(SQL).toContain("raise exception 'TERM_REQUIRED';");
    expect(SQL).toContain("if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;");
    expect(SQL).toContain("if r.requested_by = v_user then raise exception 'SELF_APPROVAL'; end if;");
  });
  it("o distrato não desfaz recebimento nem mexe na taxa da rede (D13)", () => {
    const bloco = SQL.slice(SQL.indexOf("create or replace function public._apply_direct_sale_distrato"), SQL.indexOf("-- 6) ORTODONTIA"));
    expect(bloco).not.toMatch(/split_charges|payment_receipts/);
  });
  it("Indica +Risos como hoje (5b): só a carência volta; o convertido avisa o Financeiro", () => {
    expect(SQL).toContain("ind.orcamento_id = v_c.negotiation_id and ind.status = 'convertida'");
    expect(SQL).not.toMatch(/indica\._mover_saldo/);
  });
  it("Riso+ Social: o estorno da mensalidade do PPR+ tira os pontos dela", () => {
    expect(SQL).toContain("delete from public.ppr_social_points sp");
  });
});
