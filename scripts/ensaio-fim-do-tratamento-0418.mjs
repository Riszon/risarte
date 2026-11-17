// ENSAIO DA 0418 (fim do tratamento) no banco de TREINO — tudo numa transação
// DESFEITA no fim; nada fica gravado.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/ensaio-fim-do-tratamento-0418.mjs [--quebrar=ortho|urgencia|pergunta]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const W = process.cwd().split("\\").join("/") + "/";
const { connect } = await import(pathToFileURL(W + "scripts/test-db.mjs").href);
const quebrar = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? "";

let sql = readFileSync(W + "supabase/migrations/0418_fim_do_tratamento_o_motor.sql", "utf8");
// Quebras de propósito: a régua tem de reprovar.
if (quebrar === "ortho") sql = sql.replace("and o.status in ('aguardando_inicio', 'em_tratamento', 'suspenso')", "and o.status in ('nenhum')");
if (quebrar === "urgencia") sql = sql.replace("    when v_phase = 'commercial_conversion' and v_type = 'treatment_start' then 'treatment_start'\n    when v_phase = 'follow_up' and v_type = 'reevaluation'", "    when v_phase = 'acquisition' and v_type in ('urgency', 'emergency') then 'treatment_start'\n    when v_phase = 'commercial_conversion' and v_type = 'treatment_start' then 'treatment_start'\n    when v_phase = 'follow_up' and v_type = 'reevaluation'");
if (quebrar === "pergunta") sql = sql.replace("      v_asked, coalesce(v_auto, false), v_user);", "      v_asked, coalesce(v_auto, false), v_user) where false;");

// Sem quebra, a 0420 (a instalação não termina o plano) vai por cima: o
// ensaio prova que a correção não quebrou nada da 0418.
if (!quebrar) sql += "\n" + readFileSync(W + "supabase/migrations/0420_fim_do_tratamento_instalacao_ortodontica.sql", "utf8")
  + "\n" + readFileSync(W + "supabase/migrations/0421_fim_do_tratamento_qualidade.sql", "utf8")
  + "\n" + readFileSync(W + "supabase/migrations/0422_fim_do_tratamento_uma_decisao_por_cliente.sql", "utf8");
// 0422: o Sim e o Não sei pedem considerações; o horário longe pede escolha.
const NOTAS = quebrar ? "" : ", 'Considerações de ensaio para o Coordenador', 'manter'";
const ASSINATURA = quebrar ? "uuid,text" : "uuid,text,text,text";
if (quebrar && sql === readFileSync(W + "supabase/migrations/0418_fim_do_tratamento_o_motor.sql", "utf8")) throw new Error(`a quebra "${quebrar}" não achou o que quebrar: não mediu nada`);
const c = await connect();
let ok = 0, falhou = 0;
const check = (cond, txt) => { if (cond) { ok++; console.log("  ✔ " + txt); } else { falhou++; console.log("  ✘ " + txt); } };
const one = async (q, p = []) => (await c.query(q, p)).rows[0];
const asUser = async (uid) => {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  await c.query("set local role authenticated");
};
const asSuper = async () => { await c.query("reset role"); await c.query("select set_config('request.jwt.claims', '', true)"); };
const espera = async (txt, fn, codigo) => {
  await c.query("savepoint s");
  try { await fn(); check(false, `${txt} (devia recusar com ${codigo})`); await c.query("rollback to savepoint s"); }
  catch (e) { await c.query("rollback to savepoint s"); check(String(e.message).includes(codigo), `${txt} → ${e.message}`); }
};

const LONDRINA = "9490e17e-2f0c-4a2d-838b-0990577a2ab7";
let A, B, C, D;

try {
  await c.query("begin");
  await c.query(sql);
  console.log(`0418 aplicada na transação${quebrar ? ` (QUEBRADA: ${quebrar})` : ""}.`);

  // Os clientes do ensaio são escolhidos NA HORA (a equipe mexe no treino):
  // Fase 5 em Londrina, sessões abertas de UM plano vendido, nenhuma outra
  // sessão aberta, sem ortodontia e sem fechamento ainda.
  const cand = (await c.query(`
    with abertas as (
      select ts.client_id, ts.plan_id, count(*) n from public.treatment_sessions ts
       where ts.status in ('pending','scheduled') and ts.plan_id is not null group by 1, 2)
    select a.client_id from abertas a join public.clients cl on cl.id = a.client_id
     where cl.clinic_id = $1 and cl.journey_phase = 'treatment_start'
       and a.n = (select count(*) from public.treatment_sessions x where x.client_id = a.client_id and x.status in ('pending','scheduled'))
       and not exists (select 1 from public.ortho_cases o where o.client_id = a.client_id)
       and not exists (select 1 from public.treatment_closures f where f.client_id = a.client_id)
       and not exists (select 1 from public.treatment_plans tp where tp.client_id = a.client_id and tp.complement_of_plan_id is not null)
       and exists (select 1 from public.plan_negotiations n join public.commercial_sales s on s.negotiation_id = n.id
                    where n.plan_id = a.plan_id and s.closed_at is not null and s.cancelled_at is null)
     order by a.n, a.client_id limit 4`, [LONDRINA])).rows.map((r) => r.client_id);
  if (cand.length < 4) throw new Error(`o treino só tem ${cand.length} cliente(s) que servem ao ensaio (precisa de 4): não dá para medir`);
  [A, B, C, D] = cand;

  const role = async (r) => (await one(
    `select u.user_id from public.user_clinic_roles u join public.profiles p on p.id = u.user_id
      where u.clinic_id = $1 and u.role = $2 and coalesce(p.is_owner,false) = false and p.is_admin_master = false
      order by p.email like '%example.com' desc limit 1`, [LONDRINA, r]))?.user_id;
  const DENT = await role("dentist"), COORD = await role("clinical_coordinator"), RECEP = await role("receptionist");
  check(DENT && COORD && RECEP, "achou dentista, Coordenador e recepção de teste em Londrina");

  const conclui = async (client, uid) => {
    await asUser(uid);
    await c.query("reset role"); // a baixa roda como a função faria (security definer), com o auth.uid() de quem conclui
    await c.query(`update public.treatment_sessions set status = 'done', done_at = now(), executed_by = $2
                    where client_id = $1 and status in ('pending','scheduled')`, [client, uid]);
    await asSuper();
  };
  const fech = async (client) => { await asSuper(); return one(`select * from public.treatment_closures where client_id = $1 order by created_at desc limit 1`, [client]); };
  const cli = async (client) => { await asSuper(); return one(`select journey_phase, journey_status, follow_up_return_at from public.clients where id = $1`, [client]); };

  console.log("\n1) Fim do plano e do tratamento (cliente A)");
  await conclui(A, DENT);
  let f = await fech(A);
  check(f && f.scope === "plano" && f.status === "pergunta", `fechamento aberto na pergunta (${f?.status})`);
  check(f?.asked_user_id === DENT, "a pergunta vai para quem executou");
  check(f?.treatment_end === true, "fim do tratamento reconhecido");
  check((await cli(A)).journey_status === "treatment_finished", "sub-status 'Tratamento Finalizado' sozinho");
  check((await one(`select lifecycle from public.treatment_plans where id = $1`, [f.plan_id])).lifecycle === "concluido", "plano 'Concluído' sozinho");
  check(Number((await one(`select count(*) n from public.notifications where user_id = $1 and title like 'Decisão obrigatória%' and link = $2`, [DENT, "/prontuarios/" + A])).n) === 1, "aviso ao dentista");
  check(Number((await one(`select count(*) n from public.journey_decisions where client_id = $1`, [A])).n) === 0, "a pergunta antiga (0019) não abre junto");

  console.log("\n2) Permissões");
  await asUser(RECEP);
  await espera("recepção não responde", () => c.query(`select public.answer_treatment_closure($1, 'sim'${NOTAS})`, [f.id]), "NOT_ALLOWED");
  await asUser(COORD);
  await espera("Coordenador não responde 'Não sei' pelo dentista", () => c.query(`select public.answer_treatment_closure($1, 'nao_sei'${NOTAS})`, [f.id]), "COORDINATOR_DECIDES");
  await asUser(COORD);
  await espera("só o Admin marca 'Tratamento Finalizado' à mão", () => c.query(`select public.set_journey_status($1, 'treatment_finished')`, [D]), "NOT_ALLOWED");
  await asSuper();
  const anon = await one(`select has_function_privilege('anon', 'public.answer_treatment_closure(${ASSINATURA})', 'execute') a,
                                 (select bool_or(has_function_privilege('anon', p.oid, 'execute')) from pg_proc p
                                   where p.proname = 'register_closure_contact' and p.pronamespace = 'public'::regnamespace) b,
                                 has_function_privilege('authenticated', 'public._tratamento_em_aberto(uuid)', 'execute') cc,
                                 has_function_privilege('authenticated', 'public._abrir_fechamento(text,uuid,uuid,uuid,uuid,uuid,uuid,boolean,uuid)', 'execute') d`);
  check(!anon.a && !anon.b, "sem login, as portas recusam");
  check(!anon.cc && !anon.d, "as internas não respondem a ninguém de fora");

  console.log("\n3) Não → contato → 3 tentativas → sem contato (cliente A)");
  await asUser(DENT);
  await c.query(`select public.answer_treatment_closure($1, 'nao')`, [f.id]);
  f = await fech(A);
  check(f.status === "contato", "status 'contato'");
  await asUser(COORD);
  await c.query(`select public.register_closure_contact($1, 'ligacao', false, 'não atendeu', null, null)`, [f.id]);
  await espera("'sem contato' antes de 3 tentativas", () => c.query(`select public.register_closure_contact($1, 'mensagem', false, null, 'sem_contato', null)`, [f.id]), "NEEDS_THREE_ATTEMPTS");
  await c.query(`select public.register_closure_contact($1, 'mensagem', false, null, null, null)`, [f.id]);
  await c.query(`select public.register_closure_contact($1, 'ligacao', false, null, 'sem_contato', null)`, [f.id]);
  await asSuper();
  f = await fech(A);
  const a = await cli(A);
  check(f.status === "encerrado" && f.outcome === "sem_contato", "encerrado como 'sem contato'");
  check(a.journey_phase === "follow_up", `cliente na Fase 7 (${a.journey_phase})`);
  check(a.follow_up_return_at && f.return_date, "retorno sugerido gravado (6 meses)");

  console.log("\n4) Sim → Fase 6 → sair da Fase 6 encerra (cliente B)");
  await conclui(B, DENT);
  f = await fech(B);
  await asUser(DENT);
  await c.query(`select public.answer_treatment_closure($1, 'sim'${NOTAS})`, [f.id]);
  await asSuper();
  f = await fech(B);
  check(f.status === "reavaliacao" && (await cli(B)).journey_phase === "reevaluation", "status 'reavaliacao' e cliente na Fase 6");
  check(Number((await one(`select count(*) n from public.notifications where title like 'Agendar reavaliação%' and link like $1`, [`/agenda?cliente=${B}%`])).n) >= 1, "recepção avisada para agendar a reavaliação");
  await c.query(`select public._jornada_mover_por_evento($1, 'follow_up', 'ensaio', $2)`, [B, COORD]);
  check((await fech(B)).status === "encerrado", "sair da Fase 6 encerra o fechamento");

  console.log("\n5) Com tratamento sobrando, a fase não muda (cliente C, C1)");
  await c.query(`insert into public.treatment_sessions (client_id, clinic_id, procedure_name, session_index, session_total, status)
                 values ($1, $2, 'Sessão de outro plano (ensaio)', 1, 1, 'pending')`, [C, LONDRINA]);
  await conclui(C, DENT); // conclui TUDO, inclusive a falsa… então refaz a falsa como pendente
  await c.query(`update public.treatment_sessions set status = 'pending', done_at = null where client_id = $1 and procedure_name = 'Sessão de outro plano (ensaio)'`, [C]);
  f = await fech(C);
  const cc = await cli(C);
  check(f && f.status === "pergunta", "o fim do plano abre a pergunta");
  check(cc.journey_status === "in_treatment", `reabrir sessão volta a 'Em Tratamento' (${cc.journey_status})`);
  await asUser(DENT);
  await c.query(`select public.answer_treatment_closure($1, 'sim'${NOTAS})`, [f.id]);
  await asSuper();
  check((await cli(C)).journey_phase === "treatment_start", "com tratamento sobrando, a reavaliação é dentro da Fase 5");
  f = await fech(C);
  check(f.treatment_end === false, "o fechamento sabe que não é o fim");

  console.log("\n6) D21: o Coordenador muda a resposta (cliente D)");
  await conclui(D, DENT);
  f = await fech(D);
  await asUser(DENT);
  await c.query(`select public.answer_treatment_closure($1, 'nao')`, [f.id]);
  await asUser(COORD);
  await c.query(`select public.answer_treatment_closure($1, 'sim'${NOTAS})`, [f.id]);
  await asSuper();
  f = await fech(D);
  check(f.status === "reavaliacao" && f.changed_by_coordinator, "a troca vale e fica marcada");

  console.log("\n7) D17: procedimento com reavaliação obrigatória");
  const E = (await one(`select ts.client_id from public.treatment_sessions ts join public.clients c on c.id = ts.client_id
                         where c.journey_phase = 'treatment_start' and ts.status in ('pending','scheduled') and ts.procedure_id is not null
                           and ts.client_id not in ($1,$2,$3,$4)
                           and not exists (select 1 from public.ortho_cases o where o.client_id = c.id)
                           and exists (select 1 from public.plan_negotiations n join public.commercial_sales s on s.negotiation_id = n.id
                                        where n.plan_id = ts.plan_id and s.closed_at is not null and s.cancelled_at is null)
                         limit 1`, [A, B, C, D]))?.client_id;
  if (E) {
    await asUser(COORD);
    const r = await c.query(`update public.procedures set requires_reevaluation = true where id in (select procedure_id from public.treatment_sessions where client_id = $1)`, [E]);
    check(r.rowCount === 0, `o Coordenador não marca a reavaliação obrigatória (${r.rowCount} linhas)`);
    await asSuper();
    await c.query(`update public.procedures set requires_reevaluation = true where id in (select procedure_id from public.treatment_sessions where client_id = $1)`, [E]);
    await conclui(E, DENT);
    const fe = await fech(E);
    check(fe && fe.auto_yes && fe.answer === "sim" && fe.status === "reavaliacao", "o 'Sim' é automático e a pergunta não aparece");
  } else check(false, "achou cliente para o D17");

  console.log("\n8) Urgência (D13)");
  const U = (await one(`select id from public.clients where clinic_id = $1 and journey_phase = 'acquisition' limit 1`, [LONDRINA]))?.id;
  const ap = await one(`insert into public.appointments (clinic_id, client_id, type, starts_at, ends_at, provider_user_id, status)
                        values ($1, $2, 'urgency', now() - interval '2 hours', now() - interval '1 hour', $3, 'scheduled') returning id`, [LONDRINA, U, DENT]);
  await asUser(RECEP);
  await c.query(`select public.check_in_appointment($1)`, [ap.id]);
  await asSuper();
  check((await cli(U)).journey_phase === "acquisition", "o check-in da urgência não leva mais à Fase 5");
  await c.query(`update public.appointments set status = 'completed', attendance = 'done' where id = $1`, [ap.id]);
  let fu = await one(`select * from public.treatment_closures where appointment_id = $1`, [ap.id]);
  check(fu?.status === "agendar_avaliacao", "concluir a urgência abre 'agendar a avaliação completa'");
  await c.query(`insert into public.appointments (clinic_id, client_id, type, starts_at, ends_at, provider_user_id, status)
                 values ($1, $2, 'evaluation', now() + interval '3 days', now() + interval '3 days 1 hour', $3, 'scheduled')`, [LONDRINA, U, COORD]);
  fu = await one(`select * from public.treatment_closures where appointment_id = $1`, [ap.id]);
  check(fu?.status === "encerrado" && fu.outcome === "avaliacao_agendada", "agendar a avaliação resolve a tarefa");

  console.log("\n9) A regra única vê a ortodontia aberta");
  const O = (await one(`select client_id from public.ortho_cases where status in ('aguardando_inicio','em_tratamento','suspenso') limit 1`))?.client_id;
  if (O) {
    // Isola a ortodontia: sem nenhuma sessão aberta, só ela pode segurar.
    await c.query(`update public.treatment_sessions set status = 'cancelled' where client_id = $1 and status in ('pending','scheduled')`, [O]);
    const sobra = await one(`select count(*) n from public.treatment_sessions where client_id = $1 and status in ('pending','scheduled')`, [O]);
    check(Number(sobra.n) === 0, "isolou: o cliente da ortodontia ficou sem sessão aberta");
    check((await one(`select public._tratamento_em_aberto($1) v`, [O])).v === true, "ortodontia aberta segura a Fase 5");
    await c.query(`update public.ortho_cases set status = 'contencao' where client_id = $1 and status in ('aguardando_inicio','em_tratamento','suspenso')`, [O]);
    check((await one(`select public._tratamento_em_aberto($1) v`, [O])).v === false, "na contenção, a ortodontia deixa de segurar (C2)");
    const fo = await one(`select * from public.treatment_closures where client_id = $1 and scope = 'ortodontia'`, [O]);
    check(fo?.status === "pergunta", "entregar a contenção abre a pergunta ao ortodontista (C3)");
  }
  else check(false, "achou caso ortodôntico aberto no treino");
} catch (e) {
  falhou++;
  console.log("✘ ERRO: " + e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`\n${ok} ✔ · ${falhou} ✘ — transação DESFEITA, nada ficou no treino.`);
process.exit(falhou ? 1 : 0);
