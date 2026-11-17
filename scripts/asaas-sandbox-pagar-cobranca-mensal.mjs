// SIMULA O PAGAMENTO da cobrança mensal emitida (SÓ SANDBOX), como o boleto pago:
// o Asaas manda o aviso ao projeto de teste, e a baixa vem por ele.
//
//   RISARTE_TREINO_POOLER=1 node scripts/asaas-sandbox-pagar-cobranca-mensal.mjs "Risarte Cambé - Centro" --confirmar
//
// Acha a cobrança mensal EMITIDA (ou vencida) da unidade, confere que a conta é de
// sandbox e chama a simulação do sandbox (`POST /sandbox/payment/{id}/confirm`).
// A chave nunca é impressa.
import { connect } from "./test-db.mjs";

const nome = process.argv[2];
if (!nome || !process.argv.includes("--confirmar")) {
  console.log('Uso: node scripts/asaas-sandbox-pagar-cobranca-mensal.mjs "<nome da unidade>" --confirmar');
  process.exit(2);
}
const c = await connect();
try {
  const b = (await c.query(
    `select b.id, b.period, ch.id charge_id, ch.asaas_payment_id, ch.gateway_account_id, ch.value_cents, a.environment
       from public.franchise_monthly_batches b join public.clinics k on k.id = b.clinic_id
       join public.charges ch on ch.id = b.charge_id join public.gateway_accounts a on a.id = ch.gateway_account_id
      where k.name = $1 and b.status = 'emitida' and ch.status in ('emitida', 'vencida') order by b.period limit 1`, [nome])).rows[0];
  if (!b) throw new Error("não há cobrança mensal emitida para esta unidade.");
  if (b.environment !== "sandbox") throw new Error("RECUSADO: a conta não é de sandbox.");
  const k = (await c.query("select api_key from public._gateway_read_key($1, 'prova_pagar_cobranca_mensal', null)", [b.gateway_account_id])).rows[0].api_key;
  if (!String(k).startsWith("$aact_hmlg_")) throw new Error("RECUSADO: chave que não é de sandbox.");
  const r = await fetch(`https://api-sandbox.asaas.com/v3/sandbox/payment/${b.asaas_payment_id}/confirm`, {
    method: "POST",
    headers: { access_token: k, "User-Agent": "riSZon - prova", "Content-Type": "application/json" },
    body: "{}",
  });
  const j = await r.json();
  console.log(`Pagamento simulado (${r.status}): cobrança de ${new Date(b.period).toISOString().slice(0, 7)}, R$ ${Number(b.value_cents) / 100}, situação no Asaas: ${j.status ?? JSON.stringify(j.errors ?? j)}`);
  console.log("A baixa chega pelo aviso do Asaas em até 1 minuto (atualize a tela).");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
