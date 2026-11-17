// ENSAIO DA 0421 (fim do tratamento, Etapa 3: o controle de qualidade) no banco
// de TREINO — tudo numa transação DESFEITA no fim; nada fica gravado.
// Pressupõe a 0418 e a 0420 aplicadas no treino.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/ensaio-fim-do-tratamento-0421.mjs [--quebrar=trava|queixa|saida]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const W = process.cwd().split("\\").join("/") + "/";
const { connect } = await import(pathToFileURL(W + "scripts/test-db.mjs").href);
const quebrar = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? "";

const original = readFileSync(W + "supabase/migrations/0421_fim_do_tratamento_qualidade.sql", "utf8");
let sql = original;
if (quebrar === "trava") sql = sql.replace("     where plan_id = v_plan and status = 'reavaliacao';", "     where plan_id = v_plan and status = 'nenhum';");
if (quebrar === "queixa") sql = sql.replace("if p_complaint and p_outcome <> 'revisar' then", "if false then");
if (quebrar === "saida") sql = sql.replace("              where f.client_id = p_client_id and f.status = 'reavaliacao') then", "              where false) then");
// 0422 por cima (não recria as funções que estas quebras tocam).
const S0422 = readFileSync(W + "supabase/migrations/0422_fim_do_tratamento_uma_decisao_por_cliente.sql", "utf8");
sql += "\n" + S0422;
if (quebrar && sql === original + "\n" + S0422) throw new Error(`a quebra "${quebrar}" não achou o que quebrar: não mediu nada`);

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
  console.log(`0421 aplicada na transação${quebrar ? ` (QUEBRADA: ${quebrar})` : ""}.`);
  await asSuper();

  const role = async (r) => (await one(
    `select u.user_id from public.user_clinic_roles u join public.profiles p on p.id = u.user_id
      where u.clinic_id = $1 and u.role = $2 and coalesce(p.is_owner,false) = false and p.is_admin_master = false
      order by p.email like '%example.com' desc limit 1`, [LONDRINA, r]))?.user_id;
  const DENT = await role("dentist"), COORD = await role("clinical_coordinator");
  // Clientes com UM plano vendido aberto, cujos itens da opção vendida têm
  // sessão (para dar para avaliar todos), sem ortodontia e sem fechamento.
  const cand = (await c.query(`
    with abertas as (
      select ts.client_id, ts.plan_id from public.treatment_sessions ts
       where ts.status in ('pending','scheduled') and ts.plan_id is not null group by 1, 2)
    select a.client_id, a.plan_id from abertas a join public.clients cl on cl.id = a.client_id
     where cl.clinic_id = $1 and cl.journey_phase = 'treatment_start'
       and not exists (select 1 from public.treatment_sessions x where x.client_id = a.client_id
                        and x.status in ('pending','scheduled') and x.plan_id is distinct from a.plan_id)
       and not exists (select 1 from public.ortho_cases o where o.client_id = a.client_id)
       and not exists (select 1 from public.treatment_closures f where f.client_id = a.client_id)
       and exists (select 1 from public.plan_negotiations n join public.commercial_sales s on s.negotiation_id = n.id
                    where n.plan_id = a.plan_id and n.status = 'aceita' and s.closed_at is not null and s.cancelled_at is null)
     order by a.client_id limit 12`, [LONDRINA])).rows;
  if (!DENT || !COORD || cand.length < 3) throw new Error(`o treino não tem 3 clientes que servem ao ensaio (${cand.length}): não dá para medir`);

  const conclui = async (cli) => {
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: DENT, role: "authenticated" })]);
    await c.query(`update public.treatment_sessions set status = 'done', done_at = now(), executed_by = $2
                    where client_id = $1 and status in ('pending','scheduled')`, [cli, DENT]);
    await asSuper();
  };
  const fech = async (cli) => { await asSuper(); return one(`select * from public.treatment_closures where client_id = $1 order by created_at desc limit 1`, [cli]); };
  const itens = async (plan) => (await c.query(`
    select i.id from public.treatment_plan_option_items i
     where i.option_id = (select n.option_id from public.plan_negotiations n join public.commercial_sales s on s.negotiation_id = n.id
                           where n.plan_id = $1 and n.status = 'aceita' and s.closed_at is not null and s.cancelled_at is null
                           order by s.closed_at desc limit 1)
       and not exists (select 1 from public.plan_negotiation_items ni join public.plan_negotiations n on n.id = ni.negotiation_id
                        where n.plan_id = $1 and ni.item_id = i.id and ni.included = false)`, [plan])).rows.map((r) => r.id);

  // Só serve quem tem itens na opção vendida (para dar para avaliar).
  const comItens = [];
  for (const x of cand) if ((await itens(x.plan_id)).length > 0) comItens.push(x);
  if (comItens.length < 3) throw new Error(`só ${comItens.length} cliente(s) com itens na opção vendida: não dá para medir`);
  const [A, B, C] = comItens;

  console.log("\n1) A conversão das avaliações antigas (D8)");
  const sem = await one(`select count(*) n from public.plan_quality_reviews where level is null`);
  check(Number(sem.n) === 0, "toda avaliação tem nível");

  console.log("\n2) Cinco níveis: tudo aprovado encerra o fechamento (cliente A)");
  await conclui(A.client_id);
  let f = await fech(A.client_id);
  await asUser(DENT);
  await c.query(`select public.answer_treatment_closure($1, 'sim', 'Considerações de ensaio para o Coordenador', 'manter')`, [f.id]);
  await asSuper();
  check((await fech(A.client_id)).status === "reavaliacao", "aguardando a reavaliação");
  const itA = await itens(A.plan_id);
  check(itA.length > 0, `a opção vendida tem ${itA.length} item(ns) para avaliar`);
  await asUser(COORD);
  await espera("Revisar sem observação", () => c.query(`select public.set_plan_item_quality($1, 'aprovado', null, $2, null, null, null, 'revisar')`, [itA[0], DENT]), "NOTE_REQUIRED");
  await asUser(COORD);
  for (const [k, it] of itA.entries()) {
    await c.query(`select public.set_plan_item_quality($1, 'aprovado', null, $2, null, null, null, $3)`, [it, DENT, k === 0 ? "excelente" : "bom"]);
  }
  await asSuper();
  f = await fech(A.client_id);
  check(f.status === "encerrado" && f.outcome === "reavaliado", "tudo aprovado: o fechamento encerra como 'reavaliado'");
  const lv = await one(`select level from public.plan_quality_reviews where item_id = $1`, [itA[0]]);
  check(lv.level === "excelente", "o nível fica gravado");
  check(Number((await one(`select count(*) n from public.notifications where user_id = $1 and title = 'Procedimento avaliado como Excelente'`, [DENT])).n) >= 1, "o Excelente avisa quem executou (D24)");

  console.log("\n3) Sair da Reavaliação (D23, D22)");
  const fase = async (cli) => (await one(`select journey_phase, follow_up_return_at from public.clients where id = $1`, [cli]));
  check((await fase(A.client_id)).journey_phase === "reevaluation", "o cliente A está na Reavaliação");
  await asUser(COORD);
  const ret = await one(`select public.conclude_reevaluation($1, null) d`, [A.client_id]);
  await asSuper();
  const fa = await fase(A.client_id);
  check(fa.journey_phase === "follow_up" && fa.follow_up_return_at, `concluída: Acompanhamento com retorno em ${ret.d?.toISOString?.().slice(0, 10) ?? ret.d}`);

  console.log("\n4) Com Revisar em aberto, não sai da Reavaliação (cliente B)");
  await conclui(B.client_id);
  f = await fech(B.client_id);
  await asUser(DENT);
  await c.query(`select public.answer_treatment_closure($1, 'sim', 'Considerações de ensaio para o Coordenador', 'manter')`, [f.id]);
  // Sem a avaliação feita, também não sai (a trava do fechamento aberto).
  await asUser(COORD);
  await espera("concluir a reavaliação sem avaliar", () => c.query(`select public.conclude_reevaluation($1, null)`, [B.client_id]), "QUALITY_PENDING");
  await asSuper();
  const itB = await itens(B.plan_id);
  await asUser(COORD);
  await c.query(`select public.set_plan_item_quality($1, 'aprovado', 'Margem da restauração', $2, null, null, null, 'revisar')`, [itB[0], DENT]);
  await asSuper();
  check((await fech(B.client_id)).status === "reavaliacao", "com Revisar, o fechamento continua aberto");
  await asUser(COORD);
  await espera("concluir a reavaliação com Revisar em aberto", () => c.query(`select public.conclude_reevaluation($1, null)`, [B.client_id]), "QUALITY_PENDING");
  await asUser(COORD);
  await espera("registrar um nível só num plano (tem itens)", () => c.query(`select public.register_closure_quality($1, 'bom', null)`, [f.id]), "USE_ITEM_EVALUATION");
  await asSuper();

  console.log("\n5) O contato com satisfação e queixa (D18, cliente C)");
  await conclui(C.client_id);
  f = await fech(C.client_id);
  await asUser(DENT);
  await c.query(`select public.answer_treatment_closure($1, 'nao')`, [f.id]);
  await asUser(COORD);
  await espera("falou com o cliente sem a satisfação", () => c.query(`select public.register_closure_contact($1, 'ligacao', true, 'Disse que está tudo bem', 'aguardar_retorno', null, null, null)`, [f.id]), "SATISFACTION_REQUIRED");
  await asUser(COORD);
  await espera("queixa sem chamar para revisar", () => c.query(`select public.register_closure_contact($1, 'ligacao', true, 'Reclamou de sensibilidade', 'aguardar_retorno', null, 6::smallint, true)`, [f.id]), "COMPLAINT_REQUIRES_REVIEW");
  await asUser(COORD);
  await c.query(`select public.register_closure_contact($1, 'ligacao', true, 'Reclamou de sensibilidade', 'revisar', null, 6::smallint, true)`, [f.id]);
  await asSuper();
  const ct = await one(`select satisfaction, has_complaint from public.treatment_closure_contacts where closure_id = $1`, [f.id]);
  check(ct.satisfaction === 6 && ct.has_complaint === true, "satisfação e queixa gravadas");
  check((await fech(C.client_id)).status === "reavaliacao", "a queixa leva à reavaliação");

  console.log("\n6) Reavaliação sem itens de plano (ortodontia)");
  const O = (await one(`select o.id, o.client_id from public.ortho_cases o where o.status in ('aguardando_inicio','em_tratamento','suspenso') limit 1`));
  if (O) {
    await c.query(`update public.treatment_sessions set status = 'cancelled' where client_id = $1 and status in ('pending','scheduled')`, [O.client_id]);
    await c.query(`update public.ortho_cases set status = 'contencao' where id = $1`, [O.id]);
    const fo = await one(`select * from public.treatment_closures where ortho_case_id = $1`, [O.id]);
    await c.query(`update public.treatment_closures set status = 'reavaliacao', answer = 'sim' where id = $1`, [fo.id]);
    const coordO = (await one(`select u.user_id from public.user_clinic_roles u where u.role = 'clinical_coordinator' and u.clinic_id = (select clinic_id from public.ortho_cases where id = $1) limit 1`, [O.id]))?.user_id ?? COORD;
    await asUser(coordO);
    await espera("Refazer sem observação", () => c.query(`select public.register_closure_quality($1, 'refazer', null)`, [fo.id]), "NOTE_REQUIRED");
    await asUser(coordO);
    await c.query(`select public.register_closure_quality($1, 'aceitavel', null)`, [fo.id]);
    await asSuper();
    const fo2 = await one(`select status, quality_level from public.treatment_closures where id = $1`, [fo.id]);
    check(fo2.status === "encerrado" && fo2.quality_level === "aceitavel", "um nível encerra a reavaliação da ortodontia");
  } else check(false, "achou caso ortodôntico aberto no treino");

  console.log("\n7) As portas");
  const p = await one(`select has_function_privilege('anon', 'public.register_closure_quality(uuid,text,text)', 'execute') a,
                              has_function_privilege('anon', 'public.conclude_reevaluation(uuid,date)', 'execute') b,
                              has_function_privilege('anon', 'public.set_plan_item_quality(uuid,text,text,uuid,text,uuid,text,text)', 'execute') cc`);
  check(!p.a && !p.b && !p.cc, "sem login, as portas recusam");
} catch (e) {
  falhou++;
  console.log("✘ ERRO: " + e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`\n${ok} ✔ · ${falhou} ✘ — transação DESFEITA, nada ficou no treino.`);
process.exit(falhou ? 1 : 0);
