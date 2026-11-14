// PROVA DE PONTA A PONTA NO SANDBOX — ASA4, entrega 1 (4012): a cobrança nasce
// sozinha. Opcional, fora do portão do dia a dia:
//
//   ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/asaas-asa4-entrega1.integracao.test.ts
//
// O caminho REAL do servidor (`criarCobrancasAutomaticas` → `_charge_prepare_system`
// → `emitirNoAsaas`) contra a conta sandbox de Londrina, no banco de TREINO.
// NADA É ENVIADO A NINGUÉM: o pagador é um cliente novo, com CPF de teste gerado
// na hora, SEM e-mail e SEM celular (o Asaas não tem para onde mandar). No fim, as
// cobranças são apagadas no Asaas (pela mesma porta do "cancelar") e a chave da
// unidade volta como estava. Recusa o banco de produção.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LIGADO = process.env.ASAAS_INTEGRACAO === "sim";
const PRODUCAO = "hvhbijctanrrkxhemlza";

function cpfDeTeste(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b: number[]) => {
    const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}
const dia = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe.skipIf(!LIGADO)("ASA4 entrega 1 — a cobrança nasce sozinha (sandbox, sem envio)", () => {
  type Admin = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  let admin: Admin;
  let ldn = "";
  let unidadeAntes: { enabled: boolean; enabled_from: string | null } | null = null;
  let vendaId = "";
  let parcelas: { id: string; seq: number }[] = [];
  let cobrancas: { id: string; asaas_payment_id: string | null; gateway_account_id: string | null }[] = [];

  beforeAll(async () => {
    for (const linha of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
      const i = linha.indexOf("=");
      if (i < 1) continue;
      const k = linha.slice(0, i).trim();
      if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(k)) process.env[k] = linha.slice(i + 1).trim();
    }
    if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCAO)) throw new Error("RECUSADO: nunca contra o banco de produção.");
    admin = (await import("@/lib/supabase/admin")).createAdminClient();
    ldn = (await admin.from("clinics").select("id").eq("name", "Risarte Londrina - Centro").single()).data!.id;
    const { data: conta } = await admin.from("gateway_accounts").select("environment").eq("clinic_id", ldn).eq("status", "active").single();
    if (conta?.environment !== "sandbox") throw new Error("RECUSADO: a conta de Londrina não é de sandbox.");
    const { data: u } = await admin.from("gateway_auto_charge_units").select("enabled, enabled_from").eq("clinic_id", ldn).maybeSingle();
    unidadeAntes = u ?? null;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    const { cancelarNoAsaas } = await import("@/lib/asaas/cobranca");
    const { data: adm } = await admin.from("profiles").select("id").eq("is_admin_master", true).eq("is_active", true).limit(1).single();
    for (const c of cobrancas) {
      // O sandbox às vezes recusa apagar boleto recém-criado: tenta de novo.
      for (let i = 0; i < 6; i++) {
        const r = await cancelarNoAsaas({ chargeId: c.id, accountId: c.gateway_account_id, asaasPaymentId: c.asaas_payment_id, actorId: adm!.id, reason: "prova ASA4 (sandbox)" }).catch(() => ({ ok: false }));
        if (r.ok) break;
        await new Promise((res) => setTimeout(res, 5000));
      }
    }
    const { count } = await admin.from("charges").select("id", { count: "exact", head: true }).in("id", cobrancas.map((c) => c.id)).neq("status", "cancelada");
    console.log(`limpeza: ${cobrancas.length - (count ?? 0)} de ${cobrancas.length} cobrança(s) apagada(s) no Asaas`);
    if (unidadeAntes) await admin.from("gateway_auto_charge_units").update(unidadeAntes).eq("clinic_id", ldn);
    else await admin.from("gateway_auto_charge_units").delete().eq("clinic_id", ldn);
    if (vendaId) await admin.from("direct_sales").update({ cancelled: true, notes: "Prova ASA4 (sandbox), cancelada no fim da prova" }).eq("id", vendaId);
  }, 120_000);

  it("liga Londrina, assina a venda direta nova e o servidor cria SÓ as parcelas do prazo no Asaas", async () => {
    await admin.from("gateway_auto_charge_units").upsert({ clinic_id: ldn, enabled: true, enabled_from: new Date(Date.now() - 60_000).toISOString() });
    const { data: cli } = await admin
      .from("clients")
      .insert({ clinic_id: ldn, full_name: "Prova ASA4 sem contato", cpf: cpfDeTeste(), birth_date: "1990-01-01", email: null, phone: null })
      .select("id")
      .single();
    const { data: venda } = await admin
      .from("direct_sales")
      .insert({ clinic_id: ldn, client_id: cli!.id, client_name: "Prova ASA4 sem contato", final_cents: 1500, payment_method: "boleto", installments: 3 })
      .select("id, method_rule")
      .single();
    vendaId = venda!.id;
    expect(venda!.method_rule).toBe("asa4");
    const linhas = [
      { seq: 1, due_date: dia(5), payment_method: "boleto" },
      { seq: 2, due_date: dia(10), payment_method: "pix" },
      { seq: 3, due_date: dia(40), payment_method: "boleto" },
    ].map((l) => ({ ...l, clinic_id: ldn, client_id: cli!.id, direct_sale_id: vendaId, kind: "parcela", amount_cents: 500 }));
    const { data: ps, error } = await admin.from("payment_installments").insert(linhas).select("id, seq");
    expect(error).toBeNull();
    parcelas = ps!;
    await admin.from("direct_sales").update({ contract_signed: true, contract_signed_at: new Date().toISOString() }).eq("id", vendaId);
    const { data: marca } = await admin.from("sale_auto_charges").select("source").eq("direct_sale_id", vendaId).single();
    expect(marca!.source).toBe("venda_direta");

    const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
    const r = await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: vendaId });
    expect(r.falhas, r.erros.join(" | ")).toBe(0);
    expect(r.criadas).toBe(2);

    const { data: cs } = await admin
      .from("charges")
      .select("id, status, billing_type, asaas_payment_id, gateway_account_id, auto_origin, asaas_sent_at, identification_field, pix_copy_paste, invoice_url, created_by, payment_installment_id")
      .in("payment_installment_id", parcelas.map((p) => p.id));
    cobrancas = cs ?? [];
    expect(cobrancas).toHaveLength(2);
    for (const c of cs!) {
      expect(c.status).toBe("emitida");
      expect(c.asaas_payment_id).toMatch(/^pay_/);
      expect(c.auto_origin).toBe("venda_direta");
      expect(c.created_by).toBeNull();
      // Sem contato: o Asaas não tinha para onde mandar — não aparece "Enviada pelo Asaas".
      expect(c.asaas_sent_at).toBeNull();
    }
    const terceira = parcelas.find((p) => p.seq === 3)!.id;
    expect(cs!.some((c) => c.payment_installment_id === terceira)).toBe(false);
    expect(cs!.find((c) => c.billing_type === "BOLETO")?.identification_field).toBeTruthy();
    // O link da fatura sempre existe (o paciente paga o Pix por ele). O "copia e
    // cola" depende do QR Code do Asaas, que no sandbox falhou em 14/11/2026 para
    // QUALQUER cobrança ("erro desconhecido" depois de 30 s) — não reprova a prova.
    const pix = cs!.find((c) => c.billing_type === "PIX")!;
    expect(pix.invoice_url).toMatch(/^https:\/\//);
    if (!pix.pix_copy_paste) console.log("aviso: o sandbox não devolveu o QR Code do Pix (o link da fatura existe)");
  }, 180_000);

  it("no Asaas, as cobranças existem, com a referência do riSZon, para um pagador sem e-mail e sem celular", async () => {
    const { credencialDaConta, opcoesDaConta } = await import("@/lib/asaas/account");
    const { getPayment } = await import("@/lib/asaas/api");
    const conta = cobrancas[0].gateway_account_id!;
    const cred = await credencialDaConta(conta, "prova_asa4_sandbox", null);
    for (const c of cobrancas) {
      const p = (await getPayment(cred, c.asaas_payment_id!, opcoesDaConta(conta, "prova_asa4_sandbox"))) as Record<string, unknown>;
      expect(p.externalReference).toBe(c.id);
      expect(p.deleted).toBeFalsy();
    }
    const { data: gc } = await admin.from("charges").select("gateway_customer_id").eq("id", cobrancas[0].id).single();
    const { data: contato } = await admin.rpc("_gateway_customer_contact", { p_customer_id: gc!.gateway_customer_id });
    const k = (Array.isArray(contato) ? contato[0] : contato) as { email: string | null; mobile: string | null };
    expect(k.email).toBeNull();
    expect(k.mobile).toBeNull();
  }, 60_000);

  it("rodar de novo não cria nada (idempotente) e a rodada fica gravada", async () => {
    const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
    const r = await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: vendaId });
    expect(r.criadas).toBe(0);
    const { count } = await admin.from("charges").select("id", { count: "exact", head: true }).in("payment_installment_id", parcelas.map((p) => p.id));
    expect(count).toBe(2);
    const { data: rodadas } = await admin.from("gateway_routine_runs").select("origin, created, ok").eq("routine", "cobrancas").order("started_at", { ascending: false }).limit(2);
    expect(rodadas!.map((x) => x.origin)).toEqual(["gatilho", "gatilho"]);
    expect(rodadas![1].created).toBe(2);
  }, 120_000);
});
