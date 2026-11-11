// ENSAIO DA 0400 no banco de TREINO, numa transação DESFEITA (rollback): nada fica.
// Uso: node scripts/repasse-ensaio-0400.mjs --confirmar
//
// Percorre o desconto por falha do dentista (Etapa 4B): a ocorrência nasce da
// reprovação no controle de qualidade e à mão; quem decide é quem aprova a
// equipe; "foi falha" vira linha negativa no próximo relatório; refação pelo
// mesmo dentista não desconta; quem refaz recebe; o desconto maior que o
// repasse é partido e o saldo passa adiante; desconto que consome tudo é
// pagamento compensado. Só contagens e valores na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0400_repasse_falha_do_dentista.sql";

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/repasse-ensaio-0400.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const naoMedi = [];
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
const avisos = async (uid, trecho) =>
  (await um("select count(*)::int n from public.notifications where user_id=$1 and title ilike $2", [uid, `%${trecho}%`])).n;

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  const again = await c.query(sql);
  conf("aplicar duas vezes sem erro (idempotente)", true);
  const cf = (Array.isArray(again) ? again[again.length - 1] : again).rows[0];
  console.log("conferência:", cf);
  conf(
    "conferência 1·2·2·6·0·1·1",
    Number(cf.tabela) === 1 && Number(cf.colunas_do_repasse) === 2 && Number(cf.gatilhos) === 2 &&
      Number(cf.funcoes) === 6 && Number(cf.regras_de_escrita) === 0 &&
      Number(cf.uma_sessao_viva) === 1 && Number(cf.rotina_diaria) === 1
  );

  let privs = true;
  for (const f of [
    "payout_failure_open(uuid,text)", "payout_failure_decide(uuid,boolean,text,bigint)",
    "payout_failure_list(uuid)", "can_decide_payout_failure(uuid)",
  ]) {
    const r = await um(
      `select has_function_privilege('anon','public.${f}','execute') a,
              has_function_privilege('authenticated','public.${f}','execute') u`
    );
    if (r.a || !r.u) { privs = false; falha.push(`privilégio errado em ${f}`); }
  }
  conf("4 portas: sem login não, logado sim", privs);
  let internas = true;
  for (const f of [
    "_payout_failure_deciders(uuid,uuid)", "_payout_failure_reviewers(uuid,uuid)",
    "_payout_failure_open(uuid,text,text,uuid,text,uuid)", "payout_failure_reminder_run()",
    "plan_quality_reviews_payout_failure()", "plan_cancellations_payout_failure()",
  ]) {
    const r = await um(
      `select has_function_privilege('anon','public.${f}','execute') a,
              has_function_privilege('authenticated','public.${f}','execute') u`
    );
    if (r.a || r.u) { internas = false; falha.push(`interna exposta: ${f}`); }
  }
  conf("as 6 internas não respondem a ninguém", internas);

  // -- Cenário (desfeito no fim) ------------------------------------------------
  const adm = (await um("select id from public.profiles where is_admin_master and is_active order by created_at limit 1"))?.id;
  // O treino muda: o ensaio monta o PRÓPRIO cenário, dentro desta transação.
  // Numa unidade sem Gerente, um dentista conclui 4 procedimentos de plano
  // ainda não começados (itens diferentes): os repasses nascem pelo gatilho de
  // sempre, e todo o resto dele naquela unidade é solto de relatório.
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
  const itensNovos = (await todos(
    `select s.item_id from public.treatment_sessions s
      where s.clinic_id = $1 and s.item_id is not null and s.procedure_id is not null
        and not exists (select 1 from public.treatment_sessions o
                         where o.item_id = s.item_id and o.status not in ('pending','scheduled'))
      group by s.item_id order by min(s.created_at) limit 5`, [clinica])).map((r) => r.item_id);
  const quinto = itensNovos.pop();
  await c.query(
    `update public.payout_report_items i set active = false, status = 'excluido',
            exclusion_kind = 'adiar', exclusion_reason = 'ensaio 0400', review_state = null
       from public.provider_payouts p
      where p.id = i.payout_id and p.clinic_id = $1 and p.provider_id = $2 and i.active
        and i.payment_id is null`, [clinica, dent]);
  await c.query(
    `update public.payout_reports set status = 'cancelado', cancelled_at = now(), cancel_reason = 'ensaio 0400'
      where clinic_id = $1 and provider_id = $2 and status = 'rascunho'`, [clinica, dent]);
  // O que o dentista já tinha na unidade fica fora (não pagar): só os 4 novos contam.
  await c.query(
    `update public.provider_payouts set withheld = true, withheld_reason = 'ensaio 0400'
      where clinic_id = $1 and provider_id = $2 and closing_id is null and failure_id is null`, [clinica, dent]);
  await c.query(
    `update public.treatment_sessions set status = 'done', done_at = now(), executed_by = $2
      where item_id = any($1::uuid[])`, [itensNovos, dent]);
  const novos = await todos(
    `select p.id from public.provider_payouts p
       join public.treatment_sessions s on s.id = p.session_id
      where s.item_id = any($1::uuid[]) and p.provider_id = $2`, [itensNovos, dent]);
  if (novos.length < 4) throw new Error("NÃO MEDI: concluir os 4 procedimentos não gerou 4 repasses (" + novos.length + ")");
  await c.query(
    `update public.provider_payouts set amount_cents = 10000, no_payout = false, withheld = false
      where id = any($1::uuid[])`, [novos.map((r) => r.id)]);
  const livres = await todos(
    `select p.id from public.profiles p
      where p.is_active and not p.is_admin_master and p.id <> $2
        and not exists (select 1 from public.user_clinic_roles_all u where u.user_id = p.id and u.clinic_id = $1)
        and not exists (select 1 from public.user_clinic_roles_all u where u.user_id = p.id and u.role = 'finance_franchisor')
      order by p.created_at limit 3`, [clinica, dent]);
  if (livres.length < 3) throw new Error("NÃO MEDI: faltam três perfis livres no treino (Gerente, estranho, quem refaz)");
  const [ger, estranho, refaz] = livres.map((r) => r.id);
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1,$2,'unit_manager')", [ger, clinica]);
  await c.query("update public.fiscal_periods set status = 'open' where clinic_id = $1 and status = 'closed'", [clinica]);
  const mes = (await um("select date_trunc('month', public.today_br())::date::text d")).d;
  const hoje = (await um("select public.today_br()::text d")).d;

  // 1º relatório: 2 pagos (P1, P3), 2 adiados (A1, A2).
  await de(adm, () => c.query("select public.payout_report_generate($1,$2,$3)", [clinica, mes, dent]));
  const R1 = (await um("select id from public.payout_reports where clinic_id=$1 and provider_id=$2 and status='rascunho'", [clinica, dent])).id;
  const itens1 = await todos(
    `select i.id, i.payout_id, s.item_id, s.id session_id
       from public.payout_report_items i
       join public.provider_payouts p on p.id = i.payout_id
       join public.treatment_sessions s on s.id = p.session_id
      where i.report_id=$1 order by i.finished_on, i.id`, [R1]);
  // P1 e A1 serão reprovados no controle de qualidade: precisam ser os únicos
  // do seu item de plano (a reprovação pega o item inteiro).
  const unicos = itens1.filter((it) => itens1.filter((x) => x.item_id === it.item_id).length === 1);
  if (unicos.length < 2 || itens1.length < 4) throw new Error("NÃO MEDI: o relatório não tem 2 procedimentos sozinhos no item e 4 no total");
  const [P1, A1] = unicos;
  const [P3, A2] = itens1.filter((x) => x.id !== P1.id && x.id !== A1.id);
  for (const it of itens1) {
    if ([P1.id, P3.id].includes(it.id)) continue;
    await de(adm, () => c.query("select public.payout_report_exclude_item($1,'adiar','fica para o próximo')", [it.id]));
  }
  await de(adm, () => c.query("select public.payout_report_send($1)", [R1]));
  await de(ger, () => c.query("select public.payout_report_manager_approve($1)", [R1]));
  await de(dent, () => c.query("select public.payout_report_dentist_respond($1,'[]'::jsonb,null)", [R1]));
  const pg1 = await de(adm, async () => (await um("select public.payout_report_bill($1) id", [R1])).id);
  const pa1 = (await um("select payable_id from public.payout_payments where id=$1", [pg1])).payable_id;
  await de(adm, () => c.query("select public.register_payable_payment($1,20000,$2::date,'pix')", [pa1, hoje]));
  conf("cenário: 1º relatório pago (2 procedimentos), 2 adiados", (await um("select status from public.payables where id=$1", [pa1])).status === "paga");

  // -- 1) Reprovação no controle de qualidade abre a ocorrência sozinha --------
  const plano = (await um(
    `select o.plan_id from public.treatment_plan_option_items i
       join public.treatment_plan_options o on o.id = i.option_id where i.id=$1`, [P1.item_id])).plan_id;
  const qc = async (item, resolution) => c.query(
    `insert into public.plan_quality_reviews (plan_id, item_id, clinic_id, status, note, resolution, assigned_dentist_id)
     values ((select o.plan_id from public.treatment_plan_option_items i
               join public.treatment_plan_options o on o.id = i.option_id where i.id=$1),
             $1, $2, 'reprovado', 'restauração soltou', $3, case when $3 = 'redo_other' then $4::uuid end)
     on conflict (item_id) do update set status = 'reprovado', note = excluded.note,
       resolution = excluded.resolution, assigned_dentist_id = excluded.assigned_dentist_id`,
    [item, clinica, resolution, refaz]);
  await qc(P1.item_id, "redo_other");
  // Como set_plan_item_quality faz: as sessões voltam a "a fazer".
  await c.query(
    `update public.treatment_sessions set status = 'pending', done_at = null, executed_by = null, redo_kind = 'refacao'
      where item_id = $1`, [P1.item_id]);
  const f1 = await um("select * from public.payout_failures where payout_id=$1", [P1.payout_id]);
  conf("reprovação no controle de qualidade abre a ocorrência sozinha",
    !!f1 && f1.source === "qualidade" && f1.status === "aberta" && f1.resolution === "redo_other" && !!plano);
  conf("quem decide (o Gerente) é avisado", (await avisos(ger, "decidir se houve falha")) >= 1);
  await qc(P1.item_id, "redo_other");
  conf("reprovar de novo não abre outra ocorrência",
    (await um("select count(*)::int n from public.payout_failures where payout_id=$1", [P1.payout_id])).n === 1);

  // -- 2) Quem decide --------------------------------------------------------------
  const quem = async (uid) => de(uid, async () => (await um("select public.can_decide_payout_failure($1) v", [f1.id])).v);
  conf("decide o Gerente; não decidem o dentista, um estranho nem o Financeiro (há Gerente)",
    (await quem(ger)) === true && (await quem(dent)) === false && (await quem(estranho)) === false && (await quem(adm)) === false);
  const ld = await de(dent, async () => ({
    lista: (await todos("select * from public.payout_failure_list(null)")).length,
    tabela: (await um("select count(*)::int n from public.payout_failures")).n,
  }));
  conf("o dentista não lê as ocorrências", ld.lista === 0 && ld.tabela === 0);
  const lg = await de(ger, () => todos("select * from public.payout_failure_list(null)"));
  conf("o Gerente vê a ocorrência, com o pagamento em que o repasse está", lg.some((x) => x.id === f1.id && x.can_decide && x.paid_state === "em_conta"));
  const e1 = await de(ger, () => recusa("select public.payout_failure_decide($1,true,'',null)", [f1.id]));
  const e2 = await de(ger, () => recusa("select public.payout_failure_decide($1,true,'falha confirmada',20000)", [f1.id]));
  conf("decidir exige motivo; desconto acima do pago é recusado",
    !!e1 && e1.includes("REASON_REQUIRED") && !!e2 && e2.includes("INVALID_AMOUNT"));

  // -- 3) Foi falha (repasse pago): desconto no próximo relatório ------------------
  const o1 = await de(ger, async () => (await um("select public.payout_failure_decide($1,true,'restauração refeita por falha de técnica',null) o", [f1.id])).o);
  const neg1 = await um("select * from public.provider_payouts where failure_id=$1", [f1.id]);
  const orig1 = await um("select failure_voided_at from public.provider_payouts where id=$1", [P1.payout_id]);
  conf("foi falha com repasse pago: linha negativa do valor pago e repasse original anulado",
    o1 === "desconto" && !!neg1 && Number(neg1.amount_cents) === -10000 && neg1.session_id === null && orig1.failure_voided_at !== null);
  conf("o dentista é avisado do desconto", (await avisos(dent, "Desconto no seu repasse")) === 1);
  const e3 = await de(ger, () => recusa("select public.payout_failure_decide($1,false,'mudei de ideia',null)", [f1.id]));
  conf("decidir duas vezes é recusado", !!e3 && e3.includes("WRONG_STAGE"));
  const t1 = await recusa("update public.provider_payouts set amount_cents = 500 where id=$1", [neg1.id]);
  const t2 = await recusa(
    `insert into public.provider_payouts (clinic_id, provider_id, accrual_date, amount_cents)
     values ($1,$2,$3::date,-100)`, [clinica, dent, hoje]);
  conf("o banco só aceita valor negativo em linha de desconto (e desconto sempre negativo)", !!t1 && !!t2);

  // -- 4) Quem refez recebe (F2) ---------------------------------------------------------
  await c.query(
    `update public.treatment_sessions set status = 'done', done_at = now(), executed_by = $2
      where item_id = $1`, [P1.item_id, refaz]);
  const novo = await um(
    `select count(*)::int n from public.provider_payouts p
       join public.treatment_sessions s on s.id = p.session_id
      where s.item_id = $1 and p.provider_id = $2 and p.failure_voided_at is null`, [P1.item_id, refaz]);
  conf("refação por outro dentista: quem refez recebe o repasse do procedimento", novo.n === 1);

  // -- 5) Refação pelo MESMO dentista não desconta (F1) -----------------------------------
  await qc(A1.item_id, "redo_same");
  const fA1 = await um("select id from public.payout_failures where payout_id=$1", [A1.payout_id]);
  const oA1 = await de(ger, async () => (await um("select public.payout_failure_decide($1,true,'falha, mas ele mesmo refaz',null) o", [fA1.id])).o);
  const vA1 = await um("select failure_voided_at from public.provider_payouts where id=$1", [A1.payout_id]);
  conf("refação pelo mesmo dentista: nada a descontar, repasse continua valendo",
    oA1 === "refaz_sem_custo" && vA1.failure_voided_at === null &&
      (await um("select count(*)::int n from public.provider_payouts where failure_id=$1", [fA1.id])).n === 0);

  // -- 6) À mão: "Registrar falha do dentista" -------------------------------------------
  const e4 = await de(dent, () => recusa("select public.payout_failure_open($1,'eu mesmo registro')", [P3.payout_id]));
  const e5 = await de(estranho, () => recusa("select public.payout_failure_open($1,'registro de fora')", [P3.payout_id]));
  const e6 = await de(ger, () => recusa("select public.payout_failure_open($1,'')", [P3.payout_id]));
  conf("registrar à mão: não o dentista, não um estranho, e com motivo",
    [e4, e5].every((e) => !!e && e.includes("NOT_ALLOWED")) && !!e6 && e6.includes("REASON_REQUIRED"));
  const f3 = await de(ger, async () => (await um("select public.payout_failure_open($1,'cliente reclamou e foi devolvido') id", [P3.payout_id])).id);
  const e7 = await de(ger, () => recusa("select public.payout_failure_open($1,'de novo o mesmo')", [P3.payout_id]));
  conf("registrar à mão abre a ocorrência; a mesma duas vezes é recusada", !!f3 && !!e7 && e7.includes("ALREADY_OPEN"));
  await de(ger, () => c.query("select public.payout_failure_decide($1,true,'falha de adaptação confirmada',null)", [f3]));

  // -- 7) Não foi falha: nada muda ------------------------------------------------------------
  const fA2 = await de(ger, async () => (await um("select public.payout_failure_open($1,'conferir o caso') id", [A2.payout_id])).id);
  const oA2 = await de(ger, async () => (await um("select public.payout_failure_decide($1,false,'não houve falha: cliente faltou',null) o", [fA2])).o);
  conf("não foi falha: encerra e o repasse segue", oA2 === "sem_falha" &&
    (await um("select failure_voided_at from public.provider_payouts where id=$1", [A2.payout_id])).failure_voided_at === null);
  const fA2b = await de(ger, async () => (await um("select public.payout_failure_open($1,'apareceu fato novo') id", [A2.payout_id])).id);
  conf("encerrada como 'não foi falha', pode ser reaberta à mão", !!fA2b);
  await de(ger, () => c.query("select public.payout_failure_decide($1,false,'segue sem falha',null)", [fA2b]));

  // -- 8) Fora de relatório: simplesmente não é pago ------------------------------------------
  // Um 5º procedimento concluído agora: ainda fora de qualquer relatório.
  if (quinto) {
    await c.query(
      `update public.treatment_sessions set status = 'done', done_at = now(), executed_by = $2
        where item_id = $1`, [quinto, dent]);
  }
  const fora = quinto ? await um(
    `select p.id from public.provider_payouts p
       join public.treatment_sessions s on s.id = p.session_id
      where s.item_id = $1 and p.provider_id = $2 and p.failure_voided_at is null limit 1`, [quinto, dent]) : null;
  if (fora) await c.query("update public.provider_payouts set amount_cents = 10000 where id=$1", [fora.id]);
  if (fora) {
    const ff = await de(ger, async () => (await um("select public.payout_failure_open($1,'falha antes do relatório') id", [fora.id])).id);
    const of = await de(ger, async () => (await um("select public.payout_failure_decide($1,true,'falha confirmada antes de pagar',null) o", [ff])).o);
    const cand = await de(adm, () => todos("select * from public.payout_report_candidates($1,$2)", [clinica, mes]));
    conf("foi falha antes de entrar em relatório: não é pago e sai da fila",
      of === "nao_pagar" && (await um("select count(*)::int n from public.provider_payouts where failure_id=$1", [ff])).n === 0 &&
        (await um("select failure_voided_at from public.provider_payouts where id=$1", [fora.id])).failure_voided_at !== null);
    void cand;
  } else naoMedi.push("falha antes do relatório (não havia repasse fora de relatório no cenário)");

  // -- 9) O próximo relatório leva os descontos ----------------------------------------------
  // A2 vale R$ 50,00: positivos 150,00 (A1 + A2) contra 200,00 de desconto.
  await c.query("update public.provider_payouts set amount_cents = 5000 where id=$1", [A2.payout_id]);
  const cand2 = await de(adm, () => todos("select * from public.payout_report_candidates($1,$2)", [clinica, mes]));
  const cd = cand2.find((x) => x.provider_id === dent);
  conf("a fila mostra o desconto à parte do repasse", !!cd && cd.discount_count === 2 && Number(cd.discount_cents) === -20000);
  await de(adm, () => c.query("select public.payout_report_generate($1,$2,$3)", [clinica, mes, dent]));
  const R2 = (await um("select id, total_cents from public.payout_reports where clinic_id=$1 and provider_id=$2 and status='rascunho'", [clinica, dent]));
  const det2 = await de(adm, () => todos("select * from public.payout_report_items_detail($1)", [R2.id]));
  const negs = det2.filter((x) => Number(x.amount_cents) < 0);
  conf("o relatório seguinte traz as duas linhas negativas, com o motivo",
    negs.length === 2 && negs.every((x) => x.origin === "desconto" && !!x.failure_reason) && Number(R2.total_cents) === 15000 - 20000);

  // O dentista vê o desconto e o motivo.
  await de(adm, () => c.query("select public.payout_report_send($1)", [R2.id]));
  await de(ger, () => c.query("select public.payout_report_manager_approve($1)", [R2.id]));
  const dd = await de(dent, () => todos("select * from public.my_payout_report_detail($1)", [R2.id]));
  conf("o dentista vê a linha de desconto, com o motivo", dd.filter((x) => Number(x.amount_cents) < 0 && !!x.failure_reason).length === 2);

  // -- 10) Corrigir um desconto é descontar MENOS ------------------------------------------------
  const nP1 = negs.find((x) => x.payout_id === neg1.id);
  await c.query("update public.payout_report_items set review_state = 'no_financeiro' where id=$1", [nP1.item_id]);
  const e8 = await de(adm, () => recusa("select public.payout_report_finance_decide($1,'corrigir','desconto maior',-15000,null)", [nP1.item_id]));
  const e9 = await de(adm, () => recusa("select public.payout_report_finance_decide($1,'corrigir','virou repasse',100,null)", [nP1.item_id]));
  await de(adm, () => c.query("select public.payout_report_finance_decide($1,'corrigir','desconto parcial combinado',-8000,null)", [nP1.item_id]));
  conf("corrigir desconto: só para menos, e continua desconto",
    !!e8 && e8.includes("INVALID_AMOUNT") && !!e9 && e9.includes("INVALID_AMOUNT") &&
      Number((await um("select amount_cents from public.payout_report_items where id=$1", [nP1.item_id])).amount_cents) === -8000);
  await de(dent, () => c.query("select public.payout_report_dentist_respond($1,'[]'::jsonb,null)", [R2.id]));

  // -- 11) A conta abate o desconto; o que sobra passa adiante; nada a pagar = compensado -------
  const resumo = await de(adm, async () => (await todos("select * from public.payout_report_billing($1::uuid[])", [[R2.id]]))[0]);
  conf("o resumo não pede conta quando o desconto passa do repasse", Number(resumo.to_bill_cents) === 0);
  const pg2 = await de(adm, async () => (await um("select public.payout_report_bill($1) id", [R2.id])).id);
  const p2 = await um("select * from public.payout_payments where id=$1", [pg2]);
  const naConta = await todos("select amount_cents from public.payout_report_items where payment_id=$1", [pg2]);
  const saldo = await todos(
    `select p.amount_cents from public.provider_payouts p
      where p.failure_id in (select failure_id from public.provider_payouts where id = any($1::uuid[]))
        and not (p.id = any($1::uuid[]))`, [negs.map((x) => x.payout_id)]);
  conf("desconto que consome tudo: pagamento compensado, sem conta a pagar",
    Number(p2.amount_cents) === 0 && p2.payable_id === null && p2.item_count === 4);
  conf("o desconto que não cabe é partido: o que cabe entra (a conta fecha em zero) e 30,00 passa para o próximo relatório",
    naConta.reduce((t, x) => t + Number(x.amount_cents), 0) === 0 &&
      saldo.length === 1 && Number(saldo[0].amount_cents) === -3000);
  const ld2 = await de(dent, () => todos("select * from public.payout_report_payments($1)", [R2.id]));
  conf("o dentista vê o pagamento como compensado", ld2.length === 1 && ld2[0].state === "compensado");
  const cand3 = await de(adm, () => todos("select * from public.payout_report_candidates($1,$2)", [clinica, mes]));
  conf("o saldo do desconto espera o próximo relatório", Number(cand3.find((x) => x.provider_id === dent)?.discount_cents ?? 0) === -3000);
  const e10 = await de(adm, async () => recusa("select public.payout_report_generate($1,$2,$3)", [clinica, mes, dent]));
  const soDesc = await um("select count(*)::int n from public.payout_reports where clinic_id=$1 and provider_id=$2 and status='rascunho'", [clinica, dent]);
  conf("só desconto não abre relatório: espera haver repasse", !e10 && soDesc.n === 0);

  // -- 12) Venda cancelada com procedimento com repasse ----------------------------------------
  const sale = await um(
    `select n.id negotiation_id, n.client_id, n.plan_id
       from public.treatment_sessions s
       join public.provider_payouts p on p.session_id = s.id and p.amount_cents > 0
                                     and p.failure_voided_at is null and p.failure_id is null
       join public.plan_negotiations n on n.plan_id = s.plan_id
      where p.clinic_id = $1
        and not exists (select 1 from public.payout_failures f where f.payout_id = p.id and f.status in ('aberta','falha'))
      limit 1`, [clinica]);
  if (sale) {
    const pc = await recusa(
      `insert into public.plan_cancellations (clinic_id, client_id, negotiation_id, plan_id, reason, status)
       values ($1,$2,$3,$4,'cliente desistiu','assinado')`, [clinica, sale.client_id, sale.negotiation_id, sale.plan_id]);
    if (pc) naoMedi.push("cancelamento de venda (não deu para montar o termo: " + pc.slice(0, 80) + ")");
    else {
      const antes = (await um("select count(*)::int n from public.payout_failures where source='cancelamento'")).n;
      await c.query("update public.plan_cancellations set status='efetivado' where negotiation_id=$1 and status='assinado'", [sale.negotiation_id]);
      const depois = (await um("select count(*)::int n from public.payout_failures where source='cancelamento'")).n;
      conf("venda cancelada com procedimento com repasse abre a ocorrência", depois > antes);
    }
  } else naoMedi.push("cancelamento de venda (nenhuma negociação com repasse na unidade do cenário)");

  // -- 13) Lembrete uma vez; nada trava ------------------------------------------------------------
  const aberta = await de(ger, async () => (await um("select public.payout_failure_open($1,'para o lembrete') id", [A2.payout_id])).id);
  await c.query("update public.payout_failures set created_at = now() - interval '10 days' where id=$1", [aberta]);
  const lem0 = await avisos(ger, "Lembrete: ocorrência");
  await c.query("select public.payout_failure_reminder_run()");
  await c.query("select public.payout_failure_reminder_run()");
  conf("ocorrência parada: lembrete a quem decide, uma vez só", (await avisos(ger, "Lembrete: ocorrência")) === lem0 + 1);

  // -- 14) A trava de sempre ----------------------------------------------------------------------
  const lote = await um(
    `select count(*)::int n from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname ilike 'payout_failure%'
        and exists (select 1 from unnest(p.proargtypes::oid[]) t(o) join pg_type ty on ty.oid = t.o
                     where ty.typcategory = 'A' or ty.typname in ('json','jsonb'))`);
  conf("não existe decisão de falha em lote", lote.n === 0);
} catch (e) {
  falha.push("ERRO: " + e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(`OK ${ok.length}:`, ok.join(" | "));
console.log(`FALHA ${falha.length}:`, falha.join(" | "));
if (naoMedi.length) console.log(`NÃO MEDI ${naoMedi.length}:`, naoMedi.join(" | "));
if (ok.length === 0) { console.log("NÃO MEDI NADA"); process.exit(2); }
process.exit(falha.length ? 1 : 0);
