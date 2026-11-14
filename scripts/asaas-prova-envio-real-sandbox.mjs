// ASA4 (spec 19.15): prova COM ENVIO REAL, só com o "pode" do Jeferson na hora.
// Prova que o "cadastro do carnê" (aviso "cobrança criada" desligado) não manda
// esse aviso, e que o aviso sai na criação mesmo com vencimento distante.
// Só SANDBOX (conta de Londrina). Só e-mail, NUNCA celular. O e-mail vem de
// PROVA_EMAIL (nunca escrito no código).
//
//   Disparar:  PROVA_EMAIL=... RISARTE_TREINO_POOLER=1 node scripts/asaas-prova-envio-real-sandbox.mjs --disparar <arquivo-de-estado>
//   Ensaio (sem cobrança, nada enviado): mesmo comando com --ensaio no lugar de --disparar
//   Limpar:    RISARTE_TREINO_POOLER=1 node scripts/asaas-prova-envio-real-sandbox.mjs --limpar <arquivo-de-estado>
//
// Espera-se 1 e-mail (R$ 5,00) e NENHUM de R$ 5,01 / 5,02 / 5,03.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
// --ensaio: faz tudo menos criar as cobranças (nada é enviado) e limpa no fim.
const ensaio = process.argv.includes("--ensaio");
const modo = process.argv.includes("--disparar") || ensaio ? "disparar" : process.argv.includes("--limpar") ? "limpar" : null;
const estadoPath = process.argv[process.argv.length - 1];
if (!modo || !estadoPath || estadoPath.startsWith("--")) { console.log("Uso: --disparar <estado.json> | --limpar <estado.json>"); process.exit(2); }

const c = await connect();
const conta = (await c.query("select g.id from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active' and g.environment = 'sandbox'")).rows[0];
const chave = (await c.query("select api_key from public._gateway_read_key($1, 'prova_envio_real_sandbox', null)", [conta.id])).rows[0].api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }
const api = async (m, p, b) => {
  const r = await fetch(SANDBOX + p, { method: m, headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "riSZon (Risarte Odontologia) - prova" }, body: b ? JSON.stringify(b) : undefined, redirect: "error" });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${m} ${p.split("?")[0]} -> ${r.status} ${(j?.errors ?? []).map((e) => e.description).join(" | ")}`);
  return j;
};
const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
let ok = 0, falhas = 0;
const conf = (nome, v) => { console.log(v ? "  ✓" : "  ✗", nome); v ? ok++ : falhas++; };
const desligado = { enabled: false, emailEnabledForProvider: false, smsEnabledForProvider: false, emailEnabledForCustomer: false, smsEnabledForCustomer: false, phoneCallEnabledForCustomer: false, whatsappEnabledForCustomer: false };

if (modo === "disparar") {
  const email = (process.env.PROVA_EMAIL ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error("RECUSADO: PROVA_EMAIL ausente."); process.exit(1); }
  if (existsSync(estadoPath)) { console.error("RECUSADO: já existe um disparo neste arquivo de estado. Limpe antes."); process.exit(1); }
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b) => { const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n); const cpf = [...n, d1, dv([...n, d1])].join("");
  // Sem celular e sem telefone: nada pode ir por SMS ou WhatsApp.
  const base = { cpfCnpj: cpf, email, notificationDisabled: false };
  const controle = await api("POST", "/customers", { ...base, name: "Prova riSZon controle" });
  const carne = await api("POST", "/customers", { ...base, name: "Prova riSZon carne" });
  const estado = { controle: controle.id, carne: carne.id, cobrancas: [] };
  writeFileSync(estadoPath, JSON.stringify(estado));
  conf("os dois cadastros não têm celular nem telefone", !controle.mobilePhone && !controle.phone && !carne.mobilePhone && !carne.phone);

  // Controle: só "cobrança criada" por e-mail ao pagador; todo o resto desligado.
  const nc = (await api("GET", `/customers/${controle.id}/notifications`)).data;
  await api("PUT", "/notifications/batch", { customer: controle.id, notifications: nc.map((x) => x.event === "PAYMENT_CREATED" ? { id: x.id, ...desligado, enabled: true, emailEnabledForCustomer: true } : { id: x.id, ...desligado }) });
  // Carnê: "cobrança criada" desligado; o resto fica como está (vencimentos >= 45 dias: nada dispara na janela da prova).
  const nk = (await api("GET", `/customers/${carne.id}/notifications`)).data;
  await api("PUT", "/notifications/batch", { customer: carne.id, notifications: nk.filter((x) => x.event === "PAYMENT_CREATED").map((x) => ({ id: x.id, ...desligado })) });
  const vc = (await api("GET", `/customers/${controle.id}/notifications`)).data;
  const vk = (await api("GET", `/customers/${carne.id}/notifications`)).data;
  conf("controle: só 'cobrança criada' ligado, só por e-mail", vc.every((x) => x.event === "PAYMENT_CREATED" ? x.enabled && x.emailEnabledForCustomer && !x.smsEnabledForCustomer : !x.enabled));
  conf("carnê: 'cobrança criada' desligado", vk.filter((x) => x.event === "PAYMENT_CREATED").every((x) => !x.enabled));
  if (falhas) { console.error("Configuração inesperada: NADA foi criado. Rode --limpar."); process.exit(1); }
  if (ensaio) {
    for (const id of [controle.id, carne.id]) { await api("PUT", `/customers/${id}`, { notificationDisabled: true }); await api("DELETE", `/customers/${id}`); }
    writeFileSync(estadoPath, JSON.stringify({ limpo: true }));
    console.log(`
Ensaio sem cobrança: ${ok} ok, ${falhas} falha(s). Cadastros removidos; nada foi enviado.`);
    process.exit(0);
  }

  const criar = async (customer, value, dias) => {
    const p = await api("POST", "/payments", { customer, billingType: "BOLETO", value, dueDate: dia(dias), description: "Prova riSZon (sandbox)", externalReference: `prova-envio-real-${value}` });
    estado.cobrancas.push(p.id); writeFileSync(estadoPath, JSON.stringify(estado));
    return p;
  };
  await criar(controle.id, 5.0, 45);
  await criar(carne.id, 5.01, 45);
  await criar(carne.id, 5.02, 75);
  await criar(carne.id, 5.03, 105);
  conf("4 cobranças criadas", estado.cobrancas.length === 4);
  console.log(`\nDisparado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Esperar 30 minutos e conferir a caixa de entrada e o spam.`);
  console.log("Esperado: 1 e-mail (R$ 5,00). NÃO esperado: R$ 5,01, 5,02, 5,03.");
} else {
  if (!existsSync(estadoPath)) { console.log("Nada a limpar."); process.exit(0); }
  const estado = JSON.parse(readFileSync(estadoPath, "utf8"));
  // Primeiro cala os dois cadastros, para a remoção não gerar aviso nenhum.
  for (const id of [estado.controle, estado.carne]) await api("PUT", `/customers/${id}`, { notificationDisabled: true });
  for (const id of estado.cobrancas) {
    await api("DELETE", `/payments/${id}`);
    const p = await api("GET", `/payments/${id}`).catch(() => ({ deleted: true }));
    conf(`cobrança ${estado.cobrancas.indexOf(id) + 1} removida`, p.deleted === true);
  }
  for (const id of [estado.controle, estado.carne]) await api("DELETE", `/customers/${id}`);
  conf("cadastros de prova removidos", true);
  writeFileSync(estadoPath, JSON.stringify({ limpo: true }));
}
console.log(`\n${ok} ok, ${falhas} falha(s).`);
process.exit(falhas ? 1 : 0);
