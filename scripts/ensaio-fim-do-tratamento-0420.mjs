// ENSAIO DA 0420 (a instalação ortodôntica não termina o plano) no banco de
// TREINO — tudo numa transação DESFEITA no fim; nada fica gravado.
// Pressupõe a 0418 aplicada no treino.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/ensaio-fim-do-tratamento-0420.mjs [--quebrar=filtro]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const W = process.cwd().split("\\").join("/") + "/";
const { connect } = await import(pathToFileURL(W + "scripts/test-db.mjs").href);
const quebrar = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? "";

const original = readFileSync(W + "supabase/migrations/0420_fim_do_tratamento_instalacao_ortodontica.sql", "utf8");
let sql = original;
// Quebra de propósito: a sessão ortodôntica volta a terminar o plano.
if (quebrar === "filtro") sql = sql.replace("if public._sessao_ortodontica(new.procedure_id) then return null; end if;", "");
if (quebrar && sql === original) throw new Error(`a quebra "${quebrar}" não achou o que quebrar: não mediu nada`);

const c = await connect();
let ok = 0, falhou = 0;
const check = (cond, txt) => { if (cond) { ok++; console.log("  ✔ " + txt); } else { falhou++; console.log("  ✘ " + txt); } };
const one = async (q, p = []) => (await c.query(q, p)).rows[0];
const LONDRINA = "9490e17e-2f0c-4a2d-838b-0990577a2ab7";

try {
  await c.query("begin");
  await c.query(sql);
  console.log(`0420 aplicada na transação${quebrar ? ` (QUEBRADA: ${quebrar})` : ""}.`);

  const dent = (await one(
    `select u.user_id from public.user_clinic_roles u join public.profiles p on p.id = u.user_id
      where u.clinic_id = $1 and u.role = 'dentist' and coalesce(p.is_owner,false) = false and p.is_admin_master = false
      order by p.email like '%example.com' desc limit 1`, [LONDRINA]))?.user_id;
  // Clientes com sessões abertas de UM plano vendido, sem outra sessão aberta,
  // sem ortodontia e sem fechamento.
  const cand = (await c.query(`
    with abertas as (
      select ts.client_id, ts.plan_id, count(*) n from public.treatment_sessions ts
       where ts.status in ('pending','scheduled') and ts.plan_id is not null group by 1, 2)
    select a.client_id, a.plan_id from abertas a join public.clients cl on cl.id = a.client_id
     where cl.clinic_id = $1 and cl.journey_phase = 'treatment_start'
       and a.n = (select count(*) from public.treatment_sessions x where x.client_id = a.client_id and x.status in ('pending','scheduled'))
       and not exists (select 1 from public.ortho_cases o where o.client_id = a.client_id)
       and not exists (select 1 from public.treatment_closures f where f.client_id = a.client_id)
       and exists (select 1 from public.plan_negotiations n join public.commercial_sales s on s.negotiation_id = n.id
                    where n.plan_id = a.plan_id and s.closed_at is not null and s.cancelled_at is null)
     order by a.client_id limit 3`, [LONDRINA])).rows;
  if (!dent || cand.length < 3) throw new Error(`o treino não tem dentista e 3 clientes que servem ao ensaio (${cand.length}): não dá para medir`);
  const [A, B, C] = cand;

  // Um procedimento de Ortodontia para o ensaio: o primeiro do catálogo, ou
  // um procedimento qualquer que vira Ortodontia SÓ nesta transação.
  let orto = (await one(`select id from public.procedures where specialty ilike '%ortod%' limit 1`))?.id;
  const procA = (await one(`select procedure_id from public.treatment_sessions where client_id = $1 and status in ('pending','scheduled')`, [A.client_id])).procedure_id;
  if (!orto) {
    orto = procA;
    await c.query(`update public.procedures set specialty = 'Ortodontia' where id = $1`, [orto]);
  }
  const conclui = async (where, params) => {
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: dent, role: "authenticated" })]);
    await c.query(`update public.treatment_sessions set status = 'done', done_at = now(), executed_by = '${dent}' where ${where}`, params);
    await c.query("select set_config('request.jwt.claims', '', true)");
  };
  const fechamentos = async (cliente) => Number((await one(`select count(*) n from public.treatment_closures where client_id = $1`, [cliente])).n);

  console.log("\n1) Plano só com a instalação (cliente A)");
  await c.query(`update public.treatment_sessions set procedure_id = $2 where client_id = $1 and status in ('pending','scheduled')`, [A.client_id, orto]);
  await conclui(`client_id = $1 and status in ('pending','scheduled')`, [A.client_id]);
  check(await fechamentos(A.client_id) === 0, "concluir a instalação não abre a pergunta");

  console.log("\n2) Plano misto: restauração + instalação pendente (cliente B)");
  await c.query(`insert into public.treatment_sessions (client_id, clinic_id, plan_id, procedure_id, procedure_name, session_index, session_total, status)
                 values ($1, $2, $3, $4, 'Instalação (ensaio)', 1, 1, 'pending')`, [B.client_id, LONDRINA, B.plan_id, orto]);
  await conclui(`client_id = $1 and status in ('pending','scheduled') and procedure_id is distinct from $2`, [B.client_id, orto]);
  check(await fechamentos(B.client_id) === 1, "a restauração terminou: a pergunta abre, mesmo com a instalação pendente");
  const fb = await one(`select treatment_end from public.treatment_closures where client_id = $1`, [B.client_id]);
  check(fb.treatment_end === false, "a instalação pendente segura o fim do tratamento (sobra sessão)");
  await conclui(`client_id = $1 and procedure_id = $2`, [B.client_id, orto]);
  check(await fechamentos(B.client_id) === 1, "concluir a instalação depois não abre outra pergunta");

  console.log("\n3) Plano comum continua igual (cliente C)");
  await conclui(`client_id = $1 and status in ('pending','scheduled')`, [C.client_id]);
  check(await fechamentos(C.client_id) === 1, "o fim do plano comum abre a pergunta");

  console.log("\n4) A interna não responde a ninguém de fora");
  const p = await one(`select has_function_privilege('anon', 'public._sessao_ortodontica(uuid)', 'execute') a,
                              has_function_privilege('authenticated', 'public._sessao_ortodontica(uuid)', 'execute') b`);
  check(!p.a && !p.b, "_sessao_ortodontica fechada");
} catch (e) {
  falhou++;
  console.log("✘ ERRO: " + e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`\n${ok} ✔ · ${falhou} ✘ — transação DESFEITA, nada ficou no treino.`);
process.exit(falhou ? 1 : 0);
