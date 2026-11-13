// ASA3, entrega 2 (4009) — o que não depende do banco: comparar o split
// refeito com o gravado (não chamar o Asaas à toa), reduzir ao líquido no
// bloqueio (U7) e a permissão nova "Pedir estorno" igual no código e no banco.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mesmasEntradas, reduzirAoLiquido } from "@/lib/asaas/split";
import { CAPACIDADES_POR_ID } from "@/lib/permissions";
import { WEBHOOK_EVENTS, WEBHOOK_EVENTS_VERSION } from "@/lib/asaas/api";

describe("mesmasEntradas", () => {
  const a = [
    { walletId: "raiz", percentualValue: 14.72, fixedCents: 14 },
    { walletId: "fundo", percentualValue: 1.83, fixedCents: 1 },
  ];
  it("a mesma conta em outra ordem é igual (não chama o Asaas)", () => {
    expect(mesmasEntradas(a, [...a].reverse())).toBe(true);
  });
  it("um centavo ou uma casa do percentual a mais já é diferente", () => {
    expect(mesmasEntradas(a, [{ ...a[0], fixedCents: 15 }, a[1]])).toBe(false);
    expect(mesmasEntradas(a, [{ ...a[0], percentualValue: 14.7201 }, a[1]])).toBe(false);
  });
  it("uma carteira a mais ou a menos é diferente", () => {
    expect(mesmasEntradas(a, [a[0]])).toBe(false);
  });
});

describe("reduzirAoLiquido (U7: o bloqueio por divergência)", () => {
  const e = [
    { walletId: "raiz", percentualValue: 60, fixedCents: 300 },
    { walletId: "fundo", percentualValue: 30, fixedCents: 200 },
  ];
  it("o split que passou do líquido é reduzido até caber, com 1 centavo de folga", () => {
    const liquido = 1_000;
    const r = reduzirAoLiquido(e, liquido);
    const total = r.reduce((s, x) => s + x.fixedCents + Math.floor((liquido * x.percentualValue) / 100), 0);
    expect(total).toBeLessThanOrEqual(liquido - 1);
    expect(total).toBeGreaterThan(liquido - 20);
  });
  it("o que já cabe não muda", () => {
    expect(reduzirAoLiquido(e, 100_000)).toEqual(e);
  });
});

describe("a permissão nova e o webhook", () => {
  it("'Pedir estorno': o padrão do código é o mesmo do banco (Franqueado e Gerente; a unidade escolhe)", () => {
    expect(CAPACIDADES_POR_ID.get("acao.cobranca.estorno")?.padrao).toEqual(["franchisee", "unit_manager"]);
    const sql = readFileSync("supabase/migrations/4009_asa3_fila_do_split_e_estorno.sql", "utf8");
    expect(sql).toContain("when 'acao.cobranca.estorno' then array['franchisee','unit_manager']::public.user_role[]");
  });
  it("o webhook passa a ouvir o estorno negado, e a versão da lista subiu (a rotina corrige as contas)", () => {
    expect(WEBHOOK_EVENTS).toContain("PAYMENT_REFUND_DENIED");
    expect(WEBHOOK_EVENTS_VERSION).toBe(2);
  });
});

describe("o motivo do Asaas na tela (pedido do dono, 13/11/2026)", () => {
  it("dado recusado (400): a mensagem traz o motivo do Asaas; o log continua só com o código", async () => {
    const { asaasRequest, AsaasError } = await import("@/lib/asaas/client");
    const motivo = "Não é possível efetuar o estorno pois o seu cliente não possui um e-mail válido.";
    const f = (async () =>
      new Response(JSON.stringify({ errors: [{ code: "invalid_action", description: motivo }] }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const erro = await asaasRequest(
      { apiKey: "$aact_hmlg_" + "x".repeat(40), environment: "sandbox", method: "POST", path: "/payments/{id}/bankSlip/refund", params: { id: "pay_1" }, body: {} },
      { fetchImpl: f }
    ).catch((e) => e);
    expect(erro).toBeInstanceOf(AsaasError);
    expect(erro.messagePt).toBe(`O Asaas recusou: ${motivo}`);
    expect(erro.logMessage).not.toContain("e-mail");
    expect(erro.logMessage).toContain("invalid_action");
  });
});
