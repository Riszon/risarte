// ENSAIO DA 0426 (fim do tratamento, Etapa 5: o cancelamento pelo caminho do
// fim) no banco de TREINO — tudo numa transação DESFEITA; nada fica gravado.
// Pressupõe a 0418–0423 aplicadas no treino.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/ensaio-fim-do-tratamento-0426.mjs [--quebrar=riscos|destino|coordenador]
//
// O distrato com checklist (4020) é do Asaas e tem as próprias provas: aqui o
// termo é marcado sem checklist (como o cancelamento antigo) para medir só o
// que a 0426 acrescenta.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const W = process.cwd().split("\\").join("/") + "/";
const { connect } = await import(pathToFileURL(W + "scripts/test-db.mjs").href);
const quebrar = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? "";

const original = readFileSync(W + "supabase/migrations/0426_fim_do_tratamento_cancelamento.sql", "utf8");
let sql = original;
if (quebrar === "riscos") sql = sql.replace("     and new.risks_required and new.risks_registered_at is null then", "     and false then");
if (quebrar === "destino")
  sql = sql.replace("if v_phase = 'treatment_start' and not public._tratamento_em_aberto(new.client_id) then", "if false then");
if (quebrar === "coordenador") sql = sql.replace("  if v_status is null then return new; end if;", "  return new;");
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
  console.log(`0426 aplicada na transação${quebrar ? ` (QUEBRADA: ${quebrar})` : ""}.`);
  await asSuper();

  const role = async (r, sem = []) => (await one(
    `select u.user_id from public.user_clinic_roles u join public.profiles p on p.id = u.user_id
      where u.clinic_id = $1 and u.role = $2 and coalesce(p.is_owner,false) = false and p.is_admin_master = false
        and not exists (select 1 from public.user_clinic_roles o where o.user_id = u.user_id and o.clinic_id = $1
                         and o.role::text = any($3))
      order by p.email like '%example.com' desc limit 1`, [LONDRINA, r, sem]))?.user_id;
  const COORD = await role("clinical_coordinator", ["unit_manager"]);
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
  if (!COORD || !DENT || !GER) throw new Error("faltam papéis em Londrina no treino: não dá para medir");

  // Clientes na Fase 5 com UMA venda viva, sessões pendentes só dela, sem
  // ortodontia, sem fechamento e sem termo aberto.
  const cand = (await c.query(`
    select n.client_id, n.id as neg, n.plan_id
      from public.plan_negotiations n
      join public.commercial_sales s on s.negotiation_id = n.id
      join public.clients cl on cl.id = n.client_id
     where cl.clinic_id = $1 and cl.journey_phase = 'treatment_start'
       and n.status = 'aceita' and s.closed_at is not null and s.cancelled_at is null
       and (select count(*) from public.plan_negotiations n2 join public.commercial_sales s2 on s2.negotiation_id = n2.id
             where n2.client_id = n.client_id and n2.status = 'aceita' and s2.closed_at is not null and s2.cancelled_at is null) = 1
       and exists (select 1 from public.treatment_sessions ts where ts.plan_id = n.plan_id and ts.status = 'pending')
       and not exists (select 1 from public.treatment_sessions ts where ts.client_id = n.client_id
                        and ts.status in ('pending','scheduled') and ts.plan_id is distinct from n.plan_id)
       and not exists (select 1 from public.ortho_cases o where o.client_id = n.client_id)
       and not exists (select 1 from public.treatment_closures f where f.client_id = n.client_id and f.status <> 'encerrado')
       and not exists (select 1 from public.plan_cancellations pc where pc.negotiation_id = n.id and pc.status in ('rascunho','assinado'))
     order by n.client_id limit 10`, [LONDRINA])).rows;

  // Abre um termo como o Gerente; pula o candidato que o Asaas recusa (acordo aberto etc.).
  const abrir = async (dest, ret) => {
    while (cand.length) {
      const k = cand.shift();
      await c.query("savepoint abre");
      try {
        await asUser(GER);
        const id = (await one(`select public.open_plan_cancellation($1, 'Ensaio 0426', $2, $3) id`, [k.neg, dest, ret])).id;
        await asSuper();
        // O distrato com checklist é do Asaas (provado lá): aqui, o termo antigo.
        await c.query(`update public.plan_cancellations set checklist_required = false where id = $1`, [id]);
        return { ...k, id };
      } catch (e) {
        await c.query("rollback to savepoint abre");
        await asSuper();
        console.log(`    (o termo recusou um candidato: ${e.message})`);
      }
    }
    throw new Error("o treino não tem cliente que o termo aceite: não dá para medir");
  };
  const fase = async (cli) => (await one(`select journey_phase from public.clients where id = $1`, [cli])).journey_phase;
  const termo = async (id) => one(`select * from public.plan_cancellations where id = $1`, [id]);

  console.log("\n1. Procedimento começado e não terminado: o termo pede os riscos (D25)");
  // Um item com uma sessão feita e outra pendente.
  if (!cand.length) throw new Error("sem candidatos no treino: não dá para medir");
  const item = await one(`select item_id from public.treatment_sessions where plan_id = $1 and status = 'pending' and item_id is not null limit 1`, [cand[0].plan_id]);
  await c.query(`insert into public.treatment_sessions (client_id, clinic_id, plan_id, item_id, procedure_name, session_index, session_total, status, done_at, executed_by)
                 select client_id, clinic_id, plan_id, item_id, procedure_name, 0, session_total, 'done', now() - interval '20 days', $2
                   from public.treatment_sessions where plan_id = $1 and item_id = $3 limit 1`, [cand[0].plan_id, DENT, item.item_id]);
  const A = await abrir("follow_up", "2027-06-01").catch(async () => null);
  if (!A) throw new Error("não abriu o termo");
  check((await termo(A.id)).risks_required === true, "o termo nasceu exigindo os riscos");
  const aviso = await one(`select count(*) n from public.notifications where link = $1 and title like 'Cancelamento: registrar os riscos%'`, ["/prontuarios/" + A.client_id]);
  check(Number(aviso.n) >= 1, "o Coordenador foi avisado");
  await asUser(GER);
  await espera("assinar sem o registro", () => c.query(`select public.sign_plan_cancellation($1, true)`, [A.id]), "RISKS_PENDING");
  await asUser(DENT);
  await espera("o dentista registra os riscos", () => c.query(`select public.register_cancellation_risks($1,'Informado o risco de perder o dente provisório','ligacao',public.today_br())`, [A.id]), "NOT_ALLOWED");
  await asUser(COORD);
  await espera("riscos curtos demais", () => c.query(`select public.register_cancellation_risks($1,'curto','ligacao',public.today_br())`, [A.id]), "RISKS_REQUIRED");
  await c.query(`select public.register_cancellation_risks($1,'Informado o risco de perder o dente sem a coroa definitiva','presencial',public.today_br())`, [A.id]);
  await asUser(GER);
  await c.query(`select public.sign_plan_cancellation($1, true)`, [A.id]);
  check((await (async () => { await asSuper(); return termo(A.id); })()).status === "assinado", "com o registro, o termo foi assinado");

  console.log("\n2. O destino pela regra única, na efetivação (D10, D12)");
  await asUser(COORD);
  await espera("o Coordenador prepara a efetivação", () => c.query(`select public.prepare_cancellation_apply($1,'reevaluation')`, [A.id]), "NOT_ALLOWED");
  await asUser(GER);
  const destA = (await one(`select public.prepare_cancellation_apply($1,'reevaluation') d`, [A.id])).d;
  check(destA === "reevaluation", "o Gerente escolheu a Fase 6 na efetivação");
  await c.query(`select public.apply_plan_cancellation($1)`, [A.id]);
  await asSuper();
  check((await fase(A.client_id)) === "reevaluation", "o cliente foi para a Fase 6");
  check((await one(`select lifecycle from public.treatment_plans where id = $1`, [A.plan_id])).lifecycle === "cancelado", "o plano virou Cancelado");
  const fA = await one(`select * from public.treatment_closures where cancellation_id = $1`, [A.id]);
  check(fA?.scope === "cancelamento" && fA?.status === "reavaliacao" && fA?.answer === "sim", "o Coordenador foi chamado: avaliar o que foi feito");

  console.log("\n3. O cliente que ficaria esquecido na Fase 5");
  const B = await abrir("follow_up", "2027-06-01");
  await asSuper();
  // Como um termo aberto antes da 0426, quando outra venda ainda parecia seguir.
  await c.query(`update public.plan_cancellations set destination = null, follow_up_return_at = null where id = $1`, [B.id]);
  await asUser(GER);
  await c.query(`select public.sign_plan_cancellation($1, true)`, [B.id]);
  await espera("efetivar sem destino", () => c.query(`select public.apply_plan_cancellation($1)`, [B.id]), "DESTINATION_REQUIRED");
  await espera("preparar sem dizer para onde", () => c.query(`select public.prepare_cancellation_apply($1)`, [B.id]), "DESTINATION_REQUIRED");
  await espera("retorno no passado", () => c.query(`select public.prepare_cancellation_apply($1,'follow_up',public.today_br())`, [B.id]), "RETURN_DATE_PAST");
  await c.query(`select public.prepare_cancellation_apply($1,'follow_up')`, [B.id]);
  await c.query(`select public.apply_plan_cancellation($1)`, [B.id]);
  await asSuper();
  const cliB = await one(`select journey_phase, follow_up_return_at, (public.today_br() + interval '6 months')::date esperado from public.clients where id = $1`, [B.client_id]);
  check(cliB.journey_phase === "follow_up", "foi para a Fase 7");
  check(String(cliB.follow_up_return_at) === String(cliB.esperado), "retorno sugerido: daqui a 6 meses");
  const fB = await one(`select * from public.treatment_closures where cancellation_id = $1`, [B.id]);
  check(fB?.status === "contato", "o Coordenador foi chamado: contatar o cliente");

  console.log("\n4. Sobra tratamento: fica na Fase 5");
  const C = await abrir("follow_up", "2027-06-01");
  await asSuper();
  // Outro tratamento do cliente (uma sessão pendente fora deste plano).
  await c.query(`insert into public.treatment_sessions (client_id, clinic_id, procedure_name, session_index, session_total, status)
                 values ($1, $2, 'Outro tratamento (ensaio)', 1, 1, 'pending')`, [C.client_id, LONDRINA]);
  await asUser(GER);
  await c.query(`select public.sign_plan_cancellation($1, true)`, [C.id]);
  await c.query("savepoint direto");
  // Sem preparar: o destino antigo levaria o cliente embora com tratamento sobrando.
  await espera("efetivar com tratamento sobrando e destino antigo", () => c.query(`select public.apply_plan_cancellation($1)`, [C.id]), "TREATMENT_STILL_OPEN");
  const r = (await one(`select public.prepare_cancellation_apply($1,'follow_up') r`, [C.id])).r;
  check(r === "segue_em_tratamento", "preparar diz: segue em tratamento");
  await asSuper();
  check((await termo(C.id)).destination === null, "o destino foi apagado");
  await asUser(GER);
  await c.query(`select public.apply_plan_cancellation($1)`, [C.id]);
  await asSuper();
  check((await fase(C.client_id)) === "treatment_start", "o cliente ficou na Fase 5");

  console.log("\n5. A tela e as portas");
  await asUser(GER);
  const info = await one(`select * from public.cancellation_end_info($1)`, [C.id]);
  check(info.kind === "contrato" && info.fase === "treatment_start", "a tela lê o que a efetivação faz");
  await asUser(DENT);
  await espera("o dentista lê a efetivação", () => c.query(`select * from public.cancellation_end_info($1)`, [C.id]), "NOT_ALLOWED");
  await asSuper();
  const anon = await one(`select bool_or(has_function_privilege('anon', p.oid, 'execute')) x from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('register_cancellation_risks','prepare_cancellation_apply','cancellation_end_info',
      '_tratamento_em_aberto_fora','_cancelamento_tem_incompleto','plan_cancellation_end_guard','plan_cancellation_end_apply')`);
  check(anon.x === false, "nada aberto para quem não está logado");
  const interna = await one(`select has_function_privilege('authenticated', 'public._tratamento_em_aberto_fora(uuid,uuid)', 'execute') x`);
  check(interna.x === false, "a regra interna não é porta");
} catch (e) {
  falhou++;
  console.log("  ✘ ERRO: " + e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`\n${ok} ok, ${falhou} falha(s). Transação desfeita.`);
process.exit(falhou ? 1 : 0);
