// ENSAIO DA 0391 no banco de TREINO, numa transação DESFEITA (rollback): nada fica.
// Uso: node scripts/repasse-ensaio-0391.mjs --confirmar
//
// Percorre o caminho inteiro do relatório de repasse (Etapa 3): o Financeiro
// envia; o aprovador certo confere (Financeiro, Coordenador ou Gerente,
// conforme a unidade); o dentista aprova e contesta; o aprovador responde; a
// 2ª contestação vai ao Financeiro; o prazo lembra e avisa, sem aprovar.
// Só contagens e valores na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0391_repasse_aprovacoes.sql";

// O ensaio grava papéis e relatórios de mentira e tenta atos proibidos, tudo
// numa transação desfeita. Pede autorização como os outros (OC-00088).
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/repasse-ensaio-0391.mjs --confirmar",
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
// Volta ao superusuário E apaga a identidade: o espelho do treino (0260) barra
// a gravação de funções olhando a reivindicação do token, não o papel.
const voltar = async () => {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
};
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const todos = async (sql, p = []) => (await c.query(sql, p)).rows;
/** Roda `fn` como a pessoa e volta ao superusuário. */
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
    "conferência 7·15·12·1·0·0",
    Number(cf.situacoes) === 7 && Number(cf.colunas_do_item) === 15 && Number(cf.funcoes) === 12 &&
      Number(cf.rotina_diaria) === 1 && Number(cf.regras_de_escrita) === 0 &&
      Number(cf.regras_para_o_dentista) === 0
  );

  let privs = true;
  for (const f of [
    "payout_report_send(uuid)", "payout_report_return(uuid,text)", "payout_report_manager_approve(uuid)",
    "payout_report_dentist_respond(uuid,jsonb,text)", "payout_report_manager_answer(uuid,text,text,text)",
    "payout_report_finance_decide(uuid,text,text,bigint,text)", "payout_reports_to_approve()",
    "my_payout_reports()", "my_payout_report_detail(uuid)", "payout_report_viewer(uuid)",
    "can_approve_payout_report(uuid)", "payout_report_list(uuid,uuid)", "payout_report_items_detail(uuid)",
    "payout_report_history(uuid)", "payout_report_exclude_item(uuid,text,text)", "payout_report_restore_item(uuid)",
  ]) {
    const r = await um(
      `select has_function_privilege('anon','public.${f}','execute') a,
              has_function_privilege('authenticated','public.${f}','execute') u`
    );
    if (r.a || !r.u) { privs = false; falha.push(`privilégio errado em ${f}`); }
  }
  conf("16 funções: sem login não, logado sim", privs);
  let internas = true;
  for (const f of [
    "_payout_report_approvers(uuid)", "_payout_report_approver_kind(uuid)", "_payout_report_can_read(uuid)",
    "_payout_add_business_days(date,integer)", "_payout_finance_users()", "_payout_report_sync(uuid)",
    "_payout_report_notify(uuid[],uuid,text,text,text)", "_payout_report_reviewers(uuid)",
    "_payout_report_can_adjust(uuid,text)", "payout_report_deadline_run()",
  ]) {
    const r = await um(`select has_function_privilege('authenticated','public.${f}','execute') u`);
    if (r.u) { internas = false; falha.push(`interna exposta: ${f}`); }
  }
  conf("as 10 internas (e a rotina do prazo) não respondem a logado", internas);

  // -- Dias úteis -----------------------------------------------------------
  const du = await um(
    `select public._payout_add_business_days('2026-11-13', 1)::text a,
            public._payout_add_business_days('2026-11-13', 5)::text b,
            (select count(*)::int from public.holidays where scope='national' and holiday_date='2026-11-20') f`
  );
  conf("sexta + 1 dia útil = segunda", du.a === "2026-11-16");
  if (du.f > 0) conf("5 dias úteis pulam o feriado nacional de 20/11", du.b === "2026-11-23");
  else conf("5 dias úteis sem feriado no caminho", du.b === "2026-11-20");

  // -- Cenário (desfeito no fim) ----------------------------------------------
  const adm = (await um("select id from public.profiles where is_admin_master and is_active order by created_at limit 1"))?.id;
  // Uma unidade SEM Gerente, com um só profissional com repasses abertos.
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
    "update public.provider_payouts set amount_cents = 10000, no_payout = false where clinic_id=$1 and provider_id=$2 and closing_id is null",
    [clinica, dent]
  );
  // O dentista do cenário passa a ser o ÚNICO Coordenador da unidade (o caso de Cambé).
  await c.query("delete from public.user_clinic_roles_all where clinic_id=$1 and role='clinical_coordinator' and user_id <> $2", [clinica, dent]);
  await c.query(
    `insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1,$2,'clinical_coordinator')
     on conflict (user_id, clinic_id) do update set role = 'clinical_coordinator'`, [dent, clinica]);
  const livres = await todos(
    `select p.id from public.profiles p
      where p.is_active and not p.is_admin_master and p.id <> $2
        and not exists (select 1 from public.user_clinic_roles_all u where u.user_id = p.id and u.clinic_id = $1)
        and not exists (select 1 from public.user_clinic_roles_all u where u.user_id = p.id and u.role = 'finance_franchisor')
      order by p.created_at limit 2`, [clinica, dent]
  );
  if (livres.length < 2) throw new Error("NÃO MEDI: faltam dois perfis livres no treino para fazer de Coordenador e Gerente");
  const coord = livres[0].id;
  const ger = livres[1].id;
  const estranho = "00000000-0000-0000-0000-000000000001";
  const mes = (await um("select date_trunc('month', public.today_br())::date::text d")).d;

  await de(adm, () => c.query("select public.payout_report_generate($1,$2,$3)", [clinica, mes, dent]));
  const rel = await um("select id, code, item_count, total_cents from public.payout_reports where clinic_id=$1 and provider_id=$2 and status='rascunho'", [clinica, dent]);
  const n = rel.item_count;
  conf("cenário: relatório em rascunho com os procedimentos", n >= 4 && Number(rel.total_cents) === n * 10000);
  const R = rel.id;
  const situacao = async () => (await um("select status from public.payout_reports where id=$1", [R])).status;

  // -- 1) Relatório do próprio Coordenador: quem aprova é o Financeiro, e não quem enviou
  const e0 = await de(dent, () => recusa("select public.payout_report_send($1)", [R]));
  conf("o dentista não envia o próprio relatório", !!e0 && e0.includes("NOT_ALLOWED"));
  const k1 = await de(adm, async () => (await um("select public.payout_report_send($1) k", [R])).k);
  conf("sem outro aprovador na unidade, vai para o Financeiro da Franqueadora", k1 === "financeiro" && (await situacao()) === "com_gerente");
  const e1 = await de(adm, () => recusa("select public.payout_report_manager_approve($1)", [R]));
  conf("quem ENVIOU não aprova o mesmo relatório", !!e1 && e1.includes("NOT_ALLOWED"));
  const e1b = await de(adm, () => recusa("select public.payout_report_send($1)", [R]));
  conf("enviar duas vezes é recusado", !!e1b && e1b.includes("REPORT_NOT_DRAFT"));

  // -- 2) Unidade sem Gerente: o Coordenador (que não é o dentista) aprova ------
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1,$2,'clinical_coordinator')", [coord, clinica]);
  const k2 = await um("select public._payout_report_approver_kind($1) k", [R]);
  const pc = await de(coord, async () => (await um("select public.can_approve_payout_report($1) v", [R])).v);
  conf("unidade sem Gerente: aprova o Coordenador clínico", k2.k === "coordenador" && pc === true);
  const lc = await de(coord, async () => ({
    fila: (await todos("select id from public.payout_reports_to_approve()")).map((r) => r.id),
    detalhe: (await todos("select * from public.payout_report_items_detail($1)", [R])).length,
    tabela: (await um("select count(*)::int n from public.payout_reports")).n,
  }));
  conf("o Coordenador vê o relatório na fila dele e abre o detalhe (sem ver o Financeiro)",
    lc.fila.includes(R) && lc.detalhe === n && lc.tabela === 0);

  // -- 3) Unidade com Gerente: só o Gerente ----------------------------------
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1,$2,'unit_manager')", [ger, clinica]);
  const k3 = await um("select public._payout_report_approver_kind($1) k", [R]);
  const pc2 = await de(coord, async () => (await um("select public.can_approve_payout_report($1) v", [R])).v);
  const e2 = await de(coord, () => recusa("select public.payout_report_manager_approve($1)", [R]));
  conf("unidade com Gerente: o Coordenador deixa de aprovar", k3.k === "gerente" && pc2 === false && !!e2 && e2.includes("NOT_ALLOWED"));
  const e3 = await de(dent, () => recusa("select public.payout_report_manager_approve($1)", [R]));
  const e4 = await de(estranho, () => recusa("select public.payout_report_manager_approve($1)", [R]));
  const e5 = await de(adm, () => recusa("select public.payout_report_manager_approve($1)", [R]));
  conf("não aprovam: o próprio dentista, um estranho, nem o Financeiro quando há Gerente",
    [e3, e4, e5].every((e) => !!e && e.includes("NOT_ALLOWED")));

  // -- 4) O Gerente ajusta, devolve; o Financeiro reenvia ---------------------
  const itens0 = await de(ger, () => todos("select * from public.payout_report_items_detail($1)", [R]));
  const e6 = await de(ger, () => recusa("select public.payout_report_exclude_item($1,'adiar','')", [itens0[0].item_id]));
  await de(ger, () => c.query("select public.payout_report_exclude_item($1,'adiar','conferir com o laboratório')", [itens0[0].item_id]));
  const t1 = Number((await um("select total_cents from public.payout_reports where id=$1", [R])).total_cents);
  await de(ger, () => c.query("select public.payout_report_restore_item($1)", [itens0[0].item_id]));
  conf("o Gerente exclui com motivo e devolve a linha, na vez dele", !!e6 && e6.includes("REASON_REQUIRED") && t1 === (n - 1) * 10000);
  const e7 = await de(adm, () => recusa("select public.payout_report_exclude_item($1,'adiar','financeiro fora da vez')", [itens0[0].item_id]));
  conf("depois de enviado, o Financeiro não mexe mais nas linhas", !!e7 && e7.includes("NOT_ALLOWED"));
  const e8 = await de(ger, () => recusa("select public.payout_report_return($1,'  ')", [R]));
  await de(ger, () => c.query("select public.payout_report_return($1,'gerado com o mês errado')", [R]));
  conf("devolver ao Financeiro exige motivo e volta a rascunho",
    !!e8 && e8.includes("REASON_REQUIRED") && (await situacao()) === "rascunho" && (await avisos(adm, "devolvido")) >= 1);
  const k4 = await de(adm, async () => (await um("select public.payout_report_send($1) k", [R])).k);
  conf("reenviado, agora para o Gerente (que recebe o aviso)", k4 === "gerente" && (await avisos(ger, "para aprovar")) >= 1);

  // -- 5) Antes da aprovação do Gerente, o dentista não vê nada ------------------
  const d0 = await de(dent, async () => ({
    lista: (await todos("select id from public.my_payout_reports()")).length,
    detalhe: await recusa("select * from public.my_payout_report_detail($1)", [R]),
    responder: await recusa("select public.payout_report_dentist_respond($1)", [R]),
  }));
  conf("antes do Gerente aprovar, o dentista não vê nem responde",
    d0.lista === 0 && !!d0.detalhe && d0.detalhe.includes("NOT_ALLOWED") && !!d0.responder && d0.responder.includes("WRONG_STAGE"));

  // -- 6) O Gerente aprova (um relatório) e o prazo começa -----------------------
  await de(ger, () => c.query("select public.payout_report_manager_approve($1)", [R]));
  const r6 = await um(
    `select status, manager_by, dentist_due_on::text due,
            public._payout_add_business_days(public.today_br(), 5)::text esperado
       from public.payout_reports where id=$1`, [R]);
  conf("aprovado pelo Gerente: vai ao dentista com prazo de 5 dias úteis",
    r6.status === "com_dentista" && r6.manager_by === ger && r6.due === r6.esperado && (await avisos(dent, "pronto para conferir")) >= 1);
  const e9 = await de(ger, () => recusa("select public.payout_report_manager_approve($1)", [R]));
  conf("aprovar duas vezes é recusado", !!e9 && e9.includes("WRONG_STAGE"));
  // Aprovar recebe UM relatório; nenhuma função de aprovação aceita lista.
  const lote = await um(
    `select count(*) filter (where p.proname = 'payout_report_manager_approve' and p.pronargs = 1)::int uma,
            count(*) filter (where exists (
              select 1 from unnest(p.proargtypes::oid[]) t(o)
               join pg_type ty on ty.oid = t.o
              where ty.typcategory = 'A' or ty.typname in ('json', 'jsonb')))::int com_lista
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname ilike '%approve%'`);
  conf("não existe função de aprovar em lote", lote.uma === 1 && lote.com_lista === 0);

  // -- 7) O prazo lembra e avisa, sem aprovar ---------------------------------------
  await c.query("update public.payout_reports set dentist_since = public.today_br() - 6, dentist_due_on = public.today_br() + 1 where id=$1", [R]);
  await c.query("select public.payout_report_deadline_run()");
  const p1 = await um("select dentist_reminded_at, dentist_escalated_at, status from public.payout_reports where id=$1", [R]);
  conf("3º dia útil: lembrete ao dentista", p1.dentist_reminded_at !== null && p1.dentist_escalated_at === null && (await avisos(dent, "Lembrete")) === 1);
  await c.query("update public.payout_reports set dentist_due_on = public.today_br() - 1 where id=$1", [R]);
  await c.query("select public.payout_report_deadline_run()");
  await c.query("select public.payout_report_deadline_run()");
  const p2 = await um(
    `select r.dentist_escalated_at, r.status,
            (select count(*)::int from public.payout_report_items i where i.report_id=r.id and i.released) lib
       from public.payout_reports r where r.id=$1`, [R]);
  conf("prazo vencido: avisa o aprovador uma vez e NÃO aprova nada",
    p2.dentist_escalated_at !== null && p2.status === "com_dentista" && p2.lib === 0 && (await avisos(ger, "sem resposta")) === 1);

  // -- 8) O dentista vê só o que é dele -----------------------------------------------
  const d1 = await de(dent, async () => ({
    lista: await todos("select * from public.my_payout_reports()"),
    itens: await todos("select * from public.my_payout_report_detail($1)", [R]),
    tabela: (await um("select count(*)::int n from public.payout_reports")).n,
    itensTabela: (await um("select count(*)::int n from public.payout_report_items")).n,
    historico: await recusa("select * from public.payout_report_history($1)", [R]),
    interno: await recusa("select * from public.payout_report_items_detail($1)", [R]),
  }));
  conf("Meus repasses mostra o relatório e as linhas incluídas",
    d1.lista.length === 1 && d1.lista[0].id === R && d1.itens.length === n && d1.lista[0].pending_count === n);
  conf("o que o dentista recebe não traz o registro interno",
    !("exclusion_reason" in d1.itens[0]) && !("excluded_by_name" in d1.itens[0]) &&
      !!d1.historico && d1.historico.includes("NOT_ALLOWED") && !!d1.interno && d1.interno.includes("NOT_ALLOWED"));
  conf("o dentista não lê as tabelas do relatório direto", d1.tabela === 0 && d1.itensTabela === 0);
  const outro = await de(coord, () => recusa("select * from public.my_payout_report_detail($1)", [R]));
  conf("outro profissional não abre o relatório do colega", !!outro && outro.includes("NOT_ALLOWED"));

  // -- 9) O dentista responde: contesta duas linhas, aprova o resto (parcial) ---------
  const [i1, i2] = d1.itens;
  const cont = (arr) => JSON.stringify(arr);
  const e10 = await de(dent, () => recusa("select public.payout_report_dentist_respond($1,$2::jsonb,null)",
    [R, cont([{ item_id: i1.item_id, kind: "valor", text: "" }])]));
  const e11 = await de(dent, () => recusa("select public.payout_report_dentist_respond($1,$2::jsonb,null)",
    [R, cont([{ item_id: i1.item_id, kind: "inventado", text: "motivo qualquer" }])]));
  const e12 = await de(ger, () => recusa("select public.payout_report_dentist_respond($1,'[]'::jsonb,null)", [R]));
  conf("contestar exige motivo da lista e texto; só o dentista responde",
    !!e10 && e10.includes("REASON_REQUIRED") && !!e11 && e11.includes("INVALID_KIND") && !!e12 && e12.includes("NOT_ALLOWED"));
  const pend = await um("select count(*)::int n from public.payout_report_items where report_id=$1 and review_state='pendente'", [R]);
  conf("resposta recusada não aprova nada pela metade", pend.n === n);

  const s9 = await de(dent, async () => (await um("select public.payout_report_dentist_respond($1,$2::jsonb,$3) s", [
    R,
    cont([
      { item_id: i1.item_id, kind: "valor", text: "o combinado era outro valor" },
      { item_id: i2.item_id, kind: "nao_fui_eu", text: "quem concluiu foi outro colega" },
    ]),
    "faltou a restauração feita no dia 5",
  ])).s);
  const r9 = await um(
    `select r.status, r.missing_note,
            (select count(*)::int from public.payout_report_items i where i.report_id=r.id and i.released) lib,
            (select coalesce(sum(i.amount_cents),0)::bigint from public.payout_report_items i where i.report_id=r.id and i.released) lib_cents,
            (select count(*)::int from public.payout_report_items i where i.report_id=r.id and i.review_state='contestado') cont
       from public.payout_reports r where r.id=$1`, [R]);
  conf("APROVAÇÃO PARCIAL: o que não foi contestado fica liberado para pagar",
    s9 === "em_contestacao" && r9.status === "em_contestacao" && r9.lib === n - 2 &&
      Number(r9.lib_cents) === (n - 2) * 10000 && r9.cont === 2);
  conf("'está faltando procedimento' chega ao aprovador", !!r9.missing_note && (await avisos(ger, "contestação")) >= 1);
  const e13 = await de(dent, () => recusa("select public.payout_report_dentist_respond($1,'[]'::jsonb,null)", [R]));
  conf("com a contestação no aprovador, o dentista espera", !!e13 && e13.includes("WRONG_STAGE"));

  // -- 10) O aprovador responde, linha a linha ------------------------------------------
  const e14 = await de(dent, () => recusa("select public.payout_report_manager_answer($1,'manter','respondo eu mesmo',null)", [i1.item_id]));
  const e15 = await de(ger, () => recusa("select public.payout_report_manager_answer($1,'manter','  ',null)", [i1.item_id]));
  conf("só o aprovador responde, e com texto", !!e14 && e14.includes("NOT_ALLOWED") && !!e15 && e15.includes("REASON_REQUIRED"));
  await de(ger, () => c.query("select public.payout_report_manager_answer($1,'excluir','procede: foi outro profissional','nao_pagar')", [i2.item_id]));
  const w = await um("select p.withheld from public.provider_payouts p join public.payout_report_items i on i.payout_id=p.id where i.id=$1", [i2.item_id]);
  conf("contestação aceita: a linha sai do relatório (não pagar)", w.withheld === true && (await situacao()) === "em_contestacao");
  const s10 = await de(ger, async () => (await um("select public.payout_report_manager_answer($1,'manter','valor conforme a tabela do nível',null) s", [i1.item_id])).s);
  const visto = await de(dent, () => todos("select item_id, review_state, manager_response from public.my_payout_report_detail($1)", [R]));
  conf("contestação mantida: volta ao dentista com a resposta e prazo novo",
    s10 === "com_dentista" && visto.find((v) => v.item_id === i1.item_id).manager_response !== null &&
      visto.find((v) => v.item_id === i1.item_id).review_state === "pendente" &&
      !visto.some((v) => v.item_id === i2.item_id) && (await avisos(dent, "Resposta")) >= 1);

  // -- 11) 2ª contestação da mesma linha → Financeiro decide ------------------------------
  const s11 = await de(dent, async () => (await um("select public.payout_report_dentist_respond($1,$2::jsonb,null) s", [
    R, cont([{ item_id: i1.item_id, kind: "valor", text: "continuo discordando do valor" }]),
  ])).s);
  conf("2ª contestação da mesma linha vai ao Financeiro", s11 === "em_desempate");
  const e16 = await de(ger, () => recusa("select public.payout_report_finance_decide($1,'manter','decido eu',null,null)", [i1.item_id]));
  const e17 = await de(adm, () => recusa("select public.payout_report_finance_decide($1,'corrigir','mesmo valor',10000,null)", [i1.item_id]));
  const e18 = await de(adm, () => recusa("select public.payout_report_finance_decide($1,'manter','',null,null)", [i1.item_id]));
  conf("só o Financeiro decide, com motivo e valor diferente",
    !!e16 && e16.includes("NOT_ALLOWED") && !!e17 && e17.includes("INVALID_AMOUNT") && !!e18 && e18.includes("REASON_REQUIRED"));
  const s12 = await de(adm, async () => (await um("select public.payout_report_finance_decide($1,'corrigir','tabela do nível estava desatualizada',8000,null) s", [i1.item_id])).s);
  const fim = await um(
    `select r.status, r.total_cents, r.item_count, r.approved_at,
            (select count(*)::int from public.payout_report_items i where i.report_id=r.id and i.status='incluido' and not i.released) nao_lib,
            (select original_amount_cents from public.payout_report_items where id=$2) antes,
            (select amount_cents from public.payout_report_items where id=$2) depois
       from public.payout_reports r where r.id=$1`, [R, i1.item_id]);
  conf("o Financeiro corrige o valor (o antigo fica guardado) e o relatório fica aprovado",
    s12 === "aprovado" && fim.status === "aprovado" && fim.approved_at !== null && fim.nao_lib === 0 &&
      Number(fim.antes) === 10000 && Number(fim.depois) === 8000 &&
      fim.item_count === n - 1 && Number(fim.total_cents) === (n - 2) * 10000 + 8000);
  const e19 = await de(ger, () => recusa("select public.payout_report_exclude_item($1,'adiar','depois de aprovado')", [d1.itens[2].item_id]));
  const e20 = await de(adm, () => recusa("select public.payout_report_cancel($1,'depois de aprovado')", [R]));
  conf("relatório aprovado não é mais ajustado nem cancelado",
    !!e19 && e19.includes("REPORT_NOT_DRAFT") && !!e20 && e20.includes("REPORT_NOT_DRAFT"));

  const acoes = (await de(ger, () => todos("select action from public.payout_report_history($1)", [R]))).map((r) => r.action);
  const esperadas = ["gerado", "enviado_para_aprovacao", "devolvido_ao_financeiro", "enviado_ao_dentista",
    "prazo_vencido", "dentista_respondeu", "contestado", "faltando_procedimento", "resposta_mantem",
    "item_nao_pagar", "contestado_de_novo", "em_desempate", "financeiro_corrigiu", "aprovado"];
  conf("a linha do tempo guarda cada passo", esperadas.every((a) => acoes.includes(a)));
  if (!esperadas.every((a) => acoes.includes(a))) console.log("faltam na linha do tempo:", esperadas.filter((a) => !acoes.includes(a)));

  // O adiado/"não pagar" não volta sozinho; e a trava do relatório ativo continua.
  const dup = await recusa(
    `insert into public.payout_report_items (report_id, clinic_id, payout_id, finished_on, amount_cents)
     select $1, clinic_id, payout_id, finished_on, 1 from public.payout_report_items where id=$2`, [R, d1.itens[2].item_id]);
  conf("procedimento aprovado continua preso ao relatório (não entra em outro)", !!dup && dup.startsWith("23505"));
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
