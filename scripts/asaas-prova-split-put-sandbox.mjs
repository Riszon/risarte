// PROVA NO SANDBOX PARA A ASA3, ENTREGA 2 (spec 18.7, ajustes 1 e 4).
//
//   --put      mudar SÓ o split de uma cobrança em aberto (Pix e boleto) não
//              mexe no que o pagador tem: link da fatura, nosso número, linha
//              digitável, Pix copia e cola; e não gera PAYMENT_UPDATED (o aviso
//              "cobrança alterada" da régua nasce desse evento). CONTROLE: mudar
//              o VENCIMENTO de outra cobrança gera o evento.
//   --estorno  estorno total de cobrança paga com split (Pix): o que volta de
//              cada carteira; e o caso da carteira recebedora SEM SALDO (o
//              saldo do fundo de teste é transferido para a raiz antes).
//
// Separado do riSZon: só LÊ do banco de treino a chave da conta (Vault) e os
// avisos que chegaram pelo webhook de Londrina. Pagador sem e-mail e sem
// celular, avisos desligados: nada é enviado a ninguém. Só SANDBOX.
//
//   node scripts/asaas-prova-split-put-sandbox.mjs --put --confirmar
//   node scripts/asaas-prova-split-put-sandbox.mjs --estorno --confirmar
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
const args = process.argv.slice(2);
if (!args.includes("--confirmar") || !(args.includes("--put") || args.includes("--estorno"))) {
  console.log("Uso: node scripts/asaas-prova-split-put-sandbox.mjs (--put | --estorno) --confirmar");
  process.exit(2);
}

const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const contaLdn = await um("select g.id from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active' and g.environment = 'sandbox'");
const raiz = await um("select id, wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' order by created_at limit 1");
const fundo = await um("select id, wallet_id from public.gateway_accounts where owner_type = 'recipient' and label = 'Fundo de Propaganda Teste' and status = 'active' and environment = 'sandbox'");
if (!contaLdn || !raiz?.wallet_id || !fundo?.wallet_id) {
  console.error("RECUSADO: falta a conta de Londrina, a raiz ou o fundo de teste no sandbox.");
  process.exit(1);
}
const chaveDe = async (id) => (await um("select api_key from public._gateway_read_key($1, 'prova_split_sandbox', null)", [id])).api_key;
const K = { ldn: await chaveDe(contaLdn.id), fundo: await chaveDe(fundo.id) };
for (const k of Object.values(K)) {
  if (!String(k).startsWith("$aact_hmlg_")) {
    console.error("RECUSADO: chave que não é de sandbox.");
    process.exit(1);
  }
}

async function asaas(chave, metodo, caminho, corpo, tolerarErro = false) {
  const r = await fetch(SANDBOX + caminho, {
    method: metodo,
    headers: { access_token: chave, "User-Agent": "riSZon (Risarte Odontologia) - prova do split", "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
    redirect: "error",
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = `${metodo} ${caminho.split("?")[0]} -> ${r.status} ${(j?.errors ?? []).map((e) => e.description).join(" | ")}`;
    if (tolerarErro) return { erro: msg };
    throw new Error(msg);
  }
  return j;
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
function cpfDeTeste() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b) => {
    const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}
const venc = (dias) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
const avisosDe = async (pid) =>
  (await c.query("select event from public.gateway_webhook_events where payload->'payment'->>'id' = $1 order by id", [pid])).rows.map((r) => r.event);

const pagador = await asaas(K.ldn, "POST", "/customers", { name: "Prova do split riSZon (sem contato)", cpfCnpj: cpfDeTeste(), notificationDisabled: true });
const criadas = [];
const nova = async (meio, valor, split, dias = 5) => {
  const p = await asaas(K.ldn, "POST", "/payments", {
    customer: pagador.id,
    billingType: meio,
    value: valor,
    dueDate: venc(dias),
    description: "Prova do split (ASA3 entrega 2) — sandbox",
    externalReference: `prova-split-e2-${Date.now()}-${criadas.length}`,
    ...(split ? { split } : {}),
  });
  criadas.push(p.id);
  return p;
};
async function retrato(p) {
  const g = await asaas(K.ldn, "GET", `/payments/${p.id}`);
  const linha = g.billingType === "BOLETO" ? (await asaas(K.ldn, "GET", `/payments/${p.id}/identificationField`, null, true)) : null;
  const pix = await asaas(K.ldn, "GET", `/payments/${p.id}/pixQrCode`, null, true);
  return {
    invoiceUrl: g.invoiceUrl,
    bankSlipUrl: g.bankSlipUrl ?? null,
    nossoNumero: g.nossoNumero ?? null,
    linha: linha?.identificationField ?? null,
    pix: pix?.payload ?? null,
    vencimento: g.dueDate,
    valor: g.value,
    split: (g.split ?? []).map((s) => `${s.walletId === raiz.wallet_id ? "raiz" : "fundo"} ${s.percentualValue}%+${s.fixedValue ?? 0}`).join(", "),
  };
}

const SPLIT_A = [
  { walletId: raiz.wallet_id, percentualValue: 14.72, fixedValue: 0.14 },
  { walletId: fundo.wallet_id, percentualValue: 1.83, fixedValue: 0.01 },
];
const SPLIT_B = [{ walletId: raiz.wallet_id, percentualValue: 17, fixedValue: 0.16 }];

try {
  if (args.includes("--put")) {
    const pix = await nova("PIX", 50, SPLIT_A);
    const bol = await nova("BOLETO", 50, SPLIT_A);
    const ctl = await nova("BOLETO", 50, SPLIT_A);
    await espera(8000);
    const antes = { pix: await retrato(pix), bol: await retrato(bol), ctl: await retrato(ctl) };
    // Só o split.
    const putPix = await asaas(K.ldn, "PUT", `/payments/${pix.id}`, { split: SPLIT_B }, true);
    const putBol = await asaas(K.ldn, "PUT", `/payments/${bol.id}`, { split: SPLIT_B }, true);
    // Controle: só o vencimento (sem mandar split, que fica como está).
    const putCtl = await asaas(K.ldn, "PUT", `/payments/${ctl.id}`, { dueDate: venc(9) }, true);
    console.log("PUT só split (Pix):", putPix.erro ?? "aceito");
    console.log("PUT só split (boleto):", putBol.erro ?? "aceito");
    console.log("PUT só vencimento (controle):", putCtl.erro ?? "aceito");
    await espera(60_000);
    const depois = { pix: await retrato(pix), bol: await retrato(bol), ctl: await retrato(ctl) };
    for (const k of ["pix", "bol", "ctl"]) {
      console.log(`\n== ${k === "pix" ? "Pix (só split)" : k === "bol" ? "Boleto (só split)" : "Boleto CONTROLE (só vencimento)"}`);
      for (const campo of Object.keys(antes[k])) {
        const igual = JSON.stringify(antes[k][campo]) === JSON.stringify(depois[k][campo]);
        const mostrar = campo === "split" || campo === "vencimento" || campo === "valor";
        console.log(`  ${campo}: ${igual ? "igual" : "MUDOU"}${mostrar ? ` (${antes[k][campo]} → ${depois[k][campo]})` : ""}`);
      }
      const ids = { pix: pix.id, bol: bol.id, ctl: ctl.id };
      console.log(`  avisos do Asaas recebidos: ${(await avisosDe(ids[k])).join(", ") || "nenhum"}`);
    }
  }

  if (args.includes("--estorno")) {
    // R1: estorno total comum.
    const r1 = await nova("PIX", 20, SPLIT_A, 3);
    await asaas(K.ldn, "POST", `/sandbox/payment/${r1.id}/confirm`, {});
    await espera(15_000);
    const saldoFundoAntes = (await asaas(K.fundo, "GET", "/finance/balance")).balance;
    const est1 = await asaas(K.ldn, "POST", `/payments/${r1.id}/refund`, {}, true);
    await espera(20_000);
    const g1 = await asaas(K.ldn, "GET", `/payments/${r1.id}`);
    const saldoFundoDepois = (await asaas(K.fundo, "GET", "/finance/balance")).balance;
    console.log("\n== R1: estorno total (Pix R$ 20,00, split 14,72% raiz + 1,83% fundo)");
    console.log("  estorno:", est1.erro ?? `aceito (situação ${g1.status})`);
    console.log("  split depois:", JSON.stringify((g1.split ?? []).map((s) => ({ carteira: s.walletId === raiz.wallet_id ? "raiz" : "fundo", status: s.status, total: s.totalValue }))));
    console.log(`  saldo do fundo: ${saldoFundoAntes} → ${saldoFundoDepois}`);
    console.log("  avisos do Asaas recebidos:", (await avisosDe(r1.id)).join(", ") || "nenhum");

    // R2: a carteira recebedora (fundo) SEM saldo na hora do estorno.
    const r2 = await nova("PIX", 20, SPLIT_A, 3);
    await asaas(K.ldn, "POST", `/sandbox/payment/${r2.id}/confirm`, {});
    await espera(15_000);
    const saldo = Number((await asaas(K.fundo, "GET", "/finance/balance")).balance);
    const tr = saldo > 0 ? await asaas(K.fundo, "POST", "/transfers", { value: saldo, walletId: raiz.wallet_id }, true) : { erro: "fundo já sem saldo" };
    await espera(10_000);
    const saldoZero = (await asaas(K.fundo, "GET", "/finance/balance")).balance;
    const est2 = await asaas(K.ldn, "POST", `/payments/${r2.id}/refund`, {}, true);
    await espera(20_000);
    const g2 = await asaas(K.ldn, "GET", `/payments/${r2.id}`);
    console.log("\n== R2: estorno com a carteira do fundo SEM saldo");
    console.log(`  transferência do saldo do fundo para a raiz: ${tr.erro ?? "feita"}; saldo do fundo agora: ${saldoZero}`);
    console.log("  estorno:", est2.erro ?? `aceito (situação ${g2.status})`);
    console.log("  split depois:", JSON.stringify((g2.split ?? []).map((s) => ({ carteira: s.walletId === raiz.wallet_id ? "raiz" : "fundo", status: s.status, total: s.totalValue }))));
    console.log("  avisos do Asaas recebidos:", (await avisosDe(r2.id)).join(", ") || "nenhum");
  }
} finally {
  for (const id of criadas) {
    const g = await asaas(K.ldn, "GET", `/payments/${id}`, null, true);
    if (g && !g.erro && ["PENDING", "OVERDUE"].includes(g.status)) await asaas(K.ldn, "DELETE", `/payments/${id}`, null, true);
  }
  await asaas(K.ldn, "DELETE", `/customers/${pagador.id}`, null, true);
  await c.end();
  console.log("\nCobranças em aberto da prova canceladas; pagador de teste apagado.");
}
