// PROVA DE PONTA A PONTA NO SANDBOX — ASA4, entrega 2 (4013): o cartão parcelado
// pelo Asaas. Opcional, fora do portão do dia a dia:
//
//   ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/asaas-asa4-entrega2.integracao.test.ts
//
// O caminho REAL do servidor (`criarCobrancasAutomaticas` → `_card_block_prepare_system`
// → `emitirParcelamentoNoAsaas`) contra a conta sandbox de Londrina, no banco de
// TREINO: venda direta nova com ENTRADA EM PIX + 3× no cartão pelo Asaas, assinada.
// O cartão é pago com o cartão de teste do Asaas (só no sandbox). A baixa de cada
// parcela chega pelo aviso do Asaas (webhook do projeto de teste → treino). Depois:
// o estorno do parcelamento inteiro, e o cancelamento de um 2º parcelamento não pago.
// NADA É ENVIADO A NINGUÉM: o pagador é um cliente novo, com CPF de teste, SEM
// e-mail e SEM celular, e o cadastro do parcelamento no Asaas é sem avisos.
// Recusa o banco de produção.
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
const iso = (d: Date) => d.toISOString().slice(0, 10);
const mesesDepois = (s: string, k: number) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + k, d)));
};
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!LIGADO)("ASA4 entrega 2 — cartão parcelado pelo Asaas (sandbox, sem envio)", () => {
  type Admin = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  let admin: Admin;
  let ldn = "";
  let adm = "";
  let unidadeAntes: { enabled: boolean; enabled_from: string | null } | null = null;
  const vendas: string[] = [];
  let bloco = "";
  let cpf = "";
  let cobrancas: { id: string; asaas_payment_id: string | null; installment_number: number; asaas_installment_id: string | null; gateway_account_id: string | null }[] = [];

  async function novaVenda(entradaPix: boolean): Promise<string> {
    cpf = cpfDeTeste(); // um paciente novo por venda (o CPF é único na unidade)
    const { data: cli } = await admin
      .from("clients")
      .insert({ clinic_id: ldn, full_name: "Prova ASA4 parcelado sem contato", cpf, birth_date: "1990-01-01", email: null, phone: null })
      .select("id")
      .single();
    let primeiro = iso(new Date(Date.now() + 5 * 86400000));
    if (Number(primeiro.slice(8, 10)) > 28) primeiro = primeiro.slice(0, 8) + "05";
    const total = (entradaPix ? 10000 : 0) + 30001;
    const { data: venda } = await admin
      .from("direct_sales")
      .insert({ clinic_id: ldn, client_id: cli!.id, client_name: "Prova ASA4 parcelado sem contato", final_cents: total, payment_method: "cartao_parcelado_asaas", installments: 3 })
      .select("id, method_rule")
      .single();
    expect(venda!.method_rule).toBe("asa4");
    const linhas = [
      ...(entradaPix ? [{ seq: 1, kind: "entrada", due_date: iso(new Date(Date.now() + 86400000)), payment_method: "pix", amount_cents: 10000 }] : []),
      ...[10000, 10000, 10001].map((v, k) => ({ seq: (entradaPix ? 2 : 1) + k, kind: "parcela", due_date: mesesDepois(primeiro, k), payment_method: "cartao_parcelado_asaas", amount_cents: v })),
    ].map((l) => ({ ...l, clinic_id: ldn, client_id: cli!.id, direct_sale_id: venda!.id }));
    const { error } = await admin.from("payment_installments").insert(linhas);
    expect(error).toBeNull();
    const { error: ep } = await admin.rpc("apply_settlement_projection", { p_negotiation_id: null, p_direct_sale_id: venda!.id });
    expect(ep).toBeNull();
    vendas.push(venda!.id);
    return venda!.id;
  }

  async function pagarNoSandbox(paymentId: string) {
    const { credencialDaConta } = await import("@/lib/asaas/account");
    const cred = await credencialDaConta(cobrancas[0].gateway_account_id!, "prova_asa4_parcelado", adm);
    if (!cred.apiKey.startsWith("$aact_hmlg_")) throw new Error("RECUSADO: chave que não é de sandbox.");
    const r = await fetch(`https://api-sandbox.asaas.com/v3/payments/${paymentId}/payWithCreditCard`, {
      method: "POST",
      headers: { access_token: cred.apiKey, "Content-Type": "application/json", "User-Agent": "riSZon (Risarte Odontologia) - prova" },
      body: JSON.stringify({
        creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 2), ccv: "123" },
        creditCardHolderInfo: { name: "Prova ASA4 parcelado", email: "prova.cartao@example.com", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "1000", phone: "4333330000" },
        remoteIp: "127.0.0.1",
      }),
    });
    const j = await r.json();
    return { ok: r.ok, status: j?.status as string | undefined, erro: (j?.errors ?? []).map((e: { description: string }) => e.description).join(" | ") };
  }

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
    adm = (await admin.from("profiles").select("id").eq("is_admin_master", true).eq("is_active", true).limit(1).single()).data!.id;
    const { data: conta } = await admin.from("gateway_accounts").select("environment").eq("clinic_id", ldn).eq("status", "active").single();
    if (conta?.environment !== "sandbox") throw new Error("RECUSADO: a conta de Londrina não é de sandbox.");
    const { data: u } = await admin.from("gateway_auto_charge_units").select("enabled, enabled_from").eq("clinic_id", ldn).maybeSingle();
    unidadeAntes = u ?? null;
    cpf = cpfDeTeste();
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    // Cancela o que tiver ficado aberto (nunca deixa parcelamento vivo no sandbox).
    const { cancelarParcelamentoNoAsaas } = await import("@/lib/asaas/parcelamento");
    const { data: vivas } = await admin.from("charges").select("installment_block, asaas_installment_id, gateway_account_id, id, status").in("payment_installment_id",
      (await admin.from("payment_installments").select("id").in("direct_sale_id", vendas)).data?.map((x) => x.id) ?? []);
    const porBloco = new Map<string, { inst: string | null; conta: string | null; ids: string[]; abertas: boolean }>();
    for (const c of vivas ?? []) {
      if (!c.installment_block) continue;
      const b = porBloco.get(c.installment_block) ?? { inst: c.asaas_installment_id, conta: c.gateway_account_id, ids: [] as string[], abertas: false };
      b.ids.push(c.id);
      if (["emitindo", "emitida", "vencida", "erro_emissao"].includes(c.status)) b.abertas = true;
      porBloco.set(c.installment_block, b);
    }
    for (const [blockId, b] of porBloco) {
      if (b.abertas) await cancelarParcelamentoNoAsaas({ blockId, accountId: b.conta, asaasInstallmentId: b.inst, chargeIds: b.ids, actorId: adm, reason: "prova ASA4 (sandbox)" }).catch(() => null);
    }
    // A entrada em Pix (cobrança sozinha) também é cancelada no Asaas.
    const { cancelarNoAsaas } = await import("@/lib/asaas/cobranca");
    for (const c of (vivas ?? []).filter((x) => !x.installment_block && ["emitida", "vencida"].includes(x.status))) {
      const { data: ch } = await admin.from("charges").select("asaas_payment_id").eq("id", c.id).single();
      for (let i = 0; i < 6; i++) {
        const r = await cancelarNoAsaas({ chargeId: c.id, accountId: c.gateway_account_id, asaasPaymentId: ch?.asaas_payment_id ?? null, actorId: adm, reason: "prova ASA4 (sandbox)" }).catch(() => ({ ok: false }));
        if (r.ok) break;
        await espera(5000);
      }
    }
    if (unidadeAntes) await admin.from("gateway_auto_charge_units").update(unidadeAntes).eq("clinic_id", ldn);
    else await admin.from("gateway_auto_charge_units").delete().eq("clinic_id", ldn);
    for (const v of vendas) await admin.from("direct_sales").update({ cancelled: true, notes: "Prova ASA4 parcelado (sandbox), cancelada no fim da prova" }).eq("id", v);
  }, 180_000);

  it("assina a venda (entrada em Pix + 3× no cartão) e o servidor cria o parcelamento INTEIRO no Asaas", async () => {
    await admin.from("gateway_auto_charge_units").upsert({ clinic_id: ldn, enabled: true, enabled_from: new Date(Date.now() - 60_000).toISOString() });
    const venda = await novaVenda(true);
    await admin.from("direct_sales").update({ contract_signed: true, contract_signed_at: new Date().toISOString() }).eq("id", venda);
    const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
    const r = await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: venda });
    expect(r.falhas, r.erros.join(" | ")).toBe(0);
    // A entrada em Pix (dentro do prazo) e as 3 do cartão.
    expect(r.criadas).toBe(4);
    const { data: cs } = await admin
      .from("charges")
      .select("id, status, asaas_payment_id, installment_block, installment_number, installment_count, asaas_installment_id, gateway_account_id, value_cents, invoice_url, auto_origin")
      .not("installment_block", "is", null)
      .in("payment_installment_id", (await admin.from("payment_installments").select("id").eq("direct_sale_id", venda)).data!.map((x) => x.id))
      .order("installment_number");
    cobrancas = cs ?? [];
    expect(cobrancas).toHaveLength(3);
    bloco = cs![0].installment_block!;
    expect(new Set(cs!.map((c) => c.installment_block)).size).toBe(1);
    expect(new Set(cs!.map((c) => c.asaas_installment_id)).size).toBe(1);
    expect(cs!.map((c) => c.value_cents)).toEqual([10000, 10000, 10001]);
    for (const c of cs!) {
      expect(c.status).toBe("emitida");
      expect(c.asaas_payment_id).toMatch(/^pay_/);
      expect(c.invoice_url).toMatch(/^https:\/\//);
      expect(c.auto_origin).toBe("venda_direta");
    }
  }, 240_000);

  it("no Asaas: um parcelamento, cada parcela com a referência da SUA cobrança, o split por parcela e o cadastro sem avisos", async () => {
    const { credencialDaConta, opcoesDaConta } = await import("@/lib/asaas/account");
    const { getPayment, listInstallmentPayments } = await import("@/lib/asaas/api");
    const conta = cobrancas[0].gateway_account_id!;
    const cred = await credencialDaConta(conta, "prova_asa4_parcelado", adm);
    const opts = opcoesDaConta(conta, "prova_asa4_parcelado");
    const ps = await listInstallmentPayments(cred, cobrancas[0].asaas_installment_id!, opts);
    expect(ps).toHaveLength(3);
    for (const [k, p] of ps.entries()) {
      expect(p.externalReference).toBe(cobrancas[k].id);
      expect(p.id).toBe(cobrancas[k].asaas_payment_id);
      const full = await getPayment(cred, p.id!, opts);
      expect(full.split?.length ?? 0).toBeGreaterThan(0);
    }
    const r = await fetch(`https://api-sandbox.asaas.com/v3/customers/${(await getPayment(cred, ps[0].id!, opts) as { customer?: string }).customer}`, {
      headers: { access_token: cred.apiKey, "User-Agent": "riSZon - prova" },
    });
    const cliente = await r.json();
    expect(cliente.notificationDisabled).toBe(true);
    expect(String(cliente.externalReference)).toBe(`riszon-parcelado:${bloco}`);
    expect(cliente.email ?? null).toBeNull();
    expect(cliente.mobilePhone ?? null).toBeNull();
  }, 120_000);

  it("pago com o cartão de teste: as 3 parcelas recebem a baixa como cartão parcelado, com o crédito mês a mês", async () => {
    let pago = await pagarNoSandbox(cobrancas[0].asaas_payment_id!);
    for (let i = 0; i < 3 && !pago.ok; i++) {
      await espera(5000);
      pago = await pagarNoSandbox(cobrancas[0].asaas_payment_id!);
    }
    expect(pago.ok, pago.erro).toBe(true);
    let rec: { payment_method: string; acquirer_modality: string | null; settlement_date: string | null }[] = [];
    for (let i = 0; i < 24; i++) {
      await espera(5000);
      const { data } = await admin.from("charges").select("status, receipt:payment_receipts!charges_receipt_id_fkey ( payment_method, acquirer_modality, settlement_date )").eq("installment_block", bloco);
      const pagas = (data ?? []).filter((c) => c.status === "paga");
      if (pagas.length === 3) {
        rec = pagas.map((c) => (Array.isArray(c.receipt) ? c.receipt[0] : c.receipt) as never);
        break;
      }
    }
    expect(rec).toHaveLength(3);
    for (const r of rec) {
      expect(r.payment_method).toBe("cartao_parcelado");
      expect(r.acquirer_modality).toBe("credito_parcelado");
    }
    const datas = rec.map((r) => r.settlement_date!).sort();
    expect(new Set(datas).size).toBe(3);
  }, 240_000);

  it("o estorno do parcelamento inteiro: o Asaas estorna as 3 e o riSZon desfaz as baixas", async () => {
    const { estornarParcelamentoNoAsaas } = await import("@/lib/asaas/parcelamento");
    const r = await estornarParcelamentoNoAsaas({
      accountId: cobrancas[0].gateway_account_id!,
      asaasInstallmentId: cobrancas[0].asaas_installment_id!,
      chargeIds: cobrancas.map((c) => c.id),
      actorId: adm,
      reason: "prova ASA4 parcelado (sandbox)",
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    let estornadas = 0;
    for (let i = 0; i < 24; i++) {
      await espera(5000);
      const { data } = await admin.from("charges").select("status").eq("installment_block", bloco);
      estornadas = (data ?? []).filter((c) => c.status === "estornada").length;
      if (estornadas === 3) break;
    }
    expect(estornadas).toBe(3);
  }, 240_000);

  it("um 2º parcelamento não pago é cancelado inteiro", async () => {
    const venda = await novaVenda(false);
    await admin.from("direct_sales").update({ contract_signed: true, contract_signed_at: new Date().toISOString() }).eq("id", venda);
    const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
    const r = await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: venda });
    expect(r.criadas, r.erros.join(" | ")).toBe(3);
    const ids = (await admin.from("payment_installments").select("id").eq("direct_sale_id", venda)).data!.map((x) => x.id);
    const { data: cs } = await admin.from("charges").select("id, installment_block, asaas_installment_id, gateway_account_id").in("payment_installment_id", ids);
    const { cancelarParcelamentoNoAsaas } = await import("@/lib/asaas/parcelamento");
    const c = await cancelarParcelamentoNoAsaas({
      blockId: cs![0].installment_block!,
      accountId: cs![0].gateway_account_id,
      asaasInstallmentId: cs![0].asaas_installment_id,
      chargeIds: cs!.map((x) => x.id),
      actorId: adm,
      reason: "prova ASA4 parcelado (sandbox)",
    });
    expect(c.ok, c.ok ? "" : c.error).toBe(true);
    const { data: depois } = await admin.from("charges").select("status").in("payment_installment_id", ids);
    expect(depois!.every((x) => x.status === "cancelada")).toBe(true);
  }, 240_000);
});
