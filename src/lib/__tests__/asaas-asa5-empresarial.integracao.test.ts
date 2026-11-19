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

  it("recebeu por fora: cancela no Asaas e dá a baixa manual (a parte da RisLife vira conta a pagar)", async () => {
    linha.f = await novaLinha("MONTHLY", { mes: "2026-12-01" });
    ch.f = await emitir(linha.f);
    expect((await comoAdmin("select empresarial.settle_billing($1, now())", [linha.f])).error?.message ?? "").toContain("CHARGE_IN_GATEWAY");
    const c = (await pg.query("select asaas_payment_id from public.charges where id = $1", [ch.f])).rows[0];
    const { cancelarNoAsaas } = await import("@/lib/asaas/cobranca");
    expect(await cancelarNoAsaas({ chargeId: ch.f, accountId: root, asaasPaymentId: c.asaas_payment_id as string, actorId: adm, reason: "Recebida por fora do Asaas" })).toEqual({ ok: true });
    expect((await comoAdmin("select empresarial.settle_billing($1, now())", [linha.f])).error).toBeNull();
    const b = (await pg.query("select status, split_at_source, split_rislife_cents from empresarial.adhesion_billing where id = $1", [linha.f])).rows[0];
    expect(b.status).toBe("PAID");
    expect(b.split_at_source).toBe(false);
    expect(Number(b.split_rislife_cents)).toBe(5000);
    const pay = (await pg.query("select amount_cents from public.payables where empresarial_billing_id = $1", [linha.f])).rows[0];
    expect(Number(pay?.amount_cents)).toBe(5000);
    expect((await asaas(root, `/payments/${c.asaas_payment_id}`)).deleted).toBe(true);
    log("recebeu por fora · cancelada no Asaas · baixa manual · conta a pagar à RisLife de R$ 50,00 (50% do total)");
  }, 180_000);

  it("editar: cancela no Asaas e emite de novo, já com o valor novo", async () => {
    linha.e = await novaLinha("MONTHLY", { mes: "2027-01-01" });
    ch.e = await emitir(linha.e);
    const c = (await pg.query("select asaas_payment_id from public.charges where id = $1", [ch.e])).rows[0];
    expect((await comoAdmin("update empresarial.adhesion_billing set total_amount_cents = 12000 where id = $1", [linha.e])).error?.message ?? "").toContain("CHARGE_IN_GATEWAY");
    const { cancelarNoAsaas } = await import("@/lib/asaas/cobranca");
    expect(await cancelarNoAsaas({ chargeId: ch.e, accountId: root, asaasPaymentId: c.asaas_payment_id as string, actorId: adm, reason: "Cobrança editada no Empresarial" })).toEqual({ ok: true });
    expect((await comoAdmin("update empresarial.adhesion_billing set total_amount_cents = 12000 where id = $1", [linha.e])).error).toBeNull();
    const nova = await emitir(linha.e);
    expect(nova).not.toBe(ch.e);
    const c2 = (await pg.query("select asaas_payment_id from public.charges where id = $1", [nova])).rows[0];
    const p = await asaas(root, `/payments/${c2.asaas_payment_id}`);
    expect(Math.round(Number(p.value) * 100)).toBe(12000);
    ch.e = nova;
    log(`editada · a antiga apagada no Asaas · a nova ${p.id} com R$ 120,00`);
  }, 240_000);

  it("o relatório do mês: a foto guardada, o link na descrição da cobrança e a página pública", async () => {
    linha.r = await novaLinha("MONTHLY", { mes: "2027-02-01" });
    const prep = await comoAdmin("select public.corporate_charge_prepare($1, true) j", [linha.r]);
    const chargeId = (prep.rows[0].j as { charge_id: string }).charge_id;
    // A foto no formato do "Relatório detalhado" (CompanyReport), como a emissão guarda.
    const { DEFAULT_ADHESION_PRICING } = await import("@/lib/empresarial/pricing");
    const foto = {
      company: {
        id: emp, cnpj: CNPJ, legalName: "Prova ASA5 (sandbox) LTDA", tradeName: "Prova ASA5 (sandbox)", stateRegistration: null,
        address: null, employeeCount: 1, status: "ACTIVE", paymentModel: "COMPANY_PAYS", paymentMethods: ["BOLETO"], dueDay: 10,
        defaultMaxInstallments: 1, contractStartedAt: null, gracePeriodDays: 0, employeeGracePeriodDays: 0, notes: null, consultantName: null,
      },
      pricing: DEFAULT_ADHESION_PRICING,
      pricingScope: "rede",
      employees: [{
        id: "00000000-0000-0000-0000-000000000001", fullName: "Titular da Prova", cpf: "86288366757", phone: "43999990001", email: null,
        status: "ACTIVE", registrationStage: "COMPLETED", dependentPlan: "FAMILY", joinedAt: "2026-11-01", leftAt: null, leftReason: null,
        clinicName: null, linked: false, monthlyCents: 10000,
        dependents: [{ id: "00000000-0000-0000-0000-000000000002", fullName: "Dependente da Prova", cpf: "52998224725", phone: null, relationship: "SPOUSE", status: "ACTIVE", linked: false }],
      }],
      filter: "ACTIVE",
      filterLabel: "Somente ativos",
      totals: { employeesActive: 1, employeesInactive: 0, employeesDeleted: 0, dependentsActive: 1, linkedClients: 0, pendingRegistration: 0, monthlyCents: 10000, savedCents: 0, benefitUses: 0 },
      generatedAt: new Date().toISOString(),
    };
    const rep = (await pg.query("select public._corporate_report_save($1, $2, $3) j", [linha.r, JSON.stringify(foto), adm])).rows[0].j as { id: string; code: string };
    const link = `https://risarte-asaas.vercel.app/relatorio-do-mes/${rep.code}`;
    await pg.query("select public._corporate_charge_report($1, $2, $3)", [chargeId, rep.id, ` — Titulares e dependentes do mês: ${link}`]);
    const { emitirCobrancaEmpresarial } = await import("@/lib/asaas/empresarial");
    expect(await emitirCobrancaEmpresarial(chargeId, adm)).toEqual({ ok: true });
    ch.r = chargeId;
    const c = (await pg.query("select asaas_payment_id from public.charges where id = $1", [chargeId])).rows[0];
    const p = await asaas(root, `/payments/${c.asaas_payment_id}`);
    expect(String(p.description)).toContain(rep.code);
    const pagina = await fetch(link);
    expect(pagina.status).toBe(200);
    const html = await pagina.text();
    expect(html).not.toContain("Link não encontrado");
    expect(html).toContain("como estavam no dia em que a cobrança foi gerada");
    log(`relatório do mês · link na cobrança ${p.id} · página pública 200`);
  }, 240_000);

  it("o funil: a implantação emitida pelo funil sai pela RisLife e, paga, sela o 1º pagamento do lead", async () => {
    const lead = (await pg.query(
      `insert into empresarial.commercial_leads (company_name, cnpj, contact_name, contact_phone, stage, company_id)
       values ('Prova ASA5 lead', $1, 'Contato da Prova', '43999990002', 'PROPOSAL_SENT', $2) returning id`, [CNPJ, emp])).rows[0].id as string;
    const iss = await comoAdmin("select public.corporate_lead_implantation_issue($1, 7000, public.today_br() + 3) id", [lead]);
    expect(iss.error).toBeNull();
    linha.l = iss.rows[0].id as string;
    ch.l = await emitir(linha.l);
    const c = (await pg.query("select gateway_account_id, asaas_payment_id from public.charges where id = $1", [ch.l])).rows[0];
    expect(c.gateway_account_id).toBe(rislife);
    await asaas(rislife, `/sandbox/payment/${c.asaas_payment_id}/confirm`, "POST", {});
    expect(await ate(async () => Boolean((await pg.query("select implantation_paid_at from empresarial.commercial_leads where id = $1", [lead])).rows[0].implantation_paid_at))).toBe(true);
    const l = (await pg.query("select implantation_paid_cents, implantation_payment_method from empresarial.commercial_leads where id = $1", [lead])).rows[0];
    expect(Number(l.implantation_paid_cents)).toBe(7000);
    log(`funil · implantação de R$ 70,00 pela RisLife Teste · paga · lead selado (${l.implantation_payment_method})`);
  }, 240_000);
});
