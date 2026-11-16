// PROVA DE PONTA A PONTA NO SANDBOX — ASA4, entrega 4 (4018): as mensalidades
// pelo Asaas. Opcional, fora do portão do dia a dia:
//
//   ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/asaas-asa4-mensalidades.integracao.test.ts
//
// O caminho REAL do servidor (`criarCobrancasAutomaticas` → `_fee_charge_prepare_system`
// → `emitirNoAsaas`) contra a conta sandbox de Londrina, no banco de TREINO. NADA É
// ENVIADO A NINGUÉM: o pagador é um cliente novo, com CPF de teste, SEM e-mail e SEM
// celular. O pagamento é a simulação do sandbox (`/sandbox/payment/{id}/confirm`), e a
// baixa vem pelo aviso do Asaas ao projeto de teste (o mesmo caminho da produção).
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
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!LIGADO)("ASA4 4018 — mensalidades pelo Asaas (sandbox, sem envio)", () => {
  type Admin = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  let admin: Admin;
  let ldn = "";
  let adm = "";
  let unidadeAntes: { fees_enabled_from: string | null } | null = null;
  const criados: { membership?: string; caso?: string } = {};

  const asaas = async (conta: string, metodo: string, caminho: string, corpo?: unknown) => {
    const { credencialDaConta } = await import("@/lib/asaas/account");
    const cred = await credencialDaConta(conta, "prova_asa4_4018", adm);
    const r = await fetch(`https://api-sandbox.asaas.com/v3${caminho}`, {
      method: metodo,
      headers: { access_token: cred.apiKey, "User-Agent": "riSZon - prova", "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return r.json();
  };
  const esperarBaixa = async (chargeId: string) => {
    for (let i = 0; i < 40; i++) {
      const { data } = await admin.from("charges").select("status").eq("id", chargeId).single();
      if (data && ["paga", "liquidada"].includes(data.status as string)) return data.status as string;
      await espera(3000);
    }
    return null;
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
    const { data: u } = await admin.from("gateway_auto_charge_units").select("fees_enabled_from").eq("clinic_id", ldn).maybeSingle();
    unidadeAntes = u ?? null;
    await admin.from("gateway_auto_charge_units").upsert({ clinic_id: ldn, fees_enabled_from: iso(new Date()) }, { onConflict: "clinic_id" });
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (criados.membership) await admin.from("ppr_memberships").update({ status: "cancelado", cancel_reason: "Prova 4018 (sandbox)" }).eq("id", criados.membership);
    if (criados.caso) await admin.from("ortho_cases").update({ notes: "Prova 4018 (sandbox)" }).eq("id", criados.caso);
    await admin.from("gateway_auto_charge_units").update({ fees_enabled_from: unidadeAntes?.fees_enabled_from ?? null }).eq("clinic_id", ldn);
  }, 120_000);

  it("PPR+: a mensalidade de boleto vai ao Asaas pela rotina e a baixa vem pelo aviso, com a taxa retida", async () => {
    const { data: cli } = await admin.from("clients").insert({ clinic_id: ldn, full_name: "Prova Mensalidade PPR", cpf: cpfDeTeste(), birth_date: "1990-01-01", email: null, phone: null }).select("id").single();
    const plano = (await admin.from("ppr_plans").select("id").order("created_at").limit(1).single()).data!;
    const { data: m } = await admin.from("ppr_memberships").insert({ clinic_id: ldn, plan_id: plano.id, holder_client_id: cli!.id, status: "ativo", monthly_cents: 9990, billing_day: 10, payment_method: "boleto", contract_signed: true, first_payment_confirmed: true }).select("id").single();
    criados.membership = m!.id;
    const venc = iso(new Date(Date.now() + 8 * 86400000));
    const { data: f } = await admin.from("ppr_charges").insert({ membership_id: m!.id, clinic_id: ldn, reference_month: venc.slice(0, 8) + "01", due_date: venc, amount_cents: 9990, status: "em_aberto" }).select("id").single();
    const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
    const r = await criarCobrancasAutomaticas({ origem: "gatilho", clinicId: ldn, mensalidade: { tipo: "ppr_charge", id: f!.id } });
    expect(r.falhas, r.erros.join(" | ")).toBe(0);
    expect(r.criadas).toBe(1);
    const { data: ch } = await admin.from("charges").select("id, asaas_payment_id, gateway_account_id, split_applied, value_cents, fine_percent, interest_percent").eq("source_type", "ppr_charge").eq("source_id", f!.id).single();
    expect(/^pay_/.test(ch!.asaas_payment_id as string)).toBe(true);
    expect(Number(ch!.fine_percent)).toBe(0);
    expect(Number(ch!.interest_percent)).toBe(0);
    const p = await asaas(ch!.gateway_account_id as string, "GET", `/payments/${ch!.asaas_payment_id}`);
    expect(p.description).toMatch(/Mensalidade PPR\+/);
    expect(Number(p.value)).toBe(99.9);
    await asaas(ch!.gateway_account_id as string, "POST", `/sandbox/payment/${ch!.asaas_payment_id}/confirm`, {});
    expect(await esperarBaixa(ch!.id as string)).not.toBeNull();
    expect((await admin.from("ppr_charges").select("status").eq("id", f!.id).single()).data!.status).toBe("paga");
    if (ch!.split_applied) {
      const { data: sc } = await admin.from("split_charges").select("amount_cents, retained_cents").eq("source_type", "ppr_charge").eq("source_id", f!.id).eq("reversed", false);
      expect((sc ?? []).length).toBeGreaterThan(0);
      expect((sc ?? []).every((x) => Number(x.retained_cents) === Number(x.amount_cents))).toBe(true);
    }
  }, 300_000);

  it("Ortodontia: o desconto de pontualidade vai como desconto do Asaas; pago até o vencimento, a taxa incide sobre o pago", async () => {
    const { data: cli } = await admin.from("clients").insert({ clinic_id: ldn, full_name: "Prova Mensalidade Orto", cpf: cpfDeTeste(), birth_date: "1990-01-01", email: null, phone: null }).select("id").single();
    const { data: caso, error: ec } = await admin.from("ortho_cases").insert({ clinic_id: ldn, client_id: cli!.id }).select("id").single();
    if (ec) throw new Error(`caso: ${ec.message}`);
    criados.caso = caso!.id;
    await admin.from("ortho_case_terms").upsert({ case_id: caso!.id, clinic_id: ldn, monthly_fee_cents: 17600, billing_method: "boleto", punctuality_discount_percent: 5, installments_count: 12 }, { onConflict: "case_id" });
    const venc = iso(new Date(Date.now() + 8 * 86400000));
    const { data: f, error: ef } = await admin.from("ortho_charges").insert({ case_id: caso!.id, clinic_id: ldn, client_id: cli!.id, reference_month: venc.slice(0, 8) + "01", kind: "mensalidade", due_date: venc, amount_cents: 17600, status: "em_aberto" }).select("id").single();
    expect(ef).toBeNull();
    const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
    const r = await criarCobrancasAutomaticas({ origem: "gatilho", clinicId: ldn, mensalidade: { tipo: "ortho_charge", id: f!.id } });
    expect(r.falhas, r.erros.join(" | ")).toBe(0);
    const { data: ch } = await admin.from("charges").select("id, asaas_payment_id, gateway_account_id, split_applied, discount_cents").eq("source_type", "ortho_charge").eq("source_id", f!.id).single();
    expect(Number(ch!.discount_cents)).toBe(880);
    const p = await asaas(ch!.gateway_account_id as string, "GET", `/payments/${ch!.asaas_payment_id}`);
    expect(Number(p.discount?.value)).toBe(8.8);
    expect(Number(p.discount?.dueDateLimitDays)).toBe(0);
    await asaas(ch!.gateway_account_id as string, "POST", `/sandbox/payment/${ch!.asaas_payment_id}/confirm`, {});
    expect(await esperarBaixa(ch!.id as string)).not.toBeNull();
    const { data: of } = await admin.from("ortho_charges").select("status, paid_amount_cents").eq("id", f!.id).single();
    expect(of!.status).toBe("paga");
    expect(Number(of!.paid_amount_cents)).toBe(16720);
    const { data: sc } = await admin.from("split_charges").select("base_cents, amount_cents, retained_cents").eq("source_type", "ortho_charge").eq("source_id", f!.id).eq("reversed", false);
    expect((sc ?? []).every((x) => Number(x.base_cents) === 16720)).toBe(true);
    if (ch!.split_applied) expect((sc ?? []).every((x) => Number(x.retained_cents) === Number(x.amount_cents))).toBe(true);
  }, 300_000);
});
