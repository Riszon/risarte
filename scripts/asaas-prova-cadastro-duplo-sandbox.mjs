// ASA4 (spec 19.10 item 2): o Asaas aceita DOIS cadastros com o mesmo CPF na
// mesma conta? E o aviso "cobrança criada" de um pode ficar desligado sem
// mexer no do outro? Só SANDBOX; pagador SEM contato, avisos desligados
// (notificationDisabled), NENHUMA cobrança criada: nada é enviado a ninguém.
//   RISARTE_TREINO_POOLER=1 node scripts/asaas-prova-cadastro-duplo-sandbox.mjs --confirmar
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
if (!process.argv.includes("--confirmar")) { console.log("Uso: ... --confirmar"); process.exit(2); }
const c = await connect();
const conta = (await c.query("select g.id from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active' and g.environment = 'sandbox'")).rows[0];
const chave = (await c.query("select api_key from public._gateway_read_key($1, 'prova_cadastro_duplo_sandbox', null)", [conta.id])).rows[0].api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }
const api = async (m, p, b) => {
  const r = await fetch(SANDBOX + p, { method: m, headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "riSZon (Risarte Odontologia) - prova" }, body: b ? JSON.stringify(b) : undefined, redirect: "error" });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${m} ${p.split("?")[0]} -> ${r.status} ${(j?.errors ?? []).map((e) => e.description).join(" | ")}`);
  return j;
};
const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
const dv = (b) => { const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
const d1 = dv(n); const cpf = [...n, d1, dv([...n, d1])].join("");
let ok = 0, falhas = 0;
const conf = (nome, v) => { console.log(v ? "  ✓" : "  ✗", nome); v ? ok++ : falhas++; };

const a = await api("POST", "/customers", { name: "Prova cadastro duplo riSZon", cpfCnpj: cpf, notificationDisabled: true });
const b = await api("POST", "/customers", { name: "Prova cadastro duplo riSZon (carnê)", cpfCnpj: cpf, notificationDisabled: true });
conf("o segundo cadastro com o mesmo CPF é aceito", !!b.id);
conf("são dois cadastros diferentes", a.id !== b.id);
const lista = await api("GET", `/customers?cpfCnpj=${cpf}`);
conf(`a busca por CPF devolve os dois (${lista.totalCount})`, lista.totalCount === 2);

const nb = (await api("GET", `/customers/${b.id}/notifications`)).data;
const criadaB = nb.filter((x) => x.event === "PAYMENT_CREATED");
await api("PUT", "/notifications/batch", { customer: b.id, notifications: criadaB.map((x) => ({ id: x.id, enabled: false })) });
const depoisB = (await api("GET", `/customers/${b.id}/notifications`)).data;
const depoisA = (await api("GET", `/customers/${a.id}/notifications`)).data;
conf("no cadastro do carnê, 'cobrança criada' ficou desligado", depoisB.filter((x) => x.event === "PAYMENT_CREATED").every((x) => x.enabled === false));
conf("no cadastro do carnê, os demais avisos continuam como estavam", depoisB.filter((x) => x.event !== "PAYMENT_CREATED").every((x) => nb.find((y) => y.id === x.id)?.enabled === x.enabled));
conf("no cadastro principal, 'cobrança criada' não mudou", depoisA.filter((x) => x.event === "PAYMENT_CREATED").every((x) => x.enabled === true));

for (const id of [a.id, b.id]) await api("DELETE", `/customers/${id}`);
console.log(`\n${ok} ok, ${falhas} falha(s). Cadastros de prova removidos.`);
process.exit(falhas ? 1 : 0);
