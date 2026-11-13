// PROVA DO ESTORNO COM SPLIT PELA CONTA PRINCIPAL DO SANDBOX (spec 18.7.1).
//
// A conta principal (raiz) emite duas cobranças Pix de R$ 20,00, pagas pela
// simulação do sandbox:
//   E1 — split de 14,72% para a carteira de LONDRINA (com saldo);
//   E2 — split de 1,83% para a carteira do FUNDO de teste, que tem o saldo
//        transferido para a raiz antes do pedido (carteira recebedora SEM saldo).
// Pede o estorno total das duas e PARA: o Jeferson autoriza no painel da
// conta principal. O código de autorização NUNCA passa por aqui.
//
//   node scripts/asaas-prova-estorno-raiz-sandbox.mjs --pedir --confirmar
//   node scripts/asaas-prova-estorno-raiz-sandbox.mjs --ler --confirmar
//
// Pagador sem e-mail e sem celular, avisos desligados. Só SANDBOX; só LÊ do
// banco de treino as chaves (Vault) e os avisos que chegaram pelo webhook.
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
const args = process.argv.slice(2);
if (!args.includes("--confirmar") || !(args.includes("--pedir") || args.includes("--ler"))) {
  console.log("Uso: node scripts/asaas-prova-estorno-raiz-sandbox.mjs (--pedir | --ler) --confirmar");
  process.exit(2);
}
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const raiz = await um("select id, wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' order by created_at limit 1");
const ldn = await um("select g.id, g.wallet_id from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active' and g.environment = 'sandbox'");
const fundo = await um("select id, wallet_id from public.gateway_accounts where owner_type = 'recipient' and label = 'Fundo de Propaganda Teste' and status = 'active' and environment = 'sandbox'");
const chave = async (id) => (await um("select api_key from public._gateway_read_key($1, 'prova_estorno_sandbox', null)", [id])).api_key;
const K = { raiz: await chave(raiz.id), fundo: await chave(fundo.id), ldn: await chave(ldn.id) };
if (!Object.values(K).every((k) => String(k).startsWith("$aact_hmlg_"))) {
  console.error("RECUSADO: chave que não é de sandbox.");
  process.exit(1);
}
async function asaas(k, metodo, caminho, corpo, tolerar = false) {
  const r = await fetch(SANDBOX + caminho, {
    method: metodo,
    headers: { access_token: k, "User-Agent": "riSZon (Risarte Odontologia) - prova do estorno", "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
    redirect: "error",
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const m = `${metodo} ${caminho.split("?")[0]} -> ${r.status} ${(j?.errors ?? []).map((e) => e.description).join(" | ")}`;
    if (tolerar) return { erro: m };
    throw new Error(m);
  }
  return j;
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const REF = "prova-estorno-raiz-";
const saldo = async (k) => Number((await asaas(k, "GET", "/finance/balance")).balance);

if (args.includes("--pedir")) {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b) => {
    const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  const cpf = [...n, d1, dv([...n, d1])].join("");
  const pagador = await asaas(K.raiz, "POST", "/customers", { name: "Prova do estorno riSZon (sem contato)", cpfCnpj: cpf, notificationDisabled: true });
  const venc = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const casos = [
    ["E1", [{ walletId: ldn.wallet_id, percentualValue: 14.72, fixedValue: 0.14 }]],
    ["E2", [{ walletId: fundo.wallet_id, percentualValue: 1.83, fixedValue: 0.01 }]],
  ];
  for (const [nome, split] of casos) {
    const p = await asaas(K.raiz, "POST", "/payments", {
      customer: pagador.id, billingType: "PIX", value: 20, dueDate: venc,
      description: `Prova do estorno ${nome} (ASA3) — sandbox`, externalReference: `${REF}${nome}-${Date.now()}`, split,
    });
    await asaas(K.raiz, "POST", `/sandbox/payment/${p.id}/confirm`, {});
    await espera(15_000);
    if (nome === "E2") {
      const s = await saldo(K.fundo);
      const t = s > 0 ? await asaas(K.fundo, "POST", "/transfers", { value: s, walletId: raiz.wallet_id }, true) : null;
      await espera(8_000);
      console.log(`E2: saldo do fundo ${s} transferido para a raiz (${t?.erro ?? "ok"}); saldo agora ${await saldo(K.fundo)}`);
    }
    const e = await asaas(K.raiz, "POST", `/payments/${p.id}/refund`, {}, true);
    const g = await asaas(K.raiz, "GET", `/payments/${p.id}`);
    console.log(`${nome}: cobrança ${p.id} — estorno ${e.erro ?? "pedido"}; situação ${g.status}; estorno ${(g.refunds ?? []).map((r) => r.status).join(",") || "?"}`);
  }
  console.log(`\nSaldos agora — raiz: ${await saldo(K.raiz)}, Londrina: ${await saldo(K.ldn)}, fundo: ${await saldo(K.fundo)}`);
  console.log("Aguardando a autorização no painel da conta principal.");
}

if (args.includes("--ler")) {
  const evs = (await c.query(
    "select payload->'payment'->>'id' pid, payload->'payment'->>'externalReference' ref, event, received_at from public.gateway_webhook_events where payload->'payment'->>'externalReference' like $1 order by id",
    [`${REF}%`]
  )).rows;
  const pids = [...new Set(evs.map((e) => e.pid))];
  for (const pid of pids) {
    const nome = evs.find((e) => e.pid === pid).ref.slice(REF.length, REF.length + 2);
    const g = await asaas(K.raiz, "GET", `/payments/${pid}`);
    console.log(`\n== ${nome} (${pid}) — situação ${g.status}`);
    console.log("  estornos:", JSON.stringify((g.refunds ?? []).map((r) => ({ status: r.status, valor: r.value, splits: r.refundedSplits }))));
    console.log("  split:", JSON.stringify((g.split ?? []).map((s) => ({ carteira: s.walletId === ldn.wallet_id ? "Londrina" : "fundo", status: s.status, total: s.totalValue, motivo: s.cancellationReason ?? s.refusalReason ?? null }))));
    console.log("  avisos:", evs.filter((e) => e.pid === pid).map((e) => e.event).join(", "));
  }
  console.log(`\nSaldos — raiz: ${await saldo(K.raiz)}, Londrina: ${await saldo(K.ldn)}, fundo: ${await saldo(K.fundo)}`);
}
await c.end();
