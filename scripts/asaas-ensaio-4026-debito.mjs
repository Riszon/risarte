// ENSAIO DA 4026 (o pagamento no cartão de débito) no banco de TREINO, numa
// transação DESFEITA (rollback). O Asaas não é chamado: o ensaio faz o papel do
// aviso do Asaas e do servidor (a conta do split corrigido é a do Método B).
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4026-debito.mjs --confirmar [--quebrar=gatilho|evento]
//
// OS CASOS (pedido do dono, 21/11/2026):
//   1. pago no débito, correção ACEITA: o split muda, nada a mais, nenhum crédito;
//   2. correção RECUSADA: o a mais vira crédito da unidade, com o razão, fora da receita;
//   3. pago no CRÉDITO: nada muda;
//   4. débito em cobrança PARCELADA: trava, avisa o Financeiro, não corrige nem credita;
//   5. cobrança ANTECIPADA: não tenta; o a mais vira crédito;
//   6. o prazo (o dinheiro caiu) e o erro de passagem (tenta de novo em 10 minutos);
//   7. a cobrança mensal: o crédito entra, é usado na baixa (com o razão) e,
//      maior que a cobrança, acumula para o mês seguinte;
//   8. o aviso SEM a marca de débito, mas com o valor líquido do débito: é
//      débito, mas as duas formas discordam — não corrige, avisa o Financeiro,
//      e a Conferência mostra o split a mais;
//   9. o aviso diz débito, mas o valor líquido é o do crédito: o mesmo.
// PROVADO QUEBRANDO: `gatilho` = sem o gatilho do crédito, a recusa não vira
// crédito; `evento` = sem gravar o meio usado, nada do débito acontece;
// `valor` = sem a segunda forma (só o aviso), o caso 8 passa despercebido.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4026_asa4_pagamento_no_debito.sql";
const Q = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, v) => (v ? ok : falha).push(nome);
const um = async (s, p = []) => (await c.query(s, p)).rows[0];
const todos = async (s, p = []) => (await c.query(s, p)).rows;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const mais = (s, dias) => iso(new Date(Date.parse(s) + dias * 86400000));
const n = (x) => Number(x ?? 0);

// O Método B (src/lib/asaas/split.ts), para o ensaio fazer o papel do servidor.
const f4 = (x) => Math.floor(x * 1e4 + 1e-9) / 1e4;
const splitPor = (p, a, b) => { const q = f4(p / (1 - a)); return { q, F: Math.floor((q / 100) * b + 1e-9) }; };
const repasse = (s, V, a, b) => s.F + Math.floor(((V - Math.round(a * V + b)) * s.q) / 100 + 1e-9);
const CRED = [0.0239, 29];
const DEB = [0.0189, 29];

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  const r1 = [].concat(await c.query(sql)).at(-1).rows[0];
  conf("a 4026 roda: 10 funções trocadas, 2 gatilhos, 3 contas e na lista",
    n(r1.funcoes_trocadas) === 10 && n(r1.gatilhos) === 2 && n(r1.contas) === 3 && r1.na_lista === true);
  await c.query("savepoint dup");
  try { await c.query(sql); await c.query("release savepoint dup"); conf("a 4026 roda duas vezes sem erro", true); }
  catch (e) { await c.query("rollback to savepoint dup"); conf(`a 4026 roda duas vezes sem erro (${e.message})`, false); }

  if (Q === "gatilho") {
    await c.query("drop trigger charge_splits_debit_excess on public.charge_splits");
    console.log("   (QUEBRADO de propósito: sem o gatilho do crédito)");
  }
  if (Q === "valor") {
    await c.query(`do $q$ declare d text := pg_get_functiondef('public._gateway_debit_detect(uuid,jsonb)'::regprocedure);
      begin execute replace(d, 'if not v_marca and not v_valor_deb then return null; end if;', 'if not v_marca then return null; end if;'); end $q$;`);
    console.log("   (QUEBRADO de propósito: sem a forma do valor líquido)");
  }
  if (Q === "evento") {
    await c.query(`do $q$ declare d text := pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure);
      begin execute replace(d, 'perform public._gateway_debit_detect(c.id, p);', 'null;'); end $q$;`);
    console.log("   (QUEBRADO de propósito: o aviso não grava o meio usado)");
  }

  // --- o cenário: mensalidades do PPR+ em Londrina, emitidas no cartão, com split ---
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  if (!ldn) throw new Error("NÃO MEDI: Londrina não existe no treino.");
  const conta = await um("select id from public.gateway_accounts where clinic_id = $1 and status = 'active' limit 1", [ldn]);
  const raiz = await um("select id, clinic_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' order by created_at limit 1");
  if (!conta || !raiz) throw new Error("NÃO MEDI: falta a conta de Londrina ou a raiz no treino.");
  // As tarifas da produção (21/11/2026) na conta de Londrina, só dentro da transação.
  await c.query(`update public.acquirer_rates r set fee_percent = 1.89, fixed_fee_cents = 29 from public.card_acquirers a
                  where a.id = r.acquirer_id and a.gateway_account_id = $1 and r.modality = 'debito'`, [conta.id]);
  await c.query(`update public.acquirer_rates r set fee_percent = 2.39, fixed_fee_cents = 29 from public.card_acquirers a
                  where a.id = r.acquirer_id and a.gateway_account_id = $1 and r.modality = 'credito_avista' and r.valid_from <= current_date`, [conta.id]);
  const hoje = iso((await um("select public.today_br() d")).d);
  const cli = await um(`select c.id from public.clients c where c.clinic_id = $1 and public._cpf_ok(c.cpf) and c.birth_date < current_date - interval '19 years'
                          and not exists (select 1 from public.client_guardians g where g.client_id = c.id) order by c.created_at limit 1`, [ldn]);
  const plano = await um("select id from public.ppr_plans order by created_at limit 1");
  if (!cli || !plano) throw new Error("NÃO MEDI: falta cliente ou plano do PPR+ no treino.");
  const taxas = await todos("select key from public.network_fee_types where kind = 'percent' and active order by sort_order");
  const fees = { royalty: 6, fundo: 2, planejamento: 3, comercial: 6 };
  await c.query(`insert into public.gateway_auto_charge_units (clinic_id, enabled, fees_enabled_from, changed_at)
                 values ($1, false, public.today_br(), now()) on conflict (clinic_id) do update set fees_enabled_from = public.today_br()`, [ldn]);
  const membro = (await um(`insert into public.ppr_memberships (clinic_id, plan_id, holder_client_id, status, monthly_cents, billing_day, payment_method, contract_signed, first_payment_confirmed)
                            values ($1, $2, $3, 'ativo', 100000, 10, 'boleto', true, true) returning id`, [ldn, plano.id, cli.id])).id;

  const V = 100000; // R$ 1.000,00
  const sC = splitPor(17, ...CRED);
  const sD = splitPor(17, ...DEB);
  let mes = 6;
  async function mensalidade(tag, { parcelado = false } = {}) {
    const f = (await um(`insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status)
                         values ($1, $2, date_trunc('month', current_date) + make_interval(months => $4), $3, $5, 'em_aberto') returning id`,
      [membro, ldn, mais(hoje, 10), mes++, V])).id;
    const ch = (await um("select public._fee_charge_prepare_system('ppr_charge', $1, 'BOLETO', 'mensalidade') id", [f])).id;
    const pay = `pay_${tag}_${ch.slice(0, 8)}`;
    await um("select public._charge_mark_issued($1, $2, null, $3, null, null, $4)", [ch, pay, "https://sandbox.asaas.com/i/x", "2379"]);
    await c.query(`update public.charges set billing_type = 'CREDIT_CARD', split_applied = true,
                   installment_block = case when $2 then gen_random_uuid() end, installment_count = case when $2 then 2 end,
                   installment_number = case when $2 then 1 end where id = $1`, [ch, parcelado]);
    const sid = `spl_${tag}_${ch.slice(0, 8)}`;
    const cs = (await um(`insert into public.charge_splits (charge_id, destination_account_id, wallet_id, percent, percentual_value, fixed_cents, fees, tariff_percent, tariff_fixed_cents, status, asaas_split_id)
                          values ($1, $2, 'w_ensaio', 17, $3, $4, $5::jsonb, 2.39, 29, 'enviado', $6) returning id`,
      [ch, raiz.id, sC.q, sC.F, JSON.stringify(fees), sid])).id;
    return { f, ch, cs, sid, pay };
  }
  const fimDaTransacao = async () => { await c.query("set constraints all immediate"); await c.query("set constraints all deferred"); };
  let ev = 0;
  async function avisoDoPagamento(m, meio, extra = {}) {
    // `liquidoDe`: a tarifa que o Asaas cobrou (por padrão, a do meio do aviso).
    const a = (extra.liquidoDe ?? meio) === "DEBIT_CARD" ? DEB : CRED;
    const tarifa = Math.round(a[0] * V + a[1]);
    const id = (await um(`insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload)
                          values ($1, $2, 'PAYMENT_CONFIRMED', $3::jsonb) returning id`,
      [conta.id, `evt_pg_${m.ch}_${ev++}`, JSON.stringify({ event: "PAYMENT_CONFIRMED", payment: {
        id: m.pay, externalReference: m.ch, billingType: meio, value: V / 100, netValue: (V - tarifa) / 100,
        confirmedDate: hoje, estimatedCreditDate: extra.credito ?? mais(hoje, 3), anticipated: !!extra.antecipada } })])).id;
    const r = (await um("select public._gateway_apply_event($1) r", [id])).r;
    await fimDaTransacao();
    return r;
  }
  async function avisoDoSplit(m, cents) {
    const id = (await um(`insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload)
                          values ($1, $2, 'PAYMENT_SPLIT_DONE', $3::jsonb) returning id`,
      [conta.id, `evt_sp_${m.sid}`, JSON.stringify({ event: "PAYMENT_SPLIT_DONE", additionalInfo: { splitId: m.sid },
        payment: { id: m.pay, externalReference: m.ch, split: [{ id: m.sid, walletId: "w_ensaio", totalValue: cents / 100 }] } })])).id;
    const r = (await um("select public._gateway_on_split_event($1) r", [id])).r;
    await fimDaTransacao();
    return r;
  }
  const fix = (m) => um("select * from public.charge_debit_fixes where charge_id = $1", [m.ch]);
  const credito = (m) => um("select * from public.split_excess_credits where charge_id = $1", [m.ch]);
  const devidoDe = async (m) => n((await um("select coalesce(sum(amount_cents),0) s from public.split_charges where source_type = 'ppr_charge' and source_id = $1 and not reversed", [m.f])).s);
  const naFila = async (m) => (await todos("select * from public._gateway_debit_fix_queue($1, 50)", [conta.id])).find((x) => x.charge_id === m.ch);
  const aviso = async (kind, key) => n((await um("select count(*) n from public.gateway_notices where kind = $1 and key = $2", [kind, key])).n);
  const entradaCorrigida = () => [{ walletId: "w_ensaio", accountId: raiz.id, percent: 17, percentualValue: sD.q, fixedCents: sD.F,
    fees, tariffPercent: 1.89, tariffFixedCents: 29, asaasSplitId: null }];
  const razao = (tipo, id) => um("select clinic_id, account_code, direction, amount_cents, status from public.financial_entries where source_type = $1 and source_id = $2", [tipo, id]);

  // --- 1) pago no débito, correção ACEITA ---------------------------------------------------
  const A = await mensalidade("aceita");
  conf("1: o aviso de pagamento no débito dá baixa", (await avisoDoPagamento(A, "DEBIT_CARD")) === "baixa");
  const chA = await um("select paid_billing_type, status from public.charges where id = $1", [A.ch]);
  conf("1: a cobrança grava \"pago no cartão de débito\"", chA.paid_billing_type === "DEBIT_CARD");
  conf("1: reconhecido pelas duas formas (aviso e valor líquido)",
    (await um("select paid_debit_signal s from public.charges where id = $1", [A.ch])).s === "aviso_e_valor");
  const tarifaA = await um("select amount_cents from public.financial_entries where source_type = 'gateway_fee_charge' and source_id = $1", [A.ch]);
  conf(`1: a tarifa do débito na baixa (R$ 19,19: ${n(tarifaA?.amount_cents)})`, n(tarifaA?.amount_cents) === 1919);
  const fA = await fix(A);
  conf("1: entra na fila da correção, com o prazo do crédito (D+3)", fA?.status === "pendente" && iso(fA.credit_date) === mais(hoje, 3));
  const itemA = await naFila(A);
  conf("1: a fila entrega o plano com a tarifa do débito e as taxas da emissão",
    itemA && itemA.plan.meio === "DEBIT_CARD" && itemA.plan.tarifas.every((t) => t.modality === "debito")
    && itemA.plan.carteiras[0].walletId === "w_ensaio" && n(itemA.plan.valorCents) === V);
  await um("select public._gateway_debit_fix_done($1, 'corrigido', $2::jsonb, $3::jsonb, null)",
    [A.ch, JSON.stringify(entradaCorrigida()), JSON.stringify({ antesCents: repasse(sC, V, ...DEB), depoisCents: repasse(sD, V, ...DEB) })]);
  const csA = await um("select percentual_value, fixed_cents, tariff_percent from public.charge_splits where id = $1", [A.cs]);
  conf(`1: o split passa a ${sD.q}% + R$ 0,0${sD.F} (tarifa do débito)`, n(csA.percentual_value) === sD.q && n(csA.fixed_cents) === sD.F && n(csA.tariff_percent) === 1.89);
  conf("1: a correção fica no histórico do split", n((await um("select count(*) n from public.charge_split_updates where charge_id = $1 and 'pago_no_debito' = any(reasons)", [A.ch])).n) === 1);
  conf("1: sai da fila como corrigida", (await fix(A)).status === "corrigido" && !(await naFila(A)));
  const devido = await devidoDe(A);
  conf(`1: o Asaas repassa ${repasse(sD, V, ...DEB)} (devido ${devido}): split liquidado`, (await avisoDoSplit(A, repasse(sD, V, ...DEB))) === "split_liquidado");
  conf("1: sem split a mais e sem crédito", n((await um("select excess_cents from public.charge_splits where id = $1", [A.cs])).excess_cents) === 0 && !(await credito(A)));

  // --- 2) correção RECUSADA → crédito da unidade ---------------------------------------------
  const B = await mensalidade("recusada");
  await avisoDoPagamento(B, "DEBIT_CARD");
  await um("select public._gateway_debit_fix_done($1, 'recusado', '[]'::jsonb, '{}'::jsonb, 'asaas:invalid_action')", [B.ch]);
  conf("2: a recusa sai da fila e avisa o Financeiro", (await fix(B))?.status === "recusado" && (await aviso("debito_correcao_recusada", B.ch)) === 1);
  const pagoB = repasse(sC, V, ...DEB);
  await avisoDoSplit(B, pagoB);
  const xB = await credito(B);
  const excB = pagoB - (await devidoDe(B));
  conf(`2: o a mais vira crédito da unidade (R$ ${(excB / 100).toFixed(2)}: ${n(xB?.amount_cents)})`, xB && n(xB.amount_cents) === excB && excB >= 80 && xB.status === "a_devolver");
  const uB = await razao("split_excess_unit", xB?.id);
  const hB = await razao("split_excess_hq", xB?.id);
  conf("2: razão da unidade: 6.4.01, saída, \"a receber da franqueadora\"", uB?.account_code === "6.4.01" && uB.direction === "outflow" && n(uB.amount_cents) === excB && uB.status === "settled" && uB.clinic_id === ldn);
  conf("2: razão da franqueadora: 6.4.02, entrada, \"a devolver à unidade\"", hB?.account_code === "6.4.02" && hB.direction === "inflow" && n(hB.amount_cents) === excB && hB.clinic_id !== ldn);
  const receitaB = n((await um(`select coalesce(sum(f.amount_cents),0) s from public.financial_entries f join public.split_charges sc on sc.id = f.source_id
                                where f.source_type = 'split_retained_revenue' and sc.source_id = $1 and f.status <> 'cancelled'`, [B.f])).s);
  conf(`2: a receita da franqueadora fica no devido (${receitaB}), sem o a mais`, receitaB === (await devidoDe(B)));
  conf("2: o aviso é de crédito, não o de \"repasse a maior\"", (await aviso("credito_split_debito", xB?.id ?? "")) === 1 && (await aviso("repasse_a_maior", B.cs)) === 0);

  // --- 3) pago no CRÉDITO: nada muda ----------------------------------------------------------
  const C3 = await mensalidade("credito");
  await avisoDoPagamento(C3, "CREDIT_CARD");
  conf("3: pago no crédito: sem marca de débito e fora da fila", !(await um("select paid_billing_type from public.charges where id = $1", [C3.ch])).paid_billing_type && !(await fix(C3)));
  await avisoDoSplit(C3, repasse(sC, V, ...CRED));
  conf("3: o split do crédito fica como estava, sem crédito", n((await um("select percentual_value from public.charge_splits where id = $1", [C3.cs])).percentual_value) === sC.q && !(await credito(C3)));

  // --- 4) débito em cobrança PARCELADA: trava e avisa --------------------------------------
  const P = await mensalidade("parcelado", { parcelado: true });
  await avisoDoPagamento(P, "DEBIT_CARD");
  conf("4: débito no parcelado trava, fora da fila, e avisa o Financeiro", (await fix(P))?.status === "parcelado_travado" && !(await naFila(P)) && (await aviso("debito_no_parcelado", P.ch)) === 1);
  await avisoDoSplit(P, repasse(sC, V, ...DEB));
  const exP = n((await um("select excess_cents from public.charge_splits where id = $1", [P.cs])).excess_cents);
  conf("4: não vira crédito sozinho; a marca de split a mais fica para a Conferência", !(await credito(P)) && exP > 10);

  // --- 5) cobrança ANTECIPADA: não tenta, o a mais vira crédito -------------------------------
  const T = await mensalidade("antecipada");
  await avisoDoPagamento(T, "DEBIT_CARD", { antecipada: true });
  conf("5: antecipada não entra na fila da correção", (await fix(T))?.status === "antecipada" && !(await naFila(T)));
  await avisoDoSplit(T, repasse(sC, V, ...DEB));
  conf("5: o a mais da antecipada vira crédito da unidade", n((await credito(T))?.amount_cents) > 0);

  // --- 6) o prazo e o erro de passagem --------------------------------------------------------
  const E = await mensalidade("erro");
  await avisoDoPagamento(E, "DEBIT_CARD");
  await um("select public._gateway_debit_fix_done($1, 'erro', '[]'::jsonb, '{}'::jsonb, 'network')", [E.ch]);
  const fE = await fix(E);
  conf("6: erro de passagem: continua na fila, tenta de novo em 10 minutos", fE.status === "pendente" && n(fE.attempts) === 1 && !(await naFila(E)));
  await c.query("update public.charge_debit_fixes set next_try_at = now() - interval '1 minute' where charge_id = $1", [E.ch]);
  conf("6: passados os 10 minutos, volta para a fila", !!(await naFila(E)));
  const D = await mensalidade("prazo");
  await avisoDoPagamento(D, "DEBIT_CARD", { credito: hoje });
  await naFila(D);
  conf("6: no dia do crédito, sai da fila (o crédito cobre)", (await fix(D))?.status === "prazo");

  // --- 8) o aviso sem a marca de débito, com o valor líquido do débito ------------------------
  const V8 = await mensalidade("so_valor");
  await avisoDoPagamento(V8, "CREDIT_CARD", { liquidoDe: "DEBIT_CARD" });
  const c8 = await um("select paid_billing_type, paid_debit_signal from public.charges where id = $1", [V8.ch]);
  conf("8: só o valor líquido diz débito: marcado como débito, com a discordância", c8.paid_billing_type === "DEBIT_CARD" && c8.paid_debit_signal === "divergente_valor");
  const t8 = await um("select amount_cents from public.financial_entries where source_type = 'gateway_fee_charge' and source_id = $1", [V8.ch]);
  conf("8: a tarifa da baixa é a cobrada (a do débito)", n(t8?.amount_cents) === 1919);
  conf("8: NÃO corrige sozinho (fora da fila) e avisa o Financeiro",
    (await fix(V8))?.status === "divergente" && !(await naFila(V8)) && (await aviso("debito_divergente", V8.ch)) === 1);
  await avisoDoSplit(V8, repasse(sC, V, ...DEB));
  const ex8 = n((await um("select excess_cents from public.charge_splits where id = $1", [V8.cs])).excess_cents);
  conf("8: não vira crédito sozinho; o split a mais fica marcado para a Conferência", !(await credito(V8)) && ex8 > 10);

  // --- 9) o aviso diz débito, o valor líquido é o do crédito ----------------------------------
  const V9 = await mensalidade("so_aviso");
  await avisoDoPagamento(V9, "DEBIT_CARD", { liquidoDe: "CREDIT_CARD" });
  const c9 = await um("select paid_debit_signal from public.charges where id = $1", [V9.ch]);
  conf("9: o aviso diz débito e o valor diz crédito: discordância, sem correção, com aviso",
    c9.paid_debit_signal === "divergente_aviso" && (await fix(V9))?.status === "divergente" && !(await naFila(V9)) && (await aviso("debito_divergente", V9.ch)) === 1);

  // --- 7) a cobrança mensal: o crédito entra, é usado e acumula --------------------------------
  const OUT = "2026-10-01";
  await c.query("update public.franchise_billing_settings set fine_percent = 2, interest_percent_month = 1, due_day = 10, period_kind = 'mes_calendario', preview_days = 5, partial_month_rule = 'proporcional', example_values = true where id");
  await c.query(`insert into public.franchise_billing_unit_settings (clinic_id, finance_email, monthly_from, started_on, example_values)
                 values ($1, 'fin@example.com', $2, '2026-09-01', true)
                 on conflict (clinic_id) do update set monthly_from = excluded.monthly_from, started_on = excluded.started_on`, [ldn, OUT]);
  await c.query("update public.network_fees set amount_cents = case fee when 'sistema' then 30000 else 50000 end where clinic_id is null and fee in ('sistema', 'sdr')");
  await c.query("update public.franchise_monthly_batches set status = 'cancelada' where clinic_id = $1", [ldn]);
  await c.query("update public.fiscal_periods set status = 'open' where year = 2026 and month between 9 and 10");
  await c.query("update public.split_excess_credits set origin_month = $2 where charge_id = any($1)", [[B.ch, T.ch], OUT]);
  const xT = await credito(T);

  // 7a) maior que a cobrança: acumula (nada é usado).
  await c.query("update public.split_excess_credits set amount_cents = 10000000 where id = $1", [xT.id]);
  const b0 = (await um("select public._franchise_monthly_build($1, $2, null) id", [ldn, OUT])).id;
  const lote0 = await um("select status, total_cents from public.franchise_monthly_batches where id = $1", [b0]);
  const it0 = await todos("select * from public.franchise_monthly_items where batch_id = $1 and split_excess_credit_id is not null", [b0]);
  conf(`7: crédito maior que a cobrança: a cobrança acumula para o mês seguinte (${lote0.status}, ${n(lote0.total_cents)})`, lote0.status === "acumulada" && n(lote0.total_cents) < 0 && it0.length === 2);
  conf("7: o item diz o motivo: \"Crédito — split a mais no débito\"", it0.every((i) => i.kind === "credito" && i.description === "Crédito — split a mais no débito" && n(i.amount_cents) < 0));
  conf("7: nada do crédito foi usado", n((await um("select used_cents from public.split_excess_credits where id = $1", [xT.id])).used_cents) === 0);

  // 7b) o valor de verdade: entra, a cobrança é paga, o crédito é usado.
  await c.query("update public.franchise_monthly_batches set status = 'cancelada' where id = $1", [b0]);
  await c.query("update public.split_excess_credits set amount_cents = $2 where id = $1", [xT.id, n(xT.amount_cents)]);
  const b1 = (await um("select public._franchise_monthly_build($1, $2, null) id", [ldn, OUT])).id;
  const lote1 = await um("select status, total_cents from public.franchise_monthly_batches where id = $1", [b1]);
  const creditos = n(xB.amount_cents) + n(xT.amount_cents);
  const it1 = await todos("select * from public.franchise_monthly_items where batch_id = $1 and split_excess_credit_id is not null", [b1]);
  conf(`7: os dois créditos entram na cobrança de outubro (−${creditos})`, it1.length === 2 && -it1.reduce((s, i) => s + n(i.amount_cents), 0) === creditos && n(lote1.total_cents) > 0);
  await c.query("update public.franchise_monthly_batches set status = 'paga', paid_on = $2, paid_cents = total_cents, late_cents = 0 where id = $1", [b1, hoje]);
  await um("select public._franchise_monthly_settle($1) x", [b1]);
  const usados = await todos("select status, used_cents, amount_cents from public.split_excess_credits where id = any($1)", [[xB.id, xT.id]]);
  conf("7: na baixa, os créditos ficam \"creditados\"", usados.every((u) => u.status === "creditado" && n(u.used_cents) === n(u.amount_cents)));
  const lanc = await todos("select source_type, account_code, direction, sum(amount_cents)::bigint s from public.financial_entries where source_type like 'split_excess_%' and (source_id = any($1) or source_id in (select md5('split-excess-used:' || $2 || ':' || x)::uuid from unnest($1::text[]) x) or description like '%crédito do split a mais%') group by 1,2,3", [[xB.id, xT.id], b1]);
  const soma = (t) => lanc.filter((l) => l.source_type === t).reduce((s, l) => s + n(l.s), 0);
  conf(`7: razão do uso: o "a receber" da unidade zera (6.4.01: ${soma("split_excess_unit")} saída, ${soma("split_excess_used_unit")} entrada)`,
    soma("split_excess_unit") === creditos && soma("split_excess_used_unit") === creditos);
  conf("7: razão do uso: o \"a devolver\" da franqueadora zera (6.4.02)", soma("split_excess_hq") === creditos && soma("split_excess_used_hq") === creditos);
  conf("7: a taxa paga com o crédito: despesa da unidade e receita da franqueadora, sem caixa",
    soma("split_excess_comp_unit") === creditos && soma("split_excess_comp_hq") === creditos);
  const diverg = await todos("select kind, ref_id, amount_cents from public._franchise_reconcile_found($1)", [ldn]);
  conf("8: a Conferência mostra o split a mais do débito sem confirmação", diverg.some((d) => d.kind === "split_a_mais" && d.ref_id === V8.cs));
  conf(`7: a Conferência não acusa o crédito nem o caixa (${diverg.map((d) => d.kind).join(", ") || "nada"})`,
    !diverg.some((d) => d.kind === "caixa_diferente" || d.kind === "pago_diferente" || d.kind === "diferenca_do_mes"
      || (d.kind === "split_a_mais" && [xB.charge_split_id, xT.charge_split_id].includes(d.ref_id))));

  // --- a prontidão: a escolha da unidade ---------------------------------------------------------
  const rd = await todos("select item, ok from public._central_readiness_raw($1)", [ldn]);
  conf("prontidão: o item vira \"débito conferido\"", rd.some((x) => x.item === "debito_conferido") && !rd.some((x) => x.item === "debito_desabilitado"));
  await c.query("update public.gateway_accounts set debit_disabled_declared_at = null, debit_enabled_declared_at = now() where id = $1", [conta.id]);
  conf("prontidão: \"habilitado\" também conta como conferido", (await todos("select item, ok from public._central_readiness_raw($1)", [ldn])).find((x) => x.item === "debito_conferido")?.ok === true);
  await c.query("update public.gateway_accounts set debit_enabled_declared_at = null where id = $1", [conta.id]);
  conf("prontidão: sem nenhuma marca, falta", (await todos("select item, ok from public._central_readiness_raw($1)", [ldn])).find((x) => x.item === "debito_conferido")?.ok === false);
} catch (e) {
  falha.push(`o ensaio parou: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`Ensaio da 4026${Q ? ` (quebrando: ${Q})` : ""} — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log(`  ✗ ${f}`);
console.log("Nada ficou gravado (transação desfeita).");
process.exit(falha.length ? 1 : 0);
