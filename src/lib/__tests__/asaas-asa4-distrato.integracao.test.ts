// PROVA DE PONTA A PONTA NO SANDBOX — ASA4, entrega 6 (4020): o DISTRATO com
// checklist e os boletos vivos da forma 2. Opcional, fora do portão do dia a dia:
//
//   RISARTE_TREINO_POOLER=1 ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/asaas-asa4-distrato.integracao.test.ts
//
// O caminho do servidor (`comBoletosCancelados` → `_charge_mark_cancelled_system`,
// e o banco pelas portas de quem opera: abrir, a checklist, o termo, efetivar),
// contra a conta sandbox de Londrina, no banco de TREINO. NADA É ENVIADO A
// NINGUÉM: o pagador é um cliente novo, com CPF de teste, SEM e-mail e SEM
// celular. O pagamento é a simulação do sandbox, e a baixa vem pelo aviso do
// Asaas ao projeto de teste. Quem opera é o Admin Master de teste (as portas do
// Gerente aceitam o Admin). Recusa o banco de produção.
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
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!LIGADO)("ASA4 4020 — distrato com boletos vivos e a forma 2 (sandbox, sem envio)", () => {
  type Admin = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  type Pg = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> };
  let admin: Admin;
  let pg: Pg;
  let ldn = "";
  let adm = "";
  let venda = "";
  let unidadeAntes: { enabled: boolean; enabled_from: string | null } | null = null;
  let cs: { id: string; asaas_payment_id: string; gateway_account_id: string; due_date: string; status: string }[] = [];
  let hash = "";

  // O banco pela porta de quem opera (o Admin Master de teste), gravando de verdade no treino.
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
    const cred = await credencialDaConta(conta, "prova_asa4_4020", adm);
    const r = await fetch(`https://api-sandbox.asaas.com/v3${caminho}`, {
      method: metodo,
      headers: { access_token: cred.apiKey, "User-Agent": "riSZon - prova", "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
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
    const { connect } = await import("../../../scripts/test-db.mjs");
    pg = (await connect()) as Pg;
    ldn = (await admin.from("clinics").select("id").eq("name", "Risarte Londrina - Centro").single()).data!.id;
    adm = (await admin.from("profiles").select("id").eq("email", "admin@example.com").single()).data!.id;
    const { data: conta } = await admin.from("gateway_accounts").select("environment").eq("clinic_id", ldn).eq("status", "active").single();
    if (conta?.environment !== "sandbox") throw new Error("RECUSADO: a conta de Londrina não é de sandbox.");
    const { data: u } = await admin.from("gateway_auto_charge_units").select("enabled, enabled_from").eq("clinic_id", ldn).maybeSingle();
    unidadeAntes = u ?? null;
  }, 60_000);

  afterAll(async () => {
    if (admin && venda) {
      // Nunca deixa boleto vivo no sandbox.
      const ids = (await admin.from("payment_installments").select("id").eq("direct_sale_id", venda)).data?.map((x) => x.id) ?? [];
      const { data: vivas } = await admin.from("charges").select("id").in("payment_installment_id", ids).in("status", ["emitida", "vencida", "emitindo", "erro_emissao"]);
      if ((vivas ?? []).length) {
        const { cancelarBoletosDoSistema } = await import("@/lib/asaas/boletos-da-operacao");
        await cancelarBoletosDoSistema((vivas ?? []).map((x) => x.id), adm, "prova 4020 (sandbox), limpeza");
      }
    }
    if (admin) {
      if (unidadeAntes) await admin.from("gateway_auto_charge_units").update(unidadeAntes).eq("clinic_id", ldn);
      else await admin.from("gateway_auto_charge_units").delete().eq("clinic_id", ldn);
    }
    await pg?.end();
  }, 300_000);

  it("a venda direta na forma 2: os 4 boletos vivos no Asaas e a lista com o link", async () => {
    await admin.from("gateway_auto_charge_units").upsert({ clinic_id: ldn, enabled: true, enabled_from: new Date(Date.now() - 60_000).toISOString() });
    const { data: cli } = await admin.from("clients").insert({ clinic_id: ldn, full_name: "Prova 4020 distrato sem contato", cpf: cpfDeTeste(), birth_date: "1990-01-01", email: null, phone: null }).select("id").single();
    let primeiro = iso(new Date(Date.now() + 5 * 86400000));
    if (Number(primeiro.slice(8, 10)) > 28) primeiro = primeiro.slice(0, 8) + "05";
    const { data: v } = await admin.from("direct_sales").insert({ clinic_id: ldn, client_id: cli!.id, client_name: "Prova 4020 distrato sem contato", final_cents: 40000, payment_method: "boleto", installments: 4, boleto_mode: "todos" }).select("id").single();
    venda = v!.id;
    const linhas = Array.from({ length: 4 }, (_, k) => ({ seq: k + 1, kind: "parcela", due_date: mesesDepois(primeiro, k), payment_method: "boleto", amount_cents: 10000, clinic_id: ldn, client_id: cli!.id, direct_sale_id: venda }));
    expect((await admin.from("payment_installments").insert(linhas)).error).toBeNull();
    await admin.from("direct_sales").update({ contract_signed: true, contract_signed_at: new Date().toISOString() }).eq("id", venda);
    const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");
    const r = await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: venda });
    expect(r.falhas, r.erros.join(" | ")).toBe(0);
    const ids = (await admin.from("payment_installments").select("id").eq("direct_sale_id", venda)).data!.map((x) => x.id);
    cs = ((await admin.from("charges").select("id, asaas_payment_id, gateway_account_id, due_date, status").in("payment_installment_id", ids).order("due_date")).data ?? []) as typeof cs;
    expect(cs).toHaveLength(4);
    expect(cs.every((c) => c.status === "emitida" && /^pay_/.test(c.asaas_payment_id))).toBe(true);
    const token = randomBytes(32).toString("hex");
    hash = createHash("sha256").update(token).digest("hex");
    expect((await admin.from("boleto_lists").insert({ clinic_id: ldn, direct_sale_id: venda, client_id: cli!.id, token_hash: hash, created_by: adm, expires_at: mesesDepois(cs.at(-1)!.due_date, 0) })).error).toBeNull();
    const { data: lista } = await admin.rpc("_boleto_list_read", { p_token_hash: hash, p_ip_hash: "prova", p_user_agent: "prova" });
    expect((lista as { boletos: { situacao: string }[] }).boletos.every((b) => b.situacao === "a_pagar")).toBe(true);
  }, 300_000);

  it("o 1º boleto é pago (simulação do sandbox) e a baixa vem pelo aviso do Asaas", async () => {
    await asaas(cs[0].gateway_account_id, `/sandbox/payment/${cs[0].asaas_payment_id}/confirm`, "POST", {});
    let st = "";
    for (let i = 0; i < 40; i++) {
      st = (await admin.from("charges").select("status").eq("id", cs[0].id).single()).data!.status as string;
      if (["paga", "liquidada"].includes(st)) break;
      await espera(3000);
    }
    expect(["paga", "liquidada"]).toContain(st);
  }, 180_000);

  it("com algo pago, o cancelamento simples é recusado; o distrato abre sem cancelar nada no Asaas", async () => {
    const simples = await comoAdmin("select public.cancel_direct_sale($1)", [venda]);
    expect(simples.error?.message ?? "").toMatch(/DISTRATO_REQUIRED|ALREADY_CLOSED/);
    const ab = await comoAdmin("select public.open_direct_sale_distrato($1, 'prova 4020: desistiu') id", [venda]);
    expect(ab.error).toBeNull();
    const id = ab.rows[0].id as string;
    const pc = (await admin.from("plan_cancellations").select("kind, paid_cents, clinic_refunds_cents, penalty_cents").eq("id", id).single()).data!;
    expect(pc.kind).toBe("venda_direta");
    expect(Number(pc.paid_cents)).toBe(10000);
    expect(Number(pc.clinic_refunds_cents)).toBe(10000);
    expect(Number(pc.penalty_cents)).toBe(0);
    // Abrir não cancela nada: os 3 boletos continuam vivos no Asaas.
    for (const c of cs.slice(1)) {
      const p = await asaas(c.gateway_account_id, `/payments/${c.asaas_payment_id}`);
      expect(p.deleted).toBe(false);
    }
    // Efetivar sem a checklist é recusado, e nada é cancelado.
    await comoAdmin("select public.sign_plan_cancellation($1, true)", [id]);
    const sem = await comoAdmin("select public.apply_plan_cancellation($1)", [id]);
    expect(sem.error?.message ?? "").toMatch(/CHECKLIST_INCOMPLETE/);
    expect((await admin.from("charges").select("status").eq("id", cs[1].id).single()).data!.status).toBe("emitida");
    // A checklist (os 8 itens) e o termo assinado.
    for (let k = 1; k <= 8; k++) expect((await comoAdmin("select public.distrato_checklist_set($1, $2, 'feito', null)", [id, k])).error).toBeNull();
    // Efetivar pelo caminho do servidor: os boletos vivos cancelados no Asaas, depois o banco.
    const { comBoletosCancelados } = await import("@/lib/asaas/boletos-da-operacao");
    const abertas = (await admin.from("payment_installments").select("id").eq("direct_sale_id", venda).in("status", ["em_aberto", "parcial"])).data!.map((x) => x.id);
    const op = await comBoletosCancelados<unknown>({
      operacao: "distrato",
      motivo: "distrato (prova 4020)",
      installmentIds: abertas,
      actorId: adm,
      confirmar: true,
      venda: { directSaleId: venda },
      tentar: async () => {
        const r = await comoAdmin("select public.apply_plan_cancellation($1)", [id]);
        return { error: r.error };
      },
    });
    expect(op.ok, op.ok ? "" : op.error).toBe(true);
    expect((await admin.from("plan_cancellations").select("status").eq("id", id).single()).data!.status).toBe("efetivado");
    expect((await admin.from("direct_sales").select("cancelled").eq("id", venda).single()).data!.cancelled).toBe(true);
  }, 300_000);

  it("no Asaas: os 3 boletos em aberto apagados; o pago intocado; a lista mostra \"Cancelado\"", async () => {
    for (const c of cs.slice(1)) {
      const p = await asaas(c.gateway_account_id, `/payments/${c.asaas_payment_id}`);
      expect(p.deleted).toBe(true);
      expect((await admin.from("charges").select("status").eq("id", c.id).single()).data!.status).toBe("cancelada");
    }
    const pago = await asaas(cs[0].gateway_account_id, `/payments/${cs[0].asaas_payment_id}`);
    expect(pago.deleted).toBe(false);
    expect(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]).toContain(pago.status);
    const { data: lista } = await admin.rpc("_boleto_list_read", { p_token_hash: hash, p_ip_hash: "prova", p_user_agent: "prova" });
    const b = (lista as { boletos: { situacao: string }[] }).boletos;
    console.log("situações na lista:", b.map((x) => x.situacao).join(", "));
    expect(b.filter((x) => x.situacao !== "a_pagar").length).toBe(4);
    expect(b.some((x) => x.situacao === "a_pagar")).toBe(false);
  }, 180_000);
});
