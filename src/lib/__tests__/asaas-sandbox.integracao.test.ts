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
      await cancelarNoAsaas({
        chargeId: c2 as string,
        accountId: ck.gateway_account_id,
        asaasPaymentId: ck.asaas_payment_id,
        actorId: adminId,
        reason: "teste",
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
  }, 180_000);
});
