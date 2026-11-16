// ENSAIO DA 4021 (ASA6 — a cobrança mensal às unidades) no banco de TREINO, numa
// transação DESFEITA (rollback). O Asaas não é chamado: a emissão e o aviso do
// pagamento são simulados pelas mesmas portas que o servidor e o webhook usam.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa6-cobranca-mensal.mjs --confirmar [--quebrar=dobro|fora|reter|baixa]
//
// PROVADO QUEBRANDO (20.8):
//   `dobro` = a mesma linha faturada duas vezes (o que já foi faturado é ignorado);
//   `fora`  = uma linha "a cobrar" que não entra (o estorno fica de fora);
//   `reter` = o "a reter" do cartão parcelado faturado;
//   `baixa` = o pagamento sem liquidar as contas a pagar da unidade.
// Cada um tem de reprovar.
//
// Os valores da configuração aqui são EXEMPLO (marcados), só dentro do ensaio.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4021_asa6_cobranca_mensal_das_unidades.sql";
const QUEBRAR = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, valor) => (valor ? ok : falha).push(nome);
const um = async (sql, params = []) => (await c.query(sql, params)).rows[0];
const todos = async (sql, params = []) => (await c.query(sql, params)).rows;
async function como(userId) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await c.query("set local role authenticated");
}
async function comoServidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}
async function pessoa(userId, sql, params = []) {
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
    return `erro: ${e.message}`;
  }
}
const DEBUG = process.env.ENSAIO_DEBUG === "1";
const erro = (r, ...k) => {
  const v = typeof r === "string" && k.some((x) => r.includes(x));
  if (DEBUG && !v) console.log("   [debug erro esperado", k.join("|"), "→", typeof r === "string" ? r : JSON.stringify(r).slice(0, 200), "]");
  return v;
};
const passou = (r) => {
  if (DEBUG && !Array.isArray(r)) console.log("   [debug falhou →", r, "]");
  return Array.isArray(r);
};
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const n = (x) => Number(x ?? 0);

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query("savepoint dup");
  try {
    await c.query(sql);
    await c.query("release savepoint dup");
    conf("a 4021 roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4021 roda duas vezes sem erro (${e.message})`, false);
  }
  const trocar = async (assinatura, de, para) => {
    const f = await um(`select pg_get_functiondef('${assinatura}'::regprocedure) d`);
    if (!f.d.includes(de)) throw new Error(`QUEBRA: trecho não achado em ${assinatura}`);
    await c.query(f.d.replace(de, para));
  };
  if (QUEBRAR === "dobro") {
    await trocar("public._franchise_monthly_build(uuid, date, uuid)", "    v_inv := public._franchise_invoiced_line(r.id, v_batch);", "    v_inv := 0;");
    console.log("   (QUEBRADO de propósito: o já faturado é ignorado — a linha entra de novo)");
  } else if (QUEBRAR === "fora") {
    await trocar("public._franchise_monthly_build(uuid, date, uuid)", "     order by sc.period_month, sc.created_at, t.sort_order", "       and not sc.kept_after_refund\n     order by sc.period_month, sc.created_at, t.sort_order");
    console.log("   (QUEBRADO de propósito: a linha do estorno fica de fora)");
  } else if (QUEBRAR === "reter") {
    await trocar("public._franchise_line_due(uuid)", "else greatest(sc.amount_cents - sc.retained_cents, 0) end", "else sc.amount_cents end");
    console.log("   (QUEBRADO de propósito: o retido e o a reter entram na cobrança)");
  } else if (QUEBRAR === "baixa") {
    await trocar("public._franchise_monthly_event(uuid, text, jsonb)", "      perform public._franchise_monthly_settle(b.id);", "      null;");
    console.log("   (QUEBRADO de propósito: o pagamento não liquida as contas a pagar)");
  }

  // --- as pessoas ---------------------------------------------------------------
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "recepcao", "consultor"]) {
    P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
  }
  for (const k of ["admin", "gerente", "financeiro", "recepcao", "consultor"]) if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const U = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'")).id;
  const CAMBE = (await um("select id from public.clinics where name = 'Risarte Cambé - Centro'")).id;
  const TESTE = (await um("select id from public.clinics where name = 'Risarte Unidade Teste'")).id;
  const ROOT = (await um("select public._franchise_root_account() id")).id;
  const HQ = (await um("select public._franchise_hq() id")).id;
  const FUNDO_ACC = (await um("select id from public.gateway_accounts where label = 'Fundo de Propaganda Teste'"))?.id;
  if (!ROOT) throw new Error("NÃO MEDI: o treino não tem a conta da franqueadora ativa.");
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("financeiro", franq, "finance_franchisor");
  await papel("gerente", U, "unit_manager");
  await papel("recepcao", U, "receptionist");
  await papel("consultor", U, "dentist");
  const hoje = iso((await um("select public.today_br() d")).d);
  const SET = "2026-09-01";
  const OUT = "2026-10-01";
  const AGO = "2026-08-01";
  if (hoje < "2026-11-01") throw new Error("NÃO MEDI: o ensaio usa setembro e outubro de 2026 como meses fechados.");

  // A unidade sem linhas próprias antigas (as de novembro não entram: o mês está aberto).
  await c.query("update public.split_charges set reversed = true where clinic_id = any($1) and period_month < $2", [[U, CAMBE, TESTE], "2026-11-01"]);
  // As cobranças mensais que a prova do sandbox deixou no treino (exemplo) saem do caminho.
  await c.query("update public.franchise_monthly_batches set status = 'cancelada' where clinic_id = any($1)", [[U, CAMBE, TESTE]]);
  // Os meses do ensaio começam abertos (o treino tem setembro e outubro fechados);
  // o mês fechado é provado na parte 7.
  await c.query("update public.fiscal_periods set status = 'open' where clinic_id = any($1) and year = 2026 and month between 8 and 10", [[U, franq, HQ, CAMBE, TESTE]]);

  // --- 1) a configuração nasce em branco e trava tudo --------------------------
  const cfg0 = await um("select missing from public._franchise_billing_cfg($1)", [U]);
  conf(`em branco, falta tudo (${cfg0.missing.length} itens)`, cfg0.missing.includes("Multa por atraso (%)") && cfg0.missing.includes("Taxas fixas no mês incompleto")
    && cfg0.missing.includes("E-mail financeiro da unidade") && cfg0.missing.includes("Primeiro mês da cobrança mensal"));
  conf("sem a configuração, a prévia não abre", erro(await pessoa(P.financeiro, "select public.franchise_monthly_open($1, $2)", [U, SET]), "CONFIG_MISSING"));
  conf("o Gerente não configura a rede", erro(await pessoa(P.gerente, "select public.franchise_billing_settings_save('{}'::jsonb)"), "NOT_ALLOWED"));

  // Valores de EXEMPLO (marcados), só no ensaio.
  const rede = { fine_percent: "2", interest_percent_month: "1", due_day: "10", period_kind: "mes_calendario", preview_days: "5",
    partial_month_rule: "proporcional", example_values: true };
  conf("o Financeiro configura a rede", passou(await pessoa(P.financeiro, "select public.franchise_billing_settings_save($1::jsonb)", [JSON.stringify(rede)])));
  const uni = { finance_email: "financeiro.londrina@example.com", monthly_from: SET, started_on: "2026-09-16", example_values: true };
  conf("o Financeiro configura a unidade", passou(await pessoa(P.financeiro, "select public.franchise_billing_unit_save($1, $2::jsonb)", [U, JSON.stringify(uni)])));
  const cfg1 = await um("select missing from public._franchise_billing_cfg($1)", [U]);
  conf(`sem o valor de SDR e de tecnologia, ainda falta (${cfg1.missing.join(", ")})`, cfg1.missing.some((x) => x.startsWith("Valor de")));
  await c.query("update public.network_fees set amount_cents = case fee when 'sistema' then 30000 else 50000 end where clinic_id is null and fee in ('sistema', 'sdr')");
  const cfg2 = await um("select missing from public._franchise_billing_cfg($1)", [U]);
  conf(`configuração completa (${cfg2.missing.join(", ") || "nada falta"})`, cfg2.missing.length === 0);

  // --- 2) as linhas do mês ------------------------------------------------------
  const linha = async (fee, period, amount, extra = {}) =>
    (await um(`insert into public.split_charges (clinic_id, source_type, source_id, fee, percent, base_cents, amount_cents, period_month,
                 retained_cents, kept_after_refund, charge_id, waived_at, waived_reason)
               values ($1, 'ortho_charge', gen_random_uuid(), $2, 6, $3 * 100 / 6, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [U, fee, amount, period, extra.retido ?? 0, extra.estorno ?? false, extra.charge ?? null, extra.dispensada ? new Date() : null,
       extra.dispensada ? "dispensa de teste" : null])).id;
  const L = {};
  L.ago = await linha("royalty", AGO, 10000);
  L.a = await linha("royalty", SET, 6000);
  L.b = await linha("fundo", SET, 2000);
  L.retida = await linha("royalty", SET, 9000, { retido: 9000 });
  const ch0 = (await um("select id from public.charges where clinic_id = $1 order by created_at limit 1", [U])).id;
  L.reter = await linha("comercial", SET, 12000, { retido: 12000, charge: ch0 });
  await c.query(`insert into public.charge_splits (charge_id, destination_account_id, wallet_id, percent, percentual_value, fixed_cents, fees, tariff_percent, tariff_fixed_cents, status)
                 values ($1, $2, 'carteira-ensaio-4021', 6, 6, 0, '{"comercial": 6}'::jsonb, 0, 0, 'enviado')`, [ch0, ROOT]);
  L.dispensada = await linha("planejamento", SET, 3000, { dispensada: true });
  conf("o \"a reter\" está mesmo à espera do crédito", (await um("select public._split_charge_awaiting($1) v", [L.reter])).v === true);
  for (const [fee, per] of [["royalty", AGO], ["royalty", SET], ["fundo", SET], ["comercial", SET], ["planejamento", SET]]) {
    await c.query("select public.refresh_network_fee_payable($1, $2, $3)", [U, fee, per]);
  }
  // A taxa fixa de agosto (antes do início das atividades, 16/09) é zero.
  await c.query("select public.refresh_network_fee_payable($1, 'sistema', $2)", [U, AGO]);
  conf("a taxa fixa antes do início das atividades é zero", !(await um("select 1 x from public.payables where clinic_id = $1 and network_fee = 'sistema' and fee_period = $2 and status <> 'cancelada'", [U, AGO])));

  // --- 3) a prévia de setembro --------------------------------------------------
  conf("o Gerente não abre a prévia", erro(await pessoa(P.gerente, "select public.franchise_monthly_open($1, $2)", [U, SET]), "NOT_ALLOWED"));
  const abre = await pessoa(P.financeiro, "select public.franchise_monthly_open($1, $2) id", [U, SET]);
  conf("o Financeiro abre a prévia de setembro", passou(abre));
  const B1 = abre[0]?.id;
  const itens1 = await todos("select * from public.franchise_monthly_items where batch_id = $1", [B1]);
  const tot1 = itens1.reduce((s, i) => s + n(i.amount_cents), 0);
  const fixa = (fee) => itens1.find((i) => i.kind === "fixa" && i.fee === fee);
  conf(`tecnologia proporcional aos dias: 15 de 30 dias = R$ 150,00 (${n(fixa("sistema")?.amount_cents)})`, n(fixa("sistema")?.amount_cents) === 15000);
  conf(`SDR proporcional: R$ 250,00 (${n(fixa("sdr")?.amount_cents)})`, n(fixa("sdr")?.amount_cents) === 25000);
  conf("as duas linhas \"a cobrar\" entram, com a origem", itens1.filter((i) => i.kind === "percentual").length === 2
    && itens1.some((i) => i.split_charge_id === L.a && i.origin_label === "Mensalidade da Ortodontia"));
  conf("a linha retida pelo split não entra", !itens1.some((i) => i.split_charge_id === L.retida));
  conf("o \"a reter\" (cartão parcelado) não entra", !itens1.some((i) => i.split_charge_id === L.reter));
  conf("a linha dispensada não entra", !itens1.some((i) => i.split_charge_id === L.dispensada));
  conf("o saldo anterior (agosto) não entra sozinho", !itens1.some((i) => i.origin_period && iso(i.origin_period) < SET));
  conf(`o total de setembro: R$ 480,00 (${tot1})`, tot1 === 48000);
  conf("a unidade foi avisada da abertura, com o prazo", !!(await um(`select 1 x from public.notifications where user_id = $1 and title like 'Cobrança mensal da rede: confira a prévia%' and body like '%segue para aprovação e é emitida%'`, [P.gerente])));
  conf("a mesma prévia não abre duas vezes", erro(await pessoa(P.financeiro, "select public.franchise_monthly_open($1, $2)", [U, SET]), "BATCH_EXISTS"));

  // Quem vê.
  conf("o Gerente lê a prévia da sua unidade", passou(await pessoa(P.gerente, "select public.franchise_monthly_read($1) j", [B1])));
  conf("o Dentista não lê a prévia", erro(await pessoa(P.consultor, "select public.franchise_monthly_read($1)", [B1]), "NOT_ALLOWED"));
  conf("a Recepção não lê a prévia", erro(await pessoa(P.recepcao, "select public.franchise_monthly_read($1)", [B1]), "NOT_ALLOWED"));
  conf("a lista do Dentista vem vazia", ((await pessoa(P.consultor, "select public.franchise_monthly_list() j"))?.[0]?.j ?? [1]).length === 0);
  const leitura = (await pessoa(P.gerente, "select public.franchise_monthly_read($1) j", [B1]))[0]?.j;
  conf("a tela da unidade diz o prazo e o que acontece no silêncio", String(leitura?.notice ?? "").includes("segue para aprovação e é emitida"));
  conf(`o informativo mostra o retido e o a reter (${JSON.stringify(leitura?.info)})`, n(leitura?.info?.retido_cents) === 9000 && n(leitura?.info?.a_reter_cents) === 12000);

  // --- 4) contestação na prévia -------------------------------------------------
  const itB = itens1.find((i) => i.split_charge_id === L.b);
  const itA = itens1.find((i) => i.split_charge_id === L.a);
  conf("o aprovar antes do prazo, sem a unidade conferir, é recusado", erro(await pessoa(P.financeiro, "select public.franchise_monthly_approve($1)", [B1]), "PREVIEW_OPEN"));
  conf("o Dentista não contesta", erro(await pessoa(P.consultor, "select public.franchise_monthly_contest($1, 'motivo qualquer')", [itB.id]), "NOT_ALLOWED"));
  conf("a contestação exige motivo", erro(await pessoa(P.gerente, "select public.franchise_monthly_contest($1, 'x')", [itB.id]), "REASON_REQUIRED"));
  conf("o Gerente contesta a linha do fundo", passou(await pessoa(P.gerente, "select public.franchise_monthly_contest($1, 'O paciente pagou em outubro')", [itB.id])));
  conf("com contestação aberta, a unidade não confere", erro(await pessoa(P.gerente, "select public.franchise_monthly_ack($1)", [B1]), "OPEN_CONTEST"));
  conf("o Gerente não decide a contestação", erro(await pessoa(P.gerente, "select public.franchise_monthly_decide($1, true, 'aceito sim')", [itB.id]), "NOT_ALLOWED"));
  conf("o Financeiro aceita: a linha é dispensada", passou(await pessoa(P.financeiro, "select public.franchise_monthly_decide($1, true, 'Comprovante conferido')", [itB.id])));
  conf("a linha aceita fica dispensada e a taxa dela também", (await um("select status from public.franchise_monthly_items where id = $1", [itB.id])).status === "dispensado"
    && !!(await um("select waived_at from public.split_charges where id = $1", [L.b])).waived_at);
  conf("a conta a pagar do fundo de setembro some", !(await um("select 1 x from public.payables where clinic_id = $1 and network_fee = 'fundo' and fee_period = $2 and status <> 'cancelada'", [U, SET])));
  conf("o Gerente contesta outra linha", passou(await pessoa(P.gerente, "select public.franchise_monthly_contest($1, 'Valor parece alto')", [itA.id])));
  conf("o Financeiro recusa, com motivo", passou(await pessoa(P.financeiro, "select public.franchise_monthly_decide($1, false, 'Valor confere com o recebido')", [itA.id])));
  conf("a recusada volta a valer", (await um("select status, decision from public.franchise_monthly_items where id = $1", [itA.id])).status === "ativo");
  conf("o Gerente confere: está de acordo", passou(await pessoa(P.gerente, "select public.franchise_monthly_ack($1)", [B1])));

  // --- 5) aprovação e emissão (simulada pelas portas do servidor) ----------------
  conf("o Gerente não aprova", erro(await pessoa(P.gerente, "select public.franchise_monthly_approve($1)", [B1]), "NOT_ALLOWED"));
  const ap1 = (await pessoa(P.financeiro, "select public.franchise_monthly_approve($1) j", [B1]))?.[0]?.j;
  conf(`o Financeiro aprova: R$ 460,00 (${JSON.stringify(ap1)})`, ap1?.status === "aprovada" && n(ap1?.total_cents) === 46000);
  const CH1 = ap1?.charge_id;
  const ch1 = await um("select * from public.charges where id = $1", [CH1]);
  conf("a cobrança sai pela conta da franqueadora, com a unidade como pagadora", ch1.gateway_account_id === ROOT && ch1.payer_kind === "unit"
    && ch1.clinic_id !== U && ch1.status === "emitindo" && ch1.source_type === "franchise_monthly");
  conf("boleto (com Pix), sem desconto, com a multa e os juros", ch1.billing_type === "BOLETO" && n(ch1.discount_cents) === 0 && n(ch1.fine_cents) === 920 && Number(ch1.interest_percent) === 1);
  conf(`o vencimento: o dia 10 do mês seguinte, ou amanhã se já passou (${iso(ch1.due_date)})`, iso(ch1.due_date) >= hoje);
  const leg = await um("select * from public._charge_for_gateway($1)", [CH1]);
  conf(`o pagador é a razão social e o CNPJ da unidade (${leg.payer_cpf})`, leg.payer_cpf === "32042156000121" && !!leg.payer_name);
  const pay1 = await um("select public._franchise_monthly_payer($1) j", [CH1]);
  conf("o e-mail financeiro vai para o cadastro do pagador", pay1.j.email === "financeiro.londrina@example.com");
  await c.query("select public._charge_mark_issued($1, 'pay_ensaio_4021_set', null, 'https://sandbox.asaas.com/i/ensaio', null, null, '0000')", [CH1]);
  conf("emitida: o lote acompanha", (await um("select status from public.franchise_monthly_batches where id = $1", [B1])).status === "emitida");
  conf("o Gerente é avisado da emissão", !!(await um("select 1 x from public.notifications where user_id = $1 and title = 'Cobrança mensal da rede emitida'", [P.gerente])));
  conf("a cobrança emitida não aparece para a Recepção da unidade", (await pessoa(P.recepcao, "select count(*) n from public.charges where id = $1", [CH1]))?.[0]?.n === "0");

  // --- 6) o pagamento pelo aviso do Asaas (com multa e juros) --------------------
  const evento = async (ev, payId, extra) => {
    const e = await um(`insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload)
                         values ($1, $2, $3, $4::jsonb) returning id`,
      [ROOT, `evt_${ev}_${payId}_${Math.random()}`, ev, JSON.stringify({ payment: { id: payId, externalReference: extra.ref, ...extra.p } })]);
    return (await um("select public._gateway_apply_event($1) r", [e.id])).r;
  };
  const r1 = await evento("PAYMENT_RECEIVED", "pay_ensaio_4021_set", { ref: CH1, p: { value: 470.0, netValue: 468.01, paymentDate: hoje, creditDate: hoje } });
  conf(`o aviso de pagamento dá a baixa (${r1})`, r1 === "baixa");
  const b1p = await um("select * from public.franchise_monthly_batches where id = $1", [B1]);
  conf(`o lote fica pago, com multa e juros de R$ 10,00 (${b1p.late_cents})`, b1p.status === "paga" && n(b1p.late_cents) === 1000);
  const pagas = await todos(`select network_fee, status, paid_amount_cents from public.payables where clinic_id = $1 and fee_period = $2 and network_fee in ('sistema', 'sdr', 'royalty')`, [U, SET]);
  conf(`as contas a pagar de taxa de setembro ficam pagas (${pagas.map((x) => x.network_fee + ":" + x.status).join(", ")})`, pagas.length === 3 && pagas.every((x) => x.status === "paga"));
  const caixa1 = await um(`select coalesce(sum(f.amount_cents), 0) s from public.financial_entries f join public.payable_payments pp on pp.id = f.source_id
                           where f.source_type = 'payable_cash' and pp.reference = 'Cobrança mensal da rede 09/2026' and pp.created_at = now()`);
  conf(`o caixa da unidade sai pelo total faturado (${caixa1.s})`, n(caixa1.s) === 46000);
  const rec1 = await um(`select coalesce(sum(f.amount_cents), 0) s, count(*) filter (where f.clinic_id <> $1) fora from public.financial_entries f
                           join public.payable_payments pp on pp.id = f.source_id
                          where f.source_type = 'receipt_cash' and pp.reference = 'Cobrança mensal da rede 09/2026' and pp.created_at = now()`, [HQ]);
  conf(`o caixa da franqueadora entra pelo total, só como caixa (${rec1.s})`, n(rec1.s) === 46000 && n(rec1.fora) === 0);
  conf("a receita da franqueadora por competência continua no lançamento do mês",
    n((await um(`select count(*) n from public.financial_entries f join public.payables p on p.id = f.source_id
                 where f.source_type = 'network_fee_revenue' and p.clinic_id = $1 and p.fee_period = $2 and f.status = 'open'`, [U, SET])).n) >= 3);
  const multa = await todos("select clinic_id, account_code, direction, amount_cents from public.financial_entries where source_id = $1 and source_type like 'franchise_monthly_late_%'", [B1]);
  conf("multa e juros: despesa financeira da unidade e receita financeira da franqueadora, sem taxa sobre taxa",
    multa.length === 2 && multa.some((x) => x.clinic_id === U && x.account_code === "4.2.01") && multa.some((x) => x.clinic_id === HQ && x.account_code === "4.1.01")
    && !(await um("select 1 x from public.split_charges where clinic_id = $1 and created_at > now() - interval '1 minute' and base_cents = 1000", [U])));
  conf("a tarifa do Asaas é da franqueadora", !!(await um("select 1 x from public.financial_entries where source_type = 'gateway_fee_charge' and source_id = $1 and clinic_id = $2 and account_code = '2.4.02'", [CH1, HQ])));
  conf("o mesmo aviso de novo não baixa duas vezes", (await evento("PAYMENT_RECEIVED", "pay_ensaio_4021_set", { ref: CH1, p: { value: 470.0, netValue: 468.01, paymentDate: hoje } })) !== "baixa"
    && n((await um("select count(*) n from public.payable_payments where reference = 'Cobrança mensal da rede 09/2026' and created_at = now()")).n) === 3);
  conf("a cobrança paga não se cancela", erro(await pessoa(P.financeiro, "select public.franchise_monthly_cancel_check($1)", [B1]), "BATCH_NOT_CANCELLABLE"));

  // --- 7) o que chega depois do fechamento da cobrança de setembro (4a: entra em outubro)
  L.estorno = await linha("royalty", SET, 4000, { estorno: true });
  await c.query("update public.split_charges set reversed = true where id = $1", [L.a]); // a linha de setembro desfeita depois
  await c.query("select public.refresh_network_fee_payable($1, 'royalty', $2)", [U, SET]);

  // Depois da emissão: a contestação aceita vira crédito no mês seguinte. Setembro
  // já FECHADO na contabilidade: a dispensa entra no mês aberto (6b).
  await c.query("update public.fiscal_periods set status = 'closed' where clinic_id = any($1) and year = 2026 and month = 9", [[U, HQ]]);
  await c.query(`insert into public.fiscal_periods (clinic_id, year, month, status) select x, 2026, 9, 'closed' from unnest($1::uuid[]) x
                 where not exists (select 1 from public.fiscal_periods p where p.clinic_id = x and p.year = 2026 and p.month = 9)`, [[U, HQ]]);
  const itSdr = itens1.find((i) => i.kind === "fixa" && i.fee === "sdr");
  conf("o Gerente contesta o SDR depois de pago", passou(await pessoa(P.gerente, "select public.franchise_monthly_contest($1, 'A SDR não trabalhou em setembro')", [itSdr.id])));
  conf("o Financeiro aceita (setembro fechado)", passou(await pessoa(P.financeiro, "select public.franchise_monthly_decide($1, true, 'Confirmado com a rede')", [itSdr.id])));
  conf("o boleto emitido não muda", n((await um("select value_cents from public.charges where id = $1", [CH1])).value_cents) === 46000);
  const adj = await um("select * from public.franchise_accrual_adjustments where item_id = $1", [itSdr.id]);
  const adjE = await todos("select clinic_id, account_code, direction, status, accrual_date from public.financial_entries where id = any($1)", [[adj?.unit_entry_id, adj?.hq_entry_id]]);
  conf(`mês fechado: a dispensa de −R$ 250,00 entra no mês aberto, nos dois lados (${adj?.amount_cents})`, n(adj?.amount_cents) === -25000 && adjE.length === 2
    && adjE.every((x) => iso(x.accrual_date) >= "2026-11-01") && adjE.some((x) => x.clinic_id === U && x.direction === "inflow" && x.account_code === "2.6.06")
    && adjE.some((x) => x.clinic_id === HQ && x.direction === "outflow" && x.account_code === "1.3.07" && x.status === "open"));
  conf("o mês fechado não foi mexido", (await um(`select f.status from public.financial_entries f join public.payables p on p.id = f.source_id
      where f.source_type = 'payable_accrual' and p.clinic_id = $1 and p.network_fee = 'sdr' and p.fee_period = $2`, [U, SET]))?.status === "open");
  L.out = await linha("royalty", OUT, 50000);
  L.outFundo = await linha("fundo", OUT, 2000);
  await c.query("select public.refresh_network_fee_payable($1, 'royalty', $2)", [U, OUT]);
  await c.query("select public.refresh_network_fee_payable($1, 'fundo', $2)", [U, OUT]);

  // --- 8) o saldo anterior: decisão por unidade --------------------------------
  const sa = (await pessoa(P.financeiro, "select public.franchise_prior_balance_read($1) j", [U]))?.[0]?.j;
  const T = (sa?.lines ?? []).reduce((s, x) => s + n(x.open_cents), 0);
  conf(`o saldo anterior aparece em separado (agosto, R$ ${T / 100})`, (sa?.lines ?? []).some((x) => iso(x.period) === AGO) && T >= 10000);
  conf("o Gerente não decide o saldo anterior", erro(await pessoa(P.gerente, "select public.franchise_prior_balance_decide($1, 'dispensar', 1, 'motivo qualquer')", [U]), "NOT_ALLOWED"));
  conf("o Financeiro parcela em 2, com motivo", passou(await pessoa(P.financeiro, "select public.franchise_prior_balance_decide($1, 'parcelar', 2, 'Acordo com o franqueado')", [U])));
  conf("a decisão não se repete", erro(await pessoa(P.financeiro, "select public.franchise_prior_balance_decide($1, 'incluir', 1, 'outra vez')", [U]), "ALREADY_DECIDED"));

  // --- 9) a prévia de outubro, pela rotina do dia --------------------------------
  if (FUNDO_ACC) await c.query("update public.network_fee_types set split_account_id = $1 where key = 'fundo'", [FUNDO_ACC]);
  const rot = await um("select public._franchise_monthly_cron() j");
  const B2 = (await um("select id from public.franchise_monthly_batches where clinic_id = $1 and period = $2 and status <> 'cancelada'", [U, OUT]))?.id;
  conf(`a rotina abre a prévia de outubro (${JSON.stringify(rot.j)})`, !!B2);
  const itens2 = await todos("select * from public.franchise_monthly_items where batch_id = $1", [B2 ?? null]);
  const tot2 = itens2.reduce((s, i) => s + n(i.amount_cents), 0);
  const credito = itens2.find((i) => i.kind === "credito");
  conf(`o crédito do SDR aceito depois da emissão: −R$ 250,00, com a linha de origem (${credito?.amount_cents})`, n(credito?.amount_cents) === -25000 && credito?.credit_of_item_id === itSdr.id);
  conf("o estorno de setembro entra em outubro como ajuste", itens2.some((i) => i.kind === "ajuste" && i.split_charge_id === L.estorno && n(i.amount_cents) === 4000 && iso(i.origin_period) === SET));
  conf("a linha de setembro desfeita volta como ajuste negativo", itens2.some((i) => i.kind === "ajuste" && i.split_charge_id === L.a && n(i.amount_cents) === -6000));
  const parc = itens2.filter((i) => i.kind === "saldo_anterior").reduce((s, i) => s + n(i.amount_cents), 0);
  conf(`o saldo anterior entra na parcela 1 de 2 (${parc} de ${T})`, parc === Math.floor(T / 2));
  const esperado2 = 50000 + 2000 + 30000 + 50000 + 4000 - 6000 - 25000 + Math.floor(T / 2);
  conf(`o total de outubro (${tot2}, esperado ${esperado2})`, tot2 === esperado2);

  // F1: cada linha de taxa até outubro com exatamente o seu valor faturado — nem a mais, nem a menos.
  const f1 = await todos(`select sc.id, public._franchise_line_due(sc.id) due, public._franchise_invoiced_line(sc.id) inv
                            from public.split_charges sc where sc.clinic_id = $1 and sc.period_month between $2 and $3`, [U, SET, OUT]);
  const tortas = f1.filter((x) => n(x.due) !== n(x.inv));
  conf(`cada linha de taxa tem um dono só: faturado = devido (${tortas.length} fora)`, tortas.length === 0);
  const retidaFat = await um("select coalesce(sum(i.amount_cents), 0) s from public.franchise_monthly_items i where i.split_charge_id = any($1)", [[L.retida, L.reter]]);
  conf("o retido e o a reter nunca foram faturados", n(retidaFat.s) === 0);

  // --- 10) os avisos da janela -------------------------------------------------
  conf("o dia útil antes de uma segunda é a sexta", iso((await um("select public._franchise_prev_business_day('2026-11-23') d")).d) === "2026-11-20");
  const proxUtil = iso((await um("select public.add_business_days(public.today_br(), 1) d")).d);
  await c.query("update public.franchise_monthly_batches set preview_deadline = $2 where id = $1", [B2, proxUtil]);
  await c.query("select public._franchise_monthly_cron()");
  conf("1 dia útil antes do fim, a unidade é lembrada", !!(await um("select 1 x from public.franchise_monthly_notices where batch_id = $1 and kind = 'lembrete_prazo'", [B2])));
  await c.query("update public.franchise_monthly_batches set preview_deadline = public.today_br() - 1 where id = $1", [B2]);
  await c.query("select public._franchise_monthly_cron()");
  conf("no silêncio, a prévia vai para a aprovação do Financeiro", !!(await um("select 1 x from public.franchise_monthly_notices where batch_id = $1 and kind = 'pronta'", [B2])));
  conf("depois do prazo, a unidade não contesta mais a prévia", erro(await pessoa(P.gerente, "select public.franchise_monthly_contest($1, 'tarde demais')", [itens2.find((i) => n(i.amount_cents) > 0 && i.kind !== "saldo_anterior").id]), "PREVIEW_CLOSED"));

  // --- 11) outubro: aprovação (fundo por split), atraso, cancelamento e reemissão --
  const ap2 = (await pessoa(P.financeiro, "select public.franchise_monthly_approve($1) j", [B2]))?.[0]?.j;
  conf(`o silêncio aprovado: a cobrança de outubro sai (${ap2?.status})`, ap2?.status === "aprovada");
  if (FUNDO_ACC) {
    const sp = await um("select public._franchise_monthly_split_plan($1) j", [ap2?.charge_id]);
    conf(`o fundo com conta própria vai por split, valor fixo de R$ 20,00 (${JSON.stringify(sp.j)})`, n(sp.j?.[0]?.fixedCents) === 2000);
  }
  await c.query("select public._charge_mark_issued($1, 'pay_ensaio_4021_out', null, null, null, null, null)", [ap2.charge_id]);
  const rv = await evento("PAYMENT_OVERDUE", "pay_ensaio_4021_out", { ref: ap2.charge_id, p: {} });
  conf(`o aviso de vencida marca a cobrança (${rv})`, rv === "vencida");
  await c.query("update public.charges set due_date = public.today_br() - 31 where id = $1", [ap2.charge_id]);
  await c.query("select public._franchise_monthly_cron()");
  conf("em atraso: a unidade e o Financeiro avisados", !!(await um("select 1 x from public.franchise_monthly_notices where batch_id = $1 and kind = 'atraso'", [B2])));
  conf("aos 30 dias, o Admin Master", !!(await um("select 1 x from public.franchise_monthly_notices where batch_id = $1 and kind = 'atraso_30'", [B2])));
  conf("a de setembro não se cancela (já há outubro)", erro(await pessoa(P.financeiro, "select public.franchise_monthly_cancel_check($1)", [B1]), "BATCH_NOT_CANCELLABLE", "LATER_BATCH_EXISTS"));
  conf("a de outubro pode ser cancelada para reemitir", passou(await pessoa(P.financeiro, "select public.franchise_monthly_cancel_check($1)", [B2])));
  await c.query("select public._charge_mark_cancelled($1, $2, 'Reemitir com novo vencimento')", [ap2.charge_id, P.financeiro]);
  conf("cancelada no Asaas: o lote cai", (await um("select status from public.franchise_monthly_batches where id = $1", [B2])).status === "cancelada");
  await c.query("select public._franchise_monthly_cron()");
  const B3 = (await um("select id, total_cents from public.franchise_monthly_batches where clinic_id = $1 and period = $2 and status <> 'cancelada'", [U, OUT]));
  conf(`a rotina remonta outubro com as mesmas linhas (${B3?.total_cents})`, n(B3?.total_cents) === esperado2);
  await c.query("update public.franchise_monthly_batches set preview_deadline = public.today_br() - 1 where id = $1", [B3.id]);
  const ap3 = (await pessoa(P.financeiro, "select public.franchise_monthly_approve($1) j", [B3.id]))?.[0]?.j;
  await c.query("select public._charge_mark_issued($1, 'pay_ensaio_4021_out2', null, null, null, null, null)", [ap3.charge_id]);
  const r3 = await evento("PAYMENT_RECEIVED", "pay_ensaio_4021_out2", { ref: ap3.charge_id, p: { value: esperado2 / 100, netValue: esperado2 / 100 - 1.99, paymentDate: hoje } });
  conf(`outubro pago (${r3})`, r3 === "baixa");
  const comp = await um("select coalesce(sum(amount_cents), 0) s from public.payable_payments where reference = 'Cobrança mensal da rede 10/2026' and payment_method is null and created_at = now()");
  conf(`o crédito entra como compensação, sem saída de caixa (${comp.s})`, n(comp.s) === 31000);
  const caixa2 = await um(`select coalesce(sum(f.amount_cents), 0) s from public.financial_entries f join public.payable_payments pp on pp.id = f.source_id
                           where f.source_type = 'payable_cash' and pp.reference = 'Cobrança mensal da rede 10/2026' and pp.created_at = now()`);
  conf(`o caixa da unidade em outubro = o total do boleto (${caixa2.s})`, n(caixa2.s) === esperado2);
  const abertas = await todos(`select network_fee, fee_period, status from public.payables where clinic_id = $1 and fee_period = $2 and network_fee is not null and status not in ('paga', 'cancelada')`, [U, OUT]);
  conf(`as contas de outubro ficam pagas (${abertas.map((x) => x.network_fee + ":" + x.status).join(", ") || "todas"})`, abertas.length === 0);
  const rec2 = await um(`select coalesce(sum(f.amount_cents), 0) s from public.financial_entries f join public.payable_payments pp on pp.id = f.source_id
                          where f.source_type = 'receipt_cash' and pp.reference = 'Cobrança mensal da rede 10/2026' and pp.created_at = now()`);
  conf(`o caixa da franqueadora em outubro = o boleto (o crédito não é dinheiro) (${rec2.s})`, n(rec2.s) === esperado2);

  // --- 12) mês sem nada e valor abaixo do mínimo --------------------------------
  await c.query("update public.clinics set cnpj = '11.222.333/0001-81' where id = $1", [CAMBE]);
  await c.query("update public.clinics set cnpj = '11.444.777/0001-61' where id = $1", [TESTE]);
  for (const cl of [CAMBE, TESTE]) {
    await pessoa(P.financeiro, "select public.franchise_billing_unit_save($1, $2::jsonb)", [cl, JSON.stringify({ finance_email: "fin@example.com", monthly_from: OUT, example_values: true })]);
    for (const fee of ["sistema", "sdr"]) {
      await c.query("insert into public.network_fees (clinic_id, fee, kind, amount_cents, active) values ($1, $2, 'fixed', 0, false) on conflict (clinic_id, fee) do update set active = false", [cl, fee]);
    }
  }
  await c.query(`insert into public.split_charges (clinic_id, source_type, source_id, fee, percent, base_cents, amount_cents, period_month)
                 values ($1, 'ortho_charge', gen_random_uuid(), 'royalty', 6, 5000, 300, $2)`, [CAMBE, OUT]);
  await c.query("select public.refresh_network_fee_payable($1, 'royalty', $2)", [CAMBE, OUT]);
  const bc = (await pessoa(P.financeiro, "select public.franchise_monthly_open($1, $2) id", [CAMBE, OUT]))?.[0]?.id;
  conf("abaixo de R$ 5,00: acumula para o mês seguinte", (await um("select status from public.franchise_monthly_batches where id = $1", [bc])).status === "acumulada");
  const bc2 = (await pessoa(P.financeiro, "select public.franchise_monthly_rebuild($1, 'Conferir o acúmulo') id", [bc]))?.[0]?.id;
  conf("o acumulado não fica preso: volta a entrar na prévia seguinte", n((await um("select total_cents from public.franchise_monthly_batches where id = $1", [bc2])).total_cents) === 300);
  const bt = (await pessoa(P.financeiro, "select public.franchise_monthly_open($1, $2) id", [TESTE, OUT]))?.[0]?.id;
  conf("mês sem nada a cobrar: sem cobrança", (await um("select status from public.franchise_monthly_batches where id = $1", [bt])).status === "sem_cobranca"
    && !(await um("select charge_id from public.franchise_monthly_batches where id = $1", [bt])).charge_id);
  conf("o Gerente de Londrina não lê a prévia de Cambé", erro(await pessoa(P.gerente, "select public.franchise_monthly_read($1)", [bc2]), "NOT_ALLOWED"));

  // --- 13) a dispensa do saldo anterior ------------------------------------------
  const pbT = await um("select total_cents from public.franchise_prior_balance where clinic_id = $1", [U]);
  conf(`a fotografia do saldo anterior guarda o total (${pbT.total_cents})`, n(pbT.total_cents) === T);

  // --- 14) nenhuma regra de acesso chama função fechada --------------------------
  const fechadas = await todos(`
    select distinct p.tablename, p.policyname, f.proname
      from pg_policies p
      join pg_proc f on strpos(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), f.proname || '(') > 0
      join pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
     where not has_function_privilege('authenticated', f.oid, 'execute')`);
  conf(`nenhuma regra de acesso chama função fechada (${fechadas.map((x) => `${x.tablename}:${x.proname}`).join(", ") || "nenhuma"})`, fechadas.length === 0);
  conf("as tabelas novas não têm leitura direta", (await pessoa(P.gerente, "select count(*) n from public.franchise_monthly_items"))?.[0]?.n === "0");

  await c.query("rollback");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}

for (const x of ok) console.log(`  ok   ${x}`);
for (const x of falha) console.log(`  FALHA ${x}`);
console.log(`${ok.length}/${ok.length + falha.length}`);
if (falha.length) process.exitCode = 1;
