// ASA4 (pedido de 14/11/2026, "boleto de depósito"): QUEM é o pagador do
// boleto que leva o dinheiro do caixa da unidade para a conta Asaas dela.
//   (a) a própria unidade (o CNPJ da conta) como pagadora, na conta dela;
//   (b) um cadastro interno, sem contato e com todos os avisos desligados.
// Em cada caso: cria um boleto de R$ 10,00 com split para a raiz, lê de volta
// e CANCELA (apaga). Só SANDBOX; nenhum pagador tem e-mail ou celular e todos
// ficam com notificationDisabled: nada é enviado a ninguém. Lê também a
// tarifa de boleto da conta.
//   RISARTE_TREINO_POOLER=1 node scripts/asaas-prova-pagador-deposito-sandbox.mjs --confirmar
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
if (!process.argv.includes("--confirmar")) { console.log("Uso: ... --confirmar"); process.exit(2); }
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const ldn = await um("select g.id from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active' and g.environment = 'sandbox'");
const raiz = await um("select wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' order by created_at limit 1");
const chave = (await um("select api_key from public._gateway_read_key($1, 'prova_pagador_deposito_sandbox', null)", [ldn.id])).api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }
const api = async (m, p, b, tolerar = false) => {
  const r = await fetch(SANDBOX + p, { method: m, headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "riSZon (Risarte Odontologia) - prova" }, body: b ? JSON.stringify(b) : undefined, redirect: "error" });
  const j = await r.json().catch(() => null);
  if (!r.ok) { const msg = `${r.status} ${(j?.errors ?? []).map((e) => e.description).join(" | ")}`; if (tolerar) return { erro: msg }; throw new Error(`${m} ${p} -> ${msg}`); }
  return j;
};
let ok = 0, falhas = 0;
const conf = (nome, v, extra = "") => { console.log(v ? "  ✓" : "  ✗", nome, extra); v ? ok++ : falhas++; };
const venc = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

const info = await api("GET", "/myAccount/commercialInfo/");
const doc = String(info.cpfCnpj ?? "").replace(/\D/g, "");
console.log(`Conta de Londrina (sandbox): documento com ${doc.length} dígitos.`);

async function caso(nome, cliente) {
  console.log(`\n${nome}`);
  const cli = await api("POST", "/customers", cliente, true);
  if (cli.erro) { conf("o Asaas aceita o cadastro", false, `(${cli.erro})`); return; }
  conf("o Asaas aceita o cadastro", true);
  conf("avisos desligados no cadastro (notificationDisabled)", cli.notificationDisabled === true);
  const p = await api("POST", "/payments", { customer: cli.id, billingType: "BOLETO", value: 10, dueDate: venc, description: "Prova boleto de depósito (sandbox)", splits: [{ walletId: raiz.wallet_id, percentualValue: 10 }] }, true);
  if (p.erro) { conf("boleto com split criado", false, `(${p.erro})`); }
  else {
    conf("boleto com split criado", !!p.id && (p.split ?? []).length === 1);
    conf("tem PDF do boleto e linha digitável", !!p.bankSlipUrl);
    await api("DELETE", `/payments/${p.id}`);
  }
  await api("DELETE", `/customers/${cli.id}`);
}
await caso("(a) a própria unidade como pagadora", { name: "Risarte Londrina (depósito do caixa) - prova", cpfCnpj: doc, notificationDisabled: true });
await caso("(b) cadastro interno sem contato", { name: "Depósito do caixa - Londrina - prova", cpfCnpj: (() => { const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)); const dv = (b) => { const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; }; const d1 = dv(n); return [...n, d1, dv([...n, d1])].join(""); })(), notificationDisabled: true });

const fees = await api("GET", "/myAccount/fees/");
const bs = fees?.payment?.bankSlip ?? {};
console.log(`\nTarifa de boleto (sandbox): ${JSON.stringify(bs)}`);
console.log(`\n${ok} ok, ${falhas} falha(s). Boletos e cadastros de prova apagados.`);
