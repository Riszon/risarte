// PROVA: A REFERÊNCIA DE CADA PARCELA DO PARCELAMENTO NO CARTÃO (ASA4, entrega 2).
//
// Direto na API do SANDBOX, separado do riSZon. Conta de teste de Londrina; pagador
// SEM e-mail e SEM celular, avisos desligados (nada é enviado a ninguém).
// Responde: (1) o `externalReference` do POST vai para todas as parcelas? (2) cada
// parcela aceita a SUA referência (`PUT /payments/{id}`) antes do pagamento? (3) o
// split por parcela continua depois disso? (4) depois do pagamento, cada parcela
// mantém a sua referência? No fim, estorna e apaga.
//
//   node scripts/asaas-prova-referencia-parcelas-sandbox.mjs --confirmar
import { randomUUID } from "node:crypto";
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
if (!process.argv.includes("--confirmar")) {
  console.log("Prova da referência por parcela (SANDBOX, pagador sem contato).\n  node scripts/asaas-prova-referencia-parcelas-sandbox.mjs --confirmar");
  process.exit(2);
}
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const conta = await um("select g.id, g.environment from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active'");
const raiz = await um("select wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' and wallet_id is not null order by created_at limit 1");
if (!conta || conta.environment !== "sandbox" || !raiz) { console.error("RECUSADO: falta Londrina no sandbox ou a raiz."); process.exit(1); }
const chave = (await um("select api_key from public._gateway_read_key($1, 'prova_referencia_parcelas', null)", [conta.id])).api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }
const api = async (m, p, b) => {
  const r = await fetch(SANDBOX + p, { method: m, headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "riSZon (Risarte Odontologia) - prova referencia" }, body: b ? JSON.stringify(b) : undefined, redirect: "error" });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, j, erro: r.ok ? null : (j?.errors ?? []).map((e) => `${e.code}: ${e.description}`).join(" | ") };
};
const nn = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
const dv = (b) => { const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
const d1 = dv(nn); const cpf = [...nn, d1, dv([...nn, d1])].join("");
const venc = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const pagador = (await api("POST", "/customers", { name: "Prova referencia riSZon (sem contato)", cpfCnpj: cpf, notificationDisabled: true })).j;
const ler = async (inst) => {
  const ps = (await api("GET", `/installments/${inst}/payments`)).j.data.sort((a, b) => a.installmentNumber - b.installmentNumber);
  return ps.map((p) => ({ n: p.installmentNumber, id: p.id, status: p.status, ref: p.externalReference, venc: p.dueDate, valor: p.value, split: (p.split ?? []).map((s) => `${s.percentualValue}%+${s.fixedValue ?? 0}=${s.totalValue}`).join(";"), installment: p.installment }));
};
const out = {};
let inst = null;
try {
  const bloco = randomUUID();
  const p = await api("POST", "/payments", {
    customer: pagador.id, billingType: "CREDIT_CARD", installmentCount: 3, totalValue: 30, dueDate: venc,
    description: "Prova referencia (ASA4) - sandbox", externalReference: bloco,
    ...(process.argv.includes("--sem-split") ? {} : { split: [{ walletId: raiz.wallet_id, percentualValue: 17.4341, fixedValue: 0.02 }] }),
    ...(process.argv.includes("--total-300") ? { totalValue: 300 } : {}),
  });
  if (!p.ok) throw new Error("criar: " + p.erro);
  inst = p.j.installment;
  out.resposta_do_post = { id: p.j.id, installment: p.j.installment, installmentNumber: p.j.installmentNumber, ref: p.j.externalReference, invoiceUrl: Boolean(p.j.invoiceUrl) };
  out.antes = await ler(inst);
  out.ref_do_bloco_em_todas = out.antes.every((x) => x.ref === bloco);
  const minhas = {};
  out.troca = [];
  // --troca=todas (padrão) | --troca=menos-a-primeira | --troca=nenhuma
  const troca = (process.argv.find((a) => a.startsWith("--troca=")) ?? "--troca=todas").split("=")[1];
  out.modo = troca;
  for (const x of out.antes) {
    if (troca === "nenhuma" || (troca === "menos-a-primeira" && x.n === 1)) { minhas[x.id] = bloco; continue; }
    const ref = randomUUID(); minhas[x.id] = ref;
    const r = await api("PUT", `/payments/${x.id}`, { externalReference: ref });
    out.troca.push({ n: x.n, aceito: r.ok, erro: r.erro, valor_depois: r.j?.value, venc_depois: r.j?.dueDate, installment_depois: r.j?.installment });
  }
  out.depois_da_troca = await ler(inst);
  out.cada_uma_com_a_sua = out.depois_da_troca.every((x) => x.ref === minhas[x.id]);
  out.continua_o_mesmo_parcelamento = out.depois_da_troca.every((x) => x.installment === inst) && out.depois_da_troca.length === 3;
  const pago = await api("POST", `/payments/${p.j.id}/payWithCreditCard`, {
    creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 2), ccv: "123" },
    creditCardHolderInfo: { name: "Prova referencia riSZon", email: "prova.cartao@example.com", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "1000", phone: "4333330000" },
    remoteIp: "127.0.0.1",
  });
  out.pagamento = { aceito: pago.ok, status: pago.j?.status, erro: pago.erro };
  out.depois_do_pagamento = await ler(inst);
  out.referencias_mantidas = out.depois_do_pagamento.every((x) => x.ref === minhas[x.id]);
} finally {
  if (inst) { const e = await api("POST", `/installments/${inst}/refund`, {}); if (!e.ok) await api("DELETE", `/installments/${inst}`); }
  await api("DELETE", `/customers/${pagador.id}`);
}
console.log(JSON.stringify(out, null, 2));
console.log("\nParcelamento de teste estornado/apagado; pagador apagado. Nada foi enviado a ninguém.");
