// PROVA REAL NO SANDBOX DO ASAAS — opcional, fora do portão do dia a dia.
//
//   npm run test:asaas
//
// Roda o caminho de verdade do servidor contra as contas de TESTE registradas
// no banco de TREINO: lê a chave no Vault pela chave de serviço (a mesma porta
// que o site usa), fala com o sandbox do Asaas e grava situação, tarifas,
// chave Pix e antecipação. Sem `ASAAS_INTEGRACAO=sim` o arquivo inteiro é
// pulado — `npm test` não depende de rede nem de conta.
//
// TRAVAS: só roda com o banco de treino (recusa o projeto de produção pelo
// identificador) e só mexe em conta `sandbox`. Nenhuma chave aparece na saída.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const LIGADO = process.env.ASAAS_INTEGRACAO === "sim";

/**
 * O sandbox do Asaas devolve 500 ao confirmar ou apagar um BOLETO nos primeiros
 * segundos depois de criado (o registro ainda não terminou). Espera e tenta de
 * novo — só nos testes; no produto o erro vira "tente de novo em instantes".
 */
async function comPaciencia<T>(fn: () => Promise<T>, vezes = 6, esperaMs = 5000): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < vezes; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimo = e;
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
  throw ultimo;
}
const PRODUCAO = "hvhbijctanrrkxhemlza";

describe.skipIf(!LIGADO)("Asaas sandbox — o caminho real do servidor", () => {
  beforeAll(() => {
    for (const linha of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
      const i = linha.indexOf("=");
      if (i < 1) continue;
      const k = linha.slice(0, i).trim();
      if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(k)) {
        process.env[k] = linha.slice(i + 1).trim();
      }
    }
    if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCAO)) {
      throw new Error("RECUSADO: este teste nunca roda contra o banco de produção.");
    }
  });

  // Só com o endereço público do projeto de teste na Vercel, por exemplo:
  //   ASAAS_WEBHOOK_BASE_URL=https://risarte-asaas.vercel.app npm run test:asaas
  // Cria (ou recria) o webhook de cada conta de teste apontando para lá, pelo
  // MESMO código do botão "Criar o webhook" da Central. Os avisos do Asaas
  // sobre a fila vão para ASAAS_WEBHOOK_EMAIL (padrão: um endereço de teste).
  it.skipIf(!process.env.ASAAS_WEBHOOK_BASE_URL)("cria o webhook de cada conta de teste no endereço publicado", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { criarWebhookDaConta, enderecoDoWebhook } = await import("@/lib/asaas/link");
    const admin = createAdminClient();
    const { data: contas } = await admin
      .from("gateway_accounts")
      .select("id, label, webhook_ref")
      .eq("environment", "sandbox")
      .eq("status", "active")
      .not("api_key_secret_id", "is", null);
    expect((contas ?? []).length).toBeGreaterThan(0);
    for (const c of contas ?? []) {
      expect(enderecoDoWebhook(c.webhook_ref)).toMatch(/^https:\/\/.+\/api\/webhooks\/asaas\/[0-9a-f]{32}$/);
      const r = await criarWebhookDaConta({
        accountId: c.id,
        actorId: null,
        notifyEmail: process.env.ASAAS_WEBHOOK_EMAIL || "riszon.webhook.teste@example.com",
      });
      expect(r, c.label).toBe("created");
    }
  }, 120_000);

  it("verifica cada conta de teste: chave do Vault aceita, tarifas gravadas", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { verificarConta } = await import("@/lib/asaas/link");
    const admin = createAdminClient();

    const { data: contas, error } = await admin
      .from("gateway_accounts")
      .select("id, label, owner_type, environment")
      .eq("environment", "sandbox")
      .eq("status", "active")
      .not("api_key_secret_id", "is", null);
    expect(error).toBeNull();
    // Zero contas é "não medi", não "passou".
    expect((contas ?? []).length, "nenhuma conta de teste registrada: rode scripts/asaas-sandbox-contas.mjs").toBeGreaterThan(0);

    for (const c of contas ?? []) {
      const r = await verificarConta({ accountId: c.id, actorId: null, purpose: "integration_test" });
      expect(r.status, `${c.label}: ${"error" in r ? r.error : ""}`).toBe("ok");

      const { data: depois } = await admin
        .from("gateway_accounts")
        .select("last_check_ok, api_key_last_used_at, fees_synced_at, pix_key_active")
        .eq("id", c.id)
        .single();
      expect(depois?.last_check_ok).toBe(true);
      expect(depois?.api_key_last_used_at).not.toBeNull();

      if (c.owner_type !== "recipient") {
        expect(depois?.fees_synced_at, `${c.label}: tarifas não sincronizadas`).not.toBeNull();
        const { data: adq } = await admin.from("card_acquirers").select("id, is_default").eq("gateway_account_id", c.id).single();
        expect(adq?.is_default).toBe(false);
        const { count } = await admin
          .from("acquirer_rates")
          .select("id", { count: "exact", head: true })
          .eq("acquirer_id", adq!.id)
          .eq("source", "gateway");
        expect(count ?? 0, `${c.label}: nenhuma tarifa do Asaas gravada`).toBeGreaterThan(0);
      }

      const { count: usos } = await admin
        .from("gateway_key_usage")
        .select("id", { count: "exact", head: true })
        .eq("account_id", c.id)
        .eq("purpose", "integration_test");
      expect(usos ?? 0, `${c.label}: a leitura da chave não foi registrada`).toBeGreaterThan(0);

      const { data: log } = await admin
        .from("gateway_api_log")
        .select("path, http_status")
        .eq("account_id", c.id)
        .eq("purpose", "integration_test");
      expect((log ?? []).length).toBeGreaterThan(0);
      // O registro guarda o MODELO da rota: nada de consulta, chave ou identificador.
      for (const l of log ?? []) expect(l.path).toMatch(/^\/[A-Za-z/{}]+$/);
    }
  }, 120_000);
});

// ASA1, entrega 2 — a COBRANÇA DE PARCELA de ponta a ponta no sandbox, pelo
// caminho do servidor: o Admin de teste prepara pela porta do banco, o servidor
// emite no Asaas com a chave da unidade, o sandbox confirma o pagamento.
// Cria dados de TESTE no treino (paciente menor "Teste Asaas ASA1" com a mãe
// como responsável financeira, uma venda e três parcelas pequenas).
describe.skipIf(!LIGADO)("Asaas sandbox — a cobrança de parcela (ASA1)", () => {
  it("emite em nome do responsável financeiro, paga no sandbox, não duplica, cancela e reemite vencida", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { emitirNoAsaas, cancelarNoAsaas } = await import("@/lib/asaas/cobranca");
    const { credencialDaConta, opcoesDaConta } = await import("@/lib/asaas/account");
    const { findPaymentsByReference, getPayment, findCustomerByCpfCnpj } = await import("@/lib/asaas/api");
    const { asaasRequest } = await import("@/lib/asaas/client");
    const admin = createAdminClient();

    // Entra como o Admin Master de TESTE (link de uso único).
    const { data: link, error: eLink } = await admin.auth.admin.generateLink({ type: "magiclink", email: "admin@example.com" });
    expect(eLink).toBeNull();
    const pessoa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { data: sess, error: eOtp } = await pessoa.auth.verifyOtp({ type: "magiclink", token_hash: link!.properties!.hashed_token });
    expect(eOtp).toBeNull();
    const adminId = sess.user!.id;

    // A unidade de teste com conta Asaas (a primeira) pronta para cobrar.
    const { data: conta } = await admin
      .from("gateway_accounts")
      .select("id, clinic_id, term_signed_on, split_enabled_declared_at")
      .eq("owner_type", "unit")
      .eq("environment", "sandbox")
      .eq("status", "active")
      .order("created_at")
      .limit(1)
      .single();
    const unidade = conta!.clinic_id as string;
    if (!conta!.term_signed_on) {
      const r = await pessoa.rpc("gateway_register_term", {
        p_account_id: conta!.id,
        p_signed_on: new Date().toISOString().slice(0, 10),
        p_signed_by_name: "Franqueado de Teste",
        p_note: "teste ASA1",
      });
      expect(r.error).toBeNull();
    }
    if (!conta!.split_enabled_declared_at) {
      expect((await pessoa.rpc("gateway_declare_split_enabled", { p_account_id: conta!.id, p_enabled: true })).error).toBeNull();
    }
    expect((await pessoa.rpc("central_mark_ready", { p_clinic_id: unidade, p_ready: true })).error).toBeNull();

    // O paciente menor e a mãe pagadora (CPFs válidos inventados).
    const cpf = () => {
      const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
      const dv = (a: number[], p: number) => {
        const r = (a.reduce((s, n, i) => s + n * (p - i), 0) * 10) % 11;
        return r === 10 ? 0 : r;
      };
      d.push(dv(d, 10));
      d.push(dv(d, 11));
      return d.join("");
    };
    const cpfMae = cpf();
    const { data: cli } = await admin
      .from("clients")
      .insert({ clinic_id: unidade, full_name: "Teste Asaas ASA1 Paciente", birth_date: "2015-05-05", no_cpf: true })
      .select("id")
      .single();
    const { data: mae } = await admin
      .from("client_guardians")
      .insert({ client_id: cli!.id, full_name: "Teste Asaas ASA1 Mãe", cpf: cpfMae, relationship: "mãe", is_financial: true })
      .select("id")
      .single();
    expect(mae?.id).toBeTruthy();
    const { data: venda } = await admin
      .from("direct_sales")
      .insert({
        clinic_id: unidade,
        client_id: cli!.id,
        client_name: "Teste Asaas ASA1",
        description: "Teste ASA1",
        value_cents: 1800,
        contract_signed: true,
      })
      .select("id")
      .single();
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const dia = (n: number) => new Date(Date.parse(hoje) + n * 86400_000).toISOString().slice(0, 10);
    const parcela = async (seq: number, venc: string, metodo: string) =>
      (
        await admin
          .from("payment_installments")
          .insert({
            clinic_id: unidade,
            client_id: cli!.id,
            direct_sale_id: venda!.id,
            seq,
            due_date: venc,
            amount_cents: 600,
            payment_method: metodo,
            late_fee_percent: 2,
            monthly_interest_percent: 1,
            grace_days: 0,
          })
          .select("id")
          .single()
      ).data!.id as string;
    const p1 = await parcela(1, dia(5), "pix");
    const p2 = await parcela(2, dia(10), "boleto");
    const p3 = await parcela(3, dia(-10), "pix");

    const cred = await credencialDaConta(conta!.id, "integration_test", null);
    const opts = opcoesDaConta(conta!.id, "integration_test");

    // 1) Em dia, Pix, pagadora = a mãe.
    const { data: c1, error: e1 } = await pessoa.rpc("charge_prepare", { p_installment_id: p1, p_billing_type: "PIX", p_due_date: null });
    expect(e1).toBeNull();
    expect(await emitirNoAsaas(c1 as string, adminId)).toEqual({ ok: true });
    const { data: r1 } = await admin.from("charges").select("*").eq("id", c1).single();
    expect(r1.status).toBe("emitida");
    expect(r1.invoice_url).toMatch(/^https:\/\//);
    expect(r1.pix_copy_paste).toBeTruthy();
    const pg = await getPayment(cred, r1.asaas_payment_id, opts);
    expect(pg.externalReference).toBe(c1);
    expect(pg.value).toBe(6);
    const doCpf = await findCustomerByCpfCnpj(cred, cpfMae, opts);
    expect((pg as { customer?: string }).customer).toBe(doCpf?.id);
    // Não duplica: uma só cobrança no Asaas com esta referência.
    expect((await findPaymentsByReference(cred, c1 as string, opts)).length).toBe(1);
    // Paga no sandbox.
    await asaasRequest(
      { ...cred, method: "POST", path: "/sandbox/payment/{id}/confirm", params: { id: r1.asaas_payment_id }, body: {} },
      opts
    );
    const pago = await getPayment(cred, r1.asaas_payment_id, opts);
    expect(["RECEIVED", "CONFIRMED"]).toContain(pago.status);

    // 2) Boleto e cancelamento ("recebeu no balcão").
    const { data: c2 } = await pessoa.rpc("charge_prepare", { p_installment_id: p2, p_billing_type: "BOLETO", p_due_date: null });
    expect(await emitirNoAsaas(c2 as string, adminId)).toEqual({ ok: true });
    const { data: r2 } = await admin.from("charges").select("*").eq("id", c2).single();
    expect(r2.identification_field).toBeTruthy();
    const { data: chk } = await pessoa.rpc("charge_cancel_check", { p_charge_id: c2, p_purpose: "counter" });
    const ck = (Array.isArray(chk) ? chk[0] : chk) as { asaas_payment_id: string; gateway_account_id: string };
    expect(
      await comPaciencia(async () => {
        const r = await cancelarNoAsaas({
          chargeId: c2 as string,
          accountId: ck.gateway_account_id,
          asaasPaymentId: ck.asaas_payment_id,
          actorId: adminId,
          reason: "teste",
        });
        if (!r.ok) throw new Error(r.error);
        return r;
      })
    ).toEqual({ ok: true });
    expect((await admin.from("charges").select("status").eq("id", c2).single()).data?.status).toBe("cancelada");
    expect(await findPaymentsByReference(cred, c2 as string, opts)).toEqual([]);

    // A cobrança PAGA no Asaas não se cancela.
    const recusa = await cancelarNoAsaas({
      chargeId: c1 as string,
      accountId: conta!.id,
      asaasPaymentId: r1.asaas_payment_id,
      actorId: adminId,
      reason: "teste",
    });
    expect(recusa.ok).toBe(false);

    // 3) Vencida: nova data em 3 dias, valor atualizado até lá, sem multa nova.
    const { data: c3, error: e3 } = await pessoa.rpc("charge_prepare", { p_installment_id: p3, p_billing_type: "PIX", p_due_date: dia(3) });
    expect(e3).toBeNull();
    expect(await emitirNoAsaas(c3 as string, adminId)).toEqual({ ok: true });
    const { data: r3 } = await admin.from("charges").select("*").eq("id", c3).single();
    expect(r3.is_overdue_reissue).toBe(true);
    expect(Number(r3.value_cents)).toBeGreaterThan(600);
    expect(Number(r3.fine_percent)).toBe(0);
    const pg3 = await getPayment(cred, r3.asaas_payment_id, opts);
    expect(pg3.dueDate).toBe(dia(3));
    expect(Math.round((pg3.value ?? 0) * 100)).toBe(Number(r3.value_cents));
  }, 300_000);
});

// ASA2, entrega 1 — de ponta a ponta: o riSZon emite, o sandbox paga, o Asaas
// avisa o webhook PUBLICADO (projeto de teste na Vercel, que grava no treino) e
// a baixa acontece SOZINHA, com a venda fechando (D21). Este teste só emite,
// paga e depois LÊ o banco esperando o aviso chegar — não processa nada.
// Exige o projeto de teste publicado com a 4005 (ASAAS_E2E_WEBHOOK=sim).
describe.skipIf(!LIGADO || process.env.ASAAS_E2E_WEBHOOK !== "sim")("Asaas sandbox — o aviso vira baixa (ASA2)", () => {
  it("Pix e boleto pagos no sandbox dão baixa sozinhos e fecham a venda direta", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { emitirNoAsaas } = await import("@/lib/asaas/cobranca");
    const { credencialDaConta, opcoesDaConta } = await import("@/lib/asaas/account");
    const { asaasRequest } = await import("@/lib/asaas/client");
    const admin = createAdminClient();

    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: "admin@example.com" });
    const pessoa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { data: sess } = await pessoa.auth.verifyOtp({ type: "magiclink", token_hash: link!.properties!.hashed_token });
    const adminId = sess.user!.id;

    const { data: conta } = await admin
      .from("gateway_accounts")
      .select("id, clinic_id")
      .eq("owner_type", "unit")
      .eq("environment", "sandbox")
      .eq("status", "active")
      .order("created_at")
      .limit(1)
      .single();
    const unidade = conta!.clinic_id as string;

    const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    const dv = (a: number[], p: number) => {
      const r = (a.reduce((s, n, i) => s + n * (p - i), 0) * 10) % 11;
      return r === 10 ? 0 : r;
    };
    d.push(dv(d, 10));
    d.push(dv(d, 11));
    const { data: cli } = await admin
      .from("clients")
      .insert({ clinic_id: unidade, full_name: "Teste Asaas ASA2 Paciente", birth_date: "1985-05-05", cpf: d.join("") })
      .select("id")
      .single();
    const { data: venda } = await admin
      .from("direct_sales")
      .insert({
        clinic_id: unidade,
        client_id: cli!.id,
        client_name: "Teste Asaas ASA2",
        description: "Teste ASA2",
        value_cents: 1500,
        final_cents: 1500,
        payment_method: "pix",
        installments: 2,
        contract_signed: true,
      })
      .select("id")
      .single();
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const dia = (n: number) => new Date(Date.parse(hoje) + n * 86400_000).toISOString().slice(0, 10);
    const parcela = async (seq: number, valor: number, metodo: string) =>
      (
        await admin
          .from("payment_installments")
          .insert({
            clinic_id: unidade,
            client_id: cli!.id,
            direct_sale_id: venda!.id,
            seq,
            due_date: dia(3),
            amount_cents: valor,
            payment_method: metodo,
            late_fee_percent: 2,
            monthly_interest_percent: 1,
            grace_days: 0,
          })
          .select("id")
          .single()
      ).data!.id as string;
    const pPix = await parcela(1, 700, "pix");
    const pBoleto = await parcela(2, 800, "boleto");

    const cred = await credencialDaConta(conta!.id, "integration_test", null);
    const opts = opcoesDaConta(conta!.id, "integration_test");
    const emitirEPagar = async (inst: string, tipo: "PIX" | "BOLETO") => {
      const { data: id, error } = await pessoa.rpc("charge_prepare", { p_installment_id: inst, p_billing_type: tipo, p_due_date: null });
      expect(error).toBeNull();
      expect(await emitirNoAsaas(id as string, adminId)).toEqual({ ok: true });
      const { data: ch } = await admin.from("charges").select("asaas_payment_id, fine_cents").eq("id", id).single();
      await comPaciencia(() =>
        asaasRequest(
          { ...cred, method: "POST", path: "/sandbox/payment/{id}/confirm", params: { id: ch!.asaas_payment_id }, body: {} },
          opts
        )
      );
      return id as string;
    };
    const cPix = await emitirEPagar(pPix, "PIX");
    const cBoleto = await emitirEPagar(pBoleto, "BOLETO");

    // Espera o aviso chegar ao webhook publicado e a baixa acontecer (até 2 min).
    const esperar = async (charge: string) => {
      for (let i = 0; i < 40; i++) {
        const { data } = await admin.from("charges").select("status, receipt_id").eq("id", charge).single();
        if (data?.receipt_id) return data;
        await new Promise((r) => setTimeout(r, 3000));
      }
      return null;
    };
    const rPix = await esperar(cPix);
    const rBoleto = await esperar(cBoleto);
    expect(rPix?.receipt_id, "o aviso do Pix não deu a baixa a tempo").toBeTruthy();
    expect(rBoleto?.receipt_id, "o aviso do boleto não deu a baixa a tempo").toBeTruthy();
    expect(["paga", "liquidada"]).toContain(rPix!.status);
    expect(["paga", "liquidada"]).toContain(rBoleto!.status);

    const { data: parcelas } = await admin.from("payment_installments").select("status").in("id", [pPix, pBoleto]);
    expect(parcelas!.every((p) => p.status === "paga")).toBe(true);
    const { data: vd } = await admin.from("direct_sales").select("closed_at, payment_confirmed_source").eq("id", venda!.id).single();
    expect(vd!.closed_at).toBeTruthy();
    expect(vd!.payment_confirmed_source).toBe("asaas");
    const { data: rec } = await admin
      .from("payment_receipts")
      .select("created_by, notes, acquirer_fee_cents, amount_cents")
      .eq("id", rPix!.receipt_id)
      .single();
    expect(rec!.created_by).toBeNull();
    expect(rec!.notes).toBe("Baixa automática (Asaas)");
    expect(Number(rec!.amount_cents)).toBe(700);
    const { data: ba } = await admin.from("bank_accounts").select("alias").eq("gateway_account_id", conta!.id).single();
    expect(ba!.alias).toBe("Asaas");
  }, 300_000);
});

// ASA2 — A PROVA DO PAGAMENTO ATRASADO, em dois dias (16.1):
//   dia 1: ASAAS_PROVA_ATRASO=preparar npm run test:asaas  → cobrança de boleto
//          vencendo HOJE para o paciente "Teste Asaas Atraso";
//   dia 2: ASAAS_PROVA_ATRASO=conferir npm run test:asaas → paga no sandbox
//          (já vencida), espera a baixa e confere qual campo do Asaas traz o
//          total pago com multa e juros.
describe.skipIf(!LIGADO || !process.env.ASAAS_PROVA_ATRASO)("Asaas sandbox — pagamento atrasado (ASA2)", () => {
  beforeAll(() => {
    for (const linha of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
      const i = linha.indexOf("=");
      if (i < 1) continue;
      const k = linha.slice(0, i).trim();
      if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(k)) {
        process.env[k] = linha.slice(i + 1).trim();
      }
    }
    if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCAO)) {
      throw new Error("RECUSADO: este teste nunca roda contra o banco de produção.");
    }
  });

  it("prepara ou confere a prova do atraso", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { emitirNoAsaas } = await import("@/lib/asaas/cobranca");
    const { credencialDaConta, opcoesDaConta } = await import("@/lib/asaas/account");
    const { asaasRequest } = await import("@/lib/asaas/client");
    const { getPayment } = await import("@/lib/asaas/api");
    const admin = createAdminClient();
    const NOME = "Teste Asaas Atraso";

    const { data: conta } = await admin
      .from("gateway_accounts")
      .select("id, clinic_id")
      .eq("owner_type", "unit")
      .eq("environment", "sandbox")
      .eq("status", "active")
      .order("created_at")
      .limit(1)
      .single();
    const cred = await credencialDaConta(conta!.id, "integration_test", null);
    const opts = opcoesDaConta(conta!.id, "integration_test");

    if (process.env.ASAAS_PROVA_ATRASO === "preparar") {
      const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: "admin@example.com" });
      const pessoa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });
      const { data: sess } = await pessoa.auth.verifyOtp({ type: "magiclink", token_hash: link!.properties!.hashed_token });
      const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
      const dv = (a: number[], p: number) => {
        const r = (a.reduce((s, n, i) => s + n * (p - i), 0) * 10) % 11;
        return r === 10 ? 0 : r;
      };
      d.push(dv(d, 10));
      d.push(dv(d, 11));
      const { data: cli } = await admin
        .from("clients")
        .insert({ clinic_id: conta!.clinic_id, full_name: NOME, birth_date: "1985-05-05", cpf: d.join("") })
        .select("id")
        .single();
      const { data: venda } = await admin
        .from("direct_sales")
        .insert({
          clinic_id: conta!.clinic_id,
          client_id: cli!.id,
          client_name: NOME,
          description: "Prova do atraso",
          value_cents: 1000,
          final_cents: 1000,
          payment_method: "boleto",
          installments: 1,
          contract_signed: true,
        })
        .select("id")
        .single();
      const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
      const { data: inst } = await admin
        .from("payment_installments")
        .insert({
          clinic_id: conta!.clinic_id,
          client_id: cli!.id,
          direct_sale_id: venda!.id,
          seq: 1,
          due_date: hoje,
          amount_cents: 1000,
          payment_method: "boleto",
          late_fee_percent: 2,
          monthly_interest_percent: 1,
          grace_days: 0,
        })
        .select("id")
        .single();
      const { data: id, error } = await pessoa.rpc("charge_prepare", { p_installment_id: inst!.id, p_billing_type: "BOLETO", p_due_date: null });
      expect(error).toBeNull();
      expect(await emitirNoAsaas(id as string, sess.user!.id)).toEqual({ ok: true });
      console.log(`prova do atraso preparada: cobrança ${id} vence ${hoje}`);
      return;
    }

    // conferir
    const { data: cli } = await admin.from("clients").select("id").eq("full_name", NOME).order("created_at", { ascending: false }).limit(1).single();
    const { data: ch } = await admin
      .from("charges")
      .select("id, asaas_payment_id, value_cents, fine_cents, due_date, payment_installment_id")
      .eq("client_id", cli!.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    await comPaciencia(() =>
      asaasRequest({ ...cred, method: "POST", path: "/sandbox/payment/{id}/confirm", params: { id: ch!.asaas_payment_id }, body: {} }, opts)
    );
    let receiptId: string | null = null;
    for (let i = 0; i < 40 && !receiptId; i++) {
      const { data } = await admin.from("charges").select("receipt_id").eq("id", ch!.id).single();
      receiptId = data?.receipt_id ?? null;
      if (!receiptId) await new Promise((r) => setTimeout(r, 3000));
    }
    const pg = (await getPayment(cred, ch!.asaas_payment_id, opts)) as Record<string, unknown>;
    const { data: rec } = await admin
      .from("payment_receipts")
      .select("amount_cents, principal_cents, late_fee_cents, interest_cents")
      .eq("id", receiptId)
      .single();
    console.log("ASAAS:", JSON.stringify({ value: pg.value, originalValue: pg.originalValue, interestValue: pg.interestValue, netValue: pg.netValue, status: pg.status }));
    console.log("RISZON:", JSON.stringify(rec));
    expect(receiptId, "o aviso não deu a baixa a tempo").toBeTruthy();
    expect(Number(rec!.amount_cents)).toBe(Math.round(Number(pg.value) * 100));
    expect(Number(pg.value)).toBeGreaterThan(Number(ch!.value_cents) / 100);
  }, 300_000);
});
