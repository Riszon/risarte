// ASA4, entrega 2 (spec 19.19.8): prova COM ENVIO REAL do cartão parcelado, só com o
// "pode" do Jeferson. Mede quantos e-mails o Asaas manda num parcelamento 3× (um por
// parcelamento ou um por parcela) e se a mensageria sai uma vez ou por parcela, e se
// entra no líquido (a base do split).
// Só SANDBOX (conta de Londrina). Só e-mail, NUNCA celular. O e-mail vem de
// PROVA_EMAIL (nunca escrito no código). O e-mail do titular do cartão é @example.com.
//
//   Ensaio (nada é criado nem enviado):  PROVA_EMAIL=... node scripts/asaas-prova-envio-parcelado-sandbox.mjs --ensaio <estado.json>
//   Disparar:                            PROVA_EMAIL=... node scripts/asaas-prova-envio-parcelado-sandbox.mjs --disparar <estado.json>
//   Medir (de novo, quando quiser):      node scripts/asaas-prova-envio-parcelado-sandbox.mjs --medir <estado.json>
//   Limpar (cala os avisos, estorna, apaga): node scripts/asaas-prova-envio-parcelado-sandbox.mjs --limpar <estado.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
const modo = ["--ensaio", "--disparar", "--medir", "--limpar"].find((m) => process.argv.includes(m));
const estadoPath = process.argv[process.argv.length - 1];
if (!modo || !estadoPath || estadoPath.startsWith("--")) { console.log("Uso: --ensaio | --disparar | --medir | --limpar <estado.json>"); process.exit(2); }

const c = await connect();
const conta = (await c.query("select g.id, g.clinic_id from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active' and g.environment = 'sandbox'")).rows[0];
const faixa = (await c.query(
  `select r.fee_percent::float pct, r.fixed_fee_cents fixo from public.acquirer_rates r join public.card_acquirers a on a.id = r.acquirer_id
    where a.clinic_id = $1 and a.name ilike '%asaas%' and r.modality = 'credito_parcelado' and 3 between r.min_installments and r.max_installments
      and r.valid_from <= current_date and (r.valid_to is null or r.valid_to >= current_date)`, [conta.clinic_id])).rows[0];
const chave = (await c.query("select api_key from public._gateway_read_key($1, 'prova_envio_parcelado_sandbox', null)", [conta.id])).rows[0].api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }
const api = async (m, p, b) => {
  const r = await fetch(SANDBOX + p, { method: m, headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "riSZon (Risarte Odontologia) - prova" }, body: b ? JSON.stringify(b) : undefined, redirect: "error" });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${m} ${p.split("?")[0]} -> ${r.status} ${(j?.errors ?? []).map((e) => e.description).join(" | ")}`);
  return j;
};
const hojeBR = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const corte = (x) => Math.floor(x * 100 + 1e-7) / 100;
let ok = 0, falhas = 0;
const conf = (nome, v) => { console.log(v ? "  ✓" : "  ✗", nome); v ? ok++ : falhas++; };
const desligado = { enabled: false, emailEnabledForProvider: false, smsEnabledForProvider: false, emailEnabledForCustomer: false, smsEnabledForCustomer: false, phoneCallEnabledForCustomer: false, whatsappEnabledForCustomer: false };
const LIGADOS = ["PAYMENT_CREATED", "PAYMENT_RECEIVED"];

async function medir(estado) {
  const lista = (await api("GET", `/installments/${estado.parcelamento}/payments`)).data.sort((a, b) => a.installmentNumber - b.installmentNumber);
  const a = faixa.pct / 100, b = faixa.fixo / 100, n = lista.length;
  const linhas = [];
  for (const x of lista) {
    const p = await api("GET", `/payments/${x.id}`);
    const tarifaRegra = corte(corte(a * p.value) + corte(b / n));
    const liquidoRegra = Math.round((p.value - tarifaRegra) * 100) / 100;
    linhas.push({ n: p.installmentNumber, valor: p.value, situacao: p.status, liquido: p.netValue, liquido_pela_regra_sem_mensageria: liquidoRegra, diferenca: Math.round((liquidoRegra - p.netValue) * 100) / 100 });
  }
  console.table(linhas);
  const ft = await api("GET", `/financialTransactions?startDate=${estado.dia}&finishDate=${dia(1)}&limit=100`).catch((e) => ({ erro: e.message }));
  const ids = new Set(lista.map((x) => x.id));
  const doParcelamento = (ft.data ?? []).filter((t) => ids.has(t.paymentId) || /notif|mensag|messag|sms|e-?mail/i.test(`${t.type} ${t.description}`));
  console.log("Lançamentos da conta ligados à prova (tipo, valor, cobrança, descrição):");
  console.table(doParcelamento.map((t) => ({ tipo: t.type, valor: t.value, cobranca: ids.has(t.paymentId) ? `parcela ${lista.find((x) => x.id === t.paymentId)?.installmentNumber}` : t.paymentId ?? "—", descricao: t.description })));
  if (ft.erro) console.log("  (lançamentos não lidos:", ft.erro, ")");
  const notificacao = doParcelamento.filter((t) => /notif|mensag|messag|sms|e-?mail/i.test(`${t.type} ${t.description}`));
  console.log(`Mensageria encontrada nos lançamentos: ${notificacao.length} lançamento(s). Diferença no líquido das parcelas: ${linhas.map((l) => l.diferenca).join(" / ")}.`);
}

if (modo === "--ensaio" || modo === "--disparar") {
  const email = (process.env.PROVA_EMAIL ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error("RECUSADO: PROVA_EMAIL ausente."); process.exit(1); }
  if (existsSync(estadoPath)) { console.error("RECUSADO: já existe um disparo neste arquivo de estado. Limpe antes."); process.exit(1); }
  const nn = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (bb) => { const r = (bb.reduce((s, d, i) => s + d * (bb.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(nn); const cpf = [...nn, d1, dv([...nn, d1])].join("");
  // Sem celular e sem telefone: nada pode ir por SMS ou WhatsApp.
  const pagador = await api("POST", "/customers", { name: "Prova riSZon parcelado", cpfCnpj: cpf, email, notificationDisabled: false });
  const estado = { pagador: pagador.id, cpf, parcelamento: null, dia: dia(0) };
  writeFileSync(estadoPath, JSON.stringify(estado));
  conf("o cadastro não tem celular nem telefone", !pagador.mobilePhone && !pagador.phone);
  // Só "cobrança criada" e "pagamento recebido/confirmado", só por e-mail ao pagador; o resto desligado (inclusive para a conta).
  const ns = (await api("GET", `/customers/${pagador.id}/notifications`)).data;
  await api("PUT", "/notifications/batch", { customer: pagador.id, notifications: ns.map((x) => LIGADOS.includes(x.event) ? { id: x.id, ...desligado, enabled: true, emailEnabledForCustomer: true } : { id: x.id, ...desligado }) });
  const vs = (await api("GET", `/customers/${pagador.id}/notifications`)).data;
  conf("só 'cobrança criada' e 'pagamento' ligados, só por e-mail ao pagador", vs.every((x) => LIGADOS.includes(x.event) ? x.enabled && x.emailEnabledForCustomer && !x.smsEnabledForCustomer && !x.whatsappEnabledForCustomer && !x.phoneCallEnabledForCustomer && !x.emailEnabledForProvider && !x.smsEnabledForProvider : !x.enabled));
  if (falhas || modo === "--ensaio") {
    await api("PUT", `/customers/${pagador.id}`, { notificationDisabled: true });
    await api("DELETE", `/customers/${pagador.id}`);
    writeFileSync(estadoPath, JSON.stringify({ limpo: true }));
    console.log(falhas ? "\nConfiguração inesperada: NADA foi criado; cadastro removido." : `\nEnsaio: ${ok} ok. Cadastro removido; nada foi criado nem enviado.`);
    process.exit(falhas ? 1 : 0);
  }
  // O parcelamento nasce sem cartão (como o link da fatura) e depois é pago pela API.
  const p = await api("POST", "/payments", { customer: pagador.id, billingType: "CREDIT_CARD", installmentCount: 3, totalValue: 15, dueDate: dia(3), description: "Prova riSZon cartao parcelado (sandbox)", externalReference: `prova-envio-parcelado-${Date.now()}` });
  estado.parcelamento = p.installment; estado.primeira = p.id; estado.criado_em = hojeBR();
  writeFileSync(estadoPath, JSON.stringify(estado));
  console.log(`\nParcelamento 3× de R$ 15,00 criado em ${estado.criado_em}.`);
  await new Promise((r) => setTimeout(r, 20_000));
  const pago = await api("POST", `/payments/${p.id}/payWithCreditCard`, {
    creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 2), ccv: "123" },
    creditCardHolderInfo: { name: "Prova riSZon parcelado", email: "prova.cartao@example.com", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "1000", phone: "4333330000" },
    remoteIp: "127.0.0.1",
  });
  estado.pago_em = hojeBR(); writeFileSync(estadoPath, JSON.stringify(estado));
  conf(`cartão aprovado (${pago.status}) em ${estado.pago_em}`, pago.status === "CONFIRMED");
  await new Promise((r) => setTimeout(r, 10_000));
  await medir(estado);
} else if (modo === "--medir") {
  await medir(JSON.parse(readFileSync(estadoPath, "utf8")));
} else {
  if (!existsSync(estadoPath)) { console.log("Nada a limpar."); process.exit(0); }
  const estado = JSON.parse(readFileSync(estadoPath, "utf8"));
  if (estado.limpo) { console.log("Já limpo."); process.exit(0); }
  // Primeiro cala o cadastro, para o estorno não gerar aviso nenhum.
  await api("PUT", `/customers/${estado.pagador}`, { notificationDisabled: true });
  const ns = (await api("GET", `/customers/${estado.pagador}/notifications`)).data;
  await api("PUT", "/notifications/batch", { customer: estado.pagador, notifications: ns.map((x) => ({ id: x.id, ...desligado })) });
  conf("avisos do cadastro desligados antes do estorno", (await api("GET", `/customers/${estado.pagador}/notifications`)).data.every((x) => !x.enabled));
  if (estado.parcelamento) {
    await api("POST", `/installments/${estado.parcelamento}/refund`, {}).catch(async () => api("DELETE", `/installments/${estado.parcelamento}`));
    const ps = (await api("GET", `/installments/${estado.parcelamento}/payments`)).data;
    conf(`parcelamento estornado (${ps.map((x) => x.status).join(", ")})`, ps.every((x) => ["REFUNDED", "REFUND_REQUESTED"].includes(x.status) || x.deleted));
  }
  await api("DELETE", `/customers/${estado.pagador}`);
  conf("cadastro de prova removido", true);
  writeFileSync(estadoPath, JSON.stringify({ limpo: true }));
}
console.log(`\n${ok} ok, ${falhas} falha(s).`);
process.exit(falhas ? 1 : 0);
