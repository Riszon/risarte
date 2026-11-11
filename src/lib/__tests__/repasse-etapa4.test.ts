import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_STATE_LABEL,
  billingErrorText,
  billingFromDb,
  billingText,
  eventLabel,
  itemPaymentText,
  paymentByItem,
  reportPaymentFromDb,
  totalToBill,
  type ReportPayment,
} from "@/lib/finance/payout-report";

/**
 * REPASSE DOS DENTISTAS, ETAPA 4 (0393) — o pagamento pelo relatório.
 *
 * A prova de comportamento é `scripts/repasse-ensaio-0393.mjs --confirmar`
 * (transação desfeita no treino, 36 conferências: aprovação parcial → conta a
 * pagar → segunda conta → pago → cancelar devolve → estorno). Estas réguas
 * prendem no texto da migração as travas que não podem sumir numa recriação
 * de função, e as frases da tela.
 */
const ler = (arq: string) =>
  readFileSync(join(process.cwd(), arq), "utf8").replace(/\r\n/g, "\n");
const sql = ler("supabase/migrations/0393_repasse_pagamento.sql")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

/** O corpo de uma função, do `create` até o `revoke` dela. */
const corpo = (nome: string) => {
  const ini = sql.search(new RegExp(`create (?:or replace )?function public\\.${nome}\\s*\\(`));
  if (ini < 0) throw new Error(`NÃO MEDI: não achei public.${nome} na 0393`);
  return sql.slice(ini, sql.indexOf("revoke execute on function", ini));
};

describe("0393 — o que vira conta a pagar", () => {
  const f = corpo("payout_report_bill");

  it("só o Financeiro da Franqueadora gera, e nunca a do próprio repasse", () => {
    expect(f).toContain("if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'");
    expect(f).toMatch(/if v_r\.provider_id = v_user then raise exception 'NOT_ALLOWED'/);
  });

  it("só entra a linha LIBERADA, incluída, ativa e ainda sem conta", () => {
    expect(f).toMatch(
      /i\.status = 'incluido' and i\.active and i\.released\s+and i\.payment_id is null\s+for update/
    );
  });

  it("o relatório é travado antes de escolher as linhas (dois cliques não geram duas contas)", () => {
    expect(f).toMatch(/from public\.payout_reports where id = p_report_id for update/);
    expect(f).toContain("raise exception 'NOTHING_TO_BILL'");
  });

  it("a conta nasce aberta, sem alçada, em 2.1.01, e entra no resultado", () => {
    expect(f).toMatch(/'2\.1\.01'/);
    expect(f).toMatch(/'aberta', 'automatica', false/);
    expect(f).toContain("perform public.post_payable_accrual(v_payable)");
  });

  it("gerar de todos chama a mesma função, relatório a relatório", () => {
    const t = corpo("payout_reports_bill_all");
    expect(t).toContain("perform public.payout_report_bill(r.id)");
    expect(t).toContain("pr.provider_id is distinct from (select auth.uid())");
  });
});

describe("0393 — as travas contra pagar duas vezes", () => {
  const t = corpo("payout_report_items_payment_lock");

  it("linha em uma conta não muda de valor, de situação nem de relatório", () => {
    for (const coluna of ["amount_cents", "status", "active", "released", "payout_id", "report_id"]) {
      expect(t).toContain(`new.${coluna} is distinct from old.${coluna}`);
    }
    expect(t).toContain("raise exception 'ITEM_IN_PAYMENT'");
  });

  it("a linha só sai da conta quando a conta foi cancelada, e nunca troca de conta", () => {
    expect(t).toMatch(
      /if new\.payment_id is not null or not exists \(\s*select 1 from public\.payout_payments p\s+where p\.id = old\.payment_id and p\.status = 'cancelada'/
    );
  });

  it("só entra em conta a linha liberada, e em conta do MESMO relatório", () => {
    expect(t).toContain("raise exception 'ITEM_NOT_RELEASED'");
    expect(t).toMatch(/p\.report_id = new\.report_id and p\.status = 'ativa'/);
  });

  it("a trava vale em alteração E em exclusão", () => {
    expect(sql).toMatch(
      /create trigger payout_report_items_payment_lock\s+before update or delete on public\.payout_report_items/
    );
  });

  it("a conta do repasse não se apaga, não muda de valor e, cancelada, não volta", () => {
    const p = corpo("payout_payments_lock");
    expect(p).toContain("if tg_op = 'DELETE' then raise exception 'PAYMENT_LOCKED'");
    expect(p).toContain("new.amount_cents is distinct from old.amount_cents");
    expect(p).toContain("old.status = 'cancelada' and new.status is distinct from old.status");
    expect(sql).toContain("constraint payout_payments_payable_unique unique (payable_id)");
  });

  it("ninguém grava em payout_payments direto: só leitura na regra", () => {
    expect(sql).not.toMatch(/create policy[^;]*on public\.payout_payments\s+for (all|insert|update|delete)/);
  });
});

describe("0393 — a conta a pagar muda, o relatório acompanha", () => {
  const s = corpo("payables_payout_payment_sync");

  it("cancelar a conta devolve as linhas para 'liberada'", () => {
    expect(s).toMatch(/update public\.payout_report_items set payment_id = null\s+where payment_id = v_pp\.id/);
    expect(s).toMatch(/set status = 'cancelada'/);
  });

  it("'pago' não é copiado para a linha: vem da própria conta a pagar", () => {
    expect(sql).not.toMatch(/payout_report_items[^;]*set[^;]*paid/i);
    expect(corpo("payout_report_payments")).toContain("when pa.status = 'paga' then 'pago'");
  });

  it("o dentista não vê a conta cancelada nem quem gerou", () => {
    const l = corpo("payout_report_payments");
    expect(l).toContain("and (v_internal or pp.status = 'ativa')");
    expect(l).toContain("case when v_internal then cb.full_name end");
  });
});

describe("0393 — o Fechar o mês antigo saiu", () => {
  it("a função só recusa", () => {
    expect(corpo("close_payout_month")).toContain("raise exception 'PAYOUT_CLOSING_RETIRED'");
  });

  it("a tela não chama mais o fechamento", () => {
    const tela = ler("src/app/(app)/financeiro/repasses/payout-manager.tsx");
    const acoes = ler("src/app/(app)/financeiro/repasses/actions.ts");
    expect(tela).not.toContain("closePayoutMonth");
    expect(acoes).not.toContain("close_payout_month");
  });

  it("a missão da certificação aponta para algo que ainda dá para fazer", () => {
    const cert = ler("src/lib/certificacao.ts");
    expect(cert).not.toContain("payout_closings.closed_by");
    expect(cert).toContain("payout_payments.created_by");
  });
});

describe("as frases do pagamento", () => {
  const conta = (over: Partial<ReportPayment>): ReportPayment => ({
    paymentId: "p1",
    payableId: "c1",
    amountCents: 30000,
    itemCount: 3,
    accrualDate: "2026-11-01",
    dueDate: "2026-11-15",
    state: "programado",
    paidCents: 0,
    paidOn: null,
    createdAt: "2026-11-10T12:00:00Z",
    createdByName: null,
    cancelReason: null,
    itemIds: ["a", "b", "c"],
    ...over,
  });

  it("cada situação da conta tem nome", () => {
    for (const s of ["programado", "parcial", "pago", "cancelado"] as const) {
      expect(PAYMENT_STATE_LABEL[s].length).toBeGreaterThan(2);
    }
  });

  it("linha não liberada não fala de pagamento", () => {
    expect(itemPaymentText(false, undefined)).toBeNull();
    expect(itemPaymentText(false, conta({}))).toBeNull();
  });

  it("linha liberada: sem conta, programada, paga", () => {
    expect(itemPaymentText(true, undefined)).toBe("Liberado — ainda sem conta a pagar");
    expect(itemPaymentText(true, conta({}))).toBe("Pagamento programado para 15/11/2026");
    expect(itemPaymentText(true, conta({ state: "pago", paidOn: "2026-11-14" }))).toBe(
      "Pago em 14/11/2026"
    );
  });

  it("conta cancelada não prende a linha", () => {
    const mapa = paymentByItem([
      conta({ paymentId: "velha", state: "cancelado", itemIds: ["a"] }),
      conta({ paymentId: "nova", itemIds: ["b"] }),
    ]);
    expect(mapa.has("a")).toBe(false);
    expect(mapa.get("b")?.paymentId).toBe("nova");
  });

  it("o banco devolve texto, a tela trabalha com número", () => {
    const p = reportPaymentFromDb({
      payment_id: "p",
      payable_id: "c",
      amount_cents: "12345",
      item_count: 2,
      accrual_date: "2026-11-01",
      due_date: "2026-11-15",
      state: "inventado",
      paid_cents: null,
      paid_on: null,
      created_at: "2026-11-10T12:00:00Z",
      created_by_name: null,
      cancel_reason: null,
      item_ids: null,
    });
    expect(p.amountCents).toBe(12345);
    expect(p.state).toBe("programado");
    expect(p.itemIds).toEqual([]);
  });

  it("o resumo da lista junta pago, programado e o que falta virar conta", () => {
    const b = billingFromDb({
      report_id: "r",
      to_bill_cents: "10000",
      to_bill_count: 1,
      scheduled_cents: "20000",
      paid_cents: "30000",
      next_due: "2026-12-15",
      last_paid_on: "2026-11-14",
    });
    const texto = billingText(b) ?? "";
    expect(texto).toContain("pago em 14/11/2026");
    expect(texto).toContain("programado para 15/12/2026");
    expect(texto).toContain("liberado, sem conta a pagar");
    expect(billingText({ ...b, toBillCents: 0, scheduledCents: 0, paidCents: 0 })).toBeNull();
    expect(billingText(undefined)).toBeNull();
  });

  it("o botão de gerar todas soma só o que tem algo a cobrar", () => {
    const base = { scheduledCents: 0, paidCents: 0, nextDue: null, lastPaidOn: null };
    expect(
      totalToBill([
        { reportId: "a", toBillCents: 10000, toBillCount: 1, ...base },
        { reportId: "b", toBillCents: 0, toBillCount: 0, ...base },
        { reportId: "c", toBillCents: 5000, toBillCount: 1, ...base },
      ])
    ).toEqual({ reports: 2, cents: 15000 });
  });

  it("os erros do banco chegam em português", () => {
    for (const codigo of ["NOTHING_TO_BILL", "ITEM_IN_PAYMENT", "PERIOD_CLOSED", "WRONG_STAGE", "NOT_ALLOWED"]) {
      const frase = billingErrorText(codigo);
      expect(frase).not.toContain(codigo);
      expect(frase).not.toBe("Não foi possível concluir. Tente de novo.");
    }
  });

  it("a linha do tempo fala do pagamento", () => {
    for (const a of ["conta_gerada", "conta_cancelada", "pago", "pagamento_estornado"]) {
      expect(eventLabel(a)).not.toBe(a);
    }
  });
});
