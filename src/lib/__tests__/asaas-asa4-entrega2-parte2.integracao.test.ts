// PROVA NO SANDBOX — ASA4, entrega 2, parte 2 (4014): o split pela tarifa do dia
// da aprovação e a leitura da contestação. Opcional, fora do portão do dia a dia:
//
//   ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/asaas-asa4-entrega2-parte2.integracao.test.ts
//
// Caminho REAL do servidor contra a conta sandbox de Londrina, no banco de TREINO.
// Simula um parcelamento emitido com a tarifa CHEIA (split 17,6147%) e aprovado num
// dia de tarifa promocional (2,49%): a conferência do servidor
// (`conferirSplitDosParcelamentos`) troca o split do parcelamento inteiro no Asaas
// e grava. NADA É ENVIADO A NINGUÉM (pagador sem contato, cadastro sem avisos).
// No fim, o parcelamento é estornado. Recusa o banco de produção.
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

describe.skipIf(!LIGADO)("ASA4 entrega 2, parte 2 — o split na aprovação (sandbox, sem envio)", () => {
  type Admin = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  let admin: Admin;
  let ldn = "";
  let adm = "";
  let venda = "";
  let unidadeAntes: { enabled: boolean; enabled_from: string | null } | null = null;
  let cs: { id: string; asaas_payment_id: string; asaas_installment_id: string; gateway_account_id: string; installment_block: string }[] = [];
  let cpf = "";

  const credencial = async () => {
    const { credencialDaConta, opcoesDaConta } = await import("@/lib/asaas/account");
    const conta = cs[0].gateway_account_id;
    return { cred: await credencialDaConta(conta, "prova_asa4_parte2", adm), opts: opcoesDaConta(conta, "prova_asa4_parte2") };
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
    if (cs.length) {
      const { estornarParcelamentoNoAsaas, cancelarParcelamentoNoAsaas } = await import("@/lib/asaas/parcelamento");
      const { data: st } = await admin.from("charges").select("status").eq("installment_block", cs[0].installment_block);
      const pagas = (st ?? []).every((x) => ["paga", "liquidada", "em_contestacao"].includes(x.status));
      if (pagas) {
        await admin.from("charges").update({ status: "paga" }).eq("installment_block", cs[0].installment_block).eq("status", "em_contestacao");
        await estornarParcelamentoNoAsaas({ accountId: cs[0].gateway_account_id, asaasInstallmentId: cs[0].asaas_installment_id, chargeIds: cs.map((c) => c.id), actorId: adm, reason: "prova ASA4 parte 2 (sandbox)" }).catch(() => null);
      } else {
        await cancelarParcelamentoNoAsaas({ blockId: cs[0].installment_block, accountId: cs[0].gateway_account_id, asaasInstallmentId: cs[0].asaas_installment_id, chargeIds: cs.map((c) => c.id), actorId: adm, reason: "prova ASA4 parte 2 (sandbox)" }).catch(() => null);
      }
    }
    if (unidadeAntes) await admin.from("gateway_auto_charge_units").update(unidadeAntes).eq("clinic_id", ldn);
    else await admin.from("gateway_auto_charge_units").delete().eq("clinic_id", ldn);
    if (venda) await admin.from("direct_sales").update({ cancelled: true, notes: "Prova ASA4 parcelado parte 2 (sandbox), cancelada no fim" }).eq("id", venda);
  }, 180_000);

  it("emitido com a tarifa cheia, aprovado na promoção: o servidor troca o split do parcelamento inteiro", async () => {
    await admin.from("gateway_auto_charge_units").upsert({ clinic_id: ldn, enabled: true, enabled_from: new Date(Date.now() - 60_000).toISOString() });
    const { data: cli } = await admin.from("clients").insert({ clinic_id: ldn, full_name: "Prova ASA4 parcelado sem contato", cpf, birth_date: "1990-01-01", email: null, phone: null }).select("id").single();
    let primeiro = iso(new Date(Date.now() + 5 * 86400000));
    if (Number(primeiro.slice(8, 10)) > 28) primeiro = primeiro.slice(0, 8) + "05";
    const { data: v } = await admin.from("direct_sales").insert({ clinic_id: ldn, client_id: cli!.id, client_name: "Prova ASA4 parcelado sem contato", final_cents: 30001, payment_method: "cartao_parcelado_asaas", installments: 3 }).select("id").single();
    venda = v!.id;
    const linhas = [10000, 10000, 10001].map((x, k) => ({ seq: k + 1, kind: "parcela", due_date: mesesDepois(primeiro, k), payment_method: "cartao_parcelado_asaas", amount_cents: x, clinic_id: ldn, client_id: cli!.id, direct_sale_id: venda }));
    expect((await admin.from("payment_installments").insert(linhas)).error).toBeNull();
    await admin.rpc("apply_settlement_projection", { p_negotiation_id: null, p_direct_sale_id: venda });
    await admin.from("direct_sales").update({ contract_signed: true, contract_signed_at: new Date().toISOString() }).eq("id", venda);
    const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
    const r = await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: venda });
    expect(r.criadas, r.erros.join(" | ")).toBe(3);
    const ids = (await admin.from("payment_installments").select("id").eq("direct_sale_id", venda)).data!.map((x) => x.id);
    cs = ((await admin.from("charges").select("id, asaas_payment_id, asaas_installment_id, gateway_account_id, installment_block, installment_number").in("payment_installment_id", ids).order("installment_number")).data ?? []) as typeof cs;
    expect(cs).toHaveLength(3);

    // Simula a emissão com a tarifa CHEIA (3,49%): no Asaas e no riSZon.
    const { cred, opts } = await credencial();
    const { updateInstallmentSplits, listInstallmentPayments } = await import("@/lib/asaas/api");
    const { data: raiz } = await admin.from("charge_splits").select("wallet_id, destination_account_id, fees, percent").eq("charge_id", cs[0].id).single();
    await updateInstallmentSplits(cred, cs[0].asaas_installment_id, [{ walletId: raiz!.wallet_id, percentualValue: 17.6147, fixedValue: 0.02 }], opts);
    for (const c of cs) {
      await admin.rpc("_charge_save_split", {
        p_charge_id: c.id,
        p_entries: [{ accountId: raiz!.destination_account_id, walletId: raiz!.wallet_id, percent: Number(raiz!.percent), percentualValue: 17.6147, fixedCents: 2, fees: raiz!.fees, tariffPercent: 3.49, tariffFixedCents: 16 }],
      });
    }
    const antes = await listInstallmentPayments(cred, cs[0].asaas_installment_id, opts);
    expect(antes.every((p) => Number(p.split?.[0]?.percentualValue) === 17.6147)).toBe(true);

    // O pagamento com o cartão de teste (o sandbox às vezes recusa: tenta de novo).
    let pago = false;
    for (let i = 0; i < 4 && !pago; i++) {
      const resp = await fetch(`https://api-sandbox.asaas.com/v3/payments/${cs[0].asaas_payment_id}/payWithCreditCard`, {
        method: "POST",
        headers: { access_token: cred.apiKey, "Content-Type": "application/json", "User-Agent": "riSZon (Risarte Odontologia) - prova" },
        body: JSON.stringify({
          creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 2), ccv: "123" },
          creditCardHolderInfo: { name: "Prova ASA4 parcelado", email: "prova.cartao@example.com", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "1000", phone: "4333330000" },
          remoteIp: "127.0.0.1",
        }),
      });
      pago = resp.ok;
      if (!pago) await espera(5000);
    }
    expect(pago).toBe(true);
    for (let i = 0; i < 24; i++) {
      await espera(5000);
      const { data } = await admin.from("charges").select("status").eq("installment_block", cs[0].installment_block);
      if ((data ?? []).filter((x) => x.status === "paga").length === 3) break;
    }
    expect(((await admin.from("charges").select("status").eq("installment_block", cs[0].installment_block)).data ?? []).every((x) => x.status === "paga")).toBe(true);

    // A conferência do servidor (a que roda de 10 em 10 minutos).
    const { conferirSplitDosParcelamentos } = await import("@/lib/asaas/parcelamento");
    const conf = await conferirSplitDosParcelamentos();
    expect(conf.falharam).toBe(0);
    expect(conf.trocados).toBeGreaterThanOrEqual(1);
    const depois = await listInstallmentPayments(cred, cs[0].asaas_installment_id, opts);
    expect(depois.every((p) => Number(p.split?.[0]?.percentualValue) === 17.4341)).toBe(true);
    const { data: gravado } = await admin.from("charge_splits").select("percentual_value").in("charge_id", cs.map((c) => c.id));
    expect((gravado ?? []).every((g) => Number(g.percentual_value) === 17.4341)).toBe(true);
    const { data: marcado } = await admin.from("charges").select("split_checked_at").eq("installment_block", cs[0].installment_block);
    expect((marcado ?? []).every((x) => x.split_checked_at)).toBe(true);
    // De novo: nada a conferir.
    const { data: lista } = await admin.rpc("_card_blocks_split_to_check", { p_limit: 50 });
    expect(((lista ?? []) as { installment_block: string }[]).some((b) => b.installment_block === cs[0].installment_block)).toBe(false);
  }, 300_000);

  it("a contestação: o servidor lê o Asaas sem quebrar (o sandbox não simula contestação)", async () => {
    await admin.from("charges").update({ status: "em_contestacao" }).eq("id", cs[0].id);
    const { conferirContestacoes } = await import("@/lib/asaas/parcelamento");
    const r = await conferirContestacoes();
    expect(r.lidas + r.falharam).toBeGreaterThanOrEqual(1);
    const { data: c } = await admin.from("charges").select("chargeback_checked_at").eq("id", cs[0].id).single();
    expect(c!.chargeback_checked_at).toBeTruthy();
    await admin.from("charges").update({ status: "paga" }).eq("id", cs[0].id);
  }, 120_000);
});
