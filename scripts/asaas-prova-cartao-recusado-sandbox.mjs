// PROVA: CARTÃO RECUSADO E NOVA TENTATIVA NO MESMO PARCELAMENTO (ASA4, entrega 2).
//
// Direto na API do SANDBOX, separado do riSZon. Conta de teste de Londrina; pagador
// SEM e-mail e SEM celular, avisos desligados (nada é enviado a ninguém).
// Cria um parcelamento 3× no cartão SEM cartão (como o link da fatura), tenta pagar
// com um cartão que o Asaas recusa e depois com o cartão de teste aprovado, pela
// MESMA cobrança. Confere: o parcelamento continua o mesmo, nenhuma parcela nova
// nasce e, depois da aprovação, as 3 ficam confirmadas. No fim, estorna e apaga.
//
//   node scripts/asaas-prova-cartao-recusado-sandbox.mjs --confirmar
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
if (!process.argv.includes("--confirmar")) {
  console.log("Prova do cartão recusado no SANDBOX (pagador sem contato).\n  node scripts/asaas-prova-cartao-recusado-sandbox.mjs --confirmar");
  process.exit(2);
}
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const conta = await um("select g.id, g.environment from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active'");
if (!conta || conta.environment !== "sandbox") { console.error("RECUSADO: falta Londrina no sandbox."); process.exit(1); }
const chave = (await um("select api_key from public._gateway_read_key($1, 'prova_cartao_recusado_sandbox', null)", [conta.id])).api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }

async function asaas(metodo, caminho, corpo) {
  const r = await fetch(SANDBOX + caminho, {
    method: metodo,
    headers: { access_token: chave, "User-Agent": "riSZon (Risarte Odontologia) - prova cartao recusado", "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
    redirect: "error",
  });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, j, erro: r.ok ? null : (j?.errors ?? []).map((e) => `${e.code}: ${e.description}`).join(" | ") };
}
function cpfDeTeste() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b) => { const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}
const venc = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const cpf = cpfDeTeste();
const pagador = (await asaas("POST", "/customers", { name: "Prova cartao recusado riSZon (sem contato)", cpfCnpj: cpf, notificationDisabled: true })).j;
const titular = { name: "Prova cartao recusado riSZon", email: "prova.cartao@example.com", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "1000", phone: "4333330000" };
const ano = String(new Date().getFullYear() + 2);
// Cartões de recusa: número que não passa na validação (Luhn) e o de recusa do sandbox, se houver.
const RECUSA = [
  { rotulo: "número inválido", creditCard: { holderName: "TESTE RISZON", number: "4444444444444445", expiryMonth: "12", expiryYear: ano, ccv: "123" } },
  { rotulo: "cartão vencido", creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "01", expiryYear: "2020", ccv: "123" } },
];
const out = { tentativas: [] };
let inst = null;
try {
  const p = await asaas("POST", "/payments", {
    customer: pagador.id, billingType: "CREDIT_CARD", installmentCount: 3, totalValue: 30, dueDate: venc,
    description: "Prova cartao recusado (ASA4) - sandbox", externalReference: `prova-recusado-${Date.now()}`,
  });
  if (!p.ok) throw new Error("criar: " + p.erro);
  inst = p.j.installment;
  const antes = (await asaas("GET", `/installments/${inst}/payments`)).j.data.map((x) => x.id).sort();
  out.parcelamento = inst;
  out.invoiceUrl_existe = Boolean(p.j.invoiceUrl);
  for (const r of RECUSA) {
    const t = await asaas("POST", `/payments/${p.j.id}/payWithCreditCard`, { creditCard: r.creditCard, creditCardHolderInfo: titular, remoteIp: "127.0.0.1" });
    out.tentativas.push({ cartao: r.rotulo, aceito: t.ok, http: t.status, erro: t.erro });
  }
  const ok = await asaas("POST", `/payments/${p.j.id}/payWithCreditCard`, {
    creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: ano, ccv: "123" },
    creditCardHolderInfo: titular, remoteIp: "127.0.0.1",
  });
  out.tentativas.push({ cartao: "cartão de teste aprovado", aceito: ok.ok, http: ok.status, erro: ok.erro, situacao: ok.j?.status });
  const depois = (await asaas("GET", `/installments/${inst}/payments`)).j.data;
  out.mesmas_parcelas = JSON.stringify(depois.map((x) => x.id).sort()) === JSON.stringify(antes);
  out.parcelas_depois = depois.map((x) => ({ n: x.installmentNumber, situacao: x.status }));
  const doCliente = (await asaas("GET", `/payments?customer=${pagador.id}&limit=50`)).j;
  out.cobrancas_do_pagador = doCliente.totalCount;
} finally {
  if (inst) {
    const e = await asaas("POST", `/installments/${inst}/refund`, {});
    if (!e.ok) await asaas("DELETE", `/installments/${inst}`);
  }
  await asaas("DELETE", `/customers/${pagador.id}`);
}
console.log(JSON.stringify(out, null, 2));
console.log("\nParcelamento de teste estornado/apagado; pagador apagado. Nada foi enviado a ninguém.");
