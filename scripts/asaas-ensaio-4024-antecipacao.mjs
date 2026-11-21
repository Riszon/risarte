// ENSAIO DA 4024 (a antecipação automática vira alerta) no banco de TREINO,
// numa transação DESFEITA (rollback). O Asaas não é chamado.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4024-antecipacao.mjs --confirmar [--quebrar=trava]
//
// PROVADO QUEBRANDO: `trava` = depois da 4024, volta a regra antiga (antecipação
// ligada tira a unidade da prontidão); o ensaio tem de reprovar.
import { readFileSync } from "node:fs";
import { connect, testEnv } from "./test-db.mjs";

const ARQ = "supabase/migrations/4024_asa7_antecipacao_vira_alerta.sql";
const Q = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const TREINO_REF = "bsnptybalszjjbhxeejo";
{
  const env = testEnv();
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "TEST_DB_URL"]) {
    if (!String(env[k] ?? "").includes(TREINO_REF)) {
      console.log(`RECUSADO: ${k} não é o banco de treino.`);
      process.exit(3);
    }
  }
}
const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, v) => (v ? ok : falha).push(nome);
const um = async (s, p = []) => (await c.query(s, p)).rows[0];
const item = async (clinica) =>
  (await um("select ok from public._central_readiness_raw($1) where item = 'antecipacao_conferida'", [clinica]))?.ok ?? null;
const marcada = async (clinica) =>
  (await um("select marked_ready_at from public.central_unit_readiness where clinic_id = $1", [clinica]))?.marked_ready_at != null;

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  const conferencia = [].concat(await c.query(sql)).at(-1).rows[0];
  conf("a 4024 roda e a conferência mostra 1 · 0 · true · true",
    Number(conferencia.item_novo) === 1 && Number(conferencia.item_antigo) === 0 && conferencia.aviso_novo === true && conferencia.na_lista === true);
  await c.query("savepoint dup");
  try { await c.query(sql); await c.query("release savepoint dup"); conf("a 4024 roda duas vezes sem erro", true); }
  catch (e) { await c.query("rollback to savepoint dup"); conf(`a 4024 roda duas vezes sem erro (${e.message})`, false); }

  if (Q === "trava") {
    // A regra antiga de volta (a função da 4022), depois da 4024.
    const m22 = readFileSync("supabase/migrations/4022_asa7_pecas_do_piloto.sql", "utf8");
    const i = m22.indexOf("create or replace function public._central_readiness_raw(p_clinic_id uuid)");
    await c.query(m22.slice(i, m22.indexOf("\n$$;", i) + 4));
  }

  // A unidade do treino com a prontidão completa e marcada (Londrina Teste).
  const conta = await um(`select g.id, g.clinic_id from public.gateway_accounts g
     join public.central_unit_readiness u on u.clinic_id = g.clinic_id and u.marked_ready_at is not null
    where g.owner_type = 'unit' and g.status = 'active' limit 1`);
  conf("há no treino uma unidade pronta para o ensaio", Boolean(conta));
  if (conta) {
    conf("antes: pronta para cobrar", await marcada(conta.clinic_id));
    const avisosAntes = Number((await um("select count(*) n from public.notifications where title = 'Asaas: antecipação automática ligada'")).n);

    // A verificação lê a antecipação LIGADA.
    await c.query("select public._gateway_record_check($1, true, null, null, null, true, true)", [conta.id]);
    conf("antecipação ligada: o item continua ok (só pede a leitura)", (await item(conta.clinic_id)) === true);
    conf("antecipação ligada: a unidade CONTINUA pronta para cobrar", await marcada(conta.clinic_id));
    const aviso = await um("select body from public.notifications where title = 'Asaas: antecipação automática ligada' order by created_at desc limit 1");
    const avisosDepois = Number((await um("select count(*) n from public.notifications where title = 'Asaas: antecipação automática ligada'")).n);
    conf("o aviso aos administradores sai e explica (não manda desligar)",
      avisosDepois > avisosAntes && /Não trava a cobrança/.test(aviso?.body ?? "") && !/desligue no painel/.test(aviso?.body ?? ""));

    // Sem a leitura no Asaas, o item falta.
    await c.query("update public.gateway_accounts set anticipation_auto_enabled = null where id = $1", [conta.id]);
    conf("sem a leitura no Asaas, o item falta", (await item(conta.clinic_id)) === false);
  }
  conf("o item antigo não existe mais", (await um("select count(*) n from public._central_readiness_raw(null) where item = 'antecipacao_desligada'")).n == 0);
} catch (e) {
  falha.push(`erro inesperado: ${e.message}`);
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(`Ensaio da 4024${Q ? ` (quebrando: ${Q})` : ""} — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log(`  ✗ ${f}`);
console.log("Nada ficou gravado (transação desfeita).");
process.exit(falha.length ? 1 : 0);
