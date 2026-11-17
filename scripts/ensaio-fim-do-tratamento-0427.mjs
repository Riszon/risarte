// ENSAIO DA 0427 (fim do tratamento, Etapa 6: prazos e indicadores) no banco
// de TREINO — tudo numa transação DESFEITA no fim; nada fica gravado.
// Pressupõe a 0418–0426 aplicadas no treino.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/ensaio-fim-do-tratamento-0427.mjs [--quebrar=feriado|lembrete|meta]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const W = process.cwd().split("\\").join("/") + "/";
const { connect } = await import(pathToFileURL(W + "scripts/test-db.mjs").href);
const quebrar = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? "";

const original = readFileSync(W + "supabase/migrations/0427_fim_do_tratamento_prazos_e_indicadores.sql", "utf8");
let sql = original;
if (quebrar === "feriado") sql = sql.replace("               or (h.scope = 'city' and h.state = upper(btrim(c.state))", "               or (false and h.state = upper(btrim(c.state))");
if (quebrar === "lembrete") sql = sql.split("_tem_horario_futuro(r.client_id) then\n      continue;\n    end if;").join("_tem_horario_futuro(r.client_id) or true then\n      continue;\n    end if;").replace("  loop\n    v_prazo := coalesce", "  loop\n    continue;\n    v_prazo := coalesce");
if (quebrar === "meta") sql = sql.replace("  elsif p_indicator = 'clients_without_next_step' then", "  elsif p_indicator = 'nenhum_0427' then");
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
  // Antes da 0427: a medição de um indicador antigo, para provar que não mudou.
  const antes = (await c.query(`select sum(num) n, sum(den) d, count(*) k from public._goal_measure_raw('procedures_done', '{}'::jsonb, array[$1]::uuid[], public.today_br() - 90, public.today_br())`, [LONDRINA])).rows[0];
  await c.query(sql);
  console.log(`0427 aplicada na transação${quebrar ? ` (QUEBRADA: ${quebrar})` : ""}.`);
  await asSuper();

  const role = async (r, sem = []) => (await one(
    `select u.user_id from public.user_clinic_roles u join public.profiles p on p.id = u.user_id
      where u.clinic_id = $1 and u.role = $2 and coalesce(p.is_owner,false) = false and p.is_admin_master = false
        and not exists (select 1 from public.user_clinic_roles o where o.user_id = u.user_id and o.clinic_id = $1
                         and o.role::text = any($3))
      order by p.email like '%example.com' desc limit 1`, [LONDRINA, r, sem]))?.user_id;
  const COORD = await role("clinical_coordinator");
  const DENT = await role("dentist");
  const RECEP = await role("receptionist", ["dentist", "clinical_coordinator", "planner_dentist", "unit_manager"]);
  if (!COORD || !DENT || !RECEP) throw new Error("faltam papéis em Londrina no treino: não dá para medir");
  const cli = await one(`select city, state from public.clinics where id = $1`, [LONDRINA]);
  if (!cli?.city || !cli?.state) throw new Error("Londrina sem cidade/UF no treino: não dá para medir");

  console.log("\n1. Os dias úteis da unidade (C4)");
  const dias = async (de, ate) => Number((await one(`select public.clinic_business_days_between($1, $2::date, $3::date) n`, [LONDRINA, de, ate])).n);
  check((await dias("2027-03-01", "2027-03-05")) === 4, "segunda → sexta: 4 dias úteis (terça a sexta)");
  check((await dias("2027-03-05", "2027-03-08")) === 1, "o fim de semana não conta");
  check((await dias("2026-12-24", "2026-12-28")) === 1, "o Natal (feriado nacional) não conta");
  await c.query(`insert into public.holidays (holiday_date, name, scope, state, city) values ('2027-03-03', 'Aniversário (ensaio)', 'city', $1, $2)`, [cli.state.trim().toUpperCase(), cli.city.trim()]);
  check((await dias("2027-03-01", "2027-03-05")) === 3, "o feriado municipal da cidade da unidade não conta");
  await c.query(`insert into public.clinic_holiday_decisions (clinic_id, holiday_date, will_attend) values ($1, '2027-03-03', true)`, [LONDRINA]);
  check((await dias("2027-03-01", "2027-03-05")) === 4, "a unidade decidiu atender no feriado: conta");

  console.log("\n2. A tarefa parada volta a avisar (7.2)");
  // Uma tarefa de abandono aberta e parada há 10 dias (sem o gatilho de updated_at).
  await c.query(`insert into public.inactivity_settings (clinic_id, setting_key, value_days) values ($1, 'abandon_no_schedule_days', 1)
                 on conflict (clinic_id, setting_key) do update set value_days = 1`, [LONDRINA]);
  await c.query(`select public.treatment_abandonment_scan($1)`, [LONDRINA]);
  const ab = await one(`select id, client_id from public.treatment_abandonments where clinic_id = $1 and status = 'reagendar' limit 1`, [LONDRINA]);
  if (!ab) throw new Error("nenhuma tarefa de abandono no treino: não dá para medir");
  await c.query("set local session_replication_role = replica");
  await c.query(`update public.treatment_abandonments set updated_at = now() - interval '10 days', reminded_at = null where clinic_id = $1 and status <> 'encerrado'`, [LONDRINA]);
  await c.query(`update public.treatment_closures set updated_at = now() - interval '10 days', reminded_at = null where clinic_id = $1 and status <> 'encerrado'`, [LONDRINA]);
  await c.query("set local session_replication_role = origin");
  const n1 = Number((await one(`select public.end_of_treatment_reminders($1) n`, [LONDRINA])).n);
  check(n1 >= 1, `avisou ${n1} tarefa(s) parada(s)`);
  const aviso = await one(`select count(*) n from public.notifications where link = $1 and title like 'Parado: abandono%'`, ["/prontuarios/" + ab.client_id]);
  check(Number(aviso.n) >= 1, "o aviso chegou (Recepção e Gerente)");
  check((await one(`select reminded_at from public.treatment_abandonments where id = $1`, [ab.id])).reminded_at !== null, "o aviso ficou marcado");
  const n2 = Number((await one(`select public.end_of_treatment_reminders($1) n`, [LONDRINA])).n);
  check(n2 === 0, "rodar de novo no mesmo dia não repete o aviso");

  console.log("\n3. A lista e o indicador \"Clientes sem próximo passo\"");
  await asUser(COORD);
  const lista = (await c.query(`select client_id from public.clients_without_next_step($1)`, [LONDRINA])).rows.map((r) => r.client_id).sort();
  await asSuper();
  const interna = (await c.query(`select client_id from public._sem_proximo_passo($1)`, [LONDRINA])).rows.map((r) => r.client_id).sort();
  check(JSON.stringify(lista) === JSON.stringify(interna), `a lista da tela e a interna são a mesma (${lista.length})`);
  await asUser(DENT);
  await espera("o dentista lê a lista", () => c.query(`select * from public.clients_without_next_step($1)`, [LONDRINA]), "NOT_ALLOWED");
  await asSuper();
  const foto = (await c.query(`select num from public._goal_measure_raw('clients_without_next_step', '{}'::jsonb, array[$1]::uuid[], public.today_br(), public.today_br())`, [LONDRINA])).rows;
  check(foto.length === 1 && Number(foto[0].num) === interna.length, `a meta fotografa o mesmo número (${foto[0]?.num ?? "nada"})`);

  console.log("\n4. Os outros indicadores e a medição antiga");
  for (const k of ["redo_rate", "client_satisfaction", "closure_decided_on_time"]) {
    await c.query("savepoint m");
    try {
      await c.query(`select * from public._goal_measure_raw($1, '{}'::jsonb, array[$2]::uuid[], public.today_br() - 365, public.today_br())`, [k, LONDRINA]);
      check(true, `${k} mede sem erro`);
    } catch (e) { await c.query("rollback to savepoint m"); check(false, `${k}: ${e.message}`); }
  }
  const meta = await one(`select * from public._goal_indicator_meta('redo_rate')`);
  check(meta?.kind === "rate" && meta?.per_person === true, "o catálogo do banco conhece a taxa de refação");
  const depois = (await c.query(`select sum(num) n, sum(den) d, count(*) k from public._goal_measure_raw('procedures_done', '{}'::jsonb, array[$1]::uuid[], public.today_br() - 90, public.today_br())`, [LONDRINA])).rows[0];
  check(JSON.stringify(antes) === JSON.stringify(depois), "um indicador antigo mede igual antes e depois");

  console.log("\n5. O Meu dia do dentista");
  await asUser(DENT);
  const resumo = await one(`select * from public.my_end_of_treatment_summary($1, now() - interval '365 days', now())`, [LONDRINA]);
  check(resumo && typeof resumo.respostas === "number", "o dentista lê o próprio resumo");
  await asUser(RECEP);
  await espera("a Recepção lê o resumo de dentista", () => c.query(`select * from public.my_end_of_treatment_summary($1, now() - interval '30 days', now())`, [LONDRINA]), "NOT_ALLOWED");

  console.log("\n6. Portas fechadas");
  await asSuper();
  const anon = await one(`select bool_or(has_function_privilege('anon', p.oid, 'execute')) x from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('my_end_of_treatment_summary','clients_without_next_step',
      'end_of_treatment_reminders','_sem_proximo_passo','clinic_business_days_between','_dia_util_da_unidade')`);
  check(anon.x === false, "nada aberto para quem não está logado");
  const rot = await one(`select has_function_privilege('authenticated', 'public.end_of_treatment_reminders(uuid)', 'execute') x`);
  check(rot.x === false, "a rotina não é porta de usuário");
} catch (e) {
  falhou++;
  console.log("  ✘ ERRO: " + e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`\n${ok} ok, ${falhou} falha(s). Transação desfeita.`);
process.exit(falhou ? 1 : 0);
