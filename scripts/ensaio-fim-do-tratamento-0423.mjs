// ENSAIO DA 0423 (fim do tratamento, Etapa 4: o abandono e a lista) no banco
// de TREINO — tudo numa transação DESFEITA no fim; nada fica gravado.
// Pressupõe a 0418–0422 aplicadas no treino.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/ensaio-fim-do-tratamento-0423.mjs [--quebrar=reagendou|tentativas|lista]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const W = process.cwd().split("\\").join("/") + "/";
const { connect } = await import(pathToFileURL(W + "scripts/test-db.mjs").href);
const quebrar = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? "";

const original = readFileSync(W + "supabase/migrations/0423_fim_do_tratamento_abandono.sql", "utf8");
let sql = original;
if (quebrar === "reagendou")
  sql = sql.replace("where client_id = new.client_id and status in ('reagendar', 'contato', 'gerente');", "where client_id = new.client_id and status in ('nenhum');");
if (quebrar === "tentativas") sql = sql.replace("if v_tentativas >= 3 or p_escalate then", "if v_tentativas >= 99 or p_escalate then");
if (quebrar === "lista") sql = sql.replace("    and not public._tem_horario_futuro(c.id)\n    -- nenhuma tarefa aberta", "    -- nenhuma tarefa aberta");
if (quebrar && sql === original) throw new Error(`a quebra "${quebrar}" não achou o que quebrar: não mediu nada`);

const c = await connect();
let ok = 0, falhou = 0;
const check = (cond, txt) => { if (cond) { ok++; console.log("  ✔ " + txt); } else { falhou++; console.log("  ✘ " + txt); } };
const one = async (q, p = []) => (await c.query(q, p)).rows[0];
const LONDRINA = "9490e17e-2f0c-4a2d-838b-0990577a2ab7";
const asUser = async (uid) => {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  await c.query("set local role authenticated");
};
const asSuper = async () => { await c.query("reset role"); await c.query("select set_config('request.jwt.claims', '', true)"); };
const espera = async (txt, fn, codigo) => {
  await c.query("savepoint s");
  try { await fn(); await c.query("rollback to savepoint s"); check(false, `${txt} (devia recusar com ${codigo})`); }
  catch (e) { await c.query("rollback to savepoint s"); check(String(e.message).includes(codigo), `${txt} → ${e.message}`); }
};

try {
  await c.query("begin");
  await c.query(sql);
  console.log(`0423 aplicada na transação${quebrar ? ` (QUEBRADA: ${quebrar})` : ""}.`);
  await asSuper();

  const role = async (r, sem = []) => (await one(
    `select u.user_id from public.user_clinic_roles u join public.profiles p on p.id = u.user_id
      where u.clinic_id = $1 and u.role = $2 and coalesce(p.is_owner,false) = false and p.is_admin_master = false
        and not exists (select 1 from public.user_clinic_roles o where o.user_id = u.user_id and o.clinic_id = $1
                         and o.role::text = any($3))
      order by p.email like '%example.com' desc limit 1`, [LONDRINA, r, sem]))?.user_id;
  const RECEP = await role("receptionist", ["clinical_coordinator"]), COORD = await role("clinical_coordinator", ["unit_manager"]);
  const DENT = await role("dentist", ["receptionist", "clinical_coordinator", "unit_manager"]);
  let GER = await role("unit_manager");
  if (!GER) {
    // O treino não tem Gerente em Londrina: uma pessoa sem papel lá ganha o de Gerente, só nesta transação.
    GER = (await one(`select p.id as user_id from public.profiles p
      where not p.is_admin_master and coalesce(p.is_owner, false) = false
        and not exists (select 1 from public.user_clinic_roles_all o where o.user_id = p.id and o.clinic_id = $1)
      order by p.email like '%example.com' desc limit 1`, [LONDRINA]))?.user_id;
    if (GER) await c.query(`insert into public.user_clinic_roles_all (user_id, clinic_id, role, assignment_kind) values ($1, $2, 'unit_manager', 'principal')`, [GER, LONDRINA]);
  }
  if (!RECEP || !COORD || !GER || !DENT) throw new Error("faltam papéis em Londrina no treino: não dá para medir");

  // Prazo de 1 dia nesta unidade, para não precisar envelhecer dados.
  await c.query(`insert into public.inactivity_settings (clinic_id, setting_key, value_days)
                 values ($1, 'abandon_no_schedule_days', 1)
                 on conflict (clinic_id, setting_key) do update set value_days = 1`, [LONDRINA]);

  const parados = (await c.query(`
    select cl.id from public.clients cl
     where cl.clinic_id = $1 and cl.journey_phase = 'treatment_start'
       and exists (select 1 from public.treatment_sessions ts where ts.client_id = cl.id and ts.status = 'pending')
       and not public._tem_horario_futuro(cl.id)
       and public._ultima_atividade(cl.id) < now() - interval '1 day'
       and not exists (select 1 from public.treatment_closures f where f.client_id = cl.id and f.status <> 'encerrado')
     order by cl.id limit 6`, [LONDRINA])).rows.map((r) => r.id);
  const comHorario = (await one(`
    select cl.id from public.clients cl
     where cl.clinic_id = $1 and cl.journey_phase = 'treatment_start'
       and exists (select 1 from public.treatment_sessions ts where ts.client_id = cl.id and ts.status = 'pending')
       and public._tem_horario_futuro(cl.id) limit 1`, [LONDRINA]))?.id;
  if (parados.length < 4) throw new Error(`o treino não tem 4 clientes parados em Londrina (${parados.length}): não dá para medir`);
  const [A, B, C, D] = parados;
  const ab = async (cli) => { await asSuper(); return one(`select * from public.treatment_abandonments where client_id = $1 order by (status <> 'encerrado') desc, closed_at desc nulls first limit 1`, [cli]); };

  console.log("\n1. A varredura abre a tarefa de reagendar");
  const abertos = Number((await one(`select public.treatment_abandonment_scan($1) n`, [LONDRINA])).n);
  check(abertos >= 4, `abriu ${abertos} tarefa(s) (≥ 4)`);
  check((await ab(A))?.status === "reagendar", "o cliente parado ficou com a tarefa REAGENDAR");
  check(Number((await one(`select public.treatment_abandonment_scan($1) n`, [LONDRINA])).n) === 0, "rodar de novo não duplica");
  if (comHorario) check(!(await ab(comHorario)) || (await ab(comHorario)).status === "encerrado", "quem tem horário futuro não entra");
  const aviso = await one(`select count(*) n from public.notifications where link = $1 and title like 'Reagendar o tratamento%'`, ["/prontuarios/" + A]);
  check(Number(aviso.n) >= 1, "a Recepção foi avisada");

  console.log("\n2. As tentativas da Recepção");
  const idA = (await ab(A)).id;
  await asUser(DENT);
  await espera("o dentista registra tentativa", () => c.query(`select public.register_abandonment_attempt($1,'ligacao',false)`, [idA]), "NOT_ALLOWED");
  await asUser(RECEP);
  await espera("falou sem dizer o quê", () => c.query(`select public.register_abandonment_attempt($1,'ligacao',true,'')`, [idA]), "SUMMARY_REQUIRED");
  await espera("encaminhar sem ter falado", () => c.query(`select public.register_abandonment_attempt($1,'ligacao',false,null,true)`, [idA]), "ESCALATE_NEEDS_TALK");
  await c.query(`select public.register_abandonment_attempt($1,'ligacao',false)`, [idA]);
  await c.query(`select public.register_abandonment_attempt($1,'mensagem',false)`, [idA]);
  check((await ab(A)).status === "reagendar", "2 tentativas: continua com a Recepção");
  await asUser(RECEP);
  const etapa = (await one(`select public.register_abandonment_attempt($1,'ligacao',false) e`, [idA])).e;
  check(etapa === "contato" && (await ab(A)).status === "contato", "a 3ª tentativa leva ao Coordenador");
  await asUser(RECEP);
  await espera("a Recepção registra na etapa do Coordenador", () => c.query(`select public.register_abandonment_attempt($1,'ligacao',false)`, [idA]), "NOT_ALLOWED");

  console.log("\n3. O registro de abandono (Coordenador)");
  await asUser(RECEP);
  await espera("a Recepção registra o abandono", () => c.query(`select public.register_treatment_abandonment($1,'riscos informados ao cliente por telefone','ligacao',public.today_br())`, [idA]), "NOT_ALLOWED");
  await asUser(COORD);
  await c.query(`select public.register_abandonment_attempt($1,'ligacao',true,'Disse que não vai voltar agora')`, [idA]);
  await espera("riscos curtos demais", () => c.query(`select public.register_treatment_abandonment($1,'curto','ligacao',public.today_br())`, [idA]), "RISKS_REQUIRED");
  await espera("data no futuro", () => c.query(`select public.register_treatment_abandonment($1,'riscos informados ao cliente por telefone','ligacao',public.today_br()+1)`, [idA]), "INVALID_DATE");
  await c.query(`select public.register_treatment_abandonment($1,'Informado o risco de fratura do dente sem a coroa definitiva','ligacao',public.today_br())`, [idA]);
  const regA = await ab(A);
  check(regA.status === "gerente" && regA.risks_channel === "ligacao" && regA.registered_by === COORD, "registrado: vai ao Gerente, com meio e autor");

  console.log("\n4. A decisão do Gerente: Fase 7");
  await asUser(COORD);
  await espera("o Coordenador decide", () => c.query(`select public.decide_treatment_abandonment($1,'fase7')`, [idA]), "NOT_ALLOWED");
  await asUser(GER);
  await espera("retorno no passado", () => c.query(`select public.decide_treatment_abandonment($1,'fase7',public.today_br())`, [idA]), "RETURN_DATE_PAST");
  await c.query(`select public.decide_treatment_abandonment($1,'fase7',null,'Cliente viajou')`, [idA]);
  await asSuper();
  const cliA = await one(`select journey_phase, follow_up_return_at, (public.today_br() + interval '6 months')::date esperado from public.clients where id = $1`, [A]);
  check(cliA.journey_phase === "follow_up", "o cliente foi para a Fase 7");
  check(String(cliA.follow_up_return_at) === String(cliA.esperado), "retorno sugerido: daqui a 6 meses");
  check((await ab(A)).outcome === "fase7", "a tarefa encerrou como fase7");
  const pend = await one(`select count(*) n from public.treatment_sessions where client_id = $1 and status = 'pending'`, [A]);
  check(Number(pend.n) > 0, "as sessões pendentes continuam abertas para a volta");

  console.log("\n5. O cliente agendou: a tarefa some");
  const idB = (await ab(B)).id;
  await asUser(RECEP);
  await c.query(`select public.register_abandonment_attempt($1,'ligacao',true,'Disse que não quer marcar agora',true)`, [idB]);
  check((await ab(B)).status === "contato", "a Recepção falou e encaminhou ao Coordenador");
  await asSuper();
  await c.query(`insert into public.appointments (clinic_id, client_id, type, status, starts_at, ends_at)
                 values ($1, $2, 'treatment_session', 'scheduled', now() + interval '3 days', now() + interval '3 days 1 hour')`, [LONDRINA, B]);
  const fimB = await ab(B);
  check(fimB.status === "encerrado" && fimB.outcome === "reagendado", "com horário marcado, encerrou como reagendado");

  console.log("\n6. A lista e o começo manual");
  await asUser(DENT);
  await espera("o dentista lê a lista", () => c.query(`select * from public.clients_without_next_step($1)`, [LONDRINA]), "NOT_ALLOWED");
  // C: fecha a tarefa da varredura para ele cair na lista.
  await asSuper();
  await c.query(`update public.treatment_abandonments set status = 'encerrado', outcome = 'sem_pendencia', closed_at = now() where client_id = $1 and status <> 'encerrado'`, [C]);
  await asUser(COORD);
  const lista = (await c.query(`select * from public.clients_without_next_step($1)`, [LONDRINA])).rows;
  const ids = new Set(lista.map((r) => r.client_id));
  check(ids.has(C) && lista.find((r) => r.client_id === C).reason === "sessoes_sem_horario", "o parado sem tarefa aparece, com o motivo");
  check(!ids.has(D), "quem tem tarefa aberta (abandono) não aparece");
  check(!ids.has(B), "quem tem horário futuro não aparece");
  check(!ids.has(A), "quem foi para a Fase 7 não aparece");
  const idC = (await one(`select public.start_treatment_abandonment($1) id`, [C])).id;
  check((await ab(C)).status === "contato" && (await ab(C)).origin === "manual", "o Coordenador abre o contato pela lista");
  await asUser(COORD);
  await espera("abrir de novo", () => c.query(`select public.start_treatment_abandonment($1)`, [C]), "ALREADY_OPEN");

  console.log("\n7. A decisão do Gerente: cancelamento formal");
  await asUser(COORD);
  await c.query(`select public.register_treatment_abandonment($1,'Informados os riscos de perda do tratamento iniciado','mensagem',public.today_br())`, [idC]);
  await asUser(GER);
  await c.query(`select public.decide_treatment_abandonment($1,'cancelamento')`, [idC]);
  check((await ab(C)).status === "cancelamento", "a tarefa fica com o Gerente até o termo abrir");
  await asSuper();
  const neg = await one(`select n.id from public.plan_negotiations n join public.treatment_plans tp on tp.id = n.plan_id where tp.client_id = $1 limit 1`, [C]);
  await c.query("savepoint pc");
  try {
    await c.query(`insert into public.plan_cancellations (clinic_id, client_id, negotiation_id, reason, status) values ($1,$2,$3,'Abandono','rascunho')`, [LONDRINA, C, neg?.id ?? null]);
    check((await one(`select outcome from public.treatment_abandonments where id = $1`, [idC])).outcome === "cancelamento_aberto", "o termo abriu: a tarefa encerrou");
  } catch (e) {
    await c.query("rollback to savepoint pc");
    check(false, `não deu para abrir um termo no ensaio: ${e.message}`);
  }

  console.log("\n8. Sem sessão pendente, a varredura encerra");
  await asSuper();
  await c.query(`update public.treatment_sessions set status = 'done', done_at = now() where client_id = $1 and status in ('pending','scheduled')`, [D]);
  await c.query(`select public.treatment_abandonment_scan($1)`, [LONDRINA]);
  check((await ab(D)).outcome === "sem_pendencia", "a tarefa de quem não tem mais pendência encerrou");

  console.log("\n9. Portas fechadas");
  const anon = await one(`select bool_or(has_function_privilege('anon', p.oid, 'execute')) x from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('register_abandonment_attempt','register_treatment_abandonment',
      'decide_treatment_abandonment','start_treatment_abandonment','clients_without_next_step','treatment_abandonment_scan')`);
  check(anon.x === false, "nada aberto para quem não está logado");
  const scan = await one(`select has_function_privilege('authenticated', 'public.treatment_abandonment_scan(uuid)', 'execute') x`);
  check(scan.x === false, "a varredura não é porta de usuário");
  await asUser(GER);
  await espera("gravar direto na tabela", () => c.query(`update public.treatment_abandonments set status = 'encerrado' where id = $1`, [idC]), "permission denied");
} catch (e) {
  falhou++;
  console.log("  ✘ ERRO: " + e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`\n${ok} ok, ${falhou} falha(s). Transação desfeita.`);
process.exit(falhou ? 1 : 0);
