// ENSAIO DA 4008 (ASA3, entrega 1 — o split na emissão) no banco de TREINO,
// numa transação DESFEITA (rollback): nada fica gravado.
// Uso: node scripts/asaas-ensaio-asa3-entrega1.mjs --confirmar
//
// Confere: a pontualidade travada em zero (S4); a configuração da rede e quem
// mexe; o destino de cada taxa (S7, fundo com carteira própria); o PLANO do
// split (S6: unidade sem split habilitado, carteira inválida); o que foi
// enviado e a confirmação do split habilitado; a BAIXA pelo aviso do Asaas com
// o RETIDO NA ORIGEM (nada em dobro na conta a pagar) e o razão (despesa da
// unidade e receita da franqueadora, por taxa); o aviso PAYMENT_SPLIT_DONE com
// o valor liquidado: dentro da tolerância (S5), a menor acima dela (volta à
// conta a pagar), a maior (divergência ao Financeiro), split cancelado; a
// cobrança sem split (como hoje); as funções internas fechadas; o histórico
// da aba. Percentuais de exemplo não redondos (18.5). Só contagens na saída.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";
import { entradasDoSplit, repasseSimulado, tarifaParaOSplit } from "../src/lib/asaas/split.ts";

const ARQ = "supabase/migrations/4008_asa3_split_na_emissao.sql";

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/asaas-ensaio-asa3-entrega1.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, valor) => (valor ? ok : falha).push(nome);
async function recusa(sql, params = []) {
  await c.query("savepoint s");
  try {
    await c.query(sql, params);
    await c.query("release savepoint s");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint s");
    return `${e.code ?? ""} ${e.message}`;
  }
}
const um = async (sql, params = []) => {
  try {
    return (await c.query(sql, params)).rows[0];
  } catch (err) {
    throw new Error(`${err.message} ← ${sql.slice(0, 90)}`);
  }
};
const todos = async (sql, params = []) => {
  try {
    return (await c.query(sql, params)).rows;
  } catch (err) {
    throw new Error(`${err.message} ← ${sql.slice(0, 90)}`);
  }
};
async function como(userId) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await c.query("set local role authenticated");
}
async function comoServidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}
async function comoPessoa(userId, sql, params = []) {
  await como(userId);
  await c.query("savepoint p");
  try {
    const r = (await c.query(sql, params)).rows;
    await c.query("release savepoint p");
    await comoServidor();
    return r;
  } catch (e) {
    await c.query("rollback to savepoint p");
    await comoServidor();
    return /NOT_ALLOWED|permission denied/.test(e.message) ? "recusado" : `erro: ${e.message}`;
  }
}

// As taxas de exemplo (18.5): diferentes e não redondas.
const TAXAS = { royalty: 6.37, fundo: 1.83, planejamento: 2.91, comercial: 5.44 };

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  const e2 = await recusa(sql);
  conf("a 4008 roda duas vezes sem erro", e2 === null);
  if (e2) console.log("   ", e2);

  // --- 1) S4: sem pontualidade ---------------------------------------------------
  conf("S4: nenhuma taxa com desconto de pontualidade", (await um("select count(*)::int n from public.network_fees where punctuality_discount_percent <> 0")).n === 0);
  conf("S4: o banco recusa desconto de pontualidade", (await recusa("update public.network_fees set punctuality_discount_percent = 5 where clinic_id is null and fee = 'royalty'")) !== null);

  // --- 2) o cenário ------------------------------------------------------------------
  const pessoa = async (conta) => (await um("select id from public.profiles where email = $1", [`${conta}@example.com`]))?.id;
  const P = {};
  for (const k of ["admin", "gerente", "financeiro"]) {
    P[k] = await pessoa(k);
    if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  }
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const conta = await um("select * from public.gateway_accounts where clinic_id = $1 and status = 'active'", [ldn]);
  const raiz = await um("select * from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = $1 and wallet_id is not null order by created_at limit 1", [conta?.environment]);
  const outra = await um("select * from public.gateway_accounts where owner_type = 'recipient' and status = 'active' and environment = $1 and wallet_id is not null order by created_at limit 1", [conta?.environment]);
  if (!ldn || !conta || !raiz || !outra) throw new Error("NÃO MEDI: falta Londrina com conta, a conta raiz ou uma carteira recebedora.");
  await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P.gerente]);
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, 'unit_manager')", [P.gerente, ldn]);
  await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P.financeiro]);
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, 'finance_franchisor')", [P.financeiro, franq]);

  for (const [fee, pct] of Object.entries(TAXAS)) {
    await c.query("update public.network_fees set percent = $2, active = true where clinic_id is null and fee = $1", [fee, pct]);
    await c.query("delete from public.network_fees where clinic_id = $1 and fee = $2", [ldn, fee]);
  }
  await c.query("update public.network_fee_types set active = true where key = any($1)", [Object.keys(TAXAS)]);
  await c.query("update public.network_fee_types set split_account_id = null");
  await c.query("delete from public.network_fee_campaigns where active");
  await c.query("update public.gateway_accounts set split_enabled_declared_at = now(), split_enabled_confirmed_at = null where id = $1", [conta.id]);

  // --- 3) a configuração e quem mexe -----------------------------------------------
  const leitura = await comoPessoa(P.financeiro, "select public.gateway_split_read() r");
  conf("o Financeiro lê a configuração do split", Array.isArray(leitura) && leitura[0].r.settings.tolerance_cents === 10);
  conf("multa e juros da cobrança à unidade nascem em branco", Array.isArray(leitura) && leitura[0].r.settings.unit_charge_fine_percent === null && leitura[0].r.settings.unit_charge_interest_percent === null);
  conf("o Gerente não lê a configuração do split", (await comoPessoa(P.gerente, "select public.gateway_split_read()")) === "recusado");
  conf("o Gerente não grava", (await comoPessoa(P.gerente, "select public.gateway_split_save(10, null, null, '[]'::jsonb)")) === "recusado");
  const propria = await comoPessoa(P.financeiro, "select public.gateway_split_save(10, null, null, $1::jsonb)", [JSON.stringify([{ fee: "fundo", accountId: conta.id }])]);
  conf("a carteira da própria unidade não é destino válido", typeof propria === "string" && /DESTINATION_INVALID/.test(propria));
  const salvou = await comoPessoa(P.financeiro, "select public.gateway_split_save(10, 2, 1, $1::jsonb)", [JSON.stringify([{ fee: "fundo", accountId: outra.id }])]);
  conf("o Financeiro manda o fundo para uma carteira própria e define multa e juros", Array.isArray(salvou));
  const cfg = await um("select * from public.gateway_split_settings where id");
  conf("multa e juros gravados", Number(cfg.unit_charge_fine_percent) === 2 && Number(cfg.unit_charge_interest_percent) === 1);
  const hist = await comoPessoa(P.financeiro, "select * from public.central_history('taxas', null)");
  conf("o histórico da aba Taxas da franquia mostra a mudança", Array.isArray(hist) && hist.some((h) => h.table_name === "gateway_split_settings") && hist.some((h) => h.table_name === "network_fee_types"));
  conf("o Gerente não vê o histórico da rede", Array.isArray(await comoPessoa(P.gerente, "select * from public.central_history('taxas', null)")) && (await comoPessoa(P.gerente, "select * from public.central_history('taxas', null)")).length === 0);

  // --- 4) as cobranças de teste ---------------------------------------------------
  const parcelas = await todos(
    `select i.id, i.amount_cents, i.client_id from public.payment_installments i
      where i.clinic_id = $1 and i.status = 'em_aberto' and i.amount_cents >= 5000 and i.client_id is not null
        and not exists (select 1 from public.charges ch where ch.payment_installment_id = i.id
                         and ch.status in ('emitindo','emitida','vencida','paga','liquidada','erro_emissao','externa'))
      order by i.amount_cents limit 6`,
    [ldn]
  );
  if (parcelas.length < 6) throw new Error("NÃO MEDI: faltam 6 parcelas livres em Londrina.");
  const hoje = (await um("select public.today_br()::text d")).d;
  async function novaCobranca(parc, meio = "PIX") {
    return (
      await um(
        `insert into public.charges (clinic_id, gateway_account_id, source_type, payment_installment_id, client_id, payer_kind,
                                     billing_type, value_cents, discount_cents, fine_percent, fine_cents, interest_percent, due_date, status, description)
         values ($1, $2, 'installment', $3, $4, 'client', $5, $6, 0, 0, 0, 0, ($7::date + 7), 'emitindo', 'Ensaio 4008') returning id`,
        [ldn, conta.id, parc.id, parc.client_id, meio, parc.amount_cents, hoje]
      )
    ).id;
  }

  // O PLANO (S6).
  const ch1 = await novaCobranca(parcelas[0]);
  const plano = (await um("select public._charge_split_plan($1) p", [ch1])).p;
  conf("o plano é elegível com o split habilitado", plano.elegivel === true);
  const porCarteira = Object.fromEntries((plano.carteiras ?? []).map((w) => [w.walletId, w]));
  conf("duas carteiras: a raiz e a do fundo", Object.keys(porCarteira).length === 2 && !!porCarteira[raiz.wallet_id] && !!porCarteira[outra.wallet_id]);
  conf("a raiz soma royalty + planejamento + comercial (14,72%)", Number(porCarteira[raiz.wallet_id]?.percent) === 14.72);
  conf("o fundo vai sozinho para a carteira própria (1,83%)", Number(porCarteira[outra.wallet_id]?.percent) === 1.83 && Object.keys(porCarteira[outra.wallet_id]?.fees ?? {}).join() === "fundo");
  conf("o plano traz as tarifas da conta", Array.isArray(plano.tarifas) && plano.tarifas.length > 0);
  await c.query("update public.gateway_accounts set split_enabled_declared_at = null where id = $1", [conta.id]);
  conf("S6: unidade sem split habilitado sai sem split", (await um("select public._charge_split_plan($1) p", [ch1])).p.motivo === "split_nao_habilitado");
  await c.query("update public.gateway_accounts set split_enabled_declared_at = now() where id = $1", [conta.id]);
  await c.query("update public.gateway_accounts set status = 'disabled' where id = $1", [outra.id]);
  conf("carteira de destino desativada: sai sem split (não manda para a raiz por engano)", (await um("select public._charge_split_plan($1) p", [ch1])).p.motivo === "sem_carteira");
  await c.query("update public.gateway_accounts set status = 'active' where id = $1", [outra.id]);

  // As entradas, pela conta pura (método B).
  const tarifa = tarifaParaOSplit(plano.tarifas, "PIX", hoje, plano.vencimento);
  const montar = (planoX) =>
    entradasDoSplit(planoX.carteiras.map((w) => ({ walletId: w.walletId, percent: Number(w.percent) })), tarifa).map((e) => {
      const w = planoX.carteiras.find((x) => x.walletId === e.walletId);
      return { ...e, accountId: w.accountId, fees: w.fees, tariffPercent: tarifa.a * 100, tariffFixedCents: tarifa.bCents, asaasSplitId: `split_${e.walletId.slice(0, 6)}` };
    });
  let seq = 0;
  async function emitirEPagar(chId, parc, comSplit = true) {
    seq++;
    const pl = (await um("select public._charge_split_plan($1) p", [chId])).p;
    const ent = montar(pl).map((e) => ({ ...e, asaasSplitId: `${e.asaasSplitId}_${seq}` }));
    if (comSplit) await c.query("select public._charge_save_split($1, $2::jsonb)", [chId, JSON.stringify(ent)]);
    else await c.query("select public._charge_mark_split_skipped($1, 'franqueadora')", [chId]);
    const pid = `pay_ensaio_4008_${seq}`;
    await c.query("select public._charge_mark_issued($1, $2, null, 'https://x/i', null, 'pix', null)", [chId, pid]);
    const valor = parc.amount_cents / 100;
    const tarifaReal = tarifa.bCents / 100;
    const payload = {
      event: "PAYMENT_RECEIVED",
      payment: { id: pid, externalReference: chId, value: valor, netValue: Math.round((valor - tarifaReal) * 100) / 100, billingType: "PIX", paymentDate: hoje, creditDate: hoje },
    };
    const ev = await um(
      "insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload) values ($1, $2, 'PAYMENT_RECEIVED', $3::jsonb) returning id",
      [conta.id, `evt_ensaio_${seq}`, JSON.stringify(payload)]
    );
    const r = (await um("select public._gateway_process_event($1) r", [ev.id])).r;
    return { ent, pid, r };
  }
  async function avisoDeSplit(chId, pid, evento, walletId, splitId, totalReais) {
    seq++;
    const payload = {
      event: evento,
      payment: { id: pid, externalReference: chId, split: [{ id: splitId, walletId, totalValue: totalReais, status: "DONE" }] },
      additionalInfo: { splitId },
    };
    const ev = await um(
      "insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload) values ($1, $2, $3, $4::jsonb) returning id",
      [conta.id, `evt_ensaio_${seq}`, evento, JSON.stringify(payload)]
    );
    return (await um("select public._gateway_process_event($1) r", [ev.id])).r;
  }
  const linhas = (chId) => todos("select fee, amount_cents::int a, retained_cents::int r from public.split_charges where charge_id = $1 order by fee", [chId]);
  const conta_a_pagar = async (fee) => {
    const per = (await um("select date_trunc('month', public.today_br())::date::text p")).p;
    const pg = await um("select amount_cents::int a, status from public.payables where clinic_id = $1 and network_fee = $2 and fee_period = $3", [ldn, fee, per]);
    const sc = await um("select coalesce(sum(amount_cents - retained_cents), 0)::int s from public.split_charges where clinic_id = $1 and fee = $2 and period_month = $3 and not reversed", [ldn, fee, per]);
    return { pagar: pg && pg.status !== "cancelada" ? pg.a : 0, devido: sc.s };
  };

  // --- 5) A — dentro da tolerância -------------------------------------------------
  const a = await emitirEPagar(ch1, parcelas[0]);
  conf("o split gravado confirma o 'split habilitado' da conta", !!(await um("select split_enabled_confirmed_at from public.gateway_accounts where id = $1", [conta.id])).split_enabled_confirmed_at);
  conf("o aviso de pagamento dá baixa", a.r === "baixa");
  const lA = await linhas(ch1);
  conf("a baixa gera as 4 taxas da cobrança, ligadas a ela", lA.length === 4);
  const esperado = Object.fromEntries(Object.entries(TAXAS).map(([f, p]) => [f, Math.round((parcelas[0].amount_cents * p) / 100)]));
  conf("cada taxa sobre o valor pago, com o percentual de exemplo", lA.every((l) => l.a === esperado[l.fee]));
  conf("RETIDO NA ORIGEM: antes do aviso de split, tudo retido (provisório)", lA.every((l) => l.r === l.a));
  for (const fee of Object.keys(TAXAS)) {
    const x = await conta_a_pagar(fee);
    conf(`nada em dobro: a conta a pagar de ${fee} é só o não retido`, x.pagar === x.devido);
  }
  const razaoA = await todos("select source_type, status, amount_cents::int a from public.financial_entries where source_type in ('split_retained','split_retained_revenue') and source_id in (select id from public.split_charges where charge_id = $1)", [ch1]);
  conf("o razão: despesa da unidade e receita da franqueadora, por taxa (8 lançamentos abertos)", razaoA.length === 8 && razaoA.every((r) => r.status === "open"));
  const sim = repasseSimulado(a.ent, parcelas[0].amount_cents, tarifa);
  for (const e of a.ent) {
    const s = sim.find((x) => x.walletId === e.walletId);
    await avisoDeSplit(ch1, a.pid, "PAYMENT_SPLIT_DONE", e.walletId, e.asaasSplitId, s.cents / 100);
  }
  const csA = await todos("select status, settled_cents::int s from public.charge_splits where charge_id = $1", [ch1]);
  conf("PAYMENT_SPLIT_DONE grava o valor liquidado de cada carteira", csA.length === 2 && csA.every((x) => x.status === "liquidado" && x.s > 0));
  const lA2 = await linhas(ch1);
  conf("S5: diferença de centavos (≤ R$ 0,10) é absorvida — tudo continua retido", lA2.every((l) => l.r === l.a));
  const razaoA2 = await todos("select status from public.financial_entries where source_type in ('split_retained','split_retained_revenue') and source_id in (select id from public.split_charges where charge_id = $1)", [ch1]);
  conf("o razão passa a liquidado com o aviso", razaoA2.length === 8 && razaoA2.every((r) => r.status === "settled"));

  // --- 6) B — a menor, acima da tolerância ----------------------------------------
  const ch2 = await novaCobranca(parcelas[1]);
  const b = await emitirEPagar(ch2, parcelas[1]);
  const simB = repasseSimulado(b.ent, parcelas[1].amount_cents, tarifa);
  const antes = await conta_a_pagar("royalty");
  for (const e of b.ent) {
    const s = simB.find((x) => x.walletId === e.walletId);
    const total = e.walletId === raiz.wallet_id ? s.cents - 50 : s.cents; // R$ 0,50 a menos na raiz
    await avisoDeSplit(ch2, b.pid, "PAYMENT_SPLIT_DONE", e.walletId, e.asaasSplitId, total / 100);
  }
  const lB = await linhas(ch2);
  const naoRetido = lB.reduce((t, l) => t + (l.a - l.r), 0);
  conf("S5: falta de R$ 0,50 (> R$ 0,10) volta para a conta a pagar", naoRetido >= 49 && naoRetido <= 52);
  // Acima da tolerância, a falta INTEIRA da cobrança vai para a conta a pagar —
  // inclusive o centavo de arredondamento do fundo.
  const fundoB = lB.find((l) => l.fee === "fundo");
  conf("o fundo (liquidado certo) perde no máximo o centavo do arredondamento", fundoB.a - fundoB.r <= 1);
  const depois = await conta_a_pagar("royalty");
  conf("a conta a pagar de royalty cresce com a parte não retida", depois.pagar > antes.pagar && depois.pagar === depois.devido);

  // --- 7) C — a maior ----------------------------------------------------------------
  const ch3 = await novaCobranca(parcelas[2]);
  const cc = await emitirEPagar(ch3, parcelas[2]);
  const simC = repasseSimulado(cc.ent, parcelas[2].amount_cents, tarifa);
  const nAntes = (await um("select count(*)::int n from public.notifications where title = 'Split: repasse acima do devido'")).n;
  for (const e of cc.ent) {
    const s = simC.find((x) => x.walletId === e.walletId);
    await avisoDeSplit(ch3, cc.pid, "PAYMENT_SPLIT_DONE", e.walletId, e.asaasSplitId, (s.cents + (e.walletId === raiz.wallet_id ? 300 : 0)) / 100);
  }
  conf("repasse a maior: o excesso fica gravado", (await um("select max(excess_cents)::int x from public.charge_splits where charge_id = $1", [ch3])).x >= 299);
  conf("repasse a maior: o Financeiro e o Admin são avisados", (await um("select count(*)::int n from public.notifications where title = 'Split: repasse acima do devido'")).n > nAntes);
  conf("repasse a maior não gera conta a pagar (tudo retido)", (await linhas(ch3)).every((l) => l.r === l.a));

  // --- 8) D — split cancelado pelo Asaas ----------------------------------------------
  const ch4 = await novaCobranca(parcelas[3]);
  const d = await emitirEPagar(ch4, parcelas[3]);
  for (const e of d.ent) await avisoDeSplit(ch4, d.pid, "PAYMENT_SPLIT_CANCELLED", e.walletId, e.asaasSplitId, 0);
  const lD = await linhas(ch4);
  conf("split cancelado: nada retido, a taxa volta inteira para a conta a pagar", lD.every((l) => l.r === 0));
  const razaoD = await todos("select status from public.financial_entries where source_type in ('split_retained','split_retained_revenue') and source_id in (select id from public.split_charges where charge_id = $1)", [ch4]);
  conf("split cancelado: o razão do retido é cancelado", razaoD.length === 8 && razaoD.every((r) => r.status === "cancelled"));
  const roy = await conta_a_pagar("royalty");
  conf("split cancelado: a conta a pagar continua batendo com o não retido", roy.pagar === roy.devido);

  // --- 9) E — bloqueio por divergência ------------------------------------------------
  const ch5 = await novaCobranca(parcelas[4]);
  const e5 = await emitirEPagar(ch5, parcelas[4]);
  const nB = (await um("select count(*)::int n from public.notifications where title = 'Split bloqueado pelo Asaas'")).n;
  await avisoDeSplit(ch5, e5.pid, "PAYMENT_SPLIT_DIVERGENCE_BLOCK", e5.ent[0].walletId, e5.ent[0].asaasSplitId, 0);
  conf("bloqueio por divergência: avisa Gerente, Financeiro e Admin", (await um("select count(*)::int n from public.notifications where title = 'Split bloqueado pelo Asaas'")).n > nB);
  conf("bloqueio: continua retido enquanto o Asaas não cancela", (await linhas(ch5)).every((l) => l.r === l.a));
  await avisoDeSplit(ch5, e5.pid, "PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED", e5.ent[0].walletId, e5.ent[0].asaasSplitId, 0);
  conf("fim do bloqueio sem correção: a taxa daquela carteira volta à conta a pagar", (await linhas(ch5)).some((l) => l.r === 0));

  // --- 10) F — sem split (como hoje) ------------------------------------------------
  const ch6 = await novaCobranca(parcelas[5]);
  const f6 = await emitirEPagar(ch6, parcelas[5], false);
  conf("sem split: baixa normal", f6.r === "baixa");
  conf("sem split: o motivo fica gravado na cobrança", (await um("select split_skip_reason r from public.charges where id = $1", [ch6])).r === "franqueadora");
  const lF = await todos("select retained_cents::int r from public.split_charges where source_type = 'receipt' and source_id = (select receipt_id from public.charges where id = $1)", [ch6]);
  conf("sem split: nada retido, a taxa vai inteira para a conta a pagar (como hoje)", lF.length === 4 && lF.every((l) => l.r === 0));

  // --- 11) as funções internas fechadas ----------------------------------------------
  const internas = ["_charge_split_plan(uuid)", "_charge_save_split(uuid,jsonb)", "_charge_mark_split_skipped(uuid,text)", "_gateway_split_retention(uuid)", "_gateway_on_split_event(bigint)", "_gateway_split_ledger(uuid,date)"];
  let fechadas = 0;
  for (const f of internas) {
    const r = await um("select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n", [`public.${f}`]);
    if (!r.a && !r.n) fechadas++;
  }
  conf("as funções internas do split estão fechadas para quem entrou e para anônimo", fechadas === internas.length);
  const portas = ["gateway_split_read()", "gateway_split_save(integer,numeric,numeric,jsonb)"];
  let certas = 0;
  for (const f of portas) {
    const r = await um("select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n", [`public.${f}`]);
    if (r.a && !r.n) certas++;
  }
  conf("as 2 portas da aba: abertas para quem entrou, fechadas para anônimo", certas === portas.length);
  await como(P.gerente);
  const direto = await todos("select * from public.charge_splits");
  await comoServidor();
  conf("ninguém lê charge_splits direto na tabela", direto.length === 0);
} catch (e) {
  falha.push(`o ensaio parou: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nEnsaio da 4008 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log("  FALHOU:", f);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
