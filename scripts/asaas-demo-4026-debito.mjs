// DEMONSTRAÇÃO DA 4026 NO TREINO (fica gravada, para conferir as telas).
// Duas parcelas livres de Londrina recebem uma cobrança de cartão "Demonstração 4026",
// paga no débito pelo aviso simulado: (A) o split corrigido; (B) a correção
// recusada → crédito da unidade. O Asaas não é chamado (ids de pagamento falsos).
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-demo-4026-debito.mjs --confirmar
import { connect, testEnv } from "./test-db.mjs";

if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO (fica gravado). Rode com --confirmar.");
  process.exit(2);
}
const TREINO_REF = "bsnptybalszjjbhxeejo";
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "TEST_DB_URL"]) {
  if (!String(testEnv()[k] ?? "").includes(TREINO_REF)) { console.log(`RECUSADO: ${k} não é o banco de treino.`); process.exit(3); }
}
const c = await connect();
const um = async (s, p = []) => (await c.query(s, p)).rows[0];
const f4 = (x) => Math.floor(x * 1e4 + 1e-9) / 1e4;
try {
  await c.query("begin");
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'")).id;
  const conta = await um("select id from public.gateway_accounts where clinic_id = $1 and status = 'active' limit 1", [ldn]);
  const hoje = (await um("select public.today_br()::text d")).d;
  const taxa = async (mod) => um(`select r.fee_percent::float a, r.fixed_fee_cents::int b from public.acquirer_rates r join public.card_acquirers q on q.id = r.acquirer_id
      where q.gateway_account_id = $1 and r.modality = $2 and r.valid_from <= current_date and (r.valid_to is null or r.valid_to >= current_date)
      order by r.valid_from desc limit 1`, [conta.id, mod]);
  const cred = await taxa("credito_avista");
  const deb = await taxa("debito");
  const parcelas = (await c.query(
    `select i.id, i.amount_cents, i.client_id from public.payment_installments i
      where i.clinic_id = $1 and i.status = 'em_aberto' and i.amount_cents >= 20000 and i.client_id is not null
        and coalesce(i.payment_method, '') not in ('dinheiro', 'permuta', 'cartao_parcelado', 'cartao_parcelado_asaas', 'credito_recorrente', 'deposito_avista')
        and i.renegotiation_id is null
        and (exists (select 1 from public.direct_sales s where s.id = i.direct_sale_id and s.closed_at is not null)
             or exists (select 1 from public.commercial_sales cs where cs.negotiation_id = i.negotiation_id and cs.closed_at is not null))
        and not exists (select 1 from public.charges ch where ch.payment_installment_id = i.id
                         and ch.status in ('emitindo','emitida','vencida','paga','liquidada','erro_emissao','externa'))
      order by i.amount_cents desc limit 2`, [ldn])).rows;
  if (parcelas.length < 2) throw new Error("faltam 2 parcelas livres em Londrina");

  const casos = [];
  for (const [k, parc] of parcelas.entries()) {
    const tag = k === 0 ? "corrigido" : "credito";
    const V = Number(parc.amount_cents);
    const ch = (await um(`insert into public.charges (clinic_id, gateway_account_id, source_type, payment_installment_id, client_id, payer_kind,
        billing_type, value_cents, discount_cents, fine_percent, fine_cents, interest_percent, due_date, status, description)
       values ($1, $2, 'installment', $3, $4, 'client', 'CREDIT_CARD', $5, 0, 0, 0, 0, ($6::date + 7), 'emitindo', 'Demonstração 4026') returning id`,
      [ldn, conta.id, parc.id, parc.client_id, V, hoje])).id;
    const plano = (await um("select public._charge_split_plan($1) p", [ch])).p;
    if (!plano.elegivel) throw new Error(`plano não elegível: ${plano.motivo}`);
    const ent = (t) => plano.carteiras.map((w) => {
      const q = f4(Number(w.percent) / (1 - t.a / 100));
      return { walletId: w.walletId, accountId: w.accountId, percent: Number(w.percent), fees: w.fees, percentualValue: q,
               fixedCents: Math.floor((q / 100) * t.b + 1e-9), tariffPercent: t.a, tariffFixedCents: t.b, asaasSplitId: `spl_demo4026_${tag}_${w.walletId.slice(0, 6)}` };
    });
    await c.query("select public._charge_save_split($1, $2::jsonb)", [ch, JSON.stringify(ent(cred))]);
    const pay = `pay_demo4026_${tag}_${ch.slice(0, 8)}`;
    await c.query("select public._charge_mark_issued($1, $2, null, 'https://sandbox.asaas.com/i/demo', null, null, null)", [ch, pay]);
    const tarifa = Math.round((deb.a / 100) * V + deb.b);
    const ev = (await um(`insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload)
        values ($1, $2, 'PAYMENT_CONFIRMED', $3::jsonb) returning id`,
      [conta.id, `evt_demo4026_${tag}_${ch.slice(0, 8)}`, JSON.stringify({ event: "PAYMENT_CONFIRMED", payment: {
        id: pay, externalReference: ch, billingType: "DEBIT_CARD", value: V / 100, netValue: (V - tarifa) / 100,
        confirmedDate: hoje, estimatedCreditDate: hoje } })])).id;
    const r = (await um("select public._gateway_apply_event($1) r", [ev])).r;
    await c.query("set constraints all immediate");
    const liquido = V - tarifa;
    const repasse = (es) => es.reduce((s, e) => s + e.fixedCents + Math.floor((liquido * e.percentualValue) / 100 + 1e-9), 0);
    const novas = ent({ a: deb.a, b: deb.b });
    if (tag === "corrigido") {
      await c.query("select public._gateway_debit_fix_done($1, 'corrigido', $2::jsonb, $3::jsonb, null)",
        [ch, JSON.stringify(novas), JSON.stringify({ antesCents: repasse(ent(cred)), depoisCents: repasse(novas) })]);
    } else {
      await c.query("select public._gateway_debit_fix_done($1, 'recusado', '[]'::jsonb, '{}'::jsonb, 'demonstração: recusa simulada')", [ch]);
    }
    // O split liquidado (o que o Asaas repassaria em cada caso).
    const usadas = tag === "corrigido" ? novas : ent(cred);
    for (const w of (await c.query("select id, wallet_id, asaas_split_id from public.charge_splits where charge_id = $1", [ch])).rows) {
      const pago = repasse(usadas.filter((e) => e.walletId === w.wallet_id));
      const e2 = (await um(`insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload)
          values ($1, $2, 'PAYMENT_SPLIT_DONE', $3::jsonb) returning id`,
        [conta.id, `evt_demo4026_split_${w.id}`, JSON.stringify({ event: "PAYMENT_SPLIT_DONE", additionalInfo: { splitId: w.asaas_split_id },
          payment: { id: pay, externalReference: ch, split: [{ id: w.asaas_split_id, walletId: w.wallet_id, totalValue: pago / 100 }] } })])).id;
      await um("select public._gateway_on_split_event($1) r", [e2]);
    }
    await c.query("set constraints all immediate");
    const fx = await um("select status from public.charge_debit_fixes where charge_id = $1", [ch]);
    const cr = await um("select amount_cents, status from public.split_excess_credits where charge_id = $1", [ch]);
    casos.push({ tag, cobranca: ch, cliente: parc.client_id, valor: V, aviso: r, correcao: fx?.status, credito: cr ?? null });
  }
  await c.query("commit");
  console.log(JSON.stringify(casos, null, 1));
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.log("ERRO (nada gravado):", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
