// ASA4, entrega 2, parte 2 (4014) — devolução por Pix, contestação com prazo,
// link vencido e o split na aprovação: o que não depende do banco. O banco é
// provado no ensaio (scripts/asaas-ensaio-asa4-entrega2-parte2.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { saldoParaDevolver, ROTULO_DA_DEVOLUCAO, type DevolucaoDoParcelamento } from "@/lib/asaas/cobrancas-da-venda";

const SQL = readFileSync("supabase/migrations/4014_asa4_parcelado_devolucao_contestacao_e_avisos.sql", "utf8");
const API = readFileSync("src/lib/asaas/api.ts", "utf8");
const SERVIDOR = readFileSync("src/lib/asaas/parcelamento.ts", "utf8");
const ROTA = readFileSync("src/app/api/cron/gateway-regua/route.ts", "utf8");
const TELA = readFileSync("src/components/commercial/devolucao-do-parcelamento.tsx", "utf8");
const CENTRAL = readFileSync("src/app/(app)/central/conta-e-tarifas.tsx", "utf8");

const d = (valor: number, situacao: DevolucaoDoParcelamento["situacao"]): DevolucaoDoParcelamento => ({
  id: "x", valor, motivo: "desistência", situacao, termo: "c/b/t.pdf", termo_nome: null, pedida_em: "2026-11-15T10:00:00Z",
  quem_pediu: "Gerente", decidida_em: null, nota: null, conta_a_pagar: null,
});

describe("a devolução por Pix (19.20, 1a)", () => {
  it("o saldo para devolver: o pago menos o pedido ou autorizado (a negada não conta)", () => {
    expect(saldoParaDevolver({ pago_cents: 30001, devolucoes: [] })).toBe(30001);
    expect(saldoParaDevolver({ pago_cents: 30001, devolucoes: [d(15000, "autorizada"), d(5000, "pedida"), d(9000, "negada")] })).toBe(10001);
    expect(saldoParaDevolver({ pago_cents: 100, devolucoes: [d(200, "pedida")] })).toBe(0);
    expect(ROTULO_DA_DEVOLUCAO.autorizada).toMatch(/conta a pagar/);
  });
  it("sem o termo assinado anexado, não registra (pasta privada da unidade)", () => {
    expect(SQL).toContain("raise exception 'TERM_REQUIRED'");
    expect(SQL).toContain("public.clinic_of_storage_path(v_path) is distinct from v_clinic");
    expect(SQL).toContain("values ('devolucoes', 'devolucoes', false,");
  });
  it("só o Financeiro da Franqueadora ou o Admin Master autorizam; vira conta a pagar 1.9.03", () => {
    expect(SQL).toContain("if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;");
    expect(SQL).toContain("values (r.clinic_id, '1.9.03',");
  });
  it("a tela avisa do risco de contestação e diz que a taxa continua devida", () => {
    expect(TELA).toContain("o paciente ainda pode contestar a compra no cartão");
    expect(TELA).toContain("a taxa da rede");
  });
});

describe("a contestação com prazo (ajuste E)", () => {
  it("o servidor lê o prazo no Asaas (GET /payments/{id}/chargeback)", () => {
    expect(API).toContain('path: "/payments/{id}/chargeback"');
    expect(SERVIDOR).toContain("deadlineToSendDisputeDocuments");
  });
  it("o aviso: Gerente, quem fechou a venda, Financeiro e Admin; um por parcelamento; 2 dias úteis antes do prazo", () => {
    expect(SQL).toContain("public._admins_and_finance() || array[public._sale_closer(r.negotiation_id, r.direct_sale_id)]");
    expect(SQL).toContain("v_chave := coalesce(r.installment_block, r.id)::text;");
    expect(SQL).toContain("public._payout_add_business_days(v_hoje, 2) >= r.chargeback_deadline");
  });
});

describe("o link vencido (3a)", () => {
  it("aviso no dia útil seguinte e de 7 em 7 dias, sem cancelar sozinho", () => {
    expect(SQL).toContain("v_ciclo := (v_hoje - public._payout_add_business_days(r.primeiro, 1)) / 7;");
    expect(SQL).not.toMatch(/update public\.charges set status = 'cancelada'/);
  });
});

describe("o split na aprovação (3a)", () => {
  it("a tarifa do DIA DA APROVAÇÃO e a troca do parcelamento inteiro", () => {
    expect(SERVIDOR).toContain("hoje: b.paid_on, vencimento: b.paid_on");
    expect(SERVIDOR).toContain("await updateInstallmentSplits(cred, b.asaas_installment_id, splitsParaOAsaas(d0.entradas), opts);");
    expect(API).toContain('path: "/installments/{id}/splits"');
  });
  it("só enquanto nenhuma parcela teve o split liquidado", () => {
    expect(SQL).toContain("cs.status <> 'enviado'");
  });
  it("roda na rotina de 10 em 10 minutos, com os avisos", () => {
    expect(ROTA).toContain("conferirSplitDosParcelamentos()");
    expect(ROTA).toContain("conferirContestacoes()");
    expect(ROTA).toContain('rpc("chargeback_alerts_run")');
    expect(ROTA).toContain('rpc("card_block_overdue_alerts_run")');
  });
});

describe("a antecipação (aprovada: a diferença vira a cobrar da unidade)", () => {
  it("a Central explica o que muda e quanto custa a mais", () => {
    expect(CENTRAL).toContain("Antecipação ligada: o que muda.");
    expect(CENTRAL).toContain("conta a pagar da unidade");
  });
});
