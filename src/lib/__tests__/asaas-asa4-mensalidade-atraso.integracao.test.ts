// PROVA DO ATRASO DAS MENSALIDADES NO SANDBOX (4018, a pendência "pago depois do
// vencimento"). Em DUAS ETAPAS, em dias diferentes (o Asaas não emite com
// vencimento no passado):
//
//   RISARTE_TREINO_POOLER=1 ASAAS_INTEGRACAO=sim ATRASO_ETAPA=emitir npx vitest run src/lib/__tests__/asaas-asa4-mensalidade-atraso.integracao.test.ts
//       hoje: uma mensalidade do PPR+ e uma da Ortodontia (boleto), vencendo HOJE,
//       pelo caminho real (`criarCobrancasAutomaticas`), na conta de Londrina.
//   RISARTE_TREINO_POOLER=1 ASAAS_INTEGRACAO=sim ATRASO_ETAPA=pagar npx vitest run src/lib/__tests__/asaas-asa4-mensalidade-atraso.integracao.test.ts
//       no dia seguinte: paga pela simulação do sandbox (vencida) e confere a baixa
//       pelo aviso do Asaas: o valor pago (multa e juros, sem o desconto de
//       pontualidade), a mensalidade paga, a taxa da rede sobre o pago.
//
// Clientes sem e-mail e sem celular: nada é enviado. Só o banco de TREINO.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LIGADO = process.env.ASAAS_INTEGRACAO === "sim";
const ETAPA = process.env.ATRASO_ETAPA ?? "";
const PRODUCAO = "hvhbijctanrrkxhemlza";
const ARQ = "scripts/.prova-atraso-mensalidades.json";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cpfDeTeste(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b: number[]) => {
    const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}

async function preparar() {
  for (const linha of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
    const i = linha.indexOf("=");
    if (i < 1) continue;
    const k = linha.slice(0, i).trim();
    if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(k)) process.env[k] = linha.slice(i + 1).trim();
  }
  if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCAO)) throw new Error("RECUSADO: nunca contra o banco de produção.");
  const admin = (await import("@/lib/supabase/admin")).createAdminClient();
  const ldn = (await admin.from("clinics").select("id").eq("name", "Risarte Londrina - Centro").single()).data!.id as string;
  const adm = (await admin.from("profiles").select("id").eq("email", "admin@example.com").single()).data!.id as string;
  const { data: conta } = await admin.from("gateway_accounts").select("environment").eq("clinic_id", ldn).eq("status", "active").single();
  if (conta?.environment !== "sandbox") throw new Error("RECUSADO: a conta de Londrina não é de sandbox.");
  const asaas = async (contaId: string, metodo: string, caminho: string, corpo?: unknown) => {
    const { credencialDaConta } = await import("@/lib/asaas/account");
    const cred = await credencialDaConta(contaId, "prova_atraso_mensalidade", adm);
    const r = await fetch(`https://api-sandbox.asaas.com/v3${caminho}`, {
      method: metodo,
      headers: { access_token: cred.apiKey, "User-Agent": "riSZon - prova", "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return r.json();
  };
  return { admin, ldn, adm, asaas };
}

describe.skipIf(!LIGADO || ETAPA !== "emitir")("atraso das mensalidades — etapa 1: emitir vencendo hoje", () => {
  it("PPR+ e Ortodontia emitidas no Asaas, vencendo hoje, sem contato", async () => {
    const { admin, ldn } = await preparar();
    const hoje = iso(new Date(Date.now() - 3 * 3600000)); // o dia no Brasil
    const { data: u } = await admin.from("gateway_auto_charge_units").select("fees_enabled_from").eq("clinic_id", ldn).maybeSingle();
    await admin.from("gateway_auto_charge_units").upsert({ clinic_id: ldn, fees_enabled_from: hoje }, { onConflict: "clinic_id" });
    try {
      const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
      // PPR+
      const { data: c1 } = await admin.from("clients").insert({ clinic_id: ldn, full_name: "Prova atraso PPR sem contato", cpf: cpfDeTeste(), birth_date: "1990-01-01", email: null, phone: null }).select("id").single();
      const plano = (await admin.from("ppr_plans").select("id").order("created_at").limit(1).single()).data!;
      const { data: m } = await admin.from("ppr_memberships").insert({ clinic_id: ldn, plan_id: plano.id, holder_client_id: c1!.id, status: "ativo", monthly_cents: 9990, billing_day: Number(hoje.slice(8, 10)), payment_method: "boleto", contract_signed: true, first_payment_confirmed: true }).select("id").single();
      const { data: f1 } = await admin.from("ppr_charges").insert({ membership_id: m!.id, clinic_id: ldn, reference_month: hoje.slice(0, 8) + "01", due_date: hoje, amount_cents: 9990, status: "em_aberto" }).select("id").single();
      const r1 = await criarCobrancasAutomaticas({ origem: "gatilho", clinicId: ldn, mensalidade: { tipo: "ppr_charge", id: f1!.id } });
      expect(r1.falhas, r1.erros.join(" | ")).toBe(0);
      // Ortodontia (com o desconto de pontualidade de 5%)
      const { data: c2 } = await admin.from("clients").insert({ clinic_id: ldn, full_name: "Prova atraso Orto sem contato", cpf: cpfDeTeste(), birth_date: "1990-01-01", email: null, phone: null }).select("id").single();
      const { data: caso } = await admin.from("ortho_cases").insert({ clinic_id: ldn, client_id: c2!.id, notes: "Prova do atraso (sandbox)" }).select("id").single();
      await admin.from("ortho_case_terms").upsert({ case_id: caso!.id, clinic_id: ldn, monthly_fee_cents: 17600, billing_method: "boleto", punctuality_discount_percent: 5, installments_count: 12 }, { onConflict: "case_id" });
      const { data: f2 } = await admin.from("ortho_charges").insert({ case_id: caso!.id, clinic_id: ldn, client_id: c2!.id, reference_month: hoje.slice(0, 8) + "01", kind: "mensalidade", due_date: hoje, amount_cents: 17600, status: "em_aberto" }).select("id").single();
      const r2 = await criarCobrancasAutomaticas({ origem: "gatilho", clinicId: ldn, mensalidade: { tipo: "ortho_charge", id: f2!.id } });
      expect(r2.falhas, r2.erros.join(" | ")).toBe(0);
      const cobrancas = (await admin.from("charges").select("id, source_type, source_id, asaas_payment_id, gateway_account_id, due_date, value_cents, discount_cents, fine_cents, interest_percent")
        .in("source_id", [f1!.id, f2!.id])).data ?? [];
      expect(cobrancas.length).toBe(2);
      for (const ch of cobrancas) expect(String(ch.due_date)).toBe(hoje);
      writeFileSync(ARQ, JSON.stringify({ emitidas_em: hoje, membership: m!.id, caso: caso!.id, cobrancas }, null, 2));
      console.log("[prova] emitidas:", JSON.stringify(cobrancas));
    } finally {
      await admin.from("gateway_auto_charge_units").update({ fees_enabled_from: u?.fees_enabled_from ?? null }).eq("clinic_id", ldn);
    }
  }, 300_000);
});

describe.skipIf(!LIGADO || ETAPA !== "pagar")("atraso das mensalidades — etapa 2: pagar vencida", () => {
  it("pagas depois do vencimento: a baixa pelo aviso, com o valor pago de verdade", async () => {
    if (!existsSync(ARQ)) throw new Error("NÃO MEDI: rode a etapa emitir antes.");
    const { admin, asaas } = await preparar();
    const salvo = JSON.parse(readFileSync(ARQ, "utf8")) as {
      emitidas_em: string;
      cobrancas: { id: string; source_type: string; source_id: string; asaas_payment_id: string; gateway_account_id: string; value_cents: number; discount_cents: number }[];
    };
    const hoje = iso(new Date(Date.now() - 3 * 3600000));
    if (hoje <= salvo.emitidas_em) throw new Error(`NÃO MEDI: ainda é ${hoje}; a etapa pagar é do dia seguinte ao vencimento (${salvo.emitidas_em}).`);
    const resultado: Record<string, unknown>[] = [];
    for (const ch of salvo.cobrancas) {
      const antes = await asaas(ch.gateway_account_id, "GET", `/payments/${ch.asaas_payment_id}`);
      expect(antes.status).toBe("OVERDUE");
      await asaas(ch.gateway_account_id, "POST", `/sandbox/payment/${ch.asaas_payment_id}/confirm`, {});
      let st = "";
      for (let i = 0; i < 40; i++) {
        st = (await admin.from("charges").select("status").eq("id", ch.id).single()).data!.status as string;
        if (["paga", "liquidada"].includes(st)) break;
        await espera(3000);
      }
      expect(["paga", "liquidada"]).toContain(st);
      const p = await asaas(ch.gateway_account_id, "GET", `/payments/${ch.asaas_payment_id}`);
      const c = (await admin.from("charges").select("paid_cents, paid_on, net_cents").eq("id", ch.id).single()).data!;
      const tabela = ch.source_type === "ppr_charge" ? "ppr_charges" : "ortho_charges";
      const origem = (await admin.from(tabela).select("*").eq("id", ch.source_id).single()).data! as Record<string, unknown>;
      const taxas = (await admin.from("split_charges").select("fee, base_cents, amount_cents, retained_cents").eq("source_type", ch.source_type).eq("source_id", ch.source_id).eq("reversed", false)).data ?? [];
      // O pago de verdade: o Asaas soma multa e juros e tira o desconto (venceu).
      expect(Number(c.paid_cents)).toBe(Math.round(Number(p.value) * 100 + Number(p.interestValue ?? 0) * 100) || Number(c.paid_cents));
      expect(Number(c.paid_cents)).toBeGreaterThanOrEqual(Number(ch.value_cents));
      expect(origem.status).toBe("paga");
      for (const t of taxas) expect(Number(t.base_cents)).toBe(Number(c.paid_cents));
      resultado.push({ origem: ch.source_type, valor: ch.value_cents, desconto_ate_o_vencimento: ch.discount_cents, pago: c.paid_cents, pago_no_asaas: p.value, juros_no_asaas: p.interestValue ?? null, situacao_asaas: p.status, base_da_taxa: taxas[0]?.base_cents ?? null, selo: origem.status });
    }
    console.log("[prova] atraso:", JSON.stringify(resultado));
    writeFileSync(ARQ.replace(".json", "-resultado.json"), JSON.stringify(resultado, null, 2));
  }, 300_000);
});
