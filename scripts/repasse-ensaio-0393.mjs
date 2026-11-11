// ENSAIO DA 0393 no banco de TREINO, numa transação DESFEITA (rollback): nada fica.
// Uso: node scripts/repasse-ensaio-0393.mjs --confirmar
//
// Percorre o pagamento pelo relatório de repasse (Etapa 4): a aprovação
// parcial vira uma conta a pagar; a linha contestada, resolvida, vira outra;
// pagar marca como pago; cancelar a conta devolve as linhas; e as travas
// contra pagar duas vezes. Só contagens e valores na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0393_repasse_pagamento.sql";

// O ensaio grava papéis, relatórios e contas de mentira e tenta atos
// proibidos, tudo numa transação desfeita. Pede autorização (OC-00088).
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/repasse-ensaio-0393.mjs --confirmar",
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
// Volta ao superusuário E apaga a identidade (espelho do treino, 0260).
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
    "conferência 1·1·3·4·0·true",
    Number(cf.tabela) === 1 && Number(cf.coluna_da_linha) === 1 && Number(cf.travas) === 3 &&
      Number(cf.funcoes) === 4 && Number(cf.regras_de_escrita) === 0 && cf.fechar_o_mes_aposentado === true
  );

  let privs = true;
  for (const f of [
    "payout_report_bill(uuid)", "payout_reports_bill_all(uuid)",
    "payout_report_payments(uuid)", "payout_report_billing(uuid[])",
  ]) {
    const r = await um(
      `select has_function_privilege('anon','public.${f}','execute') a,
              has_function_privilege('authenticated','public.${f}','execute') u`
    );
    if (r.a || !r.u) { privs = false; falha.push(`privilégio errado em ${f}`); }
  }
  conf("4 funções: sem login não, logado sim", privs);
  let internas = true;
  for (const f of [
    "_payout_due_date(date,date)", "_payout_report_can_read_payment(uuid)",
    "payout_report_items_payment_lock()", "payout_payments_lock()", "payables_payout_payment_sync()",
  ]) {
    const r = await um(
      `select has_function_privilege('anon','public.${f}','execute') a,
              has_function_privilege('authenticated','public.${f}','execute') u`
    );
    if (r.a || r.u) { internas = false; falha.push(`interna exposta: ${f}`); }
  }
  conf("as 5 internas não respondem a ninguém", internas);

  // -- O vencimento (dia 15, corte no dia 10) ---------------------------------
  const v = await um(
    `select public._payout_due_date('2026-11-10','2026-11-10')::text a,
            public._payout_due_date('2026-11-11','2026-11-11')::text b,
            public._payout_due_date('2026-11-05','2026-11-20')::text c,
            public._payout_due_date('2026-12-20','2026-12-21')::text d,
            public._payout_due_date('2026-11-01','2026-11-15')::text e`
  );
  conf("liberado até o dia 10 vence no dia 15 do mesmo mês", v.a === "2026-11-15" && v.e === "2026-11-15");
  conf("liberado depois do dia 10 vence no dia 15 do mês seguinte (vira o ano)", v.b === "2026-12-15" && v.d === "2027-01-15");
  conf("conta gerada depois do dia 15 que valia vence no dia em que nasce", v.c === "2026-11-20");

  // -- Cenário (desfeito no fim) ------------------------------------------------
  const adm = (await um("select id from public.profiles where is_admin_master and is_active order by created_at limit 1"))?.id;
  const alvo = await um(
    `select p.clinic_id, min(p.provider_id::text)::uuid provider_id, count(*)::int n
       from public.provider_payouts p
      where p.closing_id is null and p.session_id is not null
        and not exists (select 1 from public.payout_report_items i where i.payout_id = p.id and i.active)
        and not exists (select 1 from public.user_clinic_roles_all u
                         where u.clinic_id = p.clinic_id and u.role = 'unit_manager')
      group by p.clinic_id having count(distinct p.provider_id) = 1 and count(*) >= 4
      order by count(*) desc limit 1`
  );
  if (!adm || !alvo) throw new Error("NÃO MEDI: falta Admin Master ou uma unidade sem Gerente com 4 repasses abertos de um só profissional");
  const clinica = alvo.clinic_id;
  const dent = alvo.provider_id;
  await c.query(
    "update public.provider_payouts set amount_cents = 10000, no_payout = false, withheld = false where clinic_id=$1 and provider_id=$2 and closing_id is null",
    [clinica, dent]
  );
  const livres = await todos(
    `select p.id from public.profiles p
      where p.is_active and not p.is_admin_master and p.id <> $2
        and not exists (select 1 from public.user_clinic_roles_all u where u.user_id = p.id and u.clinic_id = $1)
        and not exists (select 1 from public.user_clinic_roles_all u where u.user_id = p.id and u.role = 'finance_franchisor')
      order by p.created_at limit 2`, [clinica, dent]
  );
  if (livres.length < 2) throw new Error("NÃO MEDI: faltam dois perfis livres no treino para fazer de Gerente e de estranho");
  const ger = livres[0].id;
  const estranho = livres[1].id;
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1,$2,'unit_manager')", [ger, clinica]);
  // O mês do relatório não pode estar fechado na contabilidade (a conta cairia em hoje).
  await c.query("update public.fiscal_periods set status = 'open' where clinic_id = $1 and status = 'closed'", [clinica]);
  const mes = (await um("select date_trunc('month', public.today_br())::date::text d")).d;
  const hoje = (await um("select public.today_br()::text d")).d;

  await de(adm, () => c.query("select public.payout_report_generate($1,$2,$3)", [clinica, mes, dent]));
  const rel = await um("select id, code, item_count from public.payout_reports where clinic_id=$1 and provider_id=$2 and status='rascunho'", [clinica, dent]);
  const R = rel.id;
  const n = rel.item_count;
  conf("cenário: relatório com 4 ou mais procedimentos de R$ 100,00", n >= 4);
  await de(adm, () => c.query("select public.payout_report_send($1)", [R]));

  // -- 1) Antes do dentista aprovar, nada vira conta ----------------------------
  const e1 = await de(adm, () => recusa("select public.payout_report_bill($1)", [R]));
  conf("relatório ainda com o aprovador: não gera conta", !!e1 && e1.includes("WRONG_STAGE"));
  await de(ger, () => c.query("select public.payout_report_manager_approve($1)", [R]));
  const e2 = await de(adm, () => recusa("select public.payout_report_bill($1)", [R]));
  const t0 = await de(adm, async () => (await um("select public.payout_reports_bill_all($1) n", [clinica])).n);
  conf("aprovado só pelo aprovador (falta o dentista): nada a pagar", !!e2 && e2.includes("NOTHING_TO_BILL") && t0 === 0);

  // -- 2) Aprovação parcial: o dentista contesta UMA linha ------------------------
  const itens = await de(dent, () => todos("select * from public.my_payout_report_detail($1)", [R]));
  const cont = itens[0].item_id;
  await de(dent, () => c.query("select public.payout_report_dentist_respond($1,$2::jsonb,null)", [
    R, JSON.stringify([{ item_id: cont, kind: "valor", text: "o combinado era outro valor" }]),
  ]));

  const e3 = await de(ger, () => recusa("select public.payout_report_bill($1)", [R]));
  const e4 = await de(dent, () => recusa("select public.payout_report_bill($1)", [R]));
  const e5 = await de(estranho, () => recusa("select public.payout_reports_bill_all($1)", [clinica]));
  conf("só o Financeiro da Franqueadora gera a conta (nem o Gerente, nem o dentista, nem um estranho)",
    [e3, e4, e5].every((e) => !!e && e.includes("NOT_ALLOWED")));

  const g1 = await de(adm, async () => (await um("select public.payout_reports_bill_all($1) n", [clinica])).n);
  const p1 = await um(
    `select pp.id, pp.amount_cents, pp.item_count, pp.accrual_date::text accrual, pa.id payable_id,
            pa.status, pa.account_code, pa.amount_cents pa_cents, pa.due_date::text due,
            pa.requires_approval, pa.reference,
            public._payout_due_date($2::date, $2::date)::text esperado,
            (select count(*)::int from public.financial_entries e
              where e.source_type='payable_accrual' and e.source_id=pa.id and e.status='open'
                and e.accrual_date = pp.accrual_date and e.amount_cents = pa.amount_cents) razao
       from public.payout_payments pp join public.payables pa on pa.id = pp.payable_id
      where pp.report_id=$1`, [R, hoje]);
  conf("APROVAÇÃO PARCIAL vira UMA conta a pagar só com o que está liberado",
    g1 === 1 && Number(p1.amount_cents) === (n - 1) * 10000 && p1.item_count === n - 1 && Number(p1.pa_cents) === (n - 1) * 10000);
  conf("a conta nasce aberta, sem alçada, em 2.1.01, com o número do relatório",
    p1.status === "aberta" && p1.requires_approval === false && p1.account_code === "2.1.01" && p1.reference === rel.code);
  conf("vencimento pelo dia 15 com corte no dia 10", p1.due === p1.esperado);
  conf("a despesa entra no resultado pelo mês do relatório (o fechamento antigo não lançava)",
    p1.razao === 1 && p1.accrual === mes);
  conf("o dentista é avisado do pagamento programado", (await avisos(dent, "programado")) === 1);

  // -- 3) As travas contra pagar duas vezes -----------------------------------------
  const e6 = await de(adm, () => recusa("select public.payout_report_bill($1)", [R]));
  const g2 = await de(adm, async () => (await um("select public.payout_reports_bill_all($1) n", [clinica])).n);
  conf("gerar de novo não leva o que já foi para uma conta", !!e6 && e6.includes("NOTHING_TO_BILL") && g2 === 0);
  const pago = itens[1].item_id;
  const t1 = await recusa("update public.payout_report_items set amount_cents = 1 where id=$1", [pago]);
  const t2 = await recusa("update public.payout_report_items set active = false where id=$1", [pago]);
  const t3 = await recusa("update public.payout_report_items set payment_id = null where id=$1", [pago]);
  const t4 = await recusa("update public.payout_report_items set status='excluido', active=false, exclusion_kind='adiar' where id=$1", [pago]);
  const t5 = await recusa("delete from public.payout_report_items where id=$1", [pago]);
  conf("linha em uma conta não muda de valor, não sai do relatório e não se solta (nem pelo superusuário)",
    [t1, t2, t3, t4, t5].every((e) => !!e && e.includes("ITEM_IN_PAYMENT")));
  const t6 = await recusa("update public.payout_report_items set payment_id = $2 where id=$1", [cont, p1.id]);
  conf("linha contestada (não liberada) não entra em conta", !!t6 && t6.includes("ITEM_NOT_RELEASED"));
  const t7 = await recusa("delete from public.payout_payments where id=$1", [p1.id]);
  const t8 = await recusa("update public.payout_payments set amount_cents = 1 where id=$1", [p1.id]);
  conf("a conta do repasse não se apaga nem muda de valor", [t7, t8].every((e) => !!e && e.includes("PAYMENT_LOCKED")));
  const dup = await recusa(
    `insert into public.payout_report_items (report_id, clinic_id, payout_id, finished_on, amount_cents)
     select $1, clinic_id, payout_id, finished_on, 1 from public.payout_report_items where id=$2`, [R, pago]);
  conf("procedimento em conta continua preso ao relatório (não entra em outro)", !!dup && dup.startsWith("23505"));
  const e7 = await de(adm, () => recusa("select public.close_payout_month($1,$2,0)", [clinica, mes]));
  conf("o 'Fechar o mês' antigo não gera mais nada", !!e7 && e7.includes("PAYOUT_CLOSING_RETIRED"));

  // -- 4) Quem lê o pagamento -----------------------------------------------------------
  const ld = await de(dent, async () => ({
    contas: await todos("select * from public.payout_report_payments($1)", [R]),
    resumo: await todos("select * from public.payout_report_billing($1::uuid[])", [[R]]),
    tabela: (await um("select count(*)::int n from public.payout_payments")).n,
  }));
  conf("o dentista vê o pagamento programado do relatório dele, sem o nome de quem gerou",
    ld.contas.length === 1 && ld.contas[0].state === "programado" && ld.contas[0].created_by_name === null &&
      ld.contas[0].item_ids.length === n - 1 && ld.tabela === 0);
  conf("resumo: o que está programado e o que ainda espera",
    ld.resumo.length === 1 && Number(ld.resumo[0].scheduled_cents) === (n - 1) * 10000 &&
      Number(ld.resumo[0].to_bill_cents) === 0 && Number(ld.resumo[0].paid_cents) === 0);
  const le = await de(estranho, async () => ({
    contas: await recusa("select * from public.payout_report_payments($1)", [R]),
    resumo: (await todos("select * from public.payout_report_billing($1::uuid[])", [[R]])).length,
  }));
  conf("um estranho não lê o pagamento de ninguém", !!le.contas && le.contas.includes("NOT_ALLOWED") && le.resumo === 0);
  const lg = await de(ger, () => todos("select * from public.payout_report_payments($1)", [R]));
  conf("o aprovador da unidade acompanha o pagamento", lg.length === 1 && lg[0].created_by_name !== null);

  // -- 5) A linha contestada se resolve → SEGUNDA conta do mesmo relatório -------------
  await de(ger, () => c.query("select public.payout_report_manager_answer($1,'manter','valor conforme a tabela do nível',null)", [cont]));
  await de(dent, () => c.query("select public.payout_report_dentist_respond($1,'[]'::jsonb,null)", [R]));
  const st = (await um("select status from public.payout_reports where id=$1", [R])).status;
  const r5a = await de(adm, async () => (await todos("select * from public.payout_report_billing($1::uuid[])", [[R]]))[0]);
  const P2 = await de(adm, async () => (await um("select public.payout_report_bill($1) id", [R])).id);
  const p2 = await um("select pp.amount_cents, pp.item_count, pa.id payable_id from public.payout_payments pp join public.payables pa on pa.id=pp.payable_id where pp.id=$1", [P2]);
  conf("a linha resolvida vira uma segunda conta, só com ela",
    st === "aprovado" && Number(r5a.to_bill_cents) === 10000 && r5a.to_bill_count === 1 &&
      Number(p2.amount_cents) === 10000 && p2.item_count === 1);

  // -- 6) Pagar: a marca de pago vem da conta a pagar ----------------------------------
  await de(adm, () => c.query("select public.register_payable_payment($1,$2,$3::date,'pix')", [p1.payable_id, (n - 1) * 10000, hoje]));
  const l6 = await de(dent, () => todos("select * from public.payout_report_payments($1) order by created_at", [R]));
  const r6 = await de(dent, async () => (await todos("select * from public.payout_report_billing($1::uuid[])", [[R]]))[0]);
  conf("conta paga: o dentista vê 'pago' com a data, e é avisado",
    l6[0].state === "pago" && String(l6[0].paid_on).length > 0 && l6[1].state === "programado" &&
      Number(r6.paid_cents) === (n - 1) * 10000 && Number(r6.scheduled_cents) === 10000 &&
      (await avisos(dent, "Repasse pago")) === 1);
  const e8 = await de(adm, () => recusa("select public.cancel_payable($1,'tentativa depois de pago')", [p1.payable_id]));
  conf("conta com baixa não se cancela", !!e8 && e8.includes("ALREADY_PAID"));

  // -- 7) Cancelar a conta SEM baixa devolve as linhas ----------------------------------
  await de(adm, () => c.query("select public.cancel_payable($1,'vencimento errado')", [p2.payable_id]));
  const r7 = await um(
    `select pp.status, pp.cancel_reason,
            (select count(*)::int from public.payout_report_items i where i.payment_id = pp.id) presos,
            (select payment_id from public.payout_report_items where id=$2) da_linha,
            (select released from public.payout_report_items where id=$2) liberada,
            (select status from public.financial_entries e where e.source_type='payable_accrual' and e.source_id=pp.payable_id) razao
       from public.payout_payments pp where pp.id=$1`, [P2, cont]);
  conf("conta cancelada: a linha volta para 'liberada' e a despesa sai do resultado",
    r7.status === "cancelada" && r7.cancel_reason === "vencimento errado" && r7.presos === 0 &&
      r7.da_linha === null && r7.liberada === true && r7.razao === "cancelled");
  const l7 = await de(dent, () => todos("select * from public.payout_report_payments($1)", [R]));
  const l7f = await de(adm, () => todos("select * from public.payout_report_payments($1)", [R]));
  conf("o dentista não vê a conta cancelada; o Financeiro vê, com o motivo",
    l7.length === 1 && l7f.length === 2 && l7f.some((x) => x.state === "cancelado" && x.cancel_reason === "vencimento errado"));
  const P3 = await de(adm, async () => (await um("select public.payout_report_bill($1) id", [R])).id);
  const p3 = await um("select amount_cents, status from public.payout_payments where id=$1", [P3]);
  conf("a linha devolvida entra em uma conta nova", Number(p3.amount_cents) === 10000 && p3.status === "ativa");
  const t9 = await recusa("update public.payout_payments set status='ativa' where id=$1", [P2]);
  conf("conta cancelada não volta a valer", !!t9 && t9.includes("PAYMENT_LOCKED"));

  // -- 8) Estornar o pagamento desfaz o "pago" (uma verdade só) --------------------------
  const pg = await um("select id from public.payable_payments where payable_id=$1 and not reversed", [p1.payable_id]);
  await de(adm, () => c.query("select public.reverse_payable_payment($1,'pago na conta errada')", [pg.id]));
  const l8 = await de(dent, () => todos("select * from public.payout_report_payments($1) order by created_at", [R]));
  conf("pagamento estornado: deixa de aparecer como pago", l8[0].state === "programado" && l8[0].paid_on === null);

  const acoes = (await de(adm, () => todos("select action from public.payout_report_history($1)", [R]))).map((r) => r.action);
  const esperadas = ["conta_gerada", "pago", "conta_cancelada", "pagamento_estornado"];
  conf("a linha do tempo guarda a conta gerada, o pagamento, o cancelamento e o estorno", esperadas.every((a) => acoes.includes(a)));
  if (!esperadas.every((a) => acoes.includes(a))) console.log("faltam na linha do tempo:", esperadas.filter((a) => !acoes.includes(a)));

  // -- 9) Mês fechado na contabilidade: a conta entra em hoje -----------------------------
  const pa3 = (await um("select payable_id from public.payout_payments where id=$1", [P3])).payable_id;
  await de(adm, () => c.query("select public.cancel_payable($1,'refazer com o mês fechado')", [pa3]));
  await c.query(
    `insert into public.fiscal_periods (clinic_id, year, month, status)
     values ($1, extract(year from $2::date)::int, extract(month from $2::date)::int, 'closed')
     on conflict (clinic_id, year, month) do update set status = 'closed'`, [clinica, "2020-01-01"]);
  await c.query("update public.payout_reports set period_month = '2020-01-01' where id=$1", [R]);
  const P4 = await de(adm, async () => (await um("select public.payout_report_bill($1) id", [R])).id);
  const p4 = await um("select accrual_date::text a from public.payout_payments where id=$1", [P4]);
  conf("mês do relatório fechado na contabilidade: a conta entra na data de hoje", p4.a === hoje);
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
