// PROVA DE PONTA A PONTA NO SANDBOX — ASA4, 1B (4015): a forma 2, "Todos os
// boletos agora", com 12 boletos. Opcional, fora do portão do dia a dia:
//
//   ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/asaas-asa4-1b.integracao.test.ts
//
// O caminho REAL do servidor (`criarCobrancasAutomaticas` → `_charge_prepare_system`
// → `emitirNoAsaas` pelo cadastro do carnê) contra a conta sandbox de Londrina, no
// banco de TREINO. NADA É ENVIADO A NINGUÉM: o pagador é um cliente novo, com CPF de
// teste, SEM e-mail e SEM celular. No fim, os boletos são cancelados no Asaas.
// Recusa o banco de produção.
import { createHash, randomBytes } from "node:crypto";
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

describe.skipIf(!LIGADO)("ASA4 1B — forma 2 com 12 boletos (sandbox, sem envio)", () => {
  type Admin = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  let admin: Admin;
  let ldn = "";
  let adm = "";
  let venda = "";
  let unidadeAntes: { enabled: boolean; enabled_from: string | null } | null = null;
  let cs: { id: string; asaas_payment_id: string; gateway_account_id: string; due_date: string; via_carne: boolean; status: string }[] = [];

  const credencial = async () => {
    const { credencialDaConta, opcoesDaConta } = await import("@/lib/asaas/account");
    const conta = cs[0].gateway_account_id;
    return { cred: await credencialDaConta(conta, "prova_asa4_1b", adm), opts: opcoesDaConta(conta, "prova_asa4_1b") };
  };
  const asaas = async (caminho: string) => {
    const { cred } = await credencial();
    const r = await fetch(`https://api-sandbox.asaas.com/v3${caminho}`, { headers: { access_token: cred.apiKey, "User-Agent": "riSZon - prova" } });
    return r.json();
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
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (venda) {
      const ids = (await admin.from("payment_installments").select("id").eq("direct_sale_id", venda)).data?.map((x) => x.id) ?? [];
      const { data: vivas } = await admin.from("charges").select("id").in("payment_installment_id", ids).in("status", ["emitida", "vencida", "emitindo", "erro_emissao"]);
      const { cancelarBoletosDoSistema } = await import("@/lib/asaas/boletos-da-operacao");
      const r = await cancelarBoletosDoSistema((vivas ?? []).map((x) => x.id), adm, "prova ASA4 1B (sandbox)");
      console.log(`limpeza: ${r.cancelados} boleto(s) cancelado(s) no Asaas`);
      await admin.from("direct_sales").update({ cancelled: true, notes: "Prova ASA4 1B (sandbox), cancelada no fim da prova" }).eq("id", venda);
    }
    if (unidadeAntes) await admin.from("gateway_auto_charge_units").update(unidadeAntes).eq("clinic_id", ldn);
    else await admin.from("gateway_auto_charge_units").delete().eq("clinic_id", ldn);
  }, 300_000);

  it("forma 2: a assinatura cria os 12 boletos de uma vez, todos pelo cadastro do carnê", async () => {
    await admin.from("gateway_auto_charge_units").upsert({ clinic_id: ldn, enabled: true, enabled_from: new Date(Date.now() - 60_000).toISOString() });
    const { data: cli } = await admin.from("clients").insert({ clinic_id: ldn, full_name: "Prova ASA4 forma dois", cpf: cpfDeTeste(), birth_date: "1990-01-01", email: null, phone: null }).select("id").single();
    let primeiro = iso(new Date(Date.now() + 5 * 86400000));
    if (Number(primeiro.slice(8, 10)) > 28) primeiro = primeiro.slice(0, 8) + "05";
    const { data: v } = await admin.from("direct_sales").insert({ clinic_id: ldn, client_id: cli!.id, client_name: "Prova ASA4 forma dois", final_cents: 120000, payment_method: "boleto", installments: 12, boleto_mode: "todos" }).select("id").single();
    venda = v!.id;
    const linhas = Array.from({ length: 12 }, (_, k) => ({ seq: k + 1, kind: "parcela", due_date: mesesDepois(primeiro, k), payment_method: "boleto", amount_cents: 10000, clinic_id: ldn, client_id: cli!.id, direct_sale_id: venda }));
    expect((await admin.from("payment_installments").insert(linhas)).error).toBeNull();
    await admin.from("direct_sales").update({ contract_signed: true, contract_signed_at: new Date().toISOString() }).eq("id", venda);
    const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
    const r = await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: venda });
    expect(r.falhas, r.erros.join(" | ")).toBe(0);
    expect(r.criadas).toBe(12);
    const ids = (await admin.from("payment_installments").select("id").eq("direct_sale_id", venda)).data!.map((x) => x.id);
    cs = ((await admin.from("charges").select("id, asaas_payment_id, gateway_account_id, due_date, via_carne, status, asaas_sent_at").in("payment_installment_id", ids).order("due_date")).data ?? []) as typeof cs;
    expect(cs).toHaveLength(12);
    expect(cs.every((c) => c.via_carne && c.status === "emitida" && /^pay_/.test(c.asaas_payment_id))).toBe(true);
    // Nunca "Enviada pelo Asaas": o aviso de criação é desligado no carnê.
    expect(cs.every((c) => !(c as unknown as { asaas_sent_at: string | null }).asaas_sent_at)).toBe(true);
  }, 300_000);

  it("no Asaas: os 12 no cadastro do carnê (\"cobrança criada\" desligado), e o cadastro principal intocado", async () => {
    const pagamentos = await Promise.all(cs.map((c) => asaas(`/payments/${c.asaas_payment_id}`)));
    const clientes = new Set(pagamentos.map((p) => p.customer as string));
    expect(clientes.size).toBe(1);
    const carne = [...clientes][0];
    const cad = await asaas(`/customers/${carne}`);
    expect(String(cad.externalReference)).toMatch(/^riszon-carne:/);
    expect(cad.email ?? null).toBeNull();
    expect(cad.mobilePhone ?? null).toBeNull();
    const avisos = await asaas(`/customers/${carne}/notifications`);
    const criada = (avisos.data ?? []).filter((n: { event: string }) => n.event === "PAYMENT_CREATED");
    expect(cad.notificationDisabled === true || criada.every((n: { enabled: boolean }) => !n.enabled)).toBe(true);
    // O cadastro principal (o da régua) não tem nenhum desses boletos.
    const { data: gravado } = await admin.from("gateway_carne_customers").select("gateway_customer_id, asaas_customer_id").eq("asaas_customer_id", carne).single();
    const { data: principal } = await admin.from("gateway_customers").select("asaas_customer_id").eq("id", gravado!.gateway_customer_id).single();
    expect(principal!.asaas_customer_id).not.toBe(carne);
    const doPrincipal = await asaas(`/payments?customer=${principal!.asaas_customer_id}&limit=50`);
    expect((doPrincipal.data ?? []).some((p: { id: string }) => cs.some((c) => c.asaas_payment_id === p.id))).toBe(false);
  }, 180_000);

  it("a página da lista mostra os 12 boletos, com o link e a linha digitável", async () => {
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    const ultimo = cs.at(-1)!.due_date;
    const { data: cli } = await admin.from("direct_sales").select("client_id").eq("id", venda).single();
    expect((await admin.from("boleto_lists").insert({ clinic_id: ldn, direct_sale_id: venda, client_id: cli!.client_id, token_hash: hash, created_by: adm, expires_at: mesesDepois(ultimo, 0) })).error).toBeNull();
    const { data } = await admin.rpc("_boleto_list_read", { p_token_hash: hash, p_ip_hash: "prova", p_user_agent: "prova" });
    const l = data as { nome: string; boletos: { situacao: string; link: string | null; linha: string | null }[] };
    expect(l.nome).toBe("Prova");
    expect(l.boletos).toHaveLength(12);
    expect(l.boletos.every((b) => b.situacao === "a_pagar" && /^https:\/\//.test(b.link ?? ""))).toBe(true);
    expect(l.boletos.filter((b) => b.linha).length).toBeGreaterThan(0);
  }, 120_000);

  it("de 2 para 1: só os boletos fora do prazo são cancelados no Asaas", async () => {
    const { data: prazo } = await admin.rpc("_auto_charge_window");
    const limite = iso(new Date(Date.now() + Number(prazo) * 86400000));
    const fora = cs.filter((c) => c.due_date > limite).map((c) => c.id);
    const dentro = cs.filter((c) => c.due_date <= limite).map((c) => c.id);
    expect(fora.length).toBeGreaterThan(0);
    await admin.from("direct_sales").update({ boleto_mode: "mensal" }).eq("id", venda);
    const { cancelarBoletosDoSistema } = await import("@/lib/asaas/boletos-da-operacao");
    const r = await cancelarBoletosDoSistema(fora, adm, "troca de forma (um boleto por mês)");
    expect(r.ok).toBe(true);
    expect(r.cancelados).toBe(fora.length);
    const { data: depois } = await admin.from("charges").select("id, status, cancel_system").in("id", cs.map((c) => c.id));
    expect(depois!.filter((x) => fora.includes(x.id)).every((x) => x.status === "cancelada" && x.cancel_system)).toBe(true);
    expect(depois!.filter((x) => dentro.includes(x.id)).every((x) => x.status === "emitida")).toBe(true);
    const removido = await asaas(`/payments/${cs.find((c) => c.id === fora[0])!.asaas_payment_id}`);
    expect(removido.deleted === true || removido.errors).toBeTruthy();
  }, 300_000);
});
