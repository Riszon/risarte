// PROVA DO ESTORNO PARCIAL COM SPLIT PELA CONTA PRINCIPAL DO SANDBOX (4020a, spec 19.35.14).
//
// Por que a conta principal: as subcontas do sandbox (Londrina, Cambé…) foram
// criadas pela API com e-mail fictício (`@example.com`): ninguém entra no painel
// delas para autorizar o estorno. A conta principal é a que o Jeferson acessa,
// como na prova do estorno de 13/11 (18.7.3). O split vai para a carteira de
// LONDRINA (17%), o mesmo desenho das cobranças do riSZon.
//
//   node scripts/asaas-prova-estorno-parcial-raiz-sandbox.mjs --pedir-pix --confirmar
//       Pix de R$ 100,00 pago pela simulação; pede o estorno PARCIAL de R$ 30,00
//       e PARA: o Jeferson autoriza no painel da conta principal.
//   node scripts/asaas-prova-estorno-parcial-raiz-sandbox.mjs --preparar-cartao --confirmar
//       cartão parcelado 3× de R$ 100,00, aprovado com o cartão de teste do
//       sandbox (o estorno parcial só é aceito no dia seguinte).
//   node scripts/asaas-prova-estorno-parcial-raiz-sandbox.mjs --pedir-cartao --confirmar
//       pede o estorno PARCIAL de R$ 120,00 do parcelamento e PARA.
//   node scripts/asaas-prova-estorno-parcial-raiz-sandbox.mjs --ler --confirmar
//       lê o Pix e o parcelamento: os estornos, o split e os avisos que chegaram.
//
// Pagador sem e-mail e sem celular, avisos desligados: nada é enviado. Só
// SANDBOX; só LÊ do banco de treino as chaves (Vault) e os avisos do webhook.
// O código de autorização NUNCA passa por aqui. A chave nunca é impressa.
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
const args = process.argv.slice(2);
const modo = ["--pedir-pix", "--preparar-cartao", "--pedir-cartao", "--ler"].find((m) => args.includes(m));
if (!args.includes("--confirmar") || !modo) {
  console.log("Uso: node scripts/asaas-prova-estorno-parcial-raiz-sandbox.mjs (--pedir-pix | --preparar-cartao | --pedir-cartao | --ler) --confirmar");
  process.exit(2);
}
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const todos = async (sql, p = []) => (await c.query(sql, p)).rows;
const raiz = await um("select id, wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' order by created_at limit 1");
const ldn = await um("select g.id, g.wallet_id from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active' and g.environment = 'sandbox'");
const K = (await um("select api_key from public._gateway_read_key($1, 'prova_estorno_parcial_sandbox', null)", [raiz.id])).api_key;
if (!String(K).startsWith("$aact_hmlg_")) {
  console.error("RECUSADO: chave que não é de sandbox.");
  process.exit(1);
}
async function asaas(metodo, caminho, corpo, tolerar = false) {
  const r = await fetch(SANDBOX + caminho, {
    method: metodo,
    headers: { access_token: K, "User-Agent": "riSZon (Risarte Odontologia) - prova do estorno parcial", "Content-Type": "application/json" },
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
const REF_PIX = "prova-parcial-raiz-pix";
const REF_CARTAO = "prova-parcial-raiz-cartao";
const iso = (d) => d.toISOString().slice(0, 10);
function cpfDeTeste() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b) => {
    const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}
async function cliente(cpf) {
  return asaas("POST", "/customers", { name: "Prova estorno parcial sem contato", cpfCnpj: cpf, notificationDisabled: true });
}
const split = [{ walletId: ldn.wallet_id, percentualValue: 17 }];
const resumoPagamento = (p) => ({
  id: p.id,
  parcela: p.installmentNumber ?? null,
  situacao: p.status,
  valor: p.value,
  estornos: (p.refunds ?? []).map((r) => ({ situacao: r.status, valor: r.value, splitsDevolvidos: r.refundedSplits })),
  split: (p.split ?? []).map((s) => ({ situacao: s.status, total: s.totalValue, devolvido: s.refundedValue ?? null, motivo: s.cancellationReason ?? null })),
});

try {
  if (modo === "--pedir-pix") {
    // Reaproveita o Pix da prova já pago e sem estorno (o Asaas pode pedir para
    // "tentar em alguns instantes" logo depois do pagamento).
    const existentes = await asaas("GET", `/payments?externalReference=${REF_PIX}&limit=10`);
    let p = (existentes.data ?? []).find((x) => x.status === "RECEIVED" && !(x.refunds ?? []).length) ?? null;
    if (!p) {
      const cpf = cpfDeTeste();
      const cli = await cliente(cpf);
      const venc = iso(new Date(Date.now() + 3 * 86400000));
      p = await asaas("POST", "/payments", { customer: cli.id, billingType: "PIX", value: 100, dueDate: venc, description: "Prova 4020a: Pix com split, estorno parcial", externalReference: REF_PIX, split });
      await asaas("POST", `/sandbox/payment/${p.id}/confirm`, {});
      for (let i = 0; i < 10; i++) {
        const pago = await asaas("GET", `/payments/${p.id}`);
        if (["RECEIVED", "CONFIRMED"].includes(pago.status) && (pago.split ?? []).every((s) => s.status === "DONE")) break;
        await espera(3000);
      }
    }
    let est = null;
    for (let i = 0; i < 12 && !est; i++) {
      const r = await asaas("POST", `/payments/${p.id}/refund`, { value: 30, description: "Prova 4020a: estorno parcial de R$ 30" }, true);
      if (!r.erro) est = r;
      else if (/alguns instantes/.test(r.erro)) await espera(20000);
      else throw new Error(r.erro);
    }
    if (!est) throw new Error("o Asaas continuou pedindo para tentar mais tarde");
    console.log("Pix:", JSON.stringify(resumoPagamento(await asaas("GET", `/payments/${p.id}`)), null, 1));
    console.log(`Pedido do estorno: ${est.status ?? "enviado"}. AGORA: o Jeferson autoriza no painel da conta principal (cobrança ${p.id}).`);
  } else if (modo === "--preparar-cartao") {
    const cpf = cpfDeTeste();
    const cli = await cliente(cpf);
    const venc = iso(new Date(Date.now() + 5 * 86400000));
    const p = await asaas("POST", "/payments", { customer: cli.id, billingType: "CREDIT_CARD", installmentCount: 3, totalValue: 300, dueDate: venc, description: "Prova 4020a: cartão parcelado com split, estorno parcial", externalReference: REF_CARTAO, split });
    let ok = null;
    for (let i = 0; i < 4 && !ok; i++) {
      const r = await asaas("POST", `/payments/${p.id}/payWithCreditCard`, {
        creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 2), ccv: "123" },
        creditCardHolderInfo: { name: "Prova estorno parcial", email: "prova.cartao@example.com", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "1000", phone: "4333330000" },
        remoteIp: "127.0.0.1",
      }, true);
      if (!r.erro) ok = r;
      else await espera(5000);
    }
    if (!ok) throw new Error("o sandbox recusou o cartão de teste");
    const lista = await asaas("GET", `/installments/${p.installment}/payments`);
    console.log(`Parcelamento ${p.installment} aprovado em ${new Date().toISOString()}:`);
    for (const x of (lista.data ?? []).sort((a, b) => a.installmentNumber - b.installmentNumber)) console.log(" ", JSON.stringify(resumoPagamento(x)));
  } else if (modo === "--pedir-cartao") {
    const lista = await asaas("GET", `/payments?externalReference=${REF_CARTAO}&limit=20`);
    const inst = (lista.data ?? []).find((x) => x.installment)?.installment;
    if (!inst) throw new Error("não achei o parcelamento da prova (rode --preparar-cartao antes)");
    const est = await asaas("POST", `/installments/${inst}/refund`, { value: 120, description: "Prova 4020a: estorno parcial de R$ 120" }, true);
    console.log("Pedido do estorno do parcelamento:", est.erro ?? JSON.stringify({ situacao: est.status, estornos: est.refunds ?? null }));
    if (!est.erro) console.log(`AGORA: o Jeferson autoriza no painel da conta principal (parcelamento ${inst}).`);
  } else {
    for (const ref of [REF_PIX, REF_CARTAO]) {
      const lista = await asaas("GET", `/payments?externalReference=${ref}&limit=20`);
      const ps = (lista.data ?? []).sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));
      console.log(`\n== ${ref === REF_PIX ? "Pix" : "Cartão parcelado"} (${ps.length} cobrança[s])`);
      for (const p of ps) console.log(" ", JSON.stringify(resumoPagamento(await asaas("GET", `/payments/${p.id}`))));
      const ids = ps.map((p) => p.id);
      const avisos = ids.length
        ? await todos(
            `select e.event, e.result, e.received_at from public.gateway_webhook_events e
              where e.account_id = $1 and e.payload->'payment'->>'id' = any($2) order by e.received_at`, [raiz.id, ids])
        : [];
      console.log("  avisos que chegaram ao riSZon:", avisos.map((a) => `${a.event} (${a.result ?? "pendente"})`).join(", ") || "nenhum");
    }
  }
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
