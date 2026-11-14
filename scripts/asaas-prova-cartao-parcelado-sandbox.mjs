// PROVA DO CARTÃO PARCELADO NO SANDBOX (ASA4, entrega 2; pendência da seção 17).
//
// Direto na API do Asaas, SEPARADO do riSZon (não grava nada no banco). Na conta
// de teste de Londrina, um pagador SEM e-mail e SEM celular, com os avisos
// desligados (nada é enviado a ninguém). Pago com o cartão de teste publicado
// pelo Asaas (4444 4444 4444 4444), pela API — só no sandbox.
//
// Responde, com o que o Asaas devolve:
//   1. o parcelamento no cartão (3×, total que não divide exato): valor de cada
//      parcela, quem fica com a sobra, vencimentos;
//   2. depois do pagamento: a situação de cada parcela, o líquido, a data
//      PREVISTA DE CRÉDITO de cada uma (mês a mês ou tudo junto?) e o split em
//      cada parcela;
//   3. o cancelamento de um parcelamento não pago (DELETE /installments/{id});
//   4. o estorno do parcelamento pago (POST /installments/{id}/refund).
//
//   node scripts/asaas-prova-cartao-parcelado-sandbox.mjs --confirmar
import { connect } from "./test-db.mjs";

const SANDBOX = "https://api-sandbox.asaas.com/v3";
if (!process.argv.includes("--confirmar")) {
  console.log("Prova do cartão parcelado no SANDBOX (pagador sem contato).\n  node scripts/asaas-prova-cartao-parcelado-sandbox.mjs --confirmar");
  process.exit(2);
}
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const conta = await um("select g.id, g.environment from public.gateway_accounts g join public.clinics k on k.id = g.clinic_id where k.name = 'Risarte Londrina - Centro' and g.status = 'active'");
const raiz = await um("select wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' and wallet_id is not null order by created_at limit 1");
if (!conta || conta.environment !== "sandbox" || !raiz) { console.error("RECUSADO: falta Londrina no sandbox ou a raiz."); process.exit(1); }
const chave = (await um("select api_key from public._gateway_read_key($1, 'prova_cartao_parcelado_sandbox', null)", [conta.id])).api_key;
await c.end();
if (!String(chave).startsWith("$aact_hmlg_")) { console.error("RECUSADO: chave que não é de sandbox."); process.exit(1); }

async function asaas(metodo, caminho, corpo) {
  const r = await fetch(SANDBOX + caminho, {
    method: metodo,
    headers: { access_token: chave, "User-Agent": "riSZon (Risarte Odontologia) - prova cartao parcelado", "Content-Type": "application/json" },
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
const venc = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const cpf = cpfDeTeste();
const pagador = await asaas("POST", "/customers", { name: "Prova cartao parcelado riSZon (sem contato)", cpfCnpj: cpf, notificationDisabled: true });
const cartao = {
  creditCard: { holderName: "TESTE RISZON", number: "4444444444444444", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 2), ccv: "123" },
  creditCardHolderInfo: { name: "Prova cartao parcelado riSZon", email: "prova.cartao@example.com", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "1000", phone: "4333330000" },
  remoteIp: "127.0.0.1",
};
const out = {};
try {
  // 1+2. Parcelamento 3× de R$ 150,01 (não divide exato), pago no cartão, com split de 17% para a raiz.
  const p1 = await asaas("POST", "/payments", {
    customer: pagador.id, billingType: "CREDIT_CARD", installmentCount: 3, totalValue: 150.01, dueDate: venc,
    description: "Prova cartao parcelado (ASA4) - sandbox", externalReference: `prova-cartao-${Date.now()}`,
    split: [{ walletId: raiz.wallet_id, percentualValue: 17 }], ...cartao,
  });
  out.primeira = { id: p1.id, installment: p1.installment, installmentNumber: p1.installmentNumber, status: p1.status };
  const lista = await asaas("GET", `/installments/${p1.installment}/payments`);
  out.parcelas = [];
  for (const x of lista.data ?? []) {
    const p = await asaas("GET", `/payments/${x.id}`);
    out.parcelas.push({
      n: p.installmentNumber, valor: p.value, liquido: p.netValue, vencimento: p.dueDate, situacao: p.status,
      credito_previsto: p.estimatedCreditDate ?? null, credito: p.creditDate ?? null, confirmado_em: p.confirmedDate ?? null,
      split: (p.split ?? []).map((s) => ({ pct: s.percentualValue, valor: s.totalValue, situacao: s.status })),
      referencia: p.externalReference,
    });
  }
  out.parcelamento = await asaas("GET", `/installments/${p1.installment}`).then((i) => ({ valor: i.value, liquido: i.netValue, parcelas: i.installmentCount, pago: i.paymentValue ?? null }));
  // 4. Estorno do parcelamento pago.
  try {
    const est = await asaas("POST", `/installments/${p1.installment}/refund`, {});
    out.estorno = { ok: true, situacao: est.status ?? null };
    const depois = await asaas("GET", `/installments/${p1.installment}/payments`);
    out.estorno.parcelas = (depois.data ?? []).map((x) => x.status);
  } catch (e) {
    out.estorno = { ok: false, erro: e.message };
  }
  // 3. Parcelamento NÃO pago: cancelar (apagar) o parcelamento inteiro.
  const p2 = await asaas("POST", "/payments", {
    customer: pagador.id, billingType: "CREDIT_CARD", installmentCount: 2, totalValue: 20, dueDate: venc,
    description: "Prova cartao parcelado (ASA4) - cancelar", externalReference: `prova-cartao-cancelar-${Date.now()}`,
  });
  out.nao_pago = { invoiceUrl_existe: Boolean(p2.invoiceUrl), status: p2.status };
  const del = await asaas("DELETE", `/installments/${p2.installment}`);
  const depoisDel = await asaas("GET", `/installments/${p2.installment}/payments`).catch((e) => ({ erro: e.message }));
  out.cancelamento = { resposta: del, parcelas_depois: depoisDel.data?.map((x) => ({ status: x.status, deleted: x.deleted })) ?? depoisDel };
} finally {
  await asaas("DELETE", `/customers/${pagador.id}`).catch(() => {});
}
console.log(JSON.stringify(out, null, 2));
console.log("\nPagador de teste apagado. Nada foi enviado a ninguém (pagador sem contato, avisos desligados).");
