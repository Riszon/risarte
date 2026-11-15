// PROVA: A ANTECIPAÇÃO DE UM PARCELAMENTO NO CARTÃO COM SPLIT (ASA4, entrega 2, ajuste D).
//
// Direto na API do SANDBOX, separado do riSZon. Conta de teste de Londrina; pagador
// SEM e-mail e SEM celular, avisos desligados (nada é enviado a ninguém). Cartão de
// teste do Asaas, pela API, só no sandbox.
// Tenta responder: (1) a simulação da antecipação (taxa, líquido); (2) depois de
// pedir a antecipação, o split de cada parcela muda de valor? sai na antecipação
// ou na data original? a data de crédito muda? Se o sandbox não deixar antecipar,
// diz isso. No fim, tenta estornar e apaga o pagador.
//
//   node scripts/asaas-prova-antecipacao-parcelado-sandbox.mjs --confirmar
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
if (!process.argv.includes("--confirmar")) {
  console.log("Prova da antecipação no SANDBOX (pagador sem contato).\n  node scripts/asaas-prova-antecipacao-parcelado-sandbox.mjs --confirmar");
  process.exit(2);
}
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const conta = await um("select g.id, g.environment from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active'");
const raiz = await um("select wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' and wallet_id is not null order by created_at limit 1");
if (!conta || conta.environment !== "sandbox" || !raiz) { console.error("RECUSADO: falta Londrina no sandbox ou a raiz."); process.exit(1); }
const chave = (await um("select api_key from public._gateway_read_key($1, 'prova_antecipacao_sandbox', null)", [conta.id])).api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }
const api = async (m, p, b) => {
  const r = await fetch(SANDBOX + p, { method: m, headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "riSZon (Risarte Odontologia) - prova antecipacao" }, body: b ? JSON.stringify(b) : undefined, redirect: "error" });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, j, erro: r.ok ? null : (j?.errors ?? []).map((e) => `${e.code}: ${e.description}`).join(" | ") };
};
const nn = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
const dv = (b) => { const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
const d1 = dv(nn); const cpf = [...nn, d1, dv([...nn, d1])].join("");
const venc = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
const pagador = (await api("POST", "/customers", { name: "Prova antecipacao riSZon (sem contato)", cpfCnpj: cpf, notificationDisabled: true })).j;
const ler = async (inst) => {
  const ps = (await api("GET", `/installments/${inst}/payments`)).j.data.sort((a, b) => a.installmentNumber - b.installmentNumber);
  const out = [];
  for (const x of ps) {
    const p = (await api("GET", `/payments/${x.id}`)).j;
    out.push({ n: p.installmentNumber, status: p.status, liquido: p.netValue, anticipated: p.anticipated ?? null, anticipable: p.anticipable ?? null, credito: p.estimatedCreditDate ?? p.creditDate ?? null, split: (p.split ?? []).map((s) => `${s.totalValue} ${s.status}`).join(";") });
  }
  return out;
};
const out = {};
let inst = null;
try {
  const p = await api("POST", "/payments", {
    customer: pagador.id, billingType: "CREDIT_CARD", installmentCount: 3, totalValue: 300, dueDate: venc,
    description: "Prova antecipacao (ASA4) - sandbox", externalReference: `prova-antecipacao-${Date.now()}`,
    split: [{ walletId: raiz.wallet_id, percentualValue: 17.4341, fixedValue: 0.02 }],
    creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 2), ccv: "123" },
    creditCardHolderInfo: { name: "Prova antecipacao riSZon", email: "prova.cartao@example.com", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "1000", phone: "4333330000" },
    remoteIp: "127.0.0.1",
  });
  if (!p.ok) throw new Error("criar: " + p.erro);
  inst = p.j.installment;
  out.antes = await ler(inst);
  const sim = await api("POST", "/anticipations/simulate", { installment: inst });
  out.simulacao = sim.ok ? { valor: sim.j?.value, taxa: sim.j?.fee, liquido: sim.j?.netValue, dias: sim.j?.anticipationDays, documentos: sim.j?.isDocumentationRequired } : { erro: sim.erro, http: sim.status };
  const pedido = await api("POST", "/anticipations", { installment: inst });
  out.pedido = pedido.ok ? { id: pedido.j?.id, status: pedido.j?.status, taxa: pedido.j?.fee, liquido: pedido.j?.netValue, data: pedido.j?.anticipationDate } : { erro: pedido.erro, http: pedido.status };
  if (pedido.ok) {
    await new Promise((r) => setTimeout(r, 15_000));
    const a = await api("GET", `/anticipations/${pedido.j.id}`);
    out.antecipacao_depois = { status: a.j?.status, data: a.j?.anticipationDate, negada: a.j?.denialObservation ?? null };
    out.depois = await ler(inst);
  }
} finally {
  if (inst) {
    const e = await api("POST", `/installments/${inst}/refund`, {});
    out.estorno_no_fim = e.ok ? "ok" : e.erro;
  }
  await api("DELETE", `/customers/${pagador.id}`);
}
console.log(JSON.stringify(out, null, 2));
console.log("\nNada foi enviado a ninguém (pagador sem contato, avisos desligados).");
