// ENSAIO DA 0402 no banco de TREINO, numa transação DESFEITA (rollback): nada fica.
// Uso: node scripts/repasse-ensaio-0402.mjs --confirmar
//
// A divergência do repasse que chega ao Financeiro: o roteiro (conversa com a
// unidade e com o dentista antes de decidir), o valor corrigido que volta para
// a unidade confirmar e o dentista aceitar (com UMA última volta ao
// Financeiro), e o adiado que leva a história ao próximo relatório. O ensaio
// monta o próprio cenário. Só contagens e valores na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0402_repasse_divergencia.sql";

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/repasse-ensaio-0402.mjs --confirmar",
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
const recusou = (e, code) => !!e && e.includes(code);

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query(sql);
  conf("aplicar duas vezes sem erro (idempotente)", true);

  let privs = true;
  for (const f of [
    "payout_mediation_record(uuid,text,text,text,uuid,text)",
    "payout_mediation_list(uuid)",
    "payout_mediation_people(uuid)",
    "payout_report_value_ack(uuid,text)",
    "payout_report_value_respond(uuid,boolean,text)",
    "payout_report_finance_decide(uuid,text,text,bigint,text,text)",
  ]) {
    const r = await um(
      `select has_function_privilege('anon','public.${f}','execute') a,
              has_function_privilege('authenticated','public.${f}','execute') u`
    );
    if (r.a || !r.u) { privs = false; falha.push(`privilégio errado em ${f}`); }
  }
  for (const f of ["_payout_mediation_done(uuid,text)", "_payout_item_origin(uuid)"]) {
    const r = await um(`select has_function_privilege('authenticated','public.${f}','execute') u`);
    if (r.u) { privs = false; falha.push(`interna aberta: ${f}`); }
  }
  conf("portas: sem login não, logado sim; internas fechadas", privs);
  const velha = await um(
    "select count(*)::int q from pg_proc where proname = 'payout_report_finance_decide' and pronamespace = 'public'::regnamespace");
  conf("a decisão do Financeiro tem uma versão só", velha.q === 1);

  // -- Cenário (o arranjo dos ensaios da 0400/0401) ------------------------------
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
  if (!adm || !alvo) throw new Error("NÃO MEDI: falta Admin Master ou uma unidade sem Gerente com 4 procedimentos não começados");
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
            exclusion_kind = 'adiar', exclusion_reason = 'ensaio 0402', review_state = null
       from public.provider_payouts p
      where p.id = i.payout_id and p.clinic_id = $1 and p.provider_id = $2 and i.active and i.payment_id is null`, [clinica, dent]);
  await c.query(
    `update public.payout_reports set status = 'cancelado', cancelled_at = now(), cancel_reason = 'ensaio 0402'
      where clinic_id = $1 and provider_id = $2 and status not in ('cancelado', 'aprovado')`, [clinica, dent]);
  await c.query(
    `update public.provider_payouts set withheld = true, withheld_reason = 'ensaio 0402'
      where clinic_id = $1 and provider_id = $2 and closing_id is null and failure_id is null`, [clinica, dent]);
  await c.query(
    `update public.treatment_sessions set status = 'done', done_at = now(), executed_by = $2
      where item_id = any($1::uuid[])`, [itens, dent]);
  const novos = (await todos(
    `select p.id from public.provider_payouts p
       join public.treatment_sessions s on s.id = p.session_id
      where s.item_id = any($1::uuid[]) and p.provider_id = $2 order by p.created_at, p.id`, [itens, dent])).map((r) => r.id);
  if (novos.length < 4) throw new Error("NÃO MEDI: concluir os 4 procedimentos não gerou 4 repasses");
  await c.query("update public.provider_payouts set amount_cents = 10000, withheld = false, no_payout = false where id = any($1::uuid[])", [novos]);
  const livres = await todos(
    `select p.id from public.profiles p
      where p.is_active and not p.is_admin_master and p.id <> $2
        and not exists (select 1 from public.user_clinic_roles_all u where u.user_id = p.id and u.clinic_id = $1)
        and not exists (select 1 from public.user_clinic_roles_all u where u.user_id = p.id and u.role = 'finance_franchisor')
      order by p.created_at limit 2`, [clinica, dent]);
  if (livres.length < 2) throw new Error("NÃO MEDI: faltam dois perfis livres (Gerente e estranho)");
  const [ger, estranho] = livres.map((r) => r.id);
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1,$2,'unit_manager')", [ger, clinica]);
  // O Coordenador da unidade deixa de aprovar (há Gerente agora).
  const mes = (await um("select date_trunc('month', public.today_br())::date::text d")).d;

  // -- Relatório até a 2ª contestação de 3 procedimentos ----------------------------
  await de(adm, () => c.query("select public.payout_report_generate($1,$2,$3)", [clinica, mes, dent]));
  const R = (await um("select id, code from public.payout_reports where clinic_id=$1 and provider_id=$2 and status='rascunho'", [clinica, dent]));
  await de(adm, () => c.query("select public.payout_report_send($1)", [R.id]));
  await de(ger, () => c.query("select public.payout_report_manager_approve($1)", [R.id]));
  const linhas = await todos(
    "select id, payout_id from public.payout_report_items where report_id=$1 and status='incluido' order by finished_on, procedure_name, id", [R.id]);
  if (linhas.length < 4) throw new Error("NÃO MEDI: o relatório não tem 4 procedimentos");
  const [A, B, C3] = linhas;
  const contesta = (ls) => JSON.stringify(ls.map((l) => ({ item_id: l.id, kind: "valor", text: "o valor combinado era outro" })));
  await de(dent, () => c.query("select public.payout_report_dentist_respond($1,$2::jsonb,null)", [R.id, contesta([A, B, C3])]));
  for (const l of [A, B, C3]) {
    await de(ger, () => c.query("select public.payout_report_manager_answer($1,'manter','o valor da tabela está certo',null)", [l.id]));
  }
  await de(dent, () => c.query("select public.payout_report_dentist_respond($1,$2::jsonb,null)", [R.id, contesta([A, B, C3])]));
  const st = await um("select status from public.payout_reports where id=$1", [R.id]);
  const fs = await um("select count(*) filter (where finance_since is not null)::int q from public.payout_report_items where id = any($1::uuid[])", [[A.id, B.id, C3.id]]);
  conf("2ª contestação: relatório com o Financeiro e o relógio da divergência ligado",
    st.status === "em_desempate" && fs.q === 3);

  // -- 1) O roteiro é exigido ---------------------------------------------------------
  const e1 = await de(adm, () => recusa("select public.payout_report_finance_decide($1,'manter','motivo do teste',null,null,'orientação ao time')", [A.id]));
  conf("decidir sem as conversas é recusado (MEDIATION_REQUIRED)", recusou(e1, "MEDIATION_REQUIRED"));
  const pessoas = await de(adm, () => todos("select * from public.payout_mediation_people($1)", [R.id]));
  conf("com quem falar: o Gerente (unidade) e o dentista",
    pessoas.some((p) => p.user_id === ger && p.party === "unidade") && pessoas.some((p) => p.user_id === dent && p.party === "dentista"));
  await de(adm, () => c.query("select public.payout_mediation_record($1,'unidade','conversou','whatsapp',$2,'Gerente confirmou o combinado')", [A.id, ger]));
  const e2 = await de(adm, () => recusa("select public.payout_report_finance_decide($1,'manter','motivo do teste',null,null,'orientação ao time')", [A.id]));
  conf("só a unidade não basta: falta o dentista", recusou(e2, "MEDIATION_REQUIRED"));
  const e3 = await de(adm, () => recusa("select public.payout_mediation_record($1,'dentista','conversou',null,$2,'conversa sem canal')", [A.id, dent]));
  conf("conversa sem canal é recusada", recusou(e3, "INVALID_KIND"));
  const e3b = await de(adm, () => recusa("select public.payout_mediation_record($1,'dentista','conversou','ligacao',$2,'contato errado')", [A.id, estranho]));
  conf("contato que não é o dentista nem o aprovador é recusado", recusou(e3b, "INVALID_CONTACT"));
  await de(adm, () => c.query("select public.payout_mediation_record($1,'dentista','sem_contato',null,$2,'não atendeu em 3 tentativas')", [A.id, dent]));
  const e4 = await de(adm, () => recusa("select public.payout_report_finance_decide($1,'manter','motivo do teste',null,null,null)", [A.id]));
  conf("decidir sem orientação é recusado (GUIDANCE_REQUIRED)", recusou(e4, "GUIDANCE_REQUIRED"));
  const e5 = await de(estranho, () => recusa("select public.payout_mediation_record($1,'unidade','conversou','chat',null,'tentando registrar')", [B.id]));
  const e6 = await de(dent, () => recusa("select * from public.payout_mediation_list($1)", [R.id]));
  const e6b = await de(ger, () => recusa("select * from public.payout_mediation_people($1)", [R.id]));
  conf("só o Financeiro registra e lê o roteiro (estranho, dentista e Gerente não)",
    recusou(e5, "NOT_ALLOWED") && recusou(e6, "NOT_ALLOWED") && recusou(e6b, "NOT_ALLOWED"));
  const e7 = await recusa("update public.payout_mediation_contacts set summary = 'mudado' where item_id = $1", [A.id]);
  const e8 = await recusa("delete from public.payout_mediation_contacts where item_id = $1", [A.id]);
  conf("o registro da conversa não muda nem se apaga", recusou(e7, "MEDIATION_LOCKED") && recusou(e8, "MEDIATION_LOCKED"));

  // -- 2) Corrigir PROPÕE: unidade confirma, dentista aceita ---------------------------
  await de(adm, () => c.query(
    "select public.payout_report_finance_decide($1,'corrigir','tabela do nível estava desatualizada',12000,null,'pagar pela tabela nova e revisar o nível')", [A.id]));
  const a1 = await um("select review_state, released, amount_cents, proposed_amount_cents from public.payout_report_items where id=$1", [A.id]);
  const s1 = await um("select status from public.payout_reports where id=$1", [R.id]);
  conf("corrigir não libera: valor proposto, com a unidade, valor antigo valendo",
    a1.review_state === "correcao_unidade" && !a1.released && n(a1.amount_cents) === 10000 && n(a1.proposed_amount_cents) === 12000 &&
      s1.status === "em_contestacao");
  const meuA0 = await de(dent, async () => (await todos("select * from public.my_payout_report_detail($1)", [R.id])).find((x) => x.item_id === A.id));
  conf("o dentista ainda não vê o valor proposto (a unidade confirma antes)", !!meuA0 && meuA0.proposed_amount_cents === null);
  const e9 = await de(dent, () => recusa("select public.payout_report_value_respond($1,true,null)", [A.id]));
  conf("o dentista não aceita antes da unidade", recusou(e9, "WRONG_STAGE"));
  const e10 = await de(dent, () => recusa("select public.payout_report_value_ack($1,null)", [A.id]));
  conf("o dentista não confirma pela unidade", recusou(e10, "NOT_ALLOWED"));
  await de(ger, () => c.query("select public.payout_report_value_ack($1,'conversei com o dentista')", [A.id]));
  const a2 = await um("select review_state from public.payout_report_items where id=$1", [A.id]);
  conf("a unidade confirmou: a linha vai ao dentista", a2.review_state === "correcao_dentista");

  // B: mesma proposta, para o dentista recusar depois.
  await de(adm, () => c.query("select public.payout_mediation_record($1,'unidade','conversou','ligacao',$2,'Gerente de acordo')", [B.id, ger]));
  await de(adm, () => c.query("select public.payout_mediation_record($1,'dentista','conversou','chat',$2,'dentista pediu revisão')", [B.id, dent]));
  await de(adm, () => c.query("select public.payout_report_finance_decide($1,'corrigir','ajuste parcial do valor',11000,null,'valor intermediário')", [B.id]));
  await de(ger, () => c.query("select public.payout_report_value_ack($1,null)", [B.id]));

  // C3: adiar (o caso da Londrina).
  await de(adm, () => c.query("select public.payout_mediation_record($1,'unidade','conversou','presencial',$2,'combinado adiar')", [C3.id, ger]));
  await de(adm, () => c.query("select public.payout_mediation_record($1,'dentista','conversou','whatsapp',$2,'dentista ciente do adiamento')", [C3.id, dent]));
  await de(adm, () => c.query("select public.payout_report_finance_decide($1,'excluir','falta conferir o prontuário',null,'adiar','vamos conferir e pagar no próximo')", [C3.id]));

  const s2 = await um("select status from public.payout_reports where id=$1", [R.id]);
  conf("valores novos esperando o dentista: relatório volta para ele", s2.status === "com_dentista");
  const meuA = await de(dent, async () => (await todos("select * from public.my_payout_report_detail($1)", [R.id])).find((x) => x.item_id === A.id));
  conf("agora o dentista vê o valor proposto e a orientação",
    !!meuA && n(meuA.proposed_amount_cents) === 12000 && !!meuA.finance_guidance);
  const lista = await de(dent, async () => (await todos("select * from public.my_payout_reports()")).find((x) => x.id === R.id));
  conf("em Meus repasses conta como esperando resposta", !!lista && lista.pending_count === 2);

  await de(dent, () => c.query("select public.payout_report_value_respond($1,true,'de acordo')", [A.id]));
  const a3 = await um("select review_state, released, amount_cents, original_amount_cents, proposed_amount_cents from public.payout_report_items where id=$1", [A.id]);
  const pA = await um("select amount_cents from public.provider_payouts where id=$1", [A.payout_id]);
  conf("o dentista aceitou: liberado pelo valor novo, o antigo guardado",
    a3.review_state === "aprovado" && a3.released && n(a3.amount_cents) === 12000 && n(a3.original_amount_cents) === 10000);
  conf("o valor aceito chega ao repasse (o Histórico passa a mostrar o certo)", n(pA.amount_cents) === 12000);

  // -- 3) O dentista não concorda: UMA volta ao Financeiro, que decide de vez ---------
  const e11 = await de(dent, () => recusa("select public.payout_report_value_respond($1,false,null)", [B.id]));
  conf("não concordar exige explicar", recusou(e11, "REASON_REQUIRED"));
  await de(dent, () => c.query("select public.payout_report_value_respond($1,false,'continua abaixo do combinado')", [B.id]));
  const b1 = await um("select review_state, final_round from public.payout_report_items where id=$1", [B.id]);
  const s3 = await um("select status from public.payout_reports where id=$1", [R.id]);
  conf("não concordou: volta ao Financeiro como rodada final", b1.review_state === "no_financeiro" && b1.final_round && s3.status === "em_desempate");
  const e12 = await de(adm, () => recusa("select public.payout_report_finance_decide($1,'corrigir','decisão final do valor',11500,null,'valor final explicado')", [B.id]));
  conf("a rodada final pede conversa nova (as antigas não contam)", recusou(e12, "MEDIATION_REQUIRED"));
  const conta = await de(adm, () => todos("select * from public.payout_mediation_list($1)", [R.id]));
  conf("a lista mostra as conversas antigas como fora desta rodada",
    conta.filter((x) => x.item_id === B.id).every((x) => x.counts === false));
  await de(adm, () => c.query("select public.payout_mediation_record($1,'unidade','conversou','ligacao',$2,'Gerente concorda com o meio-termo')", [B.id, ger]));
  await de(adm, () => c.query("select public.payout_mediation_record($1,'dentista','conversou','ligacao',$2,'expliquei o valor final')", [B.id, dent]));
  await de(adm, () => c.query("select public.payout_report_finance_decide($1,'corrigir','decisão final do valor',11500,null,'valor final explicado')", [B.id]));
  const b2 = await um("select review_state, released, amount_cents from public.payout_report_items where id=$1", [B.id]);
  const pB = await um("select amount_cents from public.provider_payouts where id=$1", [B.payout_id]);
  const s4 = await um("select status from public.payout_reports where id=$1", [R.id]);
  conf("na rodada final a correção libera direto, e chega ao repasse",
    b2.review_state === "aprovado" && b2.released && n(b2.amount_cents) === 11500 && n(pB.amount_cents) === 11500);
  conf("tudo resolvido: relatório aprovado", s4.status === "aprovado");

  // -- 4) O adiado leva a história ao próximo relatório -------------------------------
  await de(adm, () => c.query("select public.payout_report_generate($1,$2,$3)", [clinica, mes, dent]));
  const R2 = (await um("select id from public.payout_reports where clinic_id=$1 and provider_id=$2 and status='rascunho'", [clinica, dent]))?.id;
  const det = R2 ? await de(adm, () => todos("select * from public.payout_report_items_detail($1)", [R2])) : [];
  const volta = det.find((x) => x.payout_id === C3.payout_id);
  conf("o adiado volta no próximo relatório dizendo de onde veio e por quê",
    !!volta && volta.prev_report_code === R.code && volta.prev_reason === "falta conferir o prontuário" && !!volta.prev_guidance);

  // -- 5) O lembrete da divergência parada ----------------------------------------------
  // Um terceiro caso parado: o D, contestado 2× num relatório de ensaio direto.
  await c.query("update public.payout_report_items set review_state='no_financeiro' where id=$1", [linhas[3].id]);
  await c.query("update public.payout_report_items set finance_since = now() - interval '10 days', finance_reminded_at = null where id=$1", [linhas[3].id]);
  await c.query("select public.payout_report_deadline_run()");
  const d1 = await um("select finance_reminded_at from public.payout_report_items where id=$1", [linhas[3].id]);
  const ev = await um("select count(*)::int q from public.payout_report_events where item_id=$1 and action='divergencia_parada'", [linhas[3].id]);
  await c.query("select public.payout_report_deadline_run()");
  const ev2 = await um("select count(*)::int q from public.payout_report_events where item_id=$1 and action='divergencia_parada'", [linhas[3].id]);
  conf("divergência parada 3 dias úteis: o Financeiro é lembrado uma vez", !!d1.finance_reminded_at && ev.q === 1 && ev2.q === 1);
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
