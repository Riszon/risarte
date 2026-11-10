// ENSAIO DA 0372 no banco de TREINO, numa transação DESFEITA (rollback): nada fica.
// Uso: node scripts/financeiro-ensaio-0372.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
const env = Object.fromEntries(readFileSync(".env.test.local","utf8").split(/\r?\n/).filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()]}));
if (env.TEST_DB_URL.includes("hvhbijctanrrkxhemlza")) throw new Error("produção recusada");
const c = new pg.Client({ connectionString: env.TEST_DB_URL }); await c.connect();
const ok=[]; const falha=[];
const conf=(n,v)=> (v?ok:falha).push(n);
try {
  await c.query("begin");
  await c.query(readFileSync("supabase/migrations/0372_financeiro_quem_lancou_e_quem_deu_baixa.sql","utf8"));
  conf("reaplicar sem erro", true);
  const cols = await c.query(`select table_name, column_name from information_schema.columns where table_schema='public' and ((table_name='payables' and column_name in ('cancelled_by','cancelled_at')) or (table_name='bank_transactions' and column_name in ('ignored_by','ignored_at','undone_by','undone_at')))`);
  conf("6 colunas novas", cols.rowCount===6);
  const fr = await c.query(`select proname, pg_get_function_result(oid) r from pg_proc where pronamespace='public'::regnamespace and proname in ('fiscal_year_status','dre_entries','cash_flow_detail','finance_history')`);
  conf("4 funções, uma versão cada", fr.rowCount===4);
  conf("fiscal_year_status devolve reopened_by_name", fr.rows.find(r=>r.proname==='fiscal_year_status').r.includes('reopened_by_name'));
  conf("dre_entries devolve created_by_name", fr.rows.find(r=>r.proname==='dre_entries').r.includes('created_by_name'));
  conf("cash_flow_detail devolve created_by_name", fr.rows.find(r=>r.proname==='cash_flow_detail').r.includes('created_by_name'));
  for (const f of ["finance_history(text,uuid)","cancel_payable(uuid,text)","ignore_bank_transaction(uuid,text)","unreconcile_bank_transaction(uuid)","fiscal_year_status(uuid,integer)","dre_entries(uuid,date,date,text,uuid)","cash_flow_detail(uuid,date,date)"]) {
    const r = await c.query(`select has_function_privilege('anon','public.${f}','execute') a, has_function_privilege('authenticated','public.${f}','execute') u`);
    conf(`${f}: sem login não, logado sim`, !r.rows[0].a && r.rows[0].u);
  }
  // Como logado SEM vínculo nenhum: o histórico não entrega nada.
  const qualquer = await c.query("select id from public.payables limit 1");
  if (qualquer.rowCount) {
    await c.query("set local role authenticated");
    await c.query(`select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true)`);
    const h = await c.query("select count(*)::int n from public.finance_history('payable', $1)", [qualquer.rows[0].id]);
    conf("histórico vazio para quem não vê a unidade", h.rows[0].n===0);
    await c.query("reset role");
  } else conf("(sem conta a pagar no treino para medir o histórico)", false);
  // OS ATOS DE VERDADE, como um Admin Master do treino (desfeito no rollback).
  const adm = await c.query("select id from public.profiles where is_admin_master and is_active order by created_at limit 1");
  const conta = await c.query("select id from public.payables where status in ('aberta','aguardando_autorizacao') and coalesce(paid_amount_cents,0)=0 limit 1");
  const linha = await c.query("select id from public.bank_transactions where status='pendente' limit 1");
  if (!adm.rowCount) conf("(sem Admin Master no treino)", false);
  else {
    const uid = adm.rows[0].id;
    const comoAdmin = async () => {
      await c.query("set local role authenticated");
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
    };
    if (!conta.rowCount) conf("(sem conta aberta no treino para cancelar)", false);
    else {
      const id = conta.rows[0].id;
      await comoAdmin();
      await c.query("select public.cancel_payable($1, 'ensaio 0372')", [id]);
      const h = await c.query("select count(*)::int n from public.finance_history('payable', $1) where table_name='payables' and op='U'", [id]);
      await c.query("reset role");
      const r = await c.query("select cancelled_by, cancelled_at from public.payables where id=$1", [id]);
      conf("cancelar grava QUEM", r.rows[0].cancelled_by === uid);
      conf("cancelar grava QUANDO", r.rows[0].cancelled_at !== null);
      conf("o histórico da conta mostra o cancelamento ao Admin", h.rows[0].n >= 1);
      // A recuperação pela auditoria: apaga o autor e roda o trecho 5 de novo.
      await c.query("update public.payables set cancelled_by=null, cancelled_at=null where id=$1", [id]);
      const sql = readFileSync("supabase/migrations/0372_financeiro_quem_lancou_e_quem_deu_baixa.sql","utf8");
      await c.query(sql.slice(sql.indexOf("update public.payables p"), sql.indexOf("-- 6) QUEM REABRIU")).replace(/-- -+\s*$/, ""));
      const r2 = await c.query("select cancelled_by from public.payables where id=$1", [id]);
      conf("os antigos voltam pela auditoria (cancelamento)", r2.rows[0].cancelled_by === uid);
    }
    if (!linha.rowCount) conf("(sem linha pendente no treino para ignorar)", false);
    else {
      const id = linha.rows[0].id;
      await comoAdmin();
      await c.query("select public.ignore_bank_transaction($1, 'ensaio 0372')", [id]);
      await c.query("reset role");
      const r = await c.query("select ignored_by, ignored_at from public.bank_transactions where id=$1", [id]);
      conf("ignorar grava QUEM e QUANDO", r.rows[0].ignored_by === uid && r.rows[0].ignored_at !== null);
      await comoAdmin();
      await c.query("select public.unreconcile_bank_transaction($1)", [id]);
      const h = await c.query("select count(*)::int n from public.finance_history('bank_transaction', $1)", [id]);
      await c.query("reset role");
      const d = await c.query("select status, undone_by, undone_at, ignored_by from public.bank_transactions where id=$1", [id]);
      conf("desfazer grava QUEM e QUANDO", d.rows[0].undone_by === uid && d.rows[0].undone_at !== null);
      conf("desfazer volta a pendente e limpa o 'ignorada por'", d.rows[0].status === "pendente" && d.rows[0].ignored_by === null);
      conf("o histórico da linha mostra ignorar e desfazer", h.rows[0].n >= 2);
    }
  }
  const auditadas = await c.query(`select count(*)::int n from public.audit_changes where table_name in ('payables','payable_payments','bank_transactions','payment_installments','payment_receipts')`);
  console.log("linhas de auditoria nessas tabelas no treino:", auditadas.rows[0].n);
  const prench = await c.query(`select (select count(*) from public.payables where cancelled_at is not null)::int canc, (select count(*) from public.payables where status='cancelada')::int canc_total, (select count(*) from public.bank_transactions where ignored_at is not null)::int ign, (select count(*) from public.bank_transactions where status='ignorado')::int ign_total, (select count(*) from public.bank_transactions where undone_at is not null)::int desf`);
  console.log("preenchidos pela auditoria:", prench.rows[0]);
} catch (e) { falha.push("ERRO: "+e.message); }
finally { await c.query("rollback"); await c.end(); }
console.log(`OK ${ok.length}:`, ok.join(" | ")); console.log(`FALHA ${falha.length}:`, falha.join(" | "));
if (ok.length===0) { console.log("NÃO MEDI NADA"); process.exit(2); }
process.exit(falha.length?1:0);
