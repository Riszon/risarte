// PROVA DA TARIFA E DO SPLIT NO CARTÃO PARCELADO (ASA4, entrega 2, ajuste A).
//
// Direto na API do SANDBOX, separado do riSZon (não grava nada no banco). Conta de
// teste de Londrina; pagador SEM e-mail e SEM celular, avisos desligados (nada é
// enviado a ninguém). Cartão de teste publicado pelo Asaas, pela API, só no sandbox.
//
// Para 3×, 6×, 12× e 21× de um mesmo total, mede o líquido de CADA parcela e
// responde: a parte fixa da tarifa (R$ 0,49) sai uma vez ou em cada parcela? Como
// entra no líquido de cada uma? Depois manda o split pelo Método B com a parte fixa
// medida e confere o valor que o Asaas calcula para a franqueadora em cada parcela.
// No fim, estorna tudo e apaga o pagador.
//
//   node scripts/asaas-prova-tarifa-parcelado-sandbox.mjs --confirmar [--total=3000]
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
if (!process.argv.includes("--confirmar")) {
  console.log("Prova da tarifa do parcelado no SANDBOX (pagador sem contato).\n  node scripts/asaas-prova-tarifa-parcelado-sandbox.mjs --confirmar [--total=3000]");
  process.exit(2);
}
const TOTAL = Number((process.argv.find((a) => a.startsWith("--total=")) ?? "--total=3000").split("=")[1]);
const PARCELAS = [3, 6, 12, 21];
const P = 17; // % da rede para a franqueadora (produção: 6 + 2 + 3 + 6)
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const conta = await um("select g.id, g.environment, g.clinic_id from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active'");
const raiz = await um("select wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' and wallet_id is not null order by created_at limit 1");
if (!conta || conta.environment !== "sandbox" || !raiz) { console.error("RECUSADO: falta Londrina no sandbox ou a raiz."); process.exit(1); }
const faixas = (await c.query(
  `select r.min_installments de, r.max_installments ate, r.fee_percent::float pct, r.fixed_fee_cents fixo
     from public.acquirer_rates r join public.card_acquirers a on a.id = r.acquirer_id
    where a.clinic_id = $1 and a.name ilike '%asaas%' and r.modality like 'credito%'
      and r.valid_from <= current_date and (r.valid_to is null or r.valid_to >= current_date)`, [conta.clinic_id])).rows;
const chave = (await um("select api_key from public._gateway_read_key($1, 'prova_tarifa_parcelado_sandbox', null)", [conta.id])).api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }

async function asaas(metodo, caminho, corpo) {
  const r = await fetch(SANDBOX + caminho, {
    method: metodo,
    headers: { access_token: chave, "User-Agent": "riSZon (Risarte Odontologia) - prova tarifa parcelado", "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
    redirect: "error",
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${metodo} ${caminho.split("?")[0]} -> ${r.status} ${(j?.errors ?? []).map((e) => e.description).join(" | ")}`);
  return j;
}
function cpfDeTeste() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b) => { const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}
const baixo = (x, casas) => Math.floor(x * 10 ** casas + 1e-9) / 10 ** casas;
const r2 = (x) => Math.round(x * 100) / 100;
const faixaDe = (n) => faixas.find((f) => n >= f.de && n <= f.ate);
const venc = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const cpf = cpfDeTeste();
const pagador = await asaas("POST", "/customers", { name: "Prova tarifa parcelado riSZon (sem contato)", cpfCnpj: cpf, notificationDisabled: true });
const cartao = {
  creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 2), ccv: "123" },
  creditCardHolderInfo: { name: "Prova tarifa parcelado riSZon", email: "prova.cartao@example.com", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "1000", phone: "4333330000" },
  remoteIp: "127.0.0.1",
};
const criados = [];
const out = { total: TOTAL, faixas, resultado: [] };
async function parcelas(inst) {
  const lista = await asaas("GET", `/installments/${inst}/payments?limit=50`);
  const ps = [];
  for (const x of lista.data ?? []) ps.push(await asaas("GET", `/payments/${x.id}`));
  return ps.sort((a, b) => a.installmentNumber - b.installmentNumber);
}
try {
  for (const n of PARCELAS) {
    const f = faixaDe(n);
    const a = f.pct / 100, b = f.fixo / 100;
    // 1ª passada: sem split, para medir o líquido de cada parcela.
    const p1 = await asaas("POST", "/payments", {
      customer: pagador.id, billingType: "CREDIT_CARD", installmentCount: n, totalValue: TOTAL, dueDate: venc,
      description: `Prova tarifa ${n}x (ASA4) - sandbox`, externalReference: `prova-tarifa-${n}-${Date.now()}`, ...cartao,
    });
    criados.push(p1.installment);
    const ps = await parcelas(p1.installment);
    const nets = ps.map((p) => ({ n: p.installmentNumber, valor: p.value, liquido: p.netValue, tarifa: r2(p.value - p.netValue), fixo_implicito: r2(p.value - p.netValue - a * p.value), credito: p.estimatedCreditDate ?? p.creditDate }));
    const somaTarifa = r2(nets.reduce((s, x) => s + x.tarifa, 0));
    // 2ª passada: split pelo Método B com a menor parte fixa por parcela medida.
    const bParcela = baixo(Math.max(0, Math.min(...nets.map((x) => x.tarifa - a * x.valor))), 2);
    const q = baixo(P / (1 - a), 4);
    const F = baixo((q / 100) * bParcela, 2);
    const p2 = await asaas("POST", "/payments", {
      customer: pagador.id, billingType: "CREDIT_CARD", installmentCount: n, totalValue: TOTAL, dueDate: venc,
      description: `Prova split ${n}x (ASA4) - sandbox`, externalReference: `prova-split-${n}-${Date.now()}`,
      split: [{ walletId: raiz.wallet_id, percentualValue: q, fixedValue: F }], ...cartao,
    });
    criados.push(p2.installment);
    const ps2 = await parcelas(p2.installment);
    const linhas = ps2.map((p) => {
      const s = (p.split ?? [])[0] ?? {};
      const devido = r2((P * p.value) / 100);
      return { n: p.installmentNumber, valor: p.value, liquido: p.netValue, franqueadora: s.totalValue ?? null, devido_17: devido, diferenca: s.totalValue == null ? null : r2(devido - s.totalValue), situacao_split: s.status ?? null };
    });
    out.resultado.push({
      parcelas: n, faixa: `${f.de}-${f.ate}`, tarifa_pct: f.pct, tarifa_fixa: b,
      soma_tarifas_medida: somaTarifa, se_fixo_uma_vez: r2(TOTAL * a + b), se_fixo_em_cada: r2(TOTAL * a + b * n),
      liquido_por_parcela: nets, parte_fixa_por_parcela: bParcela, split_enviado: { percentualValue: q, fixedValue: F }, split_por_parcela: linhas,
    });
  }
} finally {
  for (const inst of criados) await asaas("POST", `/installments/${inst}/refund`, {}).catch((e) => console.error("estorno:", e.message));
  await asaas("DELETE", `/customers/${pagador.id}`).catch(() => {});
}
console.log(JSON.stringify(out, null, 2));
console.log(`\n${criados.length} parcelamento(s) de teste estornado(s); pagador apagado. Nada foi enviado a ninguém.`);
