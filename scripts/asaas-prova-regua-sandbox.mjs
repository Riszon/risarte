// PROVA DA RÉGUA NO SANDBOX DO ASAAS (ASA2, entrega 3; 4007) — SEM ENVIO.
// Uso: node scripts/asaas-prova-regua-sandbox.mjs --confirmar
//
// ⚠️ O sandbox ENVIA e-mail e SMS de verdade (resposta do Asaas, 12/11/2026).
// Por isso este roteiro:
//   * cria um pagador de teste SEM celular, com os avisos DESLIGADOS o tempo
//     todo (`notificationDisabled: true`) e SEM nenhuma cobrança — nenhum
//     evento acontece, nada é enviado;
//   * o único e-mail usado é do domínio reservado `example.com` (RFC 2606),
//     que não entrega nada;
//   * apaga o pagador no fim.
//
// Prova: os 8 avisos padrão; a gravação em lote com a MESMA função do servidor
// (`pacoteDosAvisos`), conferida lendo de volta; os avisos para a unidade
// desligados (D1); o prazo dos lembretes e do 2º de vencida; e como se APAGA o
// e-mail e o celular de um pagador (D6). Só usa a chave sandbox da conta raiz
// (`ASAAS_API_KEY` do .env.local). Nada de chave, CPF ou corpo na saída.
import { readFileSync } from "node:fs";
import { pacoteDosAvisos } from "../src/lib/asaas/regua.ts";

const SANDBOX_URL = "https://api-sandbox.asaas.com/v3";
const PREFIXO_SANDBOX = "$aact_hmlg_";
const USER_AGENT = "riSZon (Risarte Odontologia) - roteiro de teste";

if (!process.argv.includes("--confirmar")) {
  console.log("Prova SEM ENVIO no sandbox do Asaas. Para rodar:\n  node scripts/asaas-prova-regua-sandbox.mjs --confirmar");
  process.exit(2);
}

function lerEnvLocal() {
  const env = {};
  for (const linha of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = linha.indexOf("=");
    if (i < 1 || linha.trim().startsWith("#")) continue;
    let v = linha.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[linha.slice(0, i).trim()] = v.replace(/\\\$/g, "$");
  }
  return env;
}
const env = lerEnvLocal();
const CHAVE = env.ASAAS_API_KEY ?? "";
if (!CHAVE.startsWith(PREFIXO_SANDBOX) || (env.ASAAS_BASE_URL ?? "").replace(/\/+$/, "") !== SANDBOX_URL) {
  console.error("RECUSADO: só com a chave e o endereço de SANDBOX.");
  process.exit(1);
}

async function asaas(metodo, caminho, corpo) {
  const res = await fetch(`${SANDBOX_URL}${caminho}`, {
    method: metodo,
    headers: { access_token: CHAVE, "User-Agent": USER_AGENT, "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    redirect: "error",
  });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const erros = Array.isArray(json?.errors) ? json.errors.map((e) => `${e.code}: ${e.description}`).join(" | ") : "";
    throw new Error(`Asaas ${metodo} ${caminho.split("?")[0].replace(/cus_\w+/, "{id}")} -> ${res.status} ${erros}`.trim());
  }
  return json;
}

function cpfValido() {
  const d = String(100000000 + Math.floor(Math.random() * 899999999)).split("").map(Number);
  const dig = (arr) => {
    const s = arr.reduce((t, n, i) => t + n * (arr.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dig(d));
  d.push(dig(d));
  return d.join("");
}

const ok = [];
const falha = [];
const conf = (nome, v) => (v ? ok : falha).push(nome);

// A régua de teste: a D8 com prazos trocados, para provar que o prazo grava.
const REGUA = [
  { slot: "criada", event: "PAYMENT_CREATED", scheduleOffset: null, email: true, sms: true, whatsapp: false, phoneCall: false },
  { slot: "lembrete_1", event: "PAYMENT_DUEDATE_WARNING", scheduleOffset: 15, email: true, sms: true, whatsapp: false, phoneCall: false },
  { slot: "lembrete_2", event: "PAYMENT_DUEDATE_WARNING", scheduleOffset: 0, email: true, sms: false, whatsapp: false, phoneCall: false },
  { slot: "linha_digitavel", event: "SEND_LINHA_DIGITAVEL", scheduleOffset: null, email: false, sms: false, whatsapp: false, phoneCall: false },
  { slot: "vencida_1", event: "PAYMENT_OVERDUE", scheduleOffset: 0, email: true, sms: true, whatsapp: true, phoneCall: false },
  { slot: "vencida_2", event: "PAYMENT_OVERDUE", scheduleOffset: 15, email: true, sms: true, whatsapp: false, phoneCall: false },
  { slot: "recebida", event: "PAYMENT_RECEIVED", scheduleOffset: null, email: true, sms: true, whatsapp: false, phoneCall: false },
  { slot: "alterada", event: "PAYMENT_UPDATED", scheduleOffset: null, email: true, sms: true, whatsapp: false, phoneCall: false },
];

let id = null;
try {
  const cli = await asaas("POST", "/customers", { name: "Ensaio da régua riSZon (sem envio)", cpfCnpj: cpfValido(), notificationDisabled: true });
  id = cli.id;
  conf("pagador de teste criado com os avisos desligados", !!id && cli.notificationDisabled === true);

  const ler = async () => (await asaas("GET", `/customers/${id}/notifications`)).data.filter((n) => !n.deleted);
  const antes = await ler();
  conf("o pagador tem os 8 avisos padrão", antes.length === 8);
  const evs = (e) => antes.filter((n) => n.event === e).map((n) => n.scheduleOffset).sort((a, b) => a - b).join(",");
  conf("dois lembretes antes do vencimento (0 e 10 dias)", evs("PAYMENT_DUEDATE_WARNING") === "0,10");
  conf("dois avisos de vencida (no dia e 7 dias)", evs("PAYMENT_OVERDUE") === "0,7");
  console.log("  padrão do Asaas para a unidade (provider):", antes.filter((n) => n.emailEnabledForProvider || n.smsEnabledForProvider).map((n) => n.event).join(", ") || "nenhum");

  // Sem e-mail nem celular: a régua vai toda desligada (o Asaas recusaria o canal sem o contato).
  await asaas("PUT", "/notifications/batch", { customer: id, notifications: pacoteDosAvisos(antes, REGUA, { temEmail: false, temCelular: false }) });
  const semContato = await ler();
  conf("sem contato, nenhum canal fica ligado (e o Asaas aceita)", semContato.every((n) => !n.emailEnabledForCustomer && !n.smsEnabledForCustomer && !n.whatsappEnabledForCustomer && !n.phoneCallEnabledForCustomer));

  // Com e-mail (example.com, que não entrega), os avisos ainda desligados no pagador.
  await asaas("PUT", `/customers/${id}`, { email: "ensaio-regua@example.com", notificationDisabled: true });
  const pacote = pacoteDosAvisos(antes, REGUA, { temEmail: true, temCelular: false });
  await asaas("PUT", "/notifications/batch", { customer: id, notifications: pacote });
  const depois = await ler();
  const por = (e, prazo) => depois.find((n) => n.event === e && n.scheduleOffset === prazo);
  conf("o primeiro lembrete foi para 15 dias, com e-mail", por("PAYMENT_DUEDATE_WARNING", 15)?.emailEnabledForCustomer === true);
  conf("sem celular, SMS e WhatsApp ficam desligados mesmo ligados na régua", depois.every((n) => !n.smsEnabledForCustomer && !n.whatsappEnabledForCustomer));
  conf("o segundo lembrete (no dia, fixo no Asaas) ficou com e-mail", por("PAYMENT_DUEDATE_WARNING", 0)?.emailEnabledForCustomer === true);
  conf("o 2º aviso de vencida foi para 15 dias", !!por("PAYMENT_OVERDUE", 15));
  conf("a ligação ficou desligada nos avisos de vencida (o padrão do Asaas era ligada)", depois.filter((n) => n.event === "PAYMENT_OVERDUE").every((n) => !n.phoneCallEnabledForCustomer));
  conf("aviso sem canal fica desligado (linha digitável)", depois.find((n) => n.event === "SEND_LINHA_DIGITAVEL")?.enabled === false);
  conf("D1: nenhum aviso para a unidade", depois.every((n) => !n.emailEnabledForProvider && !n.smsEnabledForProvider));
  // Reaplicar dá o mesmo resultado (a correspondência pelo prazo se mantém).
  await asaas("PUT", "/notifications/batch", { customer: id, notifications: pacoteDosAvisos(depois, REGUA, { temEmail: true, temCelular: false }) });
  const de3 = await ler();
  conf("reaplicar a mesma régua não troca os avisos de lugar", JSON.stringify(de3.map((n) => [n.id, n.scheduleOffset, n.emailEnabledForCustomer, n.smsEnabledForCustomer]).sort()) === JSON.stringify(depois.map((n) => [n.id, n.scheduleOffset, n.emailEnabledForCustomer, n.smsEnabledForCustomer]).sort()));

  // O contato e o "apagar" (D6) — sempre com os avisos desligados.
  let c = await asaas("GET", `/customers/${id}`);
  conf("o e-mail vai pelo PUT do pagador", c.email === "ensaio-regua@example.com" && c.notificationDisabled === true);
  await asaas("PUT", `/customers/${id}`, { email: "", mobilePhone: "", notificationDisabled: true });
  c = await asaas("GET", `/customers/${id}`);
  conf("D6: e-mail e celular em branco apagam o contato", !c.email && !c.mobilePhone);
  console.log(`  depois de apagar: email=${JSON.stringify(c.email ?? null)} mobilePhone=${JSON.stringify(c.mobilePhone ?? null)}`);
  const sem = await asaas("PUT", `/customers/${id}`, { notificationDisabled: true });
  conf("só desligar os avisos não mexe no resto", sem.notificationDisabled === true);
} catch (e) {
  falha.push(`a prova parou: ${e.message}`);
} finally {
  if (id) {
    try {
      await asaas("DELETE", `/customers/${id}`);
      ok.push("pagador de teste apagado no fim");
    } catch (e) {
      falha.push(`não consegui apagar o pagador de teste: ${e.message}`);
    }
  }
}

console.log(`\nProva da régua no sandbox — ${ok.length} OK, ${falha.length} falha(s). Nada foi enviado.`);
for (const f of falha) console.log("  FALHOU:", f);
process.exitCode = falha.length ? 1 : 0;
