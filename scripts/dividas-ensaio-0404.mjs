// ENSAIO DA 0404 (Levantamento de Dívidas, fase 1) no banco de TREINO, numa
// transação DESFEITA: nada fica.
// Uso: node scripts/dividas-ensaio-0404.mjs --confirmar [--quebrar = prova que o ensaio pega a guarda aberta]  (rede sem IPv6: RISARTE_TREINO_POOLER=1)
//
// Cada conta de teste age como ela mesma (papel `authenticated` + `auth.uid()`
// dela — o mesmo que a API faz). Prova:
//   1. a migração roda duas vezes (idempotente);
//   2. só o Financeiro da Franqueadora (e o Admin) lê e grava; os outros 14
//      papéis leem ZERO e são recusados — mesmo marcando um deles na matriz
//      (o teto do banco);
//   3. a situação segue a regra (a vencer · em atraso · inadimplente, prazo
//      por tipo de credor, etapa manual com motivo) e a rotina diária grava a
//      mudança automática no histórico;
//   4. origem: sugerida pela data em que a dívida nasceu; discordar exige
//      justificativa;
//   5. exclusão só lógica e com motivo; histórico imutável; anônimo barrado.
// Só contagens e códigos na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0404_dividas_base.sql";
if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO dentro de transação desfeita. Rode com --confirmar.");
  process.exit(2);
}

const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
let sp = 0;
async function como(uid, fn) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  try { return await fn(); } finally {
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claims', '', true)");
  }
}
// Executa e devolve a mensagem do erro (ou null), sem derrubar a transação.
async function erroDe(sql, p = []) {
  const nome = `s${++sp}`;
  await c.query(`savepoint ${nome}`);
  try { await c.query(sql, p); await c.query(`release savepoint ${nome}`); return null; }
  catch (e) { await c.query(`rollback to savepoint ${nome}`); return e.message; }
}

const PESSOAS = ["admin","financeiro","rede","gerente","franqueado","recepcao","coordenador","dentista","asb","tsb","sdr","planner","consultor","assistente","comprador","rislife"];
const falhas = [];
const ok = (nome, v) => { console.log(`  ${v ? "✓" : "✗"} ${nome}`); if (!v) falhas.push(nome); };

let saida = 1;
try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query(sql);
  console.log("Migração aplicada duas vezes sem erro (idempotente).");
  if (process.argv.includes("--quebrar")) {
    // Prova de que o ensaio pega o vazamento: a guarda passa a deixar qualquer
    // logado. O ensaio TEM de falhar.
    await c.query("create or replace function public.debt_can(p_capability text, p_clinic_id uuid) returns boolean language sql stable security definer set search_path = '' as 'select (select auth.uid()) is not null'");
    console.log("⚠️ MODO QUEBRAR: debt_can deixa qualquer logado (o ensaio tem de FALHAR).");
  }

  const ids = {};
  for (const p of PESSOAS) ids[p] = (await um("select id from auth.users where email = $1", [`${p}@example.com`])).id;
  const ldn = (await um("select id, go_live_on from public.clinics where code = 'LDN'"));
  const sup = await um("select id, kind from public.suppliers where active order by name limit 1");
  const cat = await um("select id, nature_code from public.debt_categories where parent_id is null and name = 'Tributos'");
  const sub = await um("select id from public.debt_categories where parent_id = $1 and name = 'ISS'", [cat.id]);
  const hoje = (await um("select public.today_br() as d")).d;
  const dia = (n) => { const d = new Date(hoje); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  console.log("\n1. Estrutura");
  const est = await um(`select
      (select count(*) from pg_tables where schemaname = 'public' and tablename like 'debt%')::int as tabelas,
      (select count(*) from public.debt_natures)::int as nat,
      (select count(*) from public.debt_categories where parent_id is null)::int as cat,
      (select count(*) from public.debt_categories where parent_id is not null)::int as sub,
      (select count(*) from public.clinics where go_live_on = date '2026-11-16' and code in ('LDN','CBE','RF'))::int as golive,
      (select count(*) from public.audit_missing_tables() t where t.table_name like 'debt%')::int as sem_auditoria`);
  console.log("  ", JSON.stringify(est));
  ok("10 tabelas debt*", est.tabelas === 10);
  ok("4 naturezas, 14 categorias, 14 subcategorias", est.nat === 4 && est.cat === 14 && est.sub === 14);
  ok("implantação 16/11/2026 em LDN, CBE e RF", est.golive === 3);
  ok("toda tabela nova na auditoria (ou declarada fora)", est.sem_auditoria === 0);

  console.log("\n2. Gravar como o Financeiro da Franqueadora");
  const base = { clinic_id: ldn.id, supplier_id: sup.id, category_id: cat.id, subcategory_id: sub.id,
    original_cents: 150000, updated_cents: 180000, issue_date: "2025-03-10", origin: "A", tag_ids: [] };
  const salvar = (uid, p) => como(uid, async () => (await um("select public.debt_save($1::jsonb) as id", [JSON.stringify(p)])).id);
  const dAtraso = await salvar(ids.financeiro, { ...base, due_date: dia(-10) });
  const dInad = await salvar(ids.financeiro, { ...base, due_date: dia(-40) });
  const dFut = await salvar(ids.financeiro, { ...base, due_date: dia(20) });
  const st = async (id) => (await um("select code, status, nature_code, origin_suggested from public.debts where id = $1", [id]));
  const a = await st(dAtraso), b = await st(dInad), f = await st(dFut);
  console.log("  ", a.code, a.status, "|", b.code, b.status, "|", f.code, f.status);
  ok("código DV-", /^DV-\d{6,}$/.test(a.code));
  ok("10 dias = em atraso; 40 dias = inadimplente; futuro = a vencer",
    a.status === "em_atraso" && b.status === "inadimplente" && f.status === "a_vencer");
  ok("natureza herdada da categoria (Tributária)", a.nature_code === "tributaria");
  ok("origem sugerida A (emitida antes de 16/11/2026)", a.origin_suggested === "A");

  const eB = await erroDe("select public.debt_save($1::jsonb)", [JSON.stringify({ ...base, due_date: dia(5), origin: "B" })])
    .then(async (e) => e); // como superusuário a guarda já recusa (sem login):
  ok("sem login: recusa", eB !== null && /Entre no sistema/.test(eB));
  const eSemJust = await como(ids.financeiro, () => erroDe("select public.debt_save($1::jsonb)", [JSON.stringify({ ...base, due_date: dia(5), origin: "B" })]));
  ok("origem B contra a sugestão A sem justificativa: recusa", eSemJust !== null && /justificativa/.test(eSemJust));
  const dJust = await salvar(ids.financeiro, { ...base, due_date: dia(5), origin: "B", origin_override_reason: "Compra feita depois da implantação" });
  ok("com justificativa: grava", !!dJust);
  const vencendo = await salvar(ids.financeiro, { ...base, issue_date: "2026-11-10", due_date: "2026-12-20", origin: "A" });
  ok("vence depois de 16/11 mas nasceu antes: sugerida A (D2)", (await st(vencendo)).origin_suggested === "A");
  const eSub = await como(ids.financeiro, () => erroDe("select public.debt_save($1::jsonb)", [JSON.stringify({ ...base, due_date: dia(1), subcategory_id: (dAtraso) })]));
  ok("subcategoria de outra categoria: recusa", eSub !== null);
  const eSemValor = await como(ids.financeiro, () => erroDe("select public.debt_save($1::jsonb)", [JSON.stringify({ ...base, due_date: dia(1), original_cents: 0, updated_cents: null })]));
  ok("sem valor: recusa", eSemValor !== null && /valor/.test(eSemValor));

  console.log("\n3. Quem lê e quem grava");
  const tot = (await um("select count(*)::int n from public.debts")).n;
  for (const p of PESSOAS) {
    const n = await como(ids[p], async () => (await um(`select
        (select count(*) from public.debts)::int +
        (select count(*) from public.debt_categories)::int +
        (select count(*) from public.debt_settings)::int +
        (select count(*) from public.debt_events)::int +
        (select count(*) from public.debt_history($1))::int as n`, [dAtraso])).n);
    const grava = await como(ids[p], () => erroDe("select public.debt_save($1::jsonb)", [JSON.stringify({ ...base, due_date: dia(3) })]));
    if (p === "admin" || p === "financeiro") ok(`${p} lê tudo e grava`, n > tot && grava === null);
    else ok(`${p} lê zero e é recusado`, n === 0 && grava !== null);
  }
  // O teto: marcar o Gerente na matriz não abre nada.
  await c.query("insert into public.permission_matrix (capability, role) values ('modulo.dividas','unit_manager'), ('acao.dividas.lancar','unit_manager') on conflict do nothing");
  const nGer = await como(ids.gerente, async () => (await um("select count(*)::int n from public.debts")).n);
  ok("Gerente marcado na matriz continua lendo zero (teto do banco)", nGer === 0);
  // Desmarcar o Financeiro na matriz tira o acesso dele.
  await c.query("update public.permission_matrix set allowed = false where capability = 'modulo.dividas' and role = 'finance_franchisor'");
  const nFin = await como(ids.financeiro, async () => (await um("select count(*)::int n from public.debts")).n);
  ok("Financeiro desmarcado na matriz perde a leitura", nFin === 0);
  await c.query("update public.permission_matrix set allowed = true where capability = 'modulo.dividas' and role = 'finance_franchisor'");

  console.log("\n4. Etapa manual, regra por tipo de credor, rotina diária");
  const eMotivo = await como(ids.financeiro, () => erroDe("select public.debt_set_stage($1, 'contestada', '')", [dAtraso]));
  ok("contestar sem motivo: recusa", eMotivo !== null);
  const sCont = await como(ids.financeiro, async () => (await um("select public.debt_set_stage($1, 'contestada', 'Não reconhecemos a cobrança') s", [dAtraso])).s);
  const sVolta = await como(ids.financeiro, async () => (await um("select public.debt_set_stage($1, null, 'Credor provou a dívida') s", [dAtraso])).s);
  ok("contestada e volta à situação pelo vencimento", sCont === "contestada" && sVolta === "em_atraso");
  await como(ids.financeiro, () => c.query("select public.debt_save_default_rule($1, 5)", [sup.kind]));
  ok("prazo de 5 dias para o tipo do credor: 10 dias vira inadimplente", (await st(dAtraso)).status === "inadimplente");
  await como(ids.financeiro, () => c.query("select public.debt_save_default_rule($1, null)", [sup.kind]));
  ok("tirar a regra: volta a em atraso", (await st(dAtraso)).status === "em_atraso");
  await c.query("update public.debts set due_date = $2 where id = $1", [dFut, dia(-1)]);
  const mudou = (await um("select public.debt_daily_run() n")).n;
  const ev = await um("select kind, from_status, to_status, user_id from public.debt_events where debt_id = $1 order by id desc limit 1", [dFut]);
  ok("rotina diária muda a situação e registra como automática",
    mudou >= 1 && ev.kind === "situacao_automatica" && ev.to_status === "em_atraso" && ev.user_id === null);

  console.log("\n5. Exclusão, histórico, anônimo, categorias");
  const eSemMotivo = await como(ids.financeiro, () => erroDe("select public.debt_delete($1, '')", [dInad]));
  ok("excluir sem motivo: recusa", eSemMotivo !== null);
  await como(ids.financeiro, () => c.query("select public.debt_delete($1, 'Lançada em duplicidade')", [dInad]));
  const del = await um("select deleted_at is not null as x, deleted_reason from public.debts where id = $1", [dInad]);
  ok("exclusão lógica com motivo (a linha continua no banco)", del.x && del.deleted_reason === "Lançada em duplicidade");
  const hist = await como(ids.financeiro, async () => (await c.query("select source, event_kind from public.debt_history($1)", [dAtraso])).rows);
  ok("histórico tem trilha campo a campo e eventos", hist.some((h) => h.source === "trilha") && hist.some((h) => h.event_kind === "criada"));
  const eImut = await erroDe("update public.debt_events set note = 'x' where debt_id = $1", [dAtraso]);
  ok("histórico não se altera (nem o superusuário)", eImut !== null);
  const anon = await (async () => { await c.query("savepoint an"); await c.query("set local role anon");
    try { await c.query("select public.debt_save('{}'::jsonb)"); return "EXECUTOU"; }
    catch (e) { return e.code; } finally { await c.query("rollback to savepoint an"); } })();
  ok(`anônimo não executa debt_save (veio ${anon})`, anon === "42501");
  const anonLe = await (async () => { await c.query("savepoint an2"); await c.query("set local role anon");
    try { return (await c.query("select count(*)::int n from public.debts")).rows[0].n; }
    catch (e) { return e.code; } finally { await c.query("rollback to savepoint an2"); } })();
  ok(`anônimo não lê dívidas (veio ${anonLe})`, anonLe === 0 || anonLe === "42501");
  const sub2 = await um("select id from public.debt_categories where parent_id is not null limit 1");
  const eTres = await como(ids.financeiro, () => erroDe("select public.debt_save_category($1::jsonb)", [JSON.stringify({ name: "Neta", parent_id: sub2.id })]));
  ok("subcategoria de subcategoria: recusa (só dois níveis)", eTres !== null);
  const tag1 = await como(ids.financeiro, async () => (await um("select public.debt_save_tag('{\"name\":\"Avalista teste\"}'::jsonb) id")).id);
  const tag2 = await como(ids.financeiro, async () => (await um("select public.debt_save_tag('{\"name\":\"avalista TESTE\"}'::jsonb) id")).id);
  ok("etiqueta com o mesmo nome reaproveita a existente", tag1 === tag2);

  saida = falhas.length === 0 ? 0 : 1;
  console.log(saida === 0 ? "\nENSAIO OK." : `\nENSAIO FALHOU: ${falhas.length} conferência(s).`);
} catch (e) {
  console.error("ERRO NO ENSAIO (não medi):", e.message);
  saida = 1;
} finally {
  await c.query("rollback");
  await c.end();
  console.log("(transação desfeita — nada ficou no treino)");
}
process.exit(saida);
