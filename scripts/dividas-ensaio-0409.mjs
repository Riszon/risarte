// ENSAIO DA 0409 (Levantamento de Dívidas, fase 7 — o card "Dívidas da
// unidade") no banco de TREINO, numa transação DESFEITA: nada fica.
// Uso: node scripts/dividas-ensaio-0409.mjs --confirmar [--quebrar]
//      (rede sem IPv6: RISARTE_TREINO_POOLER=1)
//
//   1. a permissão nasce SEM papel: o Gerente não vê nada;
//   2. marcada para o Gerente na matriz: ele vê os números da PRÓPRIA unidade,
//      e não os de outra; os números batem com a regra única;
//   3. marcada para um papel fora do teto (Recepção): continua sem ver;
//   4. o Financeiro da Franqueadora vê qualquer unidade; anônimo não executa.
// `--quebrar`: a porta esquece o teto — o ensaio TEM de falhar.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO dentro de transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const ARQ = "supabase/migrations/0409_dividas_card_da_unidade.sql";
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
async function como(uid, fn) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  try { return await fn(); } finally {
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claims', '', true)");
  }
}
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
    const ini = sql.indexOf("create or replace function public._debt_can_see_unit");
    const corpo = sql.slice(ini, sql.indexOf("revoke execute on function public._debt_can_see_unit"));
    await c.query(corpo.replace("and ucr.role = any (public._debt_cap_ceiling('acao.dividas.ver_unidade'))", () => ""));
    console.log("⚠️ MODO QUEBRAR: a porta esquece o teto (o ensaio tem de FALHAR).");
  }

  const ids = {};
  for (const p of ["financeiro", "gerente"]) ids[p] = (await um("select id from auth.users where email = $1", [`${p}@example.com`])).id;
  const minha = await um("select clinic_id from public.user_clinic_roles_all where user_id = $1 and role = 'unit_manager' limit 1", [ids.gerente]);
  if (!minha) throw new Error("NÃO MEDI: o Gerente de teste não é gerente de nenhuma unidade.");
  const outra = await um("select id from public.clinics where id <> $1 and is_active order by name limit 1", [minha.clinic_id]);
  // Uma dívida na unidade do Gerente (só dentro da transação).
  const sup = (await um("select id from public.suppliers where active order by name limit 1")).id;
  await como(ids.financeiro, () => c.query("select public.debt_save($1::jsonb)", [JSON.stringify({
    clinic_id: minha.clinic_id, supplier_id: sup, original_cents: 12345, due_date: "2025-01-10", issue_date: "2025-01-01", origin: "A" })]));

  const resumo = (uid, clinic) => como(uid, async () => (await c.query("select * from public.debt_unit_summary($1)", [clinic])).rows);
  const esperado = await um(`select coalesce(sum(p.balance_cents),0)::bigint s from public._debt_positions((select array_agg(id) from public.debts
    where clinic_id = $1 and deleted_at is null and status <> 'baixada')) p`, [minha.clinic_id]);

  console.log("\n1. Nasce sem papel");
  ok("padrão vazio e nenhuma linha na matriz",
    (await um("select roles from public.permission_defaults where capability = 'acao.dividas.ver_unidade'")).roles === "{}"
      && Number((await um("select count(*) n from public.permission_matrix where capability = 'acao.dividas.ver_unidade'")).n) === 0);
  ok("o Gerente não vê nada", (await resumo(ids.gerente, minha.clinic_id)).length === 0);

  console.log("\n2. Marcada para o Gerente");
  await c.query("insert into public.permission_matrix (capability, role) values ('acao.dividas.ver_unidade', 'unit_manager') on conflict do nothing");
  const r = await resumo(ids.gerente, minha.clinic_id);
  ok("vê os números da própria unidade, com o saldo da regra única", r.length === 1 && Number(r[0].balance_cents) === Number(esperado.s) && Number(r[0].debts) >= 1);
  ok("não vê os de outra unidade", (await resumo(ids.gerente, outra.id)).length === 0);
  ok("continua sem ler as tabelas das dívidas", Number((await como(ids.gerente, () => um("select count(*) n from public.debts"))).n) === 0);

  console.log("\n3. Papel fora do teto");
  await c.query("delete from public.permission_matrix where capability = 'acao.dividas.ver_unidade'");
  await c.query("insert into public.permission_matrix (capability, role) values ('acao.dividas.ver_unidade', 'receptionist') on conflict do nothing");
  const recep = await um("select user_id, clinic_id from public.user_clinic_roles_all where role = 'receptionist' limit 1");
  if (!recep) throw new Error("NÃO MEDI: nenhuma Recepção no treino.");
  ok("a Recepção marcada na matriz continua sem ver (teto)", (await resumo(recep.user_id, recep.clinic_id)).length === 0);

  console.log("\n4. O Financeiro e o anônimo");
  ok("o Financeiro da Franqueadora vê qualquer unidade", (await resumo(ids.financeiro, outra.id)).length === 1);
  const an = await (async () => { await c.query("savepoint an"); await c.query("set local role anon");
    try { await c.query("select * from public.debt_unit_summary(gen_random_uuid())"); return "EXECUTOU"; } catch (e) { return e.code; } finally { await c.query("rollback to savepoint an"); } })();
  ok(`anônimo não executa (veio ${an})`, an === "42501");

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
