// ASA4 (spec 19.5): LÊ o limite diário de criação de cobranças das contas do
// SANDBOX (GET /payments/limits). Só leitura: nada é criado nem enviado.
//   RISARTE_TREINO_POOLER=1 node scripts/asaas-prova-limites-sandbox.mjs
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
const c = await connect();
const contas = (await c.query(
  "select g.id, coalesce(k.name, g.label) nome from public.gateway_accounts g left join public.clinics k on k.id = g.clinic_id where g.status = 'active' and g.environment = 'sandbox' and g.api_key_secret_id is not null order by 2"
)).rows;
for (const conta of contas) {
  const chave = (await c.query("select api_key from public._gateway_read_key($1, 'prova_limites_sandbox', null)", [conta.id])).rows[0].api_key;
  if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }
  const r = await fetch(SANDBOX + "/payments/limits", { headers: { access_token: chave, "User-Agent": "riSZon (Risarte Odontologia) - limites" }, redirect: "error" });
  const j = await r.json().catch(() => null);
  console.log(conta.nome, "->", r.status, JSON.stringify(j));
}
await c.end();
