// 4020a — o estorno parcial (spec 19.38). O banco é provado no ensaio
// (scripts/asaas-ensaio-4020a-estorno-parcial.mjs, quebrado de propósito).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decidirSaldo, explicarRecusaDoEstorno, repartirPeloAsaas } from "@/lib/asaas/estorno-parcial-regras";

const SQL = readFileSync("supabase/migrations/4020a_asa4_estorno_parcial_pelo_asaas.sql", "utf8");

describe("o saldo antes do pedido (19.37, item 1)", () => {
  it("o parcial sai da conta da unidade: sem saldo, não pede", () => {
    const r = decidirSaldo({ parcial: true, valorCents: 5000, saldoUnidadeReais: 10, parteDaRedeCents: 0, saldoRedeReais: null });
    expect(r.ok).toBe(false);
  });
  it("o total devolve a parte da franqueadora: a unidade vê só 'temporariamente indisponível', sem o saldo", () => {
    const r = decidirSaldo({ parcial: false, valorCents: 0, saldoUnidadeReais: null, parteDaRedeCents: 1700, saldoRedeReais: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mensagemDaUnidade).toContain("temporariamente indisponível");
      expect(r.mensagemDaUnidade).not.toMatch(/R\$/);
      expect(r.detalhe).toMatch(/R\$/);
    }
  });
  it("com saldo, ou sem a leitura, segue (a recusa do Asaas é tratada)", () => {
    expect(decidirSaldo({ parcial: true, valorCents: 5000, saldoUnidadeReais: 100, parteDaRedeCents: 0, saldoRedeReais: null }).ok).toBe(true);
    expect(decidirSaldo({ parcial: false, valorCents: 0, saldoUnidadeReais: null, parteDaRedeCents: 1700, saldoRedeReais: null }).ok).toBe(true);
  });
});

describe("a repartição real (cuidado 2)", () => {
  it("o pedido do parcelado de 17/11: a parcela 1 inteira e R$ 20,00 da 2", () => {
    const r = repartirPeloAsaas({
      parcial: true,
      valorCents: 12000,
      lidas: [
        { chargeId: "c1", asaasPaymentId: "p1", valorCents: 10000, refunds: [] },
        { chargeId: "c2", asaasPaymentId: "p2", valorCents: 10000, refunds: [] },
        { chargeId: "c3", asaasPaymentId: "p3", valorCents: 10000, refunds: [] },
      ],
      respostaDoPedido: [
        { status: "DONE", value: 100, paymentId: "p1" },
        { status: "PENDING", value: 20, paymentId: "p2" },
      ],
    });
    expect(r).toEqual([
      { charge_id: "c1", amount_cents: 10000, inteira: true, asaas_status: "DONE", receipt_url: null },
      { charge_id: "c2", amount_cents: 2000, inteira: false, asaas_status: "PENDING", receipt_url: null },
    ]);
  });
});

describe("as regras no banco", () => {
  it("quem pediu não confirma; o boleto continua no estorno total", () => {
    expect(SQL).toContain("if r.requested_by = v_user then raise exception 'SELF_CONFIRM'; end if;");
    expect(SQL).toContain("raise exception 'BOLETO_PELO_ESTORNO_TOTAL'");
  });
  it("o limite em branco vale para todo estorno de cartão", () => {
    expect(SQL).toContain("select p_kind = 'cartao' and (s.card_refund_confirm_above_cents is null or coalesce(p_amount, 0) > s.card_refund_confirm_above_cents)");
  });
  it("a parcela estornada inteira fica encerrada; só o Gerente ou o Admin reabrem", () => {
    expect(SQL).toContain("update public.payment_installments set status = 'cancelada', refund_closed_at = now()");
    expect(SQL).toContain("public.has_role_in_clinic(i.clinic_id, array['unit_manager']::public.user_role[])");
  });
  it("o parcial não desfaz a baixa nem mexe na taxa", () => {
    const f = SQL.slice(SQL.indexOf("create or replace function public._charge_refund_partial_event"), SQL.indexOf("create or replace function public._refund_close_installment"));
    expect(f).not.toMatch(/_gateway_reverse_receipt|split_charges/);
  });
});

describe("4020a — a recusa do parcial no mesmo dia (prova de 17/11/2026)", () => {
  it("explica em palavras de quem pediu e mantém as outras recusas", () => {
    expect(explicarRecusaDoEstorno("O Asaas recusou: Esta transação só pode ser estornada parcialmente no próximo dia.")).toMatch(/dia seguinte à aprovação/);
    expect(explicarRecusaDoEstorno("O Asaas recusou: outra coisa")).toBe("O Asaas recusou: outra coisa");
  });
});
