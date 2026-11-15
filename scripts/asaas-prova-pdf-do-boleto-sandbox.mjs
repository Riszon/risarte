// PROVA: O PDF DO BOLETO E A FATURA ABREM SEM LOGIN? (ASA4, entrega 1B, 19.10 item 3)
//
// Direto na API do SANDBOX, separado do riSZon. Conta de teste de Londrina; pagador
// SEM e-mail e SEM celular, avisos desligados (nada é enviado a ninguém).
// Cria um boleto, abre o `bankSlipUrl` e o `invoiceUrl` SEM nenhuma credencial (como
// o paciente abriria) e diz o que voltou: código, tipo e se é PDF de verdade. Se o
// PDF abre sem login, a página da lista da forma 2 pode ganhar "Baixar todos em
// PDF" (o riSZon junta os PDFs). No fim, apaga o boleto e o pagador.
//
//   node scripts/asaas-prova-pdf-do-boleto-sandbox.mjs --confirmar
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
if (!process.argv.includes("--confirmar")) {
  console.log("Prova do PDF do boleto no SANDBOX (pagador sem contato).\n  node scripts/asaas-prova-pdf-do-boleto-sandbox.mjs --confirmar");
  process.exit(2);
}
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const conta = await um("select g.id, g.environment from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active'");
if (!conta || conta.environment !== "sandbox") { console.error("RECUSADO: falta Londrina no sandbox."); process.exit(1); }
const chave = (await um("select api_key from public._gateway_read_key($1, 'prova_pdf_boleto_sandbox', null)", [conta.id])).api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }
const api = async (m, p, b) => {
  const r = await fetch(SANDBOX + p, { method: m, headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "riSZon (Risarte Odontologia) - prova pdf" }, body: b ? JSON.stringify(b) : undefined, redirect: "error" });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, j, erro: r.ok ? null : (j?.errors ?? []).map((e) => e.description).join(" | ") };
};
const semLogin = async (url) => {
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (prova riSZon)" } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { http: r.status, tipo: r.headers.get("content-type"), bytes: buf.length, eh_pdf: buf.subarray(0, 4).toString() === "%PDF", url_final_mesmo_host: new URL(r.url).host === new URL(url).host };
};
const nn = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
const dv = (b) => { const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
const d1 = dv(nn); const cpf = [...nn, d1, dv([...nn, d1])].join("");
const pagador = (await api("POST", "/customers", { name: "Prova PDF boleto riSZon (sem contato)", cpfCnpj: cpf, notificationDisabled: true })).j;
const out = {};
let pid = null;
try {
  const venc = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const p = await api("POST", "/payments", { customer: pagador.id, billingType: "BOLETO", value: 10, dueDate: venc, description: "Prova PDF boleto (ASA4) - sandbox", externalReference: `prova-pdf-${Date.now()}` });
  if (!p.ok) throw new Error("criar: " + p.erro);
  pid = p.j.id;
  out.tem_bankSlipUrl = Boolean(p.j.bankSlipUrl);
  out.tem_invoiceUrl = Boolean(p.j.invoiceUrl);
  // O sandbox às vezes demora a gerar o PDF (504): tenta de novo, com espera.
  if (p.j.bankSlipUrl) {
    out.tentativas_do_boleto = [];
    for (let i = 0; i < 4; i++) {
      const r = await semLogin(p.j.bankSlipUrl);
      out.tentativas_do_boleto.push(r);
      if (r.eh_pdf) break;
      await new Promise((ok) => setTimeout(ok, 20_000));
    }
  }
  if (p.j.invoiceUrl) out.fatura_sem_login = await semLogin(p.j.invoiceUrl);
} finally {
  if (pid) await api("DELETE", `/payments/${pid}`);
  await api("DELETE", `/customers/${pagador.id}`);
}
console.log(JSON.stringify(out, null, 2));
console.log("\nBoleto e pagador de teste apagados. Nada foi enviado a ninguém.");
