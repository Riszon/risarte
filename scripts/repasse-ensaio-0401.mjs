// ENSAIO DA 0401 no banco de TREINO, numa transação DESFEITA (rollback): nada fica.
// Uso: node scripts/repasse-ensaio-0401.mjs --confirmar
//
// As visões do repasse (Etapa 5): a unidade mês a mês, a rede unidade a
// unidade e o dentista. O ensaio monta o próprio cenário (4 procedimentos
// concluídos por um dentista), passa por relatório, conta, pagamento e
// desconto, e confere que as três portas somam a mesma conta e que cada um vê
// só o que pode. Só contagens e valores na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0401_repasse_visoes.sql";

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/repasse-ensaio-0401.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (n, v) => (v ? ok : falha).push(n);

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
const como = async (uid) => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
};
const voltar = async () => {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
};
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const todos = async (sql, p = []) => (await c.query(sql, p)).rows;
async function de(uid, fn) {
  await como(uid);
  try {
    return await fn();
  } finally {
    await voltar();
  }
}
const n = (v) => Number(v ?? 0);

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  const again = await c.query(sql);
  conf("aplicar duas vezes sem erro (idempotente)", true);
  const cf = (Array.isArray(again) ? again[again.length - 1] : again).rows[0];
  conf("conferência 3·2·0", n(cf.funcoes) === 3 && n(cf.internas_fechadas) === 2 && n(cf.tabelas_novas) === 0);

  let privs = true;
  for (const f of ["payout_history(uuid,date,date,uuid)", "payout_network_summary(date,date)", "my_payout_evolution(date,date)"]) {
    const r = await um(
      `select has_function_privilege('anon','public.${f}','execute') a,
              has_function_privilege('authenticated','public.${f}','execute') u`
    );
    if (r.a || !r.u) { privs = false; falha.push(`privilégio errado em ${f}`); }
  }
  conf("3 portas: sem login não, logado sim", privs);

  // -- Cenário (o mesmo arranjo do ensaio da 0400) ---------------------------------
  const adm = (await um("select id from public.profiles where is_admin_master and is_active order by created_at limit 1"))?.id;
  const alvo = await um(
    `select s.clinic_id
       from public.treatment_sessions s
      where s.item_id is not null and s.procedure_id is not null
        and not exists (select 1 from public.treatment_sessions o
                         where o.item_id = s.item_id and o.status not in ('pending','scheduled'))
        and not exists (select 1 from public.user_clinic_roles_all u
                         where u.clinic_id = s.clinic_id and u.role = 'unit_manager')
      group by 1 having count(distinct s.item_id) >= 4
      order by count(distinct s.item_id) desc limit 1`);
  if (!adm || !alvo) throw new Error("NÃO MEDI: falta Admin Master ou uma unidade sem Gerente com 4 procedimentos de plano não começados");
  const clinica = alvo.clinic_id;
  const dent = (await um(
    `select u.user_id from public.user_clinic_roles_all u
       join public.profiles p on p.id = u.user_id and p.is_active and not p.is_admin_master
      where u.clinic_id = $1 and u.role = 'dentist' order by u.user_id limit 1`, [clinica]))?.user_id;
  if (!dent) throw new Error("NÃO MEDI: a unidade do cenário não tem dentista");
  const itens = (await todos(
    `select s.item_id from public.treatment_sessions s
      where s.clinic_id = $1 and s.item_id is not null and s.procedure_id is not null
        and not exists (select 1 from public.treatment_sessions o
                         where o.item_id = s.item_id and o.status not in ('pending','scheduled'))
      group by s.item_id order by min(s.created_at) limit 4`, [clinica])).map((r) => r.item_id);
  await c.query(
    `update public.payout_report_items i set active = false, status = 'excluido',
            exclusion_kind = 'adiar', exclusion_reason = 'ensaio 0401', review_state = null
       from public.provider_payouts p
      where p.id = i.payout_id and p.clinic_id = $1 and p.provider_id = $2 and i.active and i.payment_id is null`, [clinica, dent]);
  await c.query(
    `update public.payout_reports set status = 'cancelado', cancelled_at = now(), cancel_reason = 'ensaio 0401'
      where clinic_id = $1 and provider_id = $2 and status = 'rascunho'`, [clinica, dent]);
  await c.query(
    `update public.provider_payouts set withheld = true, withheld_reason = 'ensaio 0401'
      where clinic_id = $1 and provider_id = $2 and closing_id is null and failure_id is null`, [clinica, dent]);
  // O preço do item: R$ 200,00, para a produção ser conferível.
  await c.query("update public.treatment_plan_option_items set unit_price_cents = 20000 where id = any($1::uuid[])", [itens]);
  await c.query(
    `update public.treatment_sessions set status = 'done', done_at = now(), executed_by = $2
      where item_id = any($1::uuid[])`, [itens, dent]);
  const novos = await todos(
    `select p.id, p.units, s.plan_id, s.item_id from public.provider_payouts p
       join public.treatment_sessions s on s.id = p.session_id
      where s.item_id = any($1::uuid[]) and p.provider_id = $2 order by p.created_at, p.id`, [itens, dent]);
  if (novos.length < 4) throw new Error("NÃO MEDI: concluir os 4 procedimentos não gerou 4 repasses");
  await c.query("update public.provider_payouts set amount_cents = 10000, withheld = false, no_payout = false where id = any($1::uuid[])", [novos.map((x) => x.id)]);
  // A produção esperada, pela regra (preço × procedimentos × desconto da negociação aceita).
  let esperado = 0;
  for (const p of novos) {
    const neg = await um("select final_cents, subtotal_cents from public.plan_negotiations where plan_id=$1 and status='aceita' limit 1", [p.plan_id]);
    const fator = neg && n(neg.subtotal_cents) > 0 ? n(neg.final_cents) / n(neg.subtotal_cents) : 1;
    esperado += Math.round(20000 * Math.max(n(p.units) || 1, 1) * fator);
  }
  const livres = await todos(
    `select p.id from public.profiles p
      where p.is_active and not p.is_admin_master and p.id <> $2
        and not exists (select 1 from public.user_clinic_roles_all u where u.user_id = p.id and u.clinic_id = $1)
        and not exists (select 1 from public.user_clinic_roles_all u where u.user_id = p.id and u.role = 'finance_franchisor')
      order by p.created_at limit 2`, [clinica, dent]);
  if (livres.length < 2) throw new Error("NÃO MEDI: faltam dois perfis livres (Gerente e estranho)");
  const [ger, estranho] = livres.map((r) => r.id);
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1,$2,'unit_manager')", [ger, clinica]);
  await c.query("update public.fiscal_periods set status = 'open' where clinic_id = $1 and status = 'closed'", [clinica]);
  const mes = (await um("select date_trunc('month', public.today_br())::date::text d")).d;
  const hoje = (await um("select public.today_br()::text d")).d;
  const de12 = (await um("select (date_trunc('month', public.today_br()) - interval '11 months')::date::text d")).d;

  const hist = async (uid = adm) =>
    (await de(uid, () => todos("select * from public.payout_history($1,$2,$3,$4)", [clinica, de12, hoje, dent])))
      .find((r) => r.month.toISOString?.().slice(0, 10) === mes || String(r.month).slice(0, 10) === mes);

  // -- 1) Tudo esperando: 4 procedimentos, R$ 400,00, produção pela regra ----------
  const h1 = await hist();
  conf("o mês do dentista: 4 procedimentos, repasse R$ 400,00, tudo esperando",
    !!h1 && h1.procedures === 4 && n(h1.payout_cents) === 40000 && n(h1.waiting_cents) === 40000 &&
      n(h1.paid_cents) === 0 && n(h1.scheduled_cents) === 0);
  conf("produção = o valor vendido (preço do plano com o desconto da negociação)",
    !!h1 && n(h1.produced_cents) === esperado && h1.produced_missing === 0);

  // -- 2) Relatório, conta, pagamento ------------------------------------------------
  await de(adm, () => c.query("select public.payout_report_generate($1,$2,$3)", [clinica, mes, dent]));
  const R = (await um("select id from public.payout_reports where clinic_id=$1 and provider_id=$2 and status='rascunho'", [clinica, dent])).id;
  await de(adm, () => c.query("select public.payout_report_send($1)", [R]));
  await de(ger, () => c.query("select public.payout_report_manager_approve($1)", [R]));
  await de(dent, () => c.query("select public.payout_report_dentist_respond($1,'[]'::jsonb,null)", [R]));
  const pg = await de(adm, async () => (await um("select public.payout_report_bill($1) id", [R])).id);
  const h2 = await hist();
  conf("com a conta gerada: R$ 400,00 programado", n(h2.scheduled_cents) === 40000 && n(h2.waiting_cents) === 0);
  const pa = (await um("select payable_id from public.payout_payments where id=$1", [pg])).payable_id;
  await de(adm, () => c.query("select public.register_payable_payment($1,40000,$2::date,'pix')", [pa, hoje]));
  const h3 = await hist();
  conf("com a conta paga: R$ 400,00 pago", n(h3.paid_cents) === 40000 && n(h3.scheduled_cents) === 0);

  // -- 3) Falha confirmada: o desconto aparece; a produção do anulado sai -------------
  const f = await de(ger, async () => (await um("select public.payout_failure_open($1,'cliente voltou com dor') id", [novos[0].id])).id);
  await de(ger, () => c.query("select public.payout_failure_decide($1,true,'falha de técnica confirmada',null)", [f]));
  const h4 = await hist();
  conf("falha confirmada: desconto de R$ 100,00 no mês; o repasse pago continua contando",
    n(h4.discount_cents) === -10000 && n(h4.payout_cents) === 40000);
  conf("a produção do procedimento com falha sai da conta", n(h4.produced_cents) < esperado && h4.produced_missing === 0);

  // -- 4) Quem vê ---------------------------------------------------------------------
  const e1 = await de(dent, () => recusa("select * from public.payout_history($1,$2,$3,null)", [clinica, de12, hoje]));
  const e2 = await de(estranho, () => recusa("select * from public.payout_history($1,$2,$3,null)", [clinica, de12, hoje]));
  conf("o histórico da unidade não abre para o dentista nem para um estranho",
    [e1, e2].every((e) => !!e && e.includes("NOT_ALLOWED")));
  const hg = await hist(ger);
  conf("o Gerente vê o histórico da unidade dele", !!hg && n(hg.payout_cents) === 40000);
  const e3 = await de(ger, () => recusa("select * from public.payout_network_summary($1,$2)", [de12, hoje]));
  conf("o consolidado da rede é só da Franqueadora", !!e3 && e3.includes("NOT_ALLOWED"));
  const rede = await de(adm, () => todos("select * from public.payout_network_summary($1,$2)", [mes, hoje]));
  const linha = rede.find((r) => r.clinic_id === clinica);
  conf("o consolidado da rede traz a unidade com a mesma conta do histórico",
    !!linha && n(linha.payout_cents) >= 40000 && n(linha.discount_cents) <= -10000 && linha.dentists >= 1 &&
      rede.every((r) => r.clinic_id !== null));

  // -- 5) O dentista vê só o próprio repasse, sem a produção ---------------------------
  const meu = await de(dent, () => todos("select * from public.my_payout_evolution($1,$2)", [de12, hoje]));
  const meuMes = meu.find((r) => String(r.month.toISOString?.() ?? r.month).slice(0, 10) === mes && r.clinic_id === clinica);
  conf("o dentista vê o próprio repasse, o desconto e o pago",
    !!meuMes && n(meuMes.payout_cents) === 40000 && n(meuMes.discount_cents) === -10000 && n(meuMes.paid_cents) === 40000);
  conf("a evolução do dentista não traz produção", !!meuMes && !("produced_cents" in meuMes));
  const outro = await de(estranho, () => todos("select * from public.my_payout_evolution($1,$2)", [de12, hoje]));
  conf("quem não tem repasse não vê nada", outro.length === 0);

  // -- 6) Período fora do lugar -----------------------------------------------------------
  const e4 = await de(adm, () => recusa("select * from public.payout_history($1,$2,$3,null)", [clinica, hoje, de12]));
  const e5 = await de(adm, () => recusa("select * from public.payout_network_summary('2020-01-01','2026-12-31')"));
  conf("período invertido ou maior que 36 meses é recusado",
    [e4, e5].every((e) => !!e && e.includes("INVALID_PERIOD")));
} catch (e) {
  falha.push("ERRO: " + e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(`OK ${ok.length}:`, ok.join(" | "));
console.log(`FALHA ${falha.length}:`, falha.join(" | "));
if (ok.length === 0) { console.log("NÃO MEDI NADA"); process.exit(2); }
process.exit(falha.length ? 1 : 0);
