// PROVA DO SPLIT NO SANDBOX (ASA3, entrega 1) — formato e arredondamento.
//
// Direto na API do Asaas, SEPARADO do riSZon (não grava nada no banco). Na
// conta de teste de Londrina, cria um pagador SEM e-mail e SEM celular, com os
// avisos desligados (nada é enviado a ninguém), e cobranças com split para duas
// carteiras: a raiz (franqueadora, 14,72%) e a conta de teste "Fundo de
// Propaganda Teste" (1,83%) — este caso só prova que o split funciona com o
// fundo em carteira PRÓPRIA, no futuro (hoje o fundo vai para a franqueadora,
// D6). A RisLife nunca entra (D7).
//
// Pix e boleto são pagos pela simulação do sandbox; o cartão, pela API com o
// cartão de teste publicado pelo Asaas (4444 4444 4444 4444, CVV 123) — só no
// sandbox. Lê o que o Asaas devolveu (líquido, tarifa, repasse de cada
// carteira) e compara com a conta do riSZon (`src/lib/asaas/split.ts`).
//
//   node scripts/asaas-prova-split-sandbox.mjs --confirmar
//
// TRAVAS: chave da conta tem de ser de sandbox (`$aact_hmlg_`), o endereço é
// fixo no sandbox, o banco é o de treino (só LEITURA da chave e das carteiras).
// Nenhuma chave é impressa.
import { connect } from "./test-db.mjs";
import { entradasDoSplit, splitsParaOAsaas, tarifaParaOSplit } from "../src/lib/asaas/split.ts";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
if (!process.argv.includes("--confirmar")) {
  console.log("Prova do split no SANDBOX (cobranças pagas com dinheiro fictício, pagador sem contato).\n  node scripts/asaas-prova-split-sandbox.mjs --confirmar");
  process.exit(2);
}

const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const conta = await um(
  "select g.id, g.environment, g.wallet_id from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active'"
);
const raiz = await um("select wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' and wallet_id is not null order by created_at limit 1");
const fundo = await um("select wallet_id from public.gateway_accounts where owner_type = 'recipient' and label = 'Fundo de Propaganda Teste' and status = 'active' and environment = 'sandbox'");
if (!conta || conta.environment !== "sandbox" || !raiz || !fundo) {
  console.error("RECUSADO: falta a conta de Londrina no sandbox, a raiz ou a carteira de teste do fundo.");
  process.exit(1);
}
const chave = (await um("select api_key from public._gateway_read_key($1, 'prova_split_sandbox', null)", [conta.id])).api_key;
if (!String(chave).startsWith("$aact_hmlg_")) {
  console.error("RECUSADO: a chave da conta não é de sandbox.");
  process.exit(1);
}
const tarifas = (
  await c.query(
    "select r.modality, r.fee_percent, r.fixed_fee_cents, r.valid_from::text, r.valid_to::text, r.min_installments from public.acquirer_rates r join public.card_acquirers q on q.id = r.acquirer_id where q.gateway_account_id = $1",
    [conta.id]
  )
).rows;
await c.end();

async function asaas(metodo, caminho, corpo) {
  const r = await fetch(SANDBOX + caminho, {
    method: metodo,
    headers: { access_token: chave, "User-Agent": "riSZon (Risarte Odontologia) - prova do split", "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
    redirect: "error",
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${metodo} ${caminho.split("?")[0]} -> ${r.status} ${(j?.errors ?? []).map((e) => e.description).join(" | ")}`);
  return j;
}
function cpfDeTeste() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b) => {
    const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}

const hoje = new Date().toISOString().slice(0, 10);
const venc = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const CARTEIRAS = [
  { walletId: raiz.wallet_id, percent: 14.72, nome: "franqueadora (14,72%)" },
  { walletId: fundo.wallet_id, percent: 1.83, nome: "fundo em carteira própria (1,83%)" },
];
const CASOS = [
  ["PIX", 817],
  ["PIX", 50_000],
  ["PIX", 123_456],
  ["BOLETO", 50_000],
  ["BOLETO", 98_765],
  ["CREDIT_CARD", 50_000],
  ["CREDIT_CARD", 123_456],
];

const cpf = cpfDeTeste();
const pagador = await asaas("POST", "/customers", { name: "Prova do split riSZon (sem contato)", cpfCnpj: cpf, notificationDisabled: true });
const linhas = [];
try {
  for (const [meio, valor] of CASOS) {
    const t = tarifaParaOSplit(tarifas, meio, hoje, venc);
    const ent = entradasDoSplit(CARTEIRAS, t);
    const corpo = {
      customer: pagador.id,
      billingType: meio,
      value: valor / 100,
      dueDate: venc,
      description: "Prova do split (ASA3) — sandbox",
      externalReference: `prova-split-${Date.now()}`,
      split: splitsParaOAsaas(ent),
    };
    if (meio === "CREDIT_CARD") {
      corpo.creditCard = { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 2), ccv: "123" };
      corpo.creditCardHolderInfo = {
        name: "Prova do split riSZon",
        email: "prova.split@example.com",
        cpfCnpj: cpf,
        postalCode: "01310100",
        addressNumber: "1000",
        phone: "4333330000",
      };
      corpo.remoteIp = "127.0.0.1";
    }
    let p = await asaas("POST", "/payments", corpo);
    if (meio !== "CREDIT_CARD") await asaas("POST", `/sandbox/payment/${p.id}/confirm`, {});
    p = await asaas("GET", `/payments/${p.id}`);
    const pago = Math.round(Number(p.value) * 100);
    const liquido = Math.round(Number(p.netValue) * 100);
    for (const e of ent) {
      const s = (p.split ?? []).find((x) => x.walletId === e.walletId) ?? {};
      const devido = Math.round((pago * e.percent) / 100);
      const bruto = e.fixedCents + (liquido * e.percentualValue) / 100;
      const liquidado = s.totalValue == null ? null : Math.round(Number(s.totalValue) * 100);
      linhas.push({
        meio,
        pago,
        tarifa: pago - liquido,
        carteira: CARTEIRAS.find((x) => x.walletId === e.walletId).nome,
        enviado: `${e.percentualValue}% + ${(e.fixedCents / 100).toFixed(2)}`,
        devido,
        liquidado,
        diferenca: liquidado == null ? null : devido - liquidado,
        bruto: Math.round(bruto * 1000) / 1000,
        modo: liquidado == null ? "?" : liquidado === Math.round(bruto) && liquidado !== Math.floor(bruto) ? "mais próximo" : liquidado === Math.floor(bruto) && liquidado !== Math.round(bruto) ? "para baixo" : "igual nos dois",
        situacao: `${p.status}/${s.status ?? "?"}`,
      });
    }
  }
} finally {
  await asaas("DELETE", `/customers/${pagador.id}`).catch(() => {});
}

const brl = (n) => (n == null ? "—" : (n / 100).toFixed(2).replace(".", ","));
console.log("\n| Meio | Pago | Tarifa | Carteira | Enviado | Devido | Liquidado | Diferença | Conta sem arredondar | Arredondamento | Situação |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const l of linhas) {
  console.log(`| ${l.meio} | ${brl(l.pago)} | ${brl(l.tarifa)} | ${l.carteira} | ${l.enviado} | ${brl(l.devido)} | ${brl(l.liquidado)} | ${brl(l.diferenca)} | ${(l.bruto / 100).toFixed(5)} | ${l.modo} | ${l.situacao} |`);
}
const nunca = linhas.every((l) => l.diferenca == null || l.diferenca >= 0);
console.log(`\nRepasse nunca acima do devido: ${nunca ? "SIM" : "NÃO"}. Pagador de teste apagado.`);
