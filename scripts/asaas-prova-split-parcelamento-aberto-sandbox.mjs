// PROVA: TROCAR O SPLIT DE UM PARCELAMENTO NO CARTÃO AINDA NÃO PAGO (ASA4, entrega 2, 3a).
//
// Direto na API do SANDBOX, separado do riSZon. Conta de teste de Londrina; pagador
// SEM e-mail e SEM celular, avisos desligados (nada é enviado a ninguém).
// Responde: a rotina diária do split consegue atualizar o split de um parcelamento em
// aberto quando a tarifa muda? Por qual porta (o parcelamento inteiro ou parcela a
// parcela)? E depois do pagamento, o split que vale em cada parcela é o novo?
//
//   node scripts/asaas-prova-split-parcelamento-aberto-sandbox.mjs --confirmar
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
if (!process.argv.includes("--confirmar")) {
  console.log("Prova da troca do split no parcelamento aberto (SANDBOX, pagador sem contato).\n  node scripts/asaas-prova-split-parcelamento-aberto-sandbox.mjs --confirmar");
  process.exit(2);
}
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const conta = await um("select g.id, g.environment from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active'");
const raiz = await um("select wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' and wallet_id is not null order by created_at limit 1");
if (!conta || conta.environment !== "sandbox" || !raiz) { console.error("RECUSADO: falta Londrina no sandbox ou a raiz."); process.exit(1); }
const chave = (await um("select api_key from public._gateway_read_key($1, 'prova_split_parcelamento_aberto', null)", [conta.id])).api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }
const api = async (m, p, b) => {
  const r = await fetch(SANDBOX + p, { method: m, headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "riSZon (Risarte Odontologia) - prova split parcelamento" }, body: b ? JSON.stringify(b) : undefined, redirect: "error" });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, j, erro: r.ok ? null : (j?.errors ?? []).map((e) => `${e.code}: ${e.description}`).join(" | ") };
};
const nn = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
const dv = (b) => { const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
const d1 = dv(nn); const cpf = [...nn, d1, dv([...nn, d1])].join("");
const venc = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const pagador = (await api("POST", "/customers", { name: "Prova split parcelamento riSZon (sem contato)", cpfCnpj: cpf, notificationDisabled: true })).j;
const splits = async (inst) => {
  const ps = (await api("GET", `/installments/${inst}/payments`)).j.data.sort((a, b) => a.installmentNumber - b.installmentNumber);
  const out = [];
  for (const x of ps) { const p = (await api("GET", `/payments/${x.id}`)).j; out.push({ n: p.installmentNumber, id: p.id, status: p.status, liquido: p.netValue, split: (p.split ?? []).map((s) => `${s.percentualValue}% + ${s.fixedValue ?? 0} = ${s.totalValue ?? "?"} (${s.status})`).join("; ") }); }
  return out;
};
const out = {};
let inst = null;
try {
  // 1. Parcelamento 3× R$ 300 sem cartão, com o split da tarifa "antiga" (cheia, 3,49%).
  const p = await api("POST", "/payments", {
    customer: pagador.id, billingType: "CREDIT_CARD", installmentCount: 3, totalValue: 300, dueDate: venc,
    description: "Prova split parcelamento aberto (ASA4) - sandbox", externalReference: `prova-split-aberto-${Date.now()}`,
    split: [{ walletId: raiz.wallet_id, percentualValue: 17.6147, fixedValue: 0.02 }],
  });
  if (!p.ok) throw new Error("criar: " + p.erro);
  inst = p.j.installment;
  out.antes = await splits(inst);
  // 2. A porta do parcelamento inteiro: PUT /installments/{id}/splits (tarifa "nova", promoção 2,49%).
  const novo = [{ walletId: raiz.wallet_id, percentualValue: 17.4341, fixedValue: 0.02 }];
  const r1 = await api("PUT", `/installments/${inst}/splits`, { splits: novo });
  out.porta_do_parcelamento = { aceito: r1.ok, http: r1.status, erro: r1.erro };
  out.depois_da_porta_do_parcelamento = await splits(inst);
  // 3. A porta da parcela: PUT /payments/{id} com splits, só na 3ª parcela (outro valor, para distinguir).
  const terceira = out.antes[2].id;
  const r2 = await api("PUT", `/payments/${terceira}`, { split: [{ walletId: raiz.wallet_id, percentualValue: 17.0, fixedValue: 0.0 }] });
  out.porta_da_parcela = { aceito: r2.ok, http: r2.status, erro: r2.erro };
  out.depois_da_porta_da_parcela = await splits(inst);
  // 4. Paga com o cartão de teste: o split que vale em cada parcela.
  const pago = await api("POST", `/payments/${p.j.id}/payWithCreditCard`, {
    creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 2), ccv: "123" },
    creditCardHolderInfo: { name: "Prova split parcelamento riSZon", email: "prova.cartao@example.com", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "1000", phone: "4333330000" },
    remoteIp: "127.0.0.1",
  });
  out.pagamento = { aceito: pago.ok, status: pago.j?.status, erro: pago.erro };
  out.depois_do_pagamento = await splits(inst);
  // 5. Depois de pago: a porta do parcelamento ainda aceita?
  const r3 = await api("PUT", `/installments/${inst}/splits`, { splits: novo });
  out.porta_depois_de_pago = { aceito: r3.ok, http: r3.status, erro: r3.erro };
} finally {
  if (inst) { const e = await api("POST", `/installments/${inst}/refund`, {}); if (!e.ok) await api("DELETE", `/installments/${inst}`); }
  await api("DELETE", `/customers/${pagador.id}`);
}
console.log(JSON.stringify(out, null, 2));
console.log("\nParcelamento de teste estornado/apagado; pagador apagado. Nada foi enviado a ninguém.");
