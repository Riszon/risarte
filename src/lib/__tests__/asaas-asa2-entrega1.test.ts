// ASA2, entrega 1 — o aviso do Asaas vira baixa. O que é do BANCO (cada aviso,
// a D21, a baixa, o arredondamento, o estorno com a taxa mantida, a
// duplicidade, o reprocessar) é provado pelo ensaio
// `scripts/asaas-ensaio-asa2-entrega1.mjs`, no treino. Aqui: as réguas que
// impedem a regressão no código.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createPayment } from "@/lib/asaas/api";
import { mensagemDaCobranca } from "@/lib/cobrancas";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const SQL = ler("supabase/migrations/4005_asa2_aviso_vira_baixa.sql");

describe("as funções internas respondem só à chave de serviço", () => {
  const internas = [...SQL.matchAll(/create or replace function public\.(_[a-z_]+)\(/g)].map((m) => m[1]);
  it("toda função interna nova (começa com _) tem o revoke de public, anon e authenticated", () => {
    expect(internas.length).toBeGreaterThanOrEqual(15);
    for (const f of new Set(internas)) {
      expect(SQL, f).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`));
      expect(SQL, f).not.toMatch(new RegExp(`grant execute on function public\\.${f}\\(`));
    }
  });
  it("as portas abertas a quem está logado conferem o papel antes de agir", () => {
    const portas = ["network_fee_waive_after_refund", "gateway_surplus_mark_refunded", "gateway_surplus_apply", "gateway_reprocess_event"];
    for (const f of portas) {
      const corpo = SQL.slice(SQL.indexOf(`create or replace function public.${f}(`));
      const fim = corpo.indexOf("$$;");
      expect(corpo.slice(0, fim), f).toMatch(/NOT_ALLOWED/);
      expect(SQL, f).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to authenticated;`));
    }
  });
});

describe("o webhook responde 200 depois de gravar, mesmo que o processamento falhe", () => {
  const rota = ler("src/app/api/webhooks/asaas/[ref]/route.ts");
  it("o processamento vem DEPOIS de gravar o aviso", () => {
    expect(rota.indexOf('rpc("_gateway_record_event"')).toBeGreaterThan(0);
    expect(rota.indexOf('rpc("_gateway_process_pending"')).toBeGreaterThan(rota.indexOf('rpc("_gateway_record_event"'));
  });
  it("o erro do processamento é engolido e a resposta segue 200", () => {
    const depois = rota.slice(rota.indexOf('rpc("_gateway_process_pending"') - 200);
    expect(depois).toMatch(/try \{/);
    expect(depois).toMatch(/catch \(e\)/);
    expect(depois).toMatch(/status: 200/);
    expect(depois).not.toMatch(/status: 500/);
  });
});

describe("a emissão manda a multa em reais (16.3)", () => {
  it("a multa vai como valor FIXO, nunca percentual", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "pay_1" }), { status: 200 }));
    await createPayment(
      { apiKey: "$aact_hmlg_" + "x".repeat(40), environment: "sandbox" },
      {
        customer: "cus_1",
        billingType: "PIX",
        value: 70,
        dueDate: "2026-11-20",
        description: "d",
        externalReference: "r",
        discountValue: 0,
        fineValue: 2,
        interestPercent: 1.4286,
      },
      { fetchImpl }
    );
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.fine).toEqual({ value: 2, type: "FIXED" });
    expect(body.interest).toEqual({ value: 1.4286 });
  });
  it("a conta da multa em reais e dos juros proporcionais mora no banco (_charge_compute)", () => {
    expect(SQL).toMatch(/v_fine_cents := round\(v_base \* v_fine \/ 100\.0\)/);
    expect(SQL).toMatch(/v_int := round\(v_int \* v_base \/ v_value, 4\)/);
  });
});

describe("D13 e o estorno", () => {
  it("o gatilho da taxa da rede não desfaz a taxa mantida no estorno pelo Asaas", () => {
    const g = SQL.slice(SQL.indexOf("create or replace function public.apply_receipt_split()"));
    expect(g.slice(0, g.indexOf("$$;"))).toMatch(/kept_after_refund and s\.waived_at is null/);
  });
  it("o estorno pelo Asaas não devolve a taxa do Asaas", () => {
    const f = SQL.slice(SQL.indexOf("create or replace function public._gateway_reverse_receipt("));
    const corpo = f.slice(0, f.indexOf("$$;"));
    expect(corpo).not.toMatch(/'acquirer_fee'/);
  });
});

describe("mensagens", () => {
  it("os códigos novos do banco têm frase em português", () => {
    for (const c of ["SURPLUS_NOT_FOUND", "SURPLUS_ALREADY_RESOLVED", "INSTALLMENT_OF_OTHER_CLIENT", "NOTHING_TO_WAIVE"]) {
      expect(mensagemDaCobranca(c), c).not.toMatch(/Não foi possível concluir/);
    }
  });
});
