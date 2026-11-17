// ENSAIO DA 4021a (a CONFERÊNCIA DAS TAXAS, spec 20.17) no banco de TREINO, numa
// transação DESFEITA. O Asaas não é chamado (a emissão e o pagamento passam
// pelas mesmas portas do servidor e do webhook). Valores de configuração: EXEMPLO.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa6-conferencia.mjs --confirmar [--quebrar=dobro|fora|baixa|soma]
//
// PROVADO QUEBRANDO (20.17.4): cada conferência da rotina desligada tem de reprovar.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const Q = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, v) => (v ? ok : falha).push(nome);
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const todos = async (sql, p = []) => (await c.query(sql, p)).rows;
const n = (x) => Number(x ?? 0);
async function pessoa(userId, sql, params = []) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await c.query("set local role authenticated");
  await c.query("savepoint p");
  try {
    const r = (await c.query(sql, params)).rows;
    await c.query("release savepoint p");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint p");
    return `erro: ${e.message}`;
  } finally {
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claims', '', true)");
  }
}
const erro = (r, k) => typeof r === "string" && r.includes(k);

try {
  await c.query("begin");
  for (const arq of ["supabase/migrations/4021_asa6_cobranca_mensal_das_unidades.sql", "supabase/migrations/4021a_asa6_conferencia_das_taxas.sql"]) {
    await c.query(readFileSync(arq, "utf8"));
  }
  await c.query(readFileSync("supabase/migrations/4021a_asa6_conferencia_das_taxas.sql", "utf8"));
  conf("a 4021a roda duas vezes sem erro", true);
  const trocar = async (sig, de, para) => {
    const f = (await um(`select pg_get_functiondef('${sig}'::regprocedure) d`)).d;
    if (!f.includes(de)) throw new Error(`QUEBRA: trecho não achado em ${sig}`);
    await c.query(f.replace(de, para));
  };
  if (Q === "dobro") await trocar("public._franchise_reconcile_found(uuid)", "       where l.ainda < 0", "       where false");
  if (Q === "fora") await trocar("public._franchise_reconcile_found(uuid)", "         and public._franchise_line_due(sc.id) - public._franchise_invoiced_line(sc.id) > 0\n", "         and false\n");
  if (Q === "baixa") await trocar("public._franchise_reconcile_found(uuid)", "       and (b.settled_at is null or", "       and false and (b.settled_at is null or");
  if (Q === "soma") await trocar("public._franchise_month_account(uuid, date)", "s.retido + s.a_reter +", "s.a_reter +");
  if (Q) console.log(`   (QUEBRADO de propósito: ${Q})`);

  // --- as pessoas e o cenário (o mesmo da 4021: Londrina, setembro e outubro) ----
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "consultor"]) P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const U = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'")).id;
  const CAMBE = (await um("select id from public.clinics where name = 'Risarte Cambé - Centro'")).id;
  const HQ = (await um("select public._franchise_hq() id")).id;
  const ROOT = (await um("select public._franchise_root_account() id")).id;
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("financeiro", franq, "finance_franchisor");
  await papel("gerente", U, "unit_manager");
  await papel("consultor", U, "dentist");
  const hoje = String((await um("select public.today_br()::text d")).d);
  const SET = "2026-09-01";
  const OUT = "2026-10-01";
  await c.query("update public.franchise_monthly_batches set status = 'cancelada' where clinic_id = any($1)", [[U, CAMBE]]);
  await c.query("update public.split_charges set reversed = true where clinic_id = $1 and period_month < '2026-11-01'", [U]);
  await c.query("update public.fiscal_periods set status = 'open' where clinic_id = any($1) and year = 2026 and month between 8 and 10", [[U, franq, HQ]]);
  await c.query("update public.payables set status = 'cancelada' where clinic_id = $1 and network_fee is not null and fee_period between '2026-08-01' and '2026-10-01'", [U]);
  await c.query("delete from public.reconciliation_issues");
  await c.query("delete from public.reconciliation_runs");
  await c.query("update public.network_fees set amount_cents = case fee when 'sistema' then 30000 else 50000 end where clinic_id is null and fee in ('sistema', 'sdr')");
  await pessoa(P.financeiro, "select public.franchise_billing_settings_save($1::jsonb)", [JSON.stringify({ fine_percent: "2", interest_percent_month: "1", due_day: "10", period_kind: "mes_calendario", preview_days: "5", partial_month_rule: "cheio", example_values: true })]);
  await pessoa(P.financeiro, "select public.franchise_billing_unit_save($1, $2::jsonb)", [U, JSON.stringify({ finance_email: "financeiro.londrina@example.com", monthly_from: SET, example_values: true })]);

  const linha = async (fee, period, amount, extra = {}) =>
    (await um(`insert into public.split_charges (clinic_id, source_type, source_id, fee, percent, base_cents, amount_cents, period_month, retained_cents, charge_id, created_at)
               values ($1, 'ortho_charge', gen_random_uuid(), $2, 6, $3 * 100 / 6, $3, $4, $5, $6, coalesce($7, now())) returning id`,
      [U, fee, amount, period, extra.retido ?? 0, extra.charge ?? null, extra.criada ?? null])).id;
  const L = {};
  L.a = await linha("royalty", SET, 6000);
  L.retida = await linha("royalty", SET, 9000, { retido: 9000 });
  const ch0 = (await um("select id from public.charges where clinic_id = $1 order by created_at limit 1", [U])).id;
  L.reter = await linha("comercial", SET, 12000, { retido: 12000, charge: ch0 });
  await c.query(`insert into public.charge_splits (charge_id, destination_account_id, wallet_id, percent, percentual_value, fixed_cents, fees, tariff_percent, tariff_fixed_cents, status)
                 values ($1, $2, 'carteira-ensaio-4021a', 6, 6, 0, '{"comercial": 6}'::jsonb, 0, 0, 'enviado')`, [ch0, ROOT]);
  for (const f of ["royalty", "comercial"]) await c.query("select public.refresh_network_fee_payable($1, $2, $3)", [U, f, SET]);

  const evento = async (ev, payId, ref, p) => {
    const e = await um(`insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload) values ($1, $2, $3, $4::jsonb) returning id`,
      [ROOT, `evt_${ev}_${payId}_${Math.random()}`, ev, JSON.stringify({ payment: { id: payId, externalReference: ref, ...p } })]);
    return (await um("select public._gateway_apply_event($1) r", [e.id])).r;
  };
  const fechaMes = async (period, payId) => {
    const b = (await um("select id, total_cents from public.franchise_monthly_batches where clinic_id = $1 and period = $2 and status = 'previa'", [U, period]));
    await c.query("update public.franchise_monthly_batches set preview_deadline = public.today_br() - 1 where id = $1", [b.id]);
    const ap = (await pessoa(P.financeiro, "select public.franchise_monthly_approve($1) j", [b.id]))[0].j;
    await c.query("select public._charge_mark_issued($1, $2, null, null, null, null, null)", [ap.charge_id, payId]);
    await evento("PAYMENT_RECEIVED", payId, ap.charge_id, { value: n(ap.total_cents) / 100, netValue: n(ap.total_cents) / 100 - 1.99, paymentDate: hoje });
    return b.id;
  };
  // Setembro: aberto, pago. Outubro: o estorno de setembro, o crédito do SDR aceito depois, pago.
  const B1 = (await pessoa(P.financeiro, "select public.franchise_monthly_open($1, $2) id", [U, SET]))[0].id;
  await fechaMes(SET, "pay_4021a_set");
  const itSdr = (await um("select id from public.franchise_monthly_items where batch_id = $1 and kind = 'fixa' and fee = 'sdr'", [B1])).id;
  await pessoa(P.gerente, "select public.franchise_monthly_contest($1, 'A SDR não trabalhou')", [itSdr]);
  await pessoa(P.financeiro, "select public.franchise_monthly_decide($1, true, 'Confirmado com a rede')", [itSdr]);
  L.estorno = await linha("royalty", SET, 4000);
  L.out = await linha("royalty", OUT, 50000);
  await c.query("select public.refresh_network_fee_payable($1, 'royalty', $2)", [U, SET]);
  await c.query("select public.refresh_network_fee_payable($1, 'royalty', $2)", [U, OUT]);
  await c.query("select public._franchise_monthly_cron()");
  const B2 = await fechaMes(OUT, "pay_4021a_out");

  // --- 1) o mês limpo: zero divergência e a conta fecha em R$ 0,00 ------------------
  const r0 = (await um("select public._franchise_reconcile_run() j")).j;
  const abertas = await todos("select kind, period, amount_cents, detail from public.reconciliation_issues where status = 'aberta'");
  conf(`o mês limpo: zero divergência (${abertas.map((x) => x.kind + ":" + x.amount_cents).join(", ") || "nenhuma"})`, abertas.length === 0 && n(r0.novas) === 0);
  for (const per of [SET, OUT]) {
    const a = (await um("select public._franchise_month_account($1, $2) j", [U, per])).j;
    conf(`a conta de ${per.slice(5, 7)}/2026 fecha em R$ 0,00 (${JSON.stringify(a)})`, n(a.diferenca) === 0 && n(a.devido) > 0);
  }
  const aSet = (await um("select public._franchise_month_account($1, $2) j", [U, SET])).j;
  conf("setembro: o retido e o a reter aparecem na conta", n(aSet.retido) === 9000 && n(aSet.a_reter) === 12000);
  conf("sem divergência nova, nenhum resumo ao Financeiro", !(await um("select 1 x from public.notifications where title = 'Conferência das taxas: divergência nova'")));

  // --- 2) cada defeito plantado gera a divergência certa ----------------------------
  const tem = async (kind, ref) => !!(await um("select 1 x from public.reconciliation_issues where status = 'aberta' and kind = $1 and ($2::uuid is null or ref_id = $2)", [kind, ref ?? null]));
  // a) a linha cobrada duas vezes (um item a mais numa cobrança de outubro).
  const itA = await um("select * from public.franchise_monthly_items where split_charge_id = $1 limit 1", [L.a]);
  await c.query(`insert into public.franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, split_charge_id, amount_cents, description)
                 values ($1, $2, 'ajuste', 'royalty', $3, $4, 6000, 'plantado: em dobro')`, [B2, U, SET, L.a]);
  // b) a linha de fora: nascida antes da prévia de outubro abrir, e não faturada.
  L.fora = await linha("royalty", OUT, 3000, { criada: "2026-11-01T12:00:00Z" });
  // c) o "a reter" cobrado.
  await c.query(`insert into public.franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, split_charge_id, amount_cents, description)
                 values ($1, $2, 'ajuste', 'comercial', $3, $4, 12000, 'plantado: a reter cobrado')`, [B2, U, SET, L.reter]);
  // d) a baixa sem as contas (o lote pago sem a baixa feita).
  await c.query("update public.franchise_monthly_batches set settled_at = null where id = $1", [B1]);
  // e) o split a mais (acima da tolerância).
  const cs = await um(`select cs.id from public.charge_splits cs join public.charges ch on ch.id = cs.charge_id where ch.clinic_id = $1 and cs.status = 'liquidado' order by ch.paid_on desc limit 1`, [U]);
  await c.query("update public.charges set paid_on = $2 where id = (select charge_id from public.charge_splits where id = $1)", [cs.id, OUT]);
  await c.query("update public.charge_splits set excess_cents = 50 where id = $1", [cs.id]);
  // f) a conta a pagar desatualizada.
  const pay = await um("select id, amount_cents from public.payables where clinic_id = $1 and network_fee = 'royalty' and fee_period = $2", [U, OUT]);
  await c.query("update public.payables set amount_cents = amount_cents + 100 where id = $1", [pay.id]);
  // g) o caixa diferente (um pagamento da unidade a mais, com caixa).
  const pp = await um(`insert into public.payable_payments (clinic_id, payable_id, amount_cents, paid_at, payment_method, reference, franchise_batch_id)
                       values ($1, $2, 700, (select paid_on from public.franchise_monthly_batches where id = $3), 'boleto', 'plantado', $3) returning id`, [U, pay.id, B2]);
  // h) uma linha de cobrança sem dono de origem (nem taxa nem conta): a conta do mês não fecha.
  await c.query(`insert into public.franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, amount_cents, description)
                 values ($1, $2, 'ajuste', 'royalty', $3, 1500, 'plantado: sem origem')`, [B2, U, OUT]);
  await c.query(`insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status, source_type, source_id, description)
                 values ($1, '2.6.01', $2, $2, 700, 'outflow', 'settled', 'payable_cash', $3, 'plantado')`, [U, OUT, pp.id]);

  const r1 = (await um("select public._franchise_reconcile_run() j")).j;
  conf("linha em dois donos: a cobrada duas vezes", await tem("linha_dois_donos", L.a));
  conf("linha em dois donos: o a reter cobrado", await tem("linha_dois_donos", L.reter));
  conf("linha sem dono: a que ficou de fora", await tem("linha_sem_dono", L.fora));
  conf("pago diferente: a baixa sem as contas", await tem("pago_diferente", B1));
  conf("split a mais (acima de R$ 0,10)", await tem("split_a_mais", cs.id));
  conf("conta a pagar desatualizada", await tem("conta_desatualizada", pay.id));
  conf("caixa diferente", await tem("caixa_diferente", B2));
  conf("a diferença da conta do mês aparece (a linha sem origem)", await tem("diferenca_do_mes", null));
  conf(`o resumo do dia vai ao Financeiro (${r1.novas} nova(s))`, !!(await um("select 1 x from public.notifications where user_id = $1 and title = 'Conferência das taxas: divergência nova'", [P.financeiro])));
  const n1 = n((await um("select count(*) n from public.notifications where title = 'Conferência das taxas: divergência nova'")).n);
  await c.query("select public._franchise_reconcile_run()");
  conf("a mesma divergência não se repete, e o resumo não sai de novo", n((await um("select count(*) n from public.reconciliation_issues where status = 'aberta' and ref_id = $1", [L.a])).n) === 1
    && n((await um("select count(*) n from public.notifications where title = 'Conferência das taxas: divergência nova'")).n) === n1);

  // --- 3) quem vê, e ignorar ---------------------------------------------------------
  const lido = (await pessoa(P.gerente, "select public.franchise_reconciliation_read($1, $2) j", [OUT, U]))?.[0]?.j;
  conf("o Gerente vê a conta e as divergências da sua unidade", (lido?.issues ?? []).length > 0 && (lido?.units ?? []).length === 1);
  conf("o Gerente não vê a de Cambé", erro(await pessoa(P.gerente, "select public.franchise_reconciliation_read($1, $2)", [OUT, CAMBE]), "NOT_ALLOWED"));
  conf("o Dentista não vê nada", ((await pessoa(P.consultor, "select public.franchise_reconciliation_read($1, null) j", [OUT]))?.[0]?.j?.issues ?? [1]).length === 0);
  const idSplit = (await um("select id from public.reconciliation_issues where status = 'aberta' and kind = 'split_a_mais'")).id;
  conf("o Gerente não ignora", erro(await pessoa(P.gerente, "select public.franchise_reconciliation_ignore($1, 'motivo qualquer')", [idSplit]), "NOT_ALLOWED"));
  conf("ignorar exige motivo", erro(await pessoa(P.financeiro, "select public.franchise_reconciliation_ignore($1, 'x')", [idSplit]), "REASON_REQUIRED"));
  conf("o Financeiro ignora, com motivo", Array.isArray(await pessoa(P.financeiro, "select public.franchise_reconciliation_ignore($1, 'Repasse do fundo combinado à parte')", [idSplit])));
  await c.query("select public._franchise_reconcile_run()");
  conf("a ignorada fica na lista das ignoradas, com quem e quando", (await um("select status, ignored_by, ignored_at from public.reconciliation_issues where id = $1", [idSplit])).status === "ignorada");
  await c.query("update public.charge_splits set excess_cents = 80 where id = $1", [cs.id]);
  await c.query("select public._franchise_reconcile_run()");
  conf("o valor mudou: a ignorada reabre", (await um("select status from public.reconciliation_issues where id = $1", [idSplit])).status === "aberta");

  // --- 4) desfeito o defeito, a divergência fecha sozinha ----------------------------
  await c.query("delete from public.franchise_monthly_items where description like 'plantado:%'");
  await c.query("update public.split_charges set waived_at = now(), waived_reason = 'ensaio: fora' where id = $1", [L.fora]);
  await c.query("update public.franchise_monthly_batches set settled_at = now() where id = $1", [B1]);
  await c.query("update public.charge_splits set excess_cents = 0 where id = $1", [cs.id]);
  await c.query("update public.payables set amount_cents = $2 where id = $1", [pay.id, pay.amount_cents]);
  await c.query("update public.payable_payments set franchise_batch_id = null where id = $1", [pp.id]);
  const r2 = (await um("select public._franchise_reconcile_run() j")).j;
  const sobra = await todos("select kind, amount_cents from public.reconciliation_issues where status = 'aberta'");
  conf(`desfeitos os defeitos, todas fecham sozinhas (${sobra.map((x) => x.kind + ":" + x.amount_cents).join(", ") || "nenhuma"}; ${r2.fechadas} fechada(s))`,
    sobra.length === 0);
  conf("as fechadas ficam marcadas \"resolvida pela rotina\"", n((await um("select count(*) n from public.reconciliation_issues where status = 'resolvida' and resolved_at is not null")).n) >= 6);
  conf("a 4021a não muda nenhum lançamento", !/insert into public\.financial_entries|update public\.(payables|financial_entries|split_charges)/i.test(readFileSync("supabase/migrations/4021a_asa6_conferencia_das_taxas.sql", "utf8")));
  void itA;
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
