// PROVA DE PONTA A PONTA NO SANDBOX — ASA6 (4021): a COBRANÇA MENSAL DA REDE.
// Opcional, fora do portão do dia a dia:
//
//   RISARTE_TREINO_POOLER=1 ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/asaas-asa6-cobranca-mensal.integracao.test.ts
//
// Contra a CONTA RAIZ do sandbox (a da franqueadora), no banco de TREINO, com a
// unidade de Londrina como pagadora (o CNPJ do cadastro de treino). Os valores
// da configuração são EXEMPLO (marcados). O e-mail financeiro é um endereço
// @example.com (reservado, não entrega a ninguém). O pagamento é a simulação do
// sandbox, e a baixa vem pelo aviso do Asaas ao projeto de teste.
// No fim, a configuração volta ao que era (em branco) e o mês de outubro de
// Londrina volta a ficar fechado. Recusa o banco de produção.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LIGADO = process.env.ASAAS_INTEGRACAO === "sim";
const PRODUCAO = "hvhbijctanrrkxhemlza";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const OUT = "2026-10-01";

describe.skipIf(!LIGADO)("ASA6 4021 — a cobrança mensal da rede pela conta da franqueadora (sandbox)", () => {
  type Admin = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  type Pg = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> };
  let admin: Admin;
  let pg: Pg;
  let ldn = "";
  let adm = "";
  let root = "";
  let lote = "";
  let cobranca = "";
  const antes: { rede?: Record<string, unknown>; fees?: Record<string, unknown>[]; periodo?: Record<string, unknown>[] } = {};

  const comoAdmin = async (sql: string, params: unknown[] = []) => {
    await pg.query("begin");
    try {
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adm, role: "authenticated" })]);
      await pg.query("set local role authenticated");
      const r = await pg.query(sql, params);
      await pg.query("commit");
      return { rows: r.rows, error: null as null | { message: string } };
    } catch (e) {
      await pg.query("rollback");
      return { rows: [] as Record<string, unknown>[], error: { message: (e as Error).message } };
    }
  };
  const asaas = async (caminho: string, metodo = "GET", corpo?: unknown) => {
    const { credencialDaConta } = await import("@/lib/asaas/account");
    const cred = await credencialDaConta(root, "prova_asa6_4021", adm);
    const r = await fetch(`https://api-sandbox.asaas.com/v3${caminho}`, {
      method: metodo,
      headers: { access_token: cred.apiKey, "User-Agent": "riSZon - prova", "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return r.json();
  };
  const ate = async (f: () => Promise<boolean>, vezes = 40) => {
    for (let i = 0; i < vezes; i++) {
      if (await f()) return true;
      await espera(3000);
    }
    return false;
  };

  beforeAll(async () => {
    for (const linha of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
      const i = linha.indexOf("=");
      if (i < 1) continue;
      const k = linha.slice(0, i).trim();
      if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(k)) process.env[k] = linha.slice(i + 1).trim();
    }
    if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCAO)) throw new Error("RECUSADO: nunca contra o banco de produção.");
    admin = (await import("@/lib/supabase/admin")).createAdminClient();
    const { connect } = await import("../../../scripts/test-db.mjs");
    pg = (await connect()) as Pg;
    ldn = (await admin.from("clinics").select("id").eq("name", "Risarte Londrina - Centro").single()).data!.id;
    adm = (await admin.from("profiles").select("id").eq("email", "admin@example.com").single()).data!.id;
    root = (await pg.query("select public._franchise_root_account() id")).rows[0].id as string;
    const { data: conta } = await admin.from("gateway_accounts").select("environment").eq("id", root).single();
    if (conta?.environment !== "sandbox") throw new Error("RECUSADO: a conta raiz não é de sandbox.");
    antes.rede = (await pg.query("select * from public.franchise_billing_settings where id")).rows[0];
    antes.fees = (await pg.query("select fee, amount_cents from public.network_fees where clinic_id is null and fee in ('sistema', 'sdr')")).rows;
    antes.periodo = (await pg.query("select status from public.fiscal_periods where clinic_id = $1 and year = 2026 and month = 10", [ldn])).rows;
    if ((await pg.query("select 1 from public.franchise_monthly_batches where clinic_id = $1 and period = $2 and status <> 'cancelada'", [ldn, OUT])).rows.length) {
      throw new Error("NÃO MEDI: Londrina já tem a cobrança de outubro no treino.");
    }
  }, 60_000);

  afterAll(async () => {
    if (pg) {
      // Nunca deixa boleto vivo no sandbox.
      const vivas = (await pg.query(
        "select c.id, c.asaas_payment_id from public.charges c join public.franchise_monthly_batches b on b.id = c.source_id where b.clinic_id = $1 and b.period = $2 and c.status in ('emitida', 'vencida', 'emitindo', 'erro_emissao')",
        [ldn, OUT]
      )).rows;
      if (vivas.length) {
        const { cancelarNoAsaas } = await import("@/lib/asaas/cobranca");
        for (const v of vivas) await cancelarNoAsaas({ chargeId: v.id as string, accountId: root, asaasPaymentId: (v.asaas_payment_id as string) ?? null, actorId: adm, reason: "prova 4021 (sandbox), limpeza" });
      }
      // A configuração volta ao que era (em branco); outubro de Londrina volta a fechar.
      const r = antes.rede ?? {};
      await pg.query(
        `update public.franchise_billing_settings set fine_percent = $1, interest_percent_month = $2, due_day = $3, period_kind = $4, preview_days = $5,
           partial_month_rule = $6, revenue_recognition = $7, example_values = $8 where id`,
        [r.fine_percent ?? null, r.interest_percent_month ?? null, r.due_day ?? null, r.period_kind ?? null, r.preview_days ?? null, r.partial_month_rule ?? null, r.revenue_recognition ?? null, r.example_values ?? false]
      );
      await pg.query("delete from public.franchise_billing_unit_settings where clinic_id = $1", [ldn]);
      for (const f of antes.fees ?? []) await pg.query("update public.network_fees set amount_cents = $1 where clinic_id is null and fee = $2", [f.amount_cents, f.fee]);
      if (antes.periodo?.[0]?.status === "closed") await pg.query("update public.fiscal_periods set status = 'closed' where clinic_id = $1 and year = 2026 and month = 10", [ldn]);
      await pg.end();
    }
  }, 300_000);

  it("a configuração de exemplo (marcada) e a prévia de outubro de Londrina", async () => {
    // Outubro de Londrina está fechado no treino; abre só para a prova (volta no fim).
    await pg.query("update public.fiscal_periods set status = 'open' where clinic_id = $1 and year = 2026 and month = 10", [ldn]);
    await pg.query("update public.network_fees set amount_cents = case fee when 'sistema' then 30000 else 50000 end where clinic_id is null and fee in ('sistema', 'sdr')");
    const rede = { fine_percent: "2", interest_percent_month: "1", due_day: "10", period_kind: "mes_calendario", preview_days: "5", partial_month_rule: "proporcional", example_values: true };
    expect((await comoAdmin("select public.franchise_billing_settings_save($1::jsonb)", [JSON.stringify(rede)])).error).toBeNull();
    const uni = { finance_email: "financeiro.londrina@example.com", monthly_from: OUT, example_values: true };
    expect((await comoAdmin("select public.franchise_billing_unit_save($1, $2::jsonb)", [ldn, JSON.stringify(uni)])).error).toBeNull();
    const ab = await comoAdmin("select public.franchise_monthly_open($1, $2) id", [ldn, OUT]);
    expect(ab.error).toBeNull();
    lote = ab.rows[0].id as string;
    const b = (await pg.query("select status, total_cents, example_values from public.franchise_monthly_batches where id = $1", [lote])).rows[0];
    expect(b.status).toBe("previa");
    expect(b.example_values).toBe(true);
    expect(Number(b.total_cents)).toBeGreaterThanOrEqual(80000); // tecnologia R$ 300 + SDR R$ 500 (exemplo) + o "a cobrar" do mês, se houver
  }, 120_000);

  it("aprovada e emitida pela conta da franqueadora, com a unidade (CNPJ) como pagadora, só e-mail", async () => {
    // O silêncio da unidade: o prazo passa (simulado) e a prévia vai para a aprovação.
    await pg.query("update public.franchise_monthly_batches set preview_deadline = public.today_br() - 1 where id = $1", [lote]);
    const ap = await comoAdmin("select public.franchise_monthly_approve($1) j", [lote]);
    expect(ap.error).toBeNull();
    cobranca = (ap.rows[0].j as { charge_id: string }).charge_id;
    const { emitirCobrancaMensal } = await import("@/lib/asaas/cobranca-mensal");
    const e = await emitirCobrancaMensal(cobranca, adm);
    expect(e).toEqual({ ok: true });
    const ch = (await pg.query("select * from public.charges where id = $1", [cobranca])).rows[0];
    expect(ch.status).toBe("emitida");
    expect(ch.gateway_account_id).toBe(root);
    const p = await asaas(`/payments/${ch.asaas_payment_id}`);
    expect(p.billingType).toBe("BOLETO");
    expect(Math.round(Number(p.value) * 100)).toBe(Number(ch.value_cents));
    expect(Number(p.fine?.value)).toBeCloseTo(Number(ch.fine_cents) / 100, 2);
    expect(Number(p.interest?.value)).toBe(1);
    expect(Number(p.discount?.value ?? 0)).toBe(0);
    expect(p.externalReference).toBe(cobranca);
    const c = await asaas(`/customers/${p.customer}`);
    expect(String(c.cpfCnpj).replace(/\D/g, "")).toBe("32042156000121");
    expect(c.email).toBe("financeiro.londrina@example.com");
    expect(c.notificationDisabled).toBe(false);
    expect(c.mobilePhone ?? null).toBeNull();
    const lb = (await pg.query("select status from public.franchise_monthly_batches where id = $1", [lote])).rows[0];
    expect(lb.status).toBe("emitida");
    console.log("  [prova] pagamento", p.id, "valor", p.value, "vence", p.dueDate, "multa", p.fine?.value, "juros", p.interest?.value, "% · pagador", c.name);
  }, 180_000);

  it("cancelada no Asaas para reemitir: o lote cai e a prévia remonta com o mesmo valor", async () => {
    const total = Number((await pg.query("select total_cents from public.franchise_monthly_batches where id = $1", [lote])).rows[0].total_cents);
    const ck = await comoAdmin("select public.franchise_monthly_cancel_check($1) j", [lote]);
    expect(ck.error).toBeNull();
    const j = ck.rows[0].j as { charge_id: string; account_id: string; asaas_payment_id: string };
    const { cancelarNoAsaas } = await import("@/lib/asaas/cobranca");
    expect(await cancelarNoAsaas({ chargeId: j.charge_id, accountId: j.account_id, asaasPaymentId: j.asaas_payment_id, actorId: adm, reason: "prova 4021: reemitir" })).toEqual({ ok: true });
    const p = await asaas(`/payments/${j.asaas_payment_id}`);
    expect(p.deleted).toBe(true);
    expect((await pg.query("select status from public.franchise_monthly_batches where id = $1", [lote])).rows[0].status).toBe("cancelada");
    const ab = await comoAdmin("select public.franchise_monthly_open($1, $2) id", [ldn, OUT]);
    expect(ab.error).toBeNull();
    lote = ab.rows[0].id as string;
    expect(Number((await pg.query("select total_cents from public.franchise_monthly_batches where id = $1", [lote])).rows[0].total_cents)).toBe(total);
    await pg.query("update public.franchise_monthly_batches set preview_deadline = public.today_br() - 1 where id = $1", [lote]);
    const ap = await comoAdmin("select public.franchise_monthly_approve($1) j", [lote]);
    expect(ap.error).toBeNull();
    cobranca = (ap.rows[0].j as { charge_id: string }).charge_id;
    const { emitirCobrancaMensal } = await import("@/lib/asaas/cobranca-mensal");
    expect(await emitirCobrancaMensal(cobranca, adm)).toEqual({ ok: true });
  }, 240_000);

  it("paga (simulação do sandbox): a baixa vem pelo aviso do Asaas e paga as contas de taxa da unidade", async () => {
    const ch = (await pg.query("select asaas_payment_id, value_cents from public.charges where id = $1", [cobranca])).rows[0];
    await asaas(`/sandbox/payment/${ch.asaas_payment_id}/confirm`, "POST", {});
    const ok = await ate(async () => (await pg.query("select status from public.franchise_monthly_batches where id = $1", [lote])).rows[0].status === "paga");
    expect(ok).toBe(true);
    const b = (await pg.query("select * from public.franchise_monthly_batches where id = $1", [lote])).rows[0];
    expect(b.settled_at).not.toBeNull();
    const caixa = (await pg.query(
      `select coalesce(sum(f.amount_cents), 0) s from public.financial_entries f join public.payable_payments pp on pp.id = f.source_id
        where f.source_type = 'payable_cash' and pp.reference = 'Cobrança mensal da rede 10/2026' and f.clinic_id = $1`, [ldn])).rows[0];
    expect(Number(caixa.s)).toBe(Number(b.total_cents));
    const abertas = (await pg.query(
      `select count(*) n from public.payables p join public.franchise_monthly_items i on i.payable_id = p.id
        where i.batch_id = $1 and p.status <> 'paga'`, [lote])).rows[0];
    expect(Number(abertas.n)).toBe(0);
    const tarifa = (await pg.query("select amount_cents, account_code from public.financial_entries where source_type = 'gateway_fee_charge' and source_id = $1", [cobranca])).rows;
    console.log("  [prova] pago", b.paid_cents, "em", b.paid_on, "· tarifa do Asaas (franqueadora):", tarifa.map((t) => `${t.account_code} ${t.amount_cents}`).join(", ") || "nenhuma no aviso");
  }, 240_000);
});
