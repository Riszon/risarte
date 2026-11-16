// ASA4, entrega 4 (4018) — as mensalidades pelo Asaas, do jeito genérico (19.32).
// O banco é provado no ensaio (scripts/asaas-ensaio-asa4-mensalidades.mjs) e o
// Asaas no sandbox (asaas-asa4-mensalidades.integracao.test.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/4018_asa4_mensalidades_pelo_asaas.sql", "utf8");
const ROTINA = readFileSync("src/lib/asaas/cobrancas-automaticas.ts", "utf8");
const PPR = readFileSync("src/app/(app)/ppr/actions.ts", "utf8");
const ORTO = readFileSync("src/app/(app)/ortodontia/actions.ts", "utf8");

const caminhoComum = () => {
  const i = SQL.indexOf("-- 2) O CAMINHO COMUM");
  const j = SQL.indexOf("-- 3) O PPR+");
  return SQL.slice(i, j);
};

describe("o caminho genérico (19.32.7)", () => {
  it("o caminho comum não tem regra presa a PPR+ ou Ortodontia: chama as funções registradas da origem", () => {
    const comum = caminhoComum();
    expect(comum).not.toMatch(/ppr_|ortho_/i);
    expect(comum).toContain("from public.charge_source_types");
    expect(comum).toContain("execute format('select public.%I($1, $2, $3, $4)', t.settle_fn)");
  });
  it("cada origem se registra com as suas funções", () => {
    expect(SQL).toContain("('ppr_charge', 'Mensalidade PPR+', '_ppr_fees_due', '_ppr_fee_info', '_ppr_fee_settle', '_ppr_fees_overdue', '_ppr_fee_visible', 10)");
    expect(SQL).toContain("('ortho_charge', 'Mensalidade da Ortodontia', '_ortho_fees_due', '_ortho_fee_info', '_ortho_fee_settle', '_ortho_fees_overdue', '_ortho_fee_visible', 20)");
  });
  it("a rotina das cobranças emite qualquer origem pelo mesmo caminho das parcelas", () => {
    expect(ROTINA).toContain('admin.rpc("_fee_charges_due"');
    expect(ROTINA).toContain('admin.rpc("_fee_charge_prepare_system"');
  });
});

describe("as regras aprovadas (19.32.5 e 19.32.10)", () => {
  it("sem multa nem juros; o desconto de pontualidade vai até o vencimento", () => {
    expect(SQL).toContain("p_billing_type, v.value_cents, least(coalesce(v.discount_cents, 0), v.value_cents - 1), 0, 0, 0, v.due_date,");
    expect(SQL).toContain("round(oc.amount_cents * public._ortho_fee_discount_pct(oc.id) / 100.0)");
  });
  it("recorrência continua como está (só boleto/Pix/cartão pelo link entram); a passagem exige a concordância", () => {
    expect(SQL).toContain("select case p_method when 'boleto' then 'BOLETO' when 'pix' then 'PIX' end;");
    expect(SQL).toContain("raise exception 'CONSENT_REQUIRED'");
  });
  it("nada muda sozinho: a unidade liga a partir de uma data, depois de marcar \"Avisei os clientes\"", () => {
    expect(SQL).toContain("raise exception 'WARNING_REQUIRED'");
    expect(SQL).toContain("and pc.due_date >= public._fees_unit_from(pc.clinic_id)");
  });
  it("PPR+: aos 90 dias não cancela; avisa o Gerente a cada 7 dias; suspensa não gera mensalidade", () => {
    expect(SQL).not.toMatch(/status = 'cancelado', cancelled_at = now\(\),\s*cancel_reason = 'Cancelado por falta de pagamento/);
    expect(SQL).toContain("mm.overdue_alert_at < now() - interval '7 days'");
    expect(SQL).toMatch(/_ppr_generate_run[\s\S]*where m\.status = 'ativo'/);
  });
  it("cancelada a adesão: os meses que não venceram caem (com a cobrança cancelada no Asaas antes)", () => {
    expect(SQL).toContain("where membership_id = new.id and status in ('em_aberto', 'atrasada') and due_date >= public.today_br();");
    expect(PPR).toContain('cancelarCobrancasDasMensalidades({ tipo: "ppr_charge"');
    expect(ORTO).toContain('cancelarCobrancasDasMensalidades({ tipo: "ortho_charge"');
  });
  it("a taxa da rede da mensalidade paga pelo Asaas com split nasce retida (nunca em dobro)", () => {
    expect(SQL).toContain("where ch.source_type = new.source_type and ch.source_id = new.source_id and ch.split_applied");
  });
  it("o selo \"Em atraso\" inclui a mensalidade vencida, pela mesma permissão", () => {
    expect(SQL).toContain("select f.client_id, f.clinic_id, f.due_date from public._fee_sources_overdue(p_client_ids, v_cutoff) f");
    expect(SQL).toContain("public._gateway_cap_clinics('acao.cobranca.selo_atraso')");
  });
});
