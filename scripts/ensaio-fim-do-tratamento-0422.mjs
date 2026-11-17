// ENSAIO DA 0422 (relato OC-00185: uma decisão por cliente) no banco de
// TREINO — tudo numa transação DESFEITA no fim; nada fica gravado.
// Pressupõe a 0418, a 0420 e a 0421 aplicadas no treino.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/ensaio-fim-do-tratamento-0422.mjs [--quebrar=grupo|venda|notas]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const W = process.cwd().split("\\").join("/") + "/";
const { connect } = await import(pathToFileURL(W + "scripts/test-db.mjs").href);
const quebrar = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? "";

const original = readFileSync(W + "supabase/migrations/0422_fim_do_tratamento_uma_decisao_por_cliente.sql", "utf8");
let sql = original;
if (quebrar === "grupo") sql = sql.replace("  if v_lider.id is not null then\n    -- Já há uma decisão aberta", "  if false then\n    -- Já há uma decisão aberta");
if (quebrar === "venda") sql = sql.replace("where d.id = p_direct_sale_id and d.status = 'concluida') then", "where false) then");
if (quebrar === "notas") sql = sql.replace("and length(coalesce(v_notas, '')) < 10 then", "and false then");
if (quebrar && sql === original) throw new Error(`a quebra "${quebrar}" não achou o que quebrar: não mediu nada`);

const c = await connect();
if (process.env.AVISOS) c.on("notice", (n) => console.log("  [aviso do banco] " + n.message));
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
const RELATO = "a7d8399a-484d-4e6d-95f6-34e2d33c7777";
const NOTAS = "Olhar a oclusão do 36 com atenção.";

try {
  await c.query("begin");
  await c.query(sql);
  console.log(`0422 aplicada na transação${quebrar ? ` (QUEBRADA: ${quebrar})` : ""}.`);

  const role = async (r) => (await one(
    `select u.user_id from public.user_clinic_roles u join public.profiles p on p.id = u.user_id
      where u.clinic_id = $1 and u.role = $2 and coalesce(p.is_owner,false) = false and p.is_admin_master = false
      order by p.email like '%example.com' desc limit 1`, [LONDRINA, r]))?.user_id;
  const DENT = await role("dentist"), COORD = await role("clinical_coordinator");
  const cand = (await c.query(`
    with abertas as (
      select ts.client_id, ts.plan_id, count(*) n from public.treatment_sessions ts
       where ts.status in ('pending','scheduled') and ts.plan_id is not null group by 1, 2)
    select a.client_id from abertas a join public.clients cl on cl.id = a.client_id
     where cl.clinic_id = $1 and cl.journey_phase = 'treatment_start'
       and a.n = (select count(*) from public.treatment_sessions x where x.client_id = a.client_id and x.status in ('pending','scheduled'))
       and not exists (select 1 from public.ortho_cases o where o.client_id = a.client_id)
       and not exists (select 1 from public.treatment_closures f where f.client_id = a.client_id)
       and not exists (select 1 from public.appointments ap where ap.client_id = a.client_id and ap.starts_at > now() and ap.status in ('scheduled','confirmed'))
       and exists (select 1 from public.plan_negotiations n join public.commercial_sales s on s.negotiation_id = n.id
                    where n.plan_id = a.plan_id and s.closed_at is not null and s.cancelled_at is null)
     order by a.n, a.client_id limit 4`, [LONDRINA])).rows.map((r) => r.client_id);
  if (!DENT || !COORD || cand.length < 4) throw new Error(`faltam dentista, Coordenador ou 4 clientes no treino (${cand.length}): não dá para medir`);
  const [A, B, C, D] = cand;
  // Duas vendas diretas quaisquer da unidade, emprestadas SÓ nesta transação.
  const vendas = (await c.query(`select d.id from public.direct_sales d where d.clinic_id = $1 and not exists (select 1 from public.treatment_closures f where f.direct_sale_id = d.id) order by d.created_at limit 3`, [LONDRINA])).rows.map((r) => r.id);
  if (vendas.length < 3) throw new Error("o treino não tem 3 vendas diretas sem decisão em Londrina: não dá para medir");
  const [V1, V2, V3] = vendas;

  const conclui = async (where, params) => {
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: DENT, role: "authenticated" })]);
    await c.query(`update public.treatment_sessions set status = 'done', done_at = now(), executed_by = '${DENT}' where ${where}`, params);
    await c.query("select set_config('request.jwt.claims', '', true)");
  };
  const lideres = async (cli) => Number((await one(`select count(*) n from public.treatment_closures where client_id = $1 and grouped_into is null and status in ('pergunta','coordenador','reavaliacao','contato')`, [cli])).n);
  const lider = async (cli) => one(`select * from public.treatment_closures where client_id = $1 and grouped_into is null and status <> 'encerrado' order by created_at limit 1`, [cli]);
  const seguidor = async (cli) => one(`select * from public.treatment_closures where client_id = $1 and grouped_into is not null order by created_at limit 1`, [cli]);
  const marcaHorario = async (cli, dias) => one(
    `insert into public.appointments (clinic_id, client_id, type, starts_at, ends_at, provider_user_id, status)
     values ($1, $2, 'reevaluation', date_trunc('day', now()) + make_interval(days => $3) + interval '3 hours',
             date_trunc('day', now()) + make_interval(days => $3) + interval '3 hours 30 minutes', $4, 'scheduled') returning id`,
    [LONDRINA, cli, dias, COORD]);
  const avisos = async (titulo, cli) => Number((await one(`select count(*) n from public.notifications where title like $1 and (link like $2 or link like $3)`, [titulo, `/agenda?cliente=${cli}%`, `/prontuarios/${cli}`])).n);

  console.log("\n0) As repetidas do relato viraram uma decisão (E2)");
  const r = await one(`select count(*) filter (where grouped_into is null and status in ('pergunta','coordenador','reavaliacao','contato')) l,
                              count(*) filter (where grouped_into is not null) s,
                              max(status) filter (where grouped_into is null and status <> 'encerrado') st
                         from public.treatment_closures where client_id = $1`, [RELATO]);
  if (Number(r.l) + Number(r.s) > 0) {
    check(Number(r.l) === 1, `uma decisão aberta (${r.l})`);
    check(Number(r.s) === 2, `as outras duas agrupadas (${r.s})`);
    check(r.st === "reavaliacao", `ficou a mais prudente: reavaliação (${r.st})`);
  } else console.log("  (o cliente do relato já não tem fechamentos no treino — pulado)");

  console.log("\n1) Um fim enquanto há decisão aberta entra nela (cliente A)");
  await conclui(`client_id = $1 and status in ('pending','scheduled')`, [A]);
  const lA = await lider(A);
  check(lA?.status === "pergunta", "o plano abriu a decisão");
  await c.query(`select public._abrir_fechamento('venda_direta', $1, $2, null, $3, null, $4, false, $4)`, [A, LONDRINA, V1, DENT]);
  const sA = await seguidor(A);
  check(sA?.grouped_into === lA?.id, "a venda direta entrou como seguidora");
  check(await lideres(A) === 1, "continua UMA decisão aberta");

  console.log("\n2) Seguidor não responde; considerações obrigatórias");
  await asUser(DENT);
  if (sA) await espera("seguidor não responde", () => c.query(`select public.answer_treatment_closure($1, 'sim', $2)`, [sA.id, NOTAS]), "GROUPED");
  await espera("Sim sem considerações", () => c.query(`select public.answer_treatment_closure($1, 'sim')`, [lA.id]), "NOTES_REQUIRED");
  await espera("Não sei com considerações curtas", () => c.query(`select public.answer_treatment_closure($1, 'nao_sei', 'curta')`, [lA.id]), "NOTES_REQUIRED");
  await asSuper();

  console.log("\n3) Já tem horário com o Coordenador daqui a 3 dias (cliente A)");
  const hA = await marcaHorario(A, 3);
  const recepAntes = await avisos("Agendar reavaliação:%", A);
  await asUser(DENT);
  await c.query(`select public.answer_treatment_closure($1, 'sim', $2)`, [lA.id, NOTAS]);
  await asSuper();
  const lA2 = await lider(A), sA2 = await seguidor(A);
  check(lA2.status === "reavaliacao" && lA2.linked_appointment_id === hA.id, "a decisão ficou ligada ao horário existente");
  check(lA2.dentist_notes === NOTAS, "as considerações ficaram guardadas");
  check(sA2.status === "reavaliacao" && sA2.dentist_notes === NOTAS, "o seguidor acompanhou a resposta");
  check(await avisos("Agendar reavaliação:%", A) === recepAntes, "a Recepção NÃO foi avisada para agendar de novo");
  check(await avisos("Reavaliação do fim do tratamento:%", A) >= 1, "o Coordenador foi avisado de que a consulta é a reavaliação");

  console.log("\n4) Horário com o Coordenador daqui a 95 dias (cliente B)");
  await conclui(`client_id = $1 and status in ('pending','scheduled')`, [B]);
  const lB = await lider(B);
  await marcaHorario(B, 95);
  await asUser(DENT);
  await espera("Sim sem escolher (horário longe)", () => c.query(`select public.answer_treatment_closure($1, 'sim', $2)`, [lB.id, NOTAS]), "FAR_APPOINTMENT_CHOICE");
  await c.query(`select public.answer_treatment_closure($1, 'sim', $2, 'manter')`, [lB.id, NOTAS]);
  await asSuper();
  check((await lider(B)).wait_choice === "manter", "\"manter\" fica registrado");
  await asUser(COORD);
  await c.query(`select public.request_sooner_reevaluation($1)`, [lB.id]);
  await asSuper();
  check((await lider(B)).wait_choice === "antecipar", "o Coordenador pediu a reavaliação mais próxima");
  check(await avisos("Agendar reavaliação (prioridade):%", B) >= 1, "a Recepção recebeu o pedido com prioridade");

  console.log("\n5) Seguidor não recebe contato (cliente C)");
  await conclui(`client_id = $1 and status in ('pending','scheduled')`, [C]);
  const lC = await lider(C);
  await c.query(`select public._abrir_fechamento('venda_direta', $1, $2, null, $3, null, $4, false, $4)`, [C, LONDRINA, V2, DENT]);
  await asUser(DENT);
  await c.query(`select public.answer_treatment_closure($1, 'nao')`, [lC.id]);
  await asSuper();
  const sC = await seguidor(C);
  check(sC?.status === "contato", "o seguidor foi para o contato junto");
  if (sC) await espera("contato no seguidor", () => c.query(
    `insert into public.treatment_closure_contacts (closure_id, clinic_id, client_id, channel, reached) values ($1, $2, $3, 'ligacao', false)`,
    [sC.id, LONDRINA, C]), "GROUPED");

  console.log("\n6) O líder avaliado: o seguidor vira a decisão (cliente A)");
  await c.query(`update public.treatment_closures set status = 'encerrado', outcome = 'reavaliado', closed_at = now() where id = $1`, [lA.id]);
  const novo = await one(`select * from public.treatment_closures where id = $1`, [sA.id]);
  check(novo.grouped_into === null && novo.status === "reavaliacao", "o seguidor virou o líder, ainda esperando a avaliação");

  console.log("\n7) Venda direta só depois de fechada (cliente D)");
  await c.query(`update public.direct_sales set client_id = $1, status = 'aguardando_fechamento' where id = $2`, [D, V3]);
  // A venda emprestada tem sessões do cliente original: só nesta transação,
  // elas saem do caminho (a regra, com razão, diria que a venda não terminou).
  await c.query(`update public.treatment_sessions set status = 'cancelled' where direct_sale_id = $1 and client_id <> $2 and status in ('pending','scheduled')`, [V3, D]);
  const proc = (await one(`select procedure_id from public.treatment_sessions where client_id = $1 and status in ('pending','scheduled') and procedure_id is not null limit 1`, [D]))?.procedure_id;
  await c.query(`insert into public.treatment_sessions (client_id, clinic_id, direct_sale_id, procedure_id, procedure_name, session_index, session_total, status)
                 values ($1, $2, $3, $4, 'Sessão da venda direta (ensaio)', 1, 1, 'pending')`, [D, LONDRINA, V3, proc]);
  await conclui(`client_id = $1 and direct_sale_id = $2`, [D, V3]);
  const antes = Number((await one(`select count(*) n from public.treatment_closures where direct_sale_id = $1 and client_id = $2`, [V3, D])).n);
  check(antes === 0, "venda direta NÃO fechada não abre decisão");
  await c.query("savepoint vd");
  try {
    await c.query(`update public.direct_sales set status = 'concluida' where id = $1`, [V3]);
    const depois = Number((await one(`select count(*) n from public.treatment_closures where direct_sale_id = $1 and client_id = $2`, [V3, D])).n);
    check(depois === 1, "ao fechar a venda, a decisão nasce");
  } catch (e) {
    await c.query("rollback to savepoint vd");
    check(false, `fechar a venda no ensaio falhou: ${e.message}`);
  }

  console.log("\n8) Portas");
  const p = await one(`select has_function_privilege('anon', 'public.answer_treatment_closure(uuid,text,text,text)', 'execute') a,
                              has_function_privilege('anon', 'public.request_sooner_reevaluation(uuid)', 'execute') b,
                              has_function_privilege('anon', 'public.closure_coordinator_slot(uuid)', 'execute') s,
                              has_function_privilege('authenticated', 'public._fechamento_do_plano(uuid,uuid,uuid,uuid,uuid)', 'execute') d,
                              has_function_privilege('authenticated', 'public._horario_com_coordenador(uuid,uuid)', 'execute') e`);
  check(!p.a && !p.b && !p.s, "sem login, as portas recusam");
  check(!p.d && !p.e, "as internas não respondem a ninguém de fora");
} catch (e) {
  falhou++;
  console.log("✘ ERRO: " + e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`\n${ok} ✔ · ${falhou} ✘ — transação DESFEITA, nada ficou no treino.`);
process.exit(falhou ? 1 : 0);
