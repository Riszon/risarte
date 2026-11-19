// PROVA DE PONTA A PONTA NO SANDBOX — ASA5 (4023): O EMPRESARIAL PELO ASAAS.
// Opcional, fora do portão do dia a dia:
//
//   RISARTE_TREINO_POOLER=1 ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/asaas-asa5-empresarial.integracao.test.ts
//
// No banco de TREINO, com uma empresa de prova ("Prova ASA5 (sandbox)", CNPJ de
// teste) e os contatos @example.com (reservados, não entregam a ninguém):
//   - a MENSALIDADE sai pela CONTA RAIZ, com split de 50% (percentual) para a
//     carteira da RisLife Teste, e a baixa vem pelo aviso com o split real;
//   - a IMPLANTAÇÃO sai pela CONTA DA RISLIFE TESTE, sem split;
//   - a cobrança à parte dos dependentes sai no CPF de quem paga;
//   - cancelada no Asaas, a linha do Empresarial pode ser cancelada.
// O pagamento é a simulação do sandbox. No fim: nenhum boleto vivo no sandbox, a
// configuração volta a "desligado" e a empresa de prova fica suspensa. Recusa a
// produção.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LIGADO = process.env.ASAAS_INTEGRACAO === "sim";
const PRODUCAO = "hvhbijctanrrkxhemlza";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOG: string[] = [];
const log = (s: string) => LOG.push(s);

function cnpjValido(): string {
  const b = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]);
  const dv = (n: number[]) => {
    const w = n.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = n.reduce((a, d, i) => a + d * w[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  b.push(dv(b));
  b.push(dv(b));
  return b.join("");
}

describe.skipIf(!LIGADO)("ASA5 4023 — o Empresarial pelo Asaas (sandbox)", () => {
  type Admin = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  type Pg = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> };
  let admin: Admin;
  let pg: Pg;
  let adm = "";
  let root = "";
  let rislife = "";
  let walletRl = "";
  let emp = "";
  let doc = "";
  const CNPJ = cnpjValido();
  const ch: Record<string, string> = {};
  const linha: Record<string, string> = {};
  let antes: Record<string, unknown> = {};

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
  const asaas = async (conta: string, caminho: string, metodo = "GET", corpo?: unknown) => {
    const { credencialDaConta } = await import("@/lib/asaas/account");
    const cred = await credencialDaConta(conta, "prova_asa5_4023", adm);
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
  const novaLinha = async (tipo: "MONTHLY" | "IMPLANTATION", extra: { mes?: string; employee?: string; payerName?: string; payerDoc?: string; valor?: number } = {}) =>
    (await pg.query(
      `insert into empresarial.adhesion_billing (company_id, company_document_id, billing_type, reference_month, total_amount_cents, status, due_date, description, employee_id, payer_name, payer_document)
       values ($1, $2, $3, $4, $5, 'PENDING', public.today_br() + 5, $6, $7, $8, $9) returning id`,
      [emp, extra.employee ? null : doc, tipo, tipo === "MONTHLY" ? (extra.mes ?? "2026-11-01") : null, extra.valor ?? 10000,
       tipo === "MONTHLY" ? "Mensalidade 11/2026 — Prova ASA5" : "Implantação — Prova ASA5", extra.employee ?? null, extra.payerName ?? null, extra.payerDoc ?? null]
    )).rows[0].id as string;
  const emitir = async (billingId: string) => {
    const p = await comoAdmin("select public.corporate_charge_prepare($1, true) j", [billingId]);
    expect(p.error).toBeNull();
    const j = p.rows[0].j as { charge_id?: string; motivo?: string };
    expect(j.motivo ?? null).toBeNull();
    const { emitirCobrancaEmpresarial } = await import("@/lib/asaas/empresarial");
    expect(await emitirCobrancaEmpresarial(j.charge_id!, adm)).toEqual({ ok: true });
    return j.charge_id!;
  };

  beforeAll(async () => {
    for (const l of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
      const i = l.indexOf("=");
      if (i < 1) continue;
      const k = l.slice(0, i).trim();
      if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(k)) process.env[k] = l.slice(i + 1).trim();
    }
    if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCAO)) throw new Error("RECUSADO: nunca contra o banco de produção.");
    admin = (await import("@/lib/supabase/admin")).createAdminClient();
    const { connect } = await import("../../../scripts/test-db.mjs");
    pg = (await connect()) as Pg;
    adm = (await admin.from("profiles").select("id").eq("email", "admin@example.com").single()).data!.id;
    root = (await pg.query("select public._franchise_root_account() id")).rows[0].id as string;
    const rl = (await pg.query("select id, wallet_id, environment from public.gateway_accounts where label = 'RisLife Teste'")).rows[0];
    rislife = rl.id as string;
    walletRl = rl.wallet_id as string;
    if (rl.environment !== "sandbox") throw new Error("RECUSADO: a conta da RisLife Teste não é de sandbox.");
    const { data: conta } = await admin.from("gateway_accounts").select("environment").eq("id", root).single();
    if (conta?.environment !== "sandbox") throw new Error("RECUSADO: a conta raiz não é de sandbox.");
    antes = (await pg.query("select enabled_from, rislife_account_id from public.corporate_gateway_settings where id")).rows[0];
    // A empresa de prova, cópia de uma ativa, com o CNPJ de teste e contatos @example.com.
    const base = (await pg.query("select id from empresarial.companies where status = 'ACTIVE' order by created_at limit 1")).rows[0].id;
    emp = (await pg.query(
      `insert into empresarial.companies
         select (jsonb_populate_record(null::empresarial.companies, to_jsonb(x) || jsonb_build_object(
           'id', gen_random_uuid(), 'cnpj', $2::text, 'legal_name', 'Prova ASA5 (sandbox) LTDA', 'trade_name', 'Prova ASA5 (sandbox)',
           'responsible_name', 'Responsável da Prova', 'responsible_email', 'prova.asa5@example.com', 'responsible_phone', '43999990000',
           'origin_lead_id', null))).*
           from empresarial.companies x where x.id = $1 returning id`, [base, CNPJ])).rows[0].id as string;
    doc = (await pg.query(
      "insert into empresarial.company_documents (company_id, doc_type, doc_number, doc_formatted, is_primary) values ($1, 'CNPJ', $2, $2, true) returning id",
      [emp, CNPJ])).rows[0].id as string;
    log(`empresa de prova ${emp} · CNPJ ${CNPJ}`);
  }, 120_000);

  afterAll(async () => {
    if (pg) {
      // Nunca deixa boleto vivo no sandbox.
      const vivas = (await pg.query(
        `select c.id, c.gateway_account_id, c.asaas_payment_id from public.charges c join public.corporate_charges cc on cc.charge_id = c.id
          where cc.company_id = $1 and c.status in ('emitida', 'vencida', 'emitindo', 'erro_emissao')`, [emp])).rows;
      const { cancelarNoAsaas } = await import("@/lib/asaas/cobranca");
      for (const v of vivas) {
        await cancelarNoAsaas({ chargeId: v.id as string, accountId: v.gateway_account_id as string, asaasPaymentId: (v.asaas_payment_id as string) ?? null, actorId: adm, reason: "prova 4023 (sandbox), limpeza" });
      }
      await pg.query("update public.corporate_gateway_settings set enabled_from = $1, rislife_account_id = $2 where id", [antes.enabled_from ?? null, antes.rislife_account_id ?? null]);
      if (emp) await pg.query("update empresarial.companies set status = 'SUSPENDED' where id = $1", [emp]);
      await pg.end();
      try {
        const { writeFileSync } = await import("node:fs");
        writeFileSync("scripts/.prova-4023.log", LOG.join("\n") + "\n");
      } catch {
        // o registro é só para ler depois
      }
    }
  }, 300_000);

  it("liga a rede com a RisLife Teste", async () => {
    const r = await comoAdmin("select public.corporate_settings_save(public.today_br(), $1)", [rislife]);
    expect(r.error).toBeNull();
  }, 60_000);

  it("a mensalidade sai pela conta raiz, com o split de 50% para a RisLife e o pagador empresa (avisos ligados)", async () => {
    linha.m = await novaLinha("MONTHLY");
    ch.m = await emitir(linha.m);
    const c = (await pg.query("select * from public.charges where id = $1", [ch.m])).rows[0];
    expect(c.status).toBe("emitida");
    expect(c.gateway_account_id).toBe(root);
    const p = await asaas(root, `/payments/${c.asaas_payment_id}`);
    expect(p.externalReference).toBe(ch.m);
    expect(Math.round(Number(p.value) * 100)).toBe(10000);
    expect((p.split ?? []).length).toBe(1);
    expect(p.split[0].walletId).toBe(walletRl);
    expect(Number(p.split[0].percentualValue)).toBe(50);
    const cli = await asaas(root, `/customers/${p.customer}`);
    expect(String(cli.cpfCnpj).replace(/\D/g, "")).toBe(CNPJ);
    expect(cli.email).toBe("prova.asa5@example.com");
    expect(String(cli.mobilePhone ?? "").replace(/\D/g, "")).toBe("43999990000");
    expect(cli.notificationDisabled).toBe(false);
    log(`mensalidade ${p.id} · conta raiz · split ${JSON.stringify(p.split.map((s: { walletId: string; percentualValue: number }) => ({ w: s.walletId.slice(0, 8), pct: s.percentualValue })))} · pagador ${cli.name}`);
  }, 180_000);

  it("paga (simulação): a baixa vem pelo aviso, com o split na origem e o que a RisLife recebeu de fato", async () => {
    const c = (await pg.query("select asaas_payment_id from public.charges where id = $1", [ch.m])).rows[0];
    await asaas(root, `/sandbox/payment/${c.asaas_payment_id}/confirm`, "POST", {});
    expect(await ate(async () => (await pg.query("select status from empresarial.adhesion_billing where id = $1", [linha.m])).rows[0].status === "PAID")).toBe(true);
    const b = (await pg.query("select split_at_source, split_rislife_cents, split_risarte_cents from empresarial.adhesion_billing where id = $1", [linha.m])).rows[0];
    const cc = (await pg.query("select paid_cents, net_cents, fee_cents from public.charges where id = $1", [ch.m])).rows[0];
    expect(b.split_at_source).toBe(true);
    const esperado = Math.floor(Number(cc.net_cents ?? cc.paid_cents) * 0.5);
    expect(Math.abs(Number(b.split_rislife_cents) - esperado)).toBeLessThanOrEqual(1);
    expect(Number(b.split_rislife_cents) + Number(b.split_risarte_cents)).toBe(10000);
    const payables = (await pg.query("select count(*) n from public.payables where empresarial_billing_id = $1", [linha.m])).rows[0];
    expect(Number(payables.n)).toBe(0);
    log(`mensalidade paga · líquido ${cc.net_cents} · tarifa ${cc.fee_cents} · RisLife ${b.split_rislife_cents} · franqueadora ${b.split_risarte_cents} · sem conta a pagar`);
  }, 240_000);

  it("a implantação sai pela conta da RisLife Teste, sem split, e a baixa vem pelo aviso dela", async () => {
    linha.i = await novaLinha("IMPLANTATION", { valor: 5000 });
    ch.i = await emitir(linha.i);
    const c = (await pg.query("select * from public.charges where id = $1", [ch.i])).rows[0];
    expect(c.gateway_account_id).toBe(rislife);
    const p = await asaas(rislife, `/payments/${c.asaas_payment_id}`);
    expect((p.split ?? []).length).toBe(0);
    log(`implantação ${p.id} · conta da RisLife Teste · sem split`);
    await asaas(rislife, `/sandbox/payment/${c.asaas_payment_id}/confirm`, "POST", {});
    expect(await ate(async () => (await pg.query("select status from empresarial.adhesion_billing where id = $1", [linha.i])).rows[0].status === "PAID")).toBe(true);
    const b = (await pg.query("select split_rislife_cents from empresarial.adhesion_billing where id = $1", [linha.i])).rows[0];
    expect(Number(b.split_rislife_cents)).toBe(5000);
    const razao = (await pg.query("select count(*) n from public.financial_entries where source_id = $1 or source_id = $2", [linha.i, ch.i])).rows[0];
    expect(Number(razao.n)).toBe(0);
    log("implantação paga · 100% RisLife · fora do razão da franqueadora");
  }, 240_000);

  it("a cobrança à parte dos dependentes sai no CPF de quem paga", async () => {
    const t = (await pg.query(
      `insert into empresarial.employees (company_id, cpf, full_name, phone, status, dependent_plan, dependents_payer, dependents_payer_name, dependents_payer_document, dependents_payer_email)
       values ($1, '86288366757', 'Titular da Prova', '43999990001', 'ACTIVE', 'FAMILY', 'OUTRO', 'Outro Pagador da Prova', '52998224725', 'outro.asa5@example.com') returning id`, [emp])).rows[0].id as string;
    linha.d = await novaLinha("MONTHLY", { employee: t, payerName: "Outro Pagador da Prova", payerDoc: "52998224725", valor: 3000 });
    ch.d = await emitir(linha.d);
    const c = (await pg.query("select asaas_payment_id from public.charges where id = $1", [ch.d])).rows[0];
    const p = await asaas(root, `/payments/${c.asaas_payment_id}`);
    const cli = await asaas(root, `/customers/${p.customer}`);
    expect(String(cli.cpfCnpj).replace(/\D/g, "")).toBe("52998224725");
    expect(cli.email).toBe("outro.asa5@example.com");
    log(`dependentes à parte ${p.id} · pagador ${cli.name} (CPF)`);
  }, 180_000);

  it("cancelada no Asaas primeiro, o Empresarial cancela a linha (a trava recusa antes)", async () => {
    const antesDeCancelar = await comoAdmin("select empresarial.cancel_billing($1, 'prova 4023: cancelar')", [linha.d]);
    expect(antesDeCancelar.error?.message ?? "").toContain("CHARGE_IN_GATEWAY");
    const c = (await pg.query("select asaas_payment_id from public.charges where id = $1", [ch.d])).rows[0];
    const { cancelarNoAsaas } = await import("@/lib/asaas/cobranca");
    expect(await cancelarNoAsaas({ chargeId: ch.d, accountId: root, asaasPaymentId: c.asaas_payment_id as string, actorId: adm, reason: "prova 4023: cancelar" })).toEqual({ ok: true });
    expect((await asaas(root, `/payments/${c.asaas_payment_id}`)).deleted).toBe(true);
    expect((await comoAdmin("select empresarial.cancel_billing($1, 'prova 4023: cancelar')", [linha.d])).error).toBeNull();
    log("cancelada no Asaas e depois no Empresarial");
  }, 180_000);
});
