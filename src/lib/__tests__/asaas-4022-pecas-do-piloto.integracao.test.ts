// PROVA NO SANDBOX — 4022 (ASA7): o levantamento das contas e a conciliação das
// cobranças com um pagamento feito "pelo painel" SEM o aviso chegar.
//
//   RISARTE_TREINO_POOLER=1 ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/asaas-4022-pecas-do-piloto.integracao.test.ts
//
// 1) O levantamento (só leitura) em Londrina e Cambé, gravado no treino.
// 2) A conciliação, em Londrina:
//    - a fila de avisos da conta é PAUSADA no Asaas (o aviso "não chega");
//    - uma cobrança do riSZon é dada como recebida em dinheiro no Asaas
//      (`receiveInCash`, o que o painel faz) e uma cobrança é criada direto no
//      Asaas, sem a referência do riSZon (a "criada no painel");
//    - a conciliação acha as duas divergências; nada é baixado sozinho;
//    - a fila é REATIVADA (sempre, no `finally`): o Asaas reenvia o aviso, a
//      baixa acontece, e a divergência fecha sozinha na rodada seguinte;
//    - a cobrança de fora é apagada, e a divergência dela fecha sozinha.
// Pagador sem e-mail e sem celular, avisos ao pagador desligados: nada é enviado.
// Só SANDBOX e o banco de TREINO.
import { appendFileSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LIGADO = process.env.ASAAS_INTEGRACAO === "sim";
const PRODUCAO = "hvhbijctanrrkxhemlza";
// O registro da prova (o console dos testes que passam não aparece).
const REGISTRO = process.env.PROVA_REGISTRO ?? "scripts/.prova-4022.log";
const log = (...a: unknown[]) => appendFileSync(REGISTRO, `${new Date().toISOString()} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}
`);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const diasDepois = (n: number) => new Date(Date.now() - 3 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

function preparar() {
  for (const linha of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
    const i = linha.indexOf("=");
    if (i < 1) continue;
    const k = linha.slice(0, i).trim();
    if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(k)) process.env[k] = linha.slice(i + 1).trim();
  }
  if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCAO)) throw new Error("RECUSADO: nunca contra o banco de produção.");
}

describe.skipIf(!LIGADO)("4022 — peças do piloto no sandbox", () => {
  it("o levantamento de Londrina e Cambé (só leitura)", async () => {
    preparar();
    const admin = (await import("@/lib/supabase/admin")).createAdminClient();
    const { levantarConta } = await import("@/lib/asaas/pecas-do-piloto");
    const adm = (await admin.from("profiles").select("id").eq("email", "admin@example.com").single()).data!.id as string;
    for (const nome of ["Risarte Londrina - Centro", "Risarte Cambé - Centro"]) {
      const clinic = (await admin.from("clinics").select("id").eq("name", nome).single()).data!.id as string;
      const { data: conta } = await admin.from("gateway_accounts").select("id, environment").eq("clinic_id", clinic).eq("status", "active").single();
      if (conta?.environment !== "sandbox") throw new Error(`RECUSADO: a conta de ${nome} não é de sandbox.`);
      const r = await levantarConta(conta.id, adm);
      log(`[prova] levantamento ${nome}:`, JSON.stringify(r));
      expect(r.ok, r.erro).toBe(true);
      const { data: salvo } = await admin.from("gateway_account_surveys").select("ok, open_payments, installments, subscriptions").eq("account_id", conta.id).order("ran_at", { ascending: false }).limit(1).single();
      expect(salvo?.ok).toBe(true);
    }
  }, 180_000);

  it("a conciliação acha o pagamento sem aviso e a cobrança de fora; as duas fecham sozinhas", async () => {
    preparar();
    const admin = (await import("@/lib/supabase/admin")).createAdminClient();
    const { conciliarConta } = await import("@/lib/asaas/pecas-do-piloto");
    const { credencialDaConta } = await import("@/lib/asaas/account");
    const adm = (await admin.from("profiles").select("id").eq("email", "admin@example.com").single()).data!.id as string;
    const ldn = (await admin.from("clinics").select("id").eq("name", "Risarte Londrina - Centro").single()).data!.id as string;
    const { data: conta } = await admin.from("gateway_accounts").select("id, environment, webhook_id").eq("clinic_id", ldn).eq("status", "active").single();
    if (conta?.environment !== "sandbox" || !conta.webhook_id) throw new Error("RECUSADO: a conta de Londrina não é de sandbox ou não tem webhook.");
    const cred = await credencialDaConta(conta.id, "prova_4022", adm);
    const asaas = async (caminho: string, metodo = "GET", corpo?: unknown) => {
      const r = await fetch(`https://api-sandbox.asaas.com/v3${caminho}`, {
        method: metodo,
        headers: { access_token: cred.apiKey, "User-Agent": "riSZon - prova", "Content-Type": "application/json" },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      return (await r.json()) as Record<string, unknown>;
    };

    // A cobrança do riSZon: aberta, boleto ou Pix, pagador SEM contato no Asaas.
    const { data: candidatas } = await admin.from("charges")
      .select("id, asaas_payment_id, status, value_cents").eq("gateway_account_id", conta.id).in("status", ["emitida", "vencida"])
      .eq("is_external", false).is("installment_block", null).not("asaas_payment_id", "is", null).order("created_at", { ascending: false }).limit(30);
    let alvo: { id: string; asaas_payment_id: string; value: number; customer: string } | null = null;
    for (const c of candidatas ?? []) {
      const p = await asaas(`/payments/${c.asaas_payment_id}`);
      if (!["PENDING", "OVERDUE"].includes(String(p.status)) || p.billingType === "CREDIT_CARD") continue;
      const cli = await asaas(`/customers/${p.customer}`);
      if (cli.email || cli.mobilePhone || cli.phone) continue;
      alvo = { id: c.id, asaas_payment_id: String(c.asaas_payment_id), value: Number(p.value), customer: String(p.customer) };
      break;
    }
    if (!alvo) throw new Error("NÃO PROVEI: nenhuma cobrança aberta de Londrina com pagador sem contato.");
    log("[prova] cobrança do riSZon:", alvo.id, alvo.asaas_payment_id, alvo.value);

    let fora = "";
    try {
      const pausa = await asaas(`/webhooks/${conta.webhook_id}`, "PUT", { interrupted: true });
      log("[prova] fila pausada:", pausa.interrupted);
      expect(pausa.interrupted).toBe(true);

      const pago = await asaas(`/payments/${alvo.asaas_payment_id}/receiveInCash`, "POST", { paymentDate: hojeSP(), value: alvo.value, notifyCustomer: false });
      log("[prova] recebido em dinheiro no Asaas:", pago.status);
      expect(pago.status).toBe("RECEIVED_IN_CASH");
      const nova = await asaas("/payments", "POST", { customer: alvo.customer, billingType: "BOLETO", value: 7.77, dueDate: diasDepois(5), description: "Prova 4022 — criada fora do riSZon" });
      fora = String(nova.id ?? "");
      log("[prova] criada fora do riSZon:", fora);
      expect(fora).toMatch(/^pay_/);

      await espera(8_000);
      const antes = (await admin.from("charges").select("status").eq("id", alvo.id).single()).data!.status;
      log("[prova] no riSZon, sem o aviso:", antes);
      expect(["emitida", "vencida"]).toContain(antes);

      const r1 = await conciliarConta(conta.id, "diaria");
      log("[prova] conciliação 1:", JSON.stringify(r1));
      expect(r1.erro).toBeUndefined();
      const { data: d1 } = await admin.from("gateway_charge_issues").select("kind, status, asaas_payment_id").eq("account_id", conta.id).in("asaas_payment_id", [alvo.asaas_payment_id, fora]);
      log("[prova] divergências:", JSON.stringify(d1));
      expect(d1?.find((d) => d.asaas_payment_id === alvo!.asaas_payment_id)).toMatchObject({ kind: "paga_no_asaas", status: "aberta" });
      expect(d1?.find((d) => d.asaas_payment_id === fora)).toMatchObject({ kind: "fora_do_riszon", status: "aberta" });
      expect((await admin.from("charges").select("status").eq("id", alvo.id).single()).data!.status).toBe(antes); // nada baixado sozinho
    } finally {
      const volta = await asaas(`/webhooks/${conta.webhook_id}`, "PUT", { interrupted: false });
      log("[prova] fila reativada:", volta.interrupted === false);
    }

    // O Asaas reenvia o aviso guardado: a baixa acontece pelo caminho normal.
    let depois = "";
    for (let i = 0; i < 36; i++) {
      await espera(5_000);
      depois = (await admin.from("charges").select("status").eq("id", alvo.id).single()).data!.status as string;
      if (!["emitida", "vencida"].includes(depois)) break;
    }
    log("[prova] no riSZon, depois de reativar a fila:", depois);
    expect(["paga", "liquidada"]).toContain(depois);

    const apagada = await asaas(`/payments/${fora}`, "DELETE");
    log("[prova] a de fora apagada:", apagada.deleted);
    const r2 = await conciliarConta(conta.id, "diaria");
    log("[prova] conciliação 2:", JSON.stringify(r2));
    const { data: d2 } = await admin.from("gateway_charge_issues").select("kind, status, asaas_payment_id").eq("account_id", conta.id).in("asaas_payment_id", [alvo.asaas_payment_id, fora]);
    log("[prova] divergências depois:", JSON.stringify(d2));
    for (const d of d2 ?? []) expect(d.status, d.kind).toBe("resolvida");
  }, 420_000);
});
