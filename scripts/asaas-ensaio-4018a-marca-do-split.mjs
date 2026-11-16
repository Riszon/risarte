// ENSAIO DA 4018a (a marca do "split a mais", spec 20.17.9) no banco de TREINO,
// numa transação DESFEITA (rollback). O Asaas não é chamado.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4018a-marca-do-split.mjs --confirmar [--quebrar=antiga]
//
// PROVADO QUEBRANDO: `antiga` = a regra de antes (marca o inteiro sem as linhas e
// nunca limpa). Tem de reprovar.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4018a_asa3_marca_do_split_a_mais.sql";
const QUEBRAR = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, valor) => (valor ? ok : falha).push(nome);
const um = async (sql, params = []) => (await c.query(sql, params)).rows[0];
const n = (x) => Number(x ?? 0);

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  // A regra de ANTES, guardada para a quebra (a definição que a 4018a substitui).
  const antiga = (await um("select pg_get_functiondef('public._gateway_split_retention(uuid)'::regprocedure) d")).d;
  await c.query(sql);
  await c.query(sql);
  conf("a 4018a roda duas vezes sem erro", true);
  if (QUEBRAR === "antiga") {
    if (antiga.includes("4018a")) throw new Error("NÃO MEDI: o treino já tem a 4018a; a quebra precisa da regra antiga.");
    await c.query(antiga);
    console.log("   (QUEBRADO de propósito: a regra antiga)");
  }

  const tol = n((await um("select tolerance_cents t from public.gateway_split_settings where id")).t ?? 10);
  // Uma mensalidade liquidada (as 4 do treino) e uma parcela liquidada (nunca marcada).
  const mens = await um(`select cs.id, cs.charge_id, cs.settled_cents, c.source_type, c.source_id
                           from public.charge_splits cs join public.charges c on c.id = cs.charge_id
                          where cs.status = 'liquidado' and c.source_type in ('ppr_charge', 'ortho_charge') order by c.paid_on limit 1`);
  const parc = await um(`select cs.id, cs.charge_id, cs.settled_cents from public.charge_splits cs join public.charges c on c.id = cs.charge_id
                          where cs.status = 'liquidado' and c.source_type = 'installment' order by c.paid_on desc limit 1`);
  if (!mens || !parc) throw new Error("NÃO MEDI: faltam splits liquidados no treino.");
  const devido = async (chargeId, splitId) =>
    n((await um(`select coalesce(sum(sc.amount_cents), 0) s from public.split_charges sc, public.charge_splits cs
                  where cs.id = $2 and sc.charge_id = $1 and not sc.reversed and cs.fees ? sc.fee`, [chargeId, splitId])).s);
  const marca = async (id) => n((await um("select excess_cents e from public.charge_splits where id = $1", [id])).e);
  const avisos = async () => n((await um("select count(*) n from public.notifications where title = 'Split: repasse acima do devido'")).n);

  // 1) As marcas antigas do treino foram recalculadas pela migração.
  conf(`as marcas antigas ficaram zeradas (a rede recebeu menos que o devido) (${await marca(mens.id)})`, QUEBRAR ? true : (await marca(mens.id)) === 0);

  // 2) O split liquidado ANTES de as linhas nascerem (a mensalidade): sem marca e sem aviso.
  await c.query("update public.split_charges set charge_id = null, source_id = gen_random_uuid() where source_type = $1 and source_id = $2", [mens.source_type, mens.source_id]);
  await c.query("update public.charge_splits set excess_cents = 0 where id = $1", [mens.id]);
  const a0 = await avisos();
  await c.query("select public._gateway_split_retention($1)", [mens.charge_id]);
  conf(`liquidado antes das linhas: nenhuma marca (${await marca(mens.id)})`, (await marca(mens.id)) === 0);
  conf("liquidado antes das linhas: nenhum aviso", (await avisos()) === a0);

  // 3) A marca velha (o valor inteiro) é limpa quando as linhas existem.
  const parcDevido = await devido(parc.charge_id, parc.id);
  await c.query("update public.charge_splits set excess_cents = settled_cents where id = $1", [parc.id]);
  await c.query("select public._gateway_split_retention($1)", [parc.charge_id]);
  conf(`com as linhas, a marca velha é limpa (devido ${parcDevido}, recebido ${parc.settled_cents}, marca ${await marca(parc.id)})`,
    (await marca(parc.id)) === Math.max(n(parc.settled_cents) - parcDevido, 0));

  // 4) Um "a mais" de verdade, dentro da tolerância: marca, sem aviso.
  const a1 = await avisos();
  await c.query("update public.charge_splits set settled_cents = $2 where id = $1", [parc.id, parcDevido + Math.max(tol - 5, 1)]);
  await c.query("select public._gateway_split_retention($1)", [parc.charge_id]);
  conf(`a mais dentro da tolerância (R$ ${tol / 100}): marcado, sem aviso`, (await marca(parc.id)) === Math.max(tol - 5, 1) && (await avisos()) === a1);

  // 5) Acima da tolerância: marca e aviso ao Financeiro e ao Admin.
  await c.query("delete from public.gateway_notices where kind = 'repasse_a_maior' and key = $1", [parc.id]);
  await c.query("update public.charge_splits set settled_cents = $2 where id = $1", [parc.id, parcDevido + 50]);
  await c.query("select public._gateway_split_retention($1)", [parc.charge_id]);
  conf(`a mais acima da tolerância: marcado R$ 0,50 e avisado (${await marca(parc.id)})`, (await marca(parc.id)) === 50 && (await avisos()) > a1);

  await c.query("rollback");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}

for (const x of ok) console.log(`  ok   ${x}`);
for (const x of falha) console.log(`  FALHA ${x}`);
console.log(`${ok.length}/${ok.length + falha.length}`);
if (falha.length) process.exitCode = 1;
