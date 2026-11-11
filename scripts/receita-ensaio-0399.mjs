// Ensaio da 0399 (venda direta volta a fechar) — NO TREINO, numa transação
// DESFEITA. Nada fica gravado.
//
// O defeito (0373, 09/11/2026): o gatilho da receita citava
// `new.negotiation_id` também quando a venda era DIRETA, que não tem essa
// coluna — e fechar venda direta dava "record "new" has no field
// "negotiation_id"".
//
// Uso: RISARTE_TREINO_POOLER=1 node scripts/receita-ensaio-0399.mjs
//      QUEBRA=ramo → o ramo da venda direta volta a citar negotiation_id
//                    (tem de reprovar)
// Só ids internos e valores saem na tela — nenhum dado de pessoa.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const db = await connect();
let ok = 0;
let falhas = 0;
const confere = (nome, cond, extra = "") => {
  if (cond) {
    ok++;
    console.log(`  ✔ ${nome}`);
  } else {
    falhas++;
    console.log(`  ✘ ${nome} ${extra ?? ""}`);
  }
};
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const um = async (sql, p = []) => (await q(sql, p))[0];
async function erroDe(sql, p = []) {
  await db.query("savepoint s");
  try {
    await db.query(sql, p);
    await db.query("release savepoint s");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint s");
    return e.message;
  }
}

let sql = readFileSync("supabase/migrations/0399_venda_direta_volta_a_fechar.sql", "utf8");
if (process.env.QUEBRA === "ramo") {
  const antes = sql;
  sql = sql.replace(
    "     where i.direct_sale_id = new.id\n",
    () => "     where i.negotiation_id = new.negotiation_id\n"
  );
  if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
}

// A versão da 0373 da função, lida da própria migração (para mostrar o defeito
// mesmo num banco que já recebeu a 0399).
function funcaoDe(arquivo, nome) {
  const txt = readFileSync(`supabase/migrations/${arquivo}`, "utf8");
  const i = txt.indexOf(`create or replace function public.${nome}(`);
  const abre = txt.indexOf("$$", i);
  const fim = txt.indexOf("$$;", abre + 2) + 3;
  if (i < 0 || abre < i || fim <= abre) throw new Error(`NÃO MEDI: não achei ${nome} em ${arquivo}`);
  return txt.slice(i, fim);
}

// Receita ABERTA (o que a DRE soma) de uma lista de cobranças, por conta.
const receita = async (ids) =>
  await um(
    `select coalesce(sum(amount_cents), 0)::int as total,
            array_agg(distinct account_code) as contas
       from public.financial_entries
      where source_type = 'installment_accrual' and status = 'open'
        and source_id = any($1::uuid[])`,
    [ids]
  );

const mesAberto = (t) => `not exists (select 1 from public.fiscal_periods p
                   where p.clinic_id = ${t}.clinic_id and p.status = 'closed'
                     and p.year = extract(year from current_date)::int
                     and p.month = extract(month from current_date)::int)`;

async function cobrancas(col, origem, clinica, cliente, valores) {
  const ids = [];
  let seq = 0;
  for (const v of valores) {
    seq++;
    const r = await um(
      `insert into public.payment_installments
         (clinic_id, client_id, ${col}, seq, kind, due_date, amount_cents)
       values ($1, $2, $3, $4, 'parcela', current_date + ($4 * 30), $5)
       returning id`,
      [clinica, cliente, origem, seq, v]
    );
    ids.push(r.id);
  }
  return ids;
}

await db.query("begin");
try {
  const vendas = await q(`
    select s.id, s.clinic_id, s.client_id from public.direct_sales s
     where s.closed_at is null and s.cancelled is not true and s.client_id is not null
       and ${mesAberto("s")}
     order by s.created_at limit 2`);
  if (vendas.length < 2) throw new Error("NÃO MEDI: o treino não tem 2 vendas diretas abertas para o ensaio.");
  const [vd, vz] = vendas;
  console.log(`vendas diretas de ensaio: ${vd.id}, ${vz.id}`);

  // ---- 1) Como estava (0373): o defeito ----------------------------------
  await db.query(funcaoDe("0373_receita_so_com_a_venda_fechada.sql", "post_sale_accruals_on_close"));
  console.log("\nCom a função da 0373 (como está desde 09/11):");
  let err = await erroDe("update public.direct_sales set closed_at = now() where id = $1", [vd.id]);
  confere("reproduz o defeito: fechar venda direta falha", /negotiation_id/.test(err ?? ""), err);

  // ---- 2) Aplica a 0399 --------------------------------------------------
  err = await erroDe(sql);
  confere("a 0399 roda sem erro", err === null, err);
  err = await erroDe(sql);
  confere("a 0399 roda de novo sem erro (idempotente)", err === null, err);
  const g = await um(`select count(*)::int n from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                       where p.proname = 'post_sale_accruals_on_close' and not t.tgisinternal`);
  confere("os 4 gatilhos continuam ligados à função", g.n === 4, `(${g.n})`);

  // ---- 3) Venda direta fecha e lança a receita ---------------------------
  console.log("\nDepois da 0399 — venda direta:");
  await q("delete from public.payment_installments where direct_sale_id = $1", [vd.id]);
  const ivd = await cobrancas("direct_sale_id", vd.id, vd.clinic_id, vd.client_id, [30000, 20000]);
  let r = await receita(ivd);
  confere("antes de fechar: sem receita", r.total === 0, JSON.stringify(r));
  err = await erroDe("update public.direct_sales set closed_at = now() where id = $1", [vd.id]);
  confere("fechar a venda direta passa", err === null, err);
  r = await receita(ivd);
  confere(
    "a receita entra: R$ 500,00 na conta 1.1.02",
    r.total === 50000 && r.contas?.length === 1 && r.contas[0] === "1.1.02",
    JSON.stringify(r)
  );

  // Venda direta de valor zero fecha sozinha (gatilho da 0165).
  err = await erroDe("update public.direct_sales set final_cents = 0 where id = $1", [vz.id]);
  confere("venda direta de valor zero passa a fechar sozinha", err === null, err);
  const z = await um("select closed_at is not null as fechada from public.direct_sales where id = $1", [vz.id]);
  confere("…e fica fechada", z?.fechada === true);

  // ---- 4) Venda comercial continua igual ---------------------------------
  console.log("\nVenda comercial (não pode ter mudado):");
  const n1 = await um(`
    select n.id, n.clinic_id, n.client_id, n.plan_id from public.plan_negotiations n
     where not exists (select 1 from public.commercial_sales cs where cs.negotiation_id = n.id)
       and ${mesAberto("n")}
     limit 1`);
  if (!n1) throw new Error("NÃO MEDI: o treino não tem negociação sem venda para o ensaio.");
  await q("delete from public.payment_installments where negotiation_id = $1", [n1.id]);
  const venda = (fechada) =>
    erroDe(
      `insert into public.commercial_sales (negotiation_id, client_id, clinic_id, plan_id, final_cents, closed_at)
       values ($1, $2, $3, $4, 100000, case when $5 then now() end)`,
      [n1.id, n1.client_id, n1.clinic_id, n1.plan_id, fechada]
    );

  // Caminho do INSERT já fechado (gatilho *_ins) — desfeito logo depois, para
  // a mesma negociação servir ao caminho do UPDATE.
  await db.query("savepoint ins");
  const i0 = await cobrancas("negotiation_id", n1.id, n1.clinic_id, n1.client_id, [25000]);
  err = await venda(true);
  confere("venda comercial criada já fechada passa", err === null, err);
  r = await receita(i0);
  confere("…e lança a receita: R$ 250,00 na conta 1.1.01", r.total === 25000 && r.contas?.[0] === "1.1.01", JSON.stringify(r));
  await db.query("rollback to savepoint ins");

  // Caminho do UPDATE (gatilho *_upd): o fechamento de sempre.
  const i1 = await cobrancas("negotiation_id", n1.id, n1.clinic_id, n1.client_id, [40000, 60000]);
  err = await venda(false);
  confere("venda comercial criada aberta", err === null, err);
  r = await receita(i1);
  confere("venda criada sem fechar: sem receita", r.total === 0, JSON.stringify(r));
  err = await erroDe("update public.commercial_sales set closed_at = now() where negotiation_id = $1", [n1.id]);
  confere("fechar a venda comercial passa", err === null, err);
  r = await receita(i1);
  confere(
    "a receita entra: R$ 1.000,00 na conta 1.1.01",
    r.total === 100000 && r.contas?.length === 1 && r.contas[0] === "1.1.01",
    JSON.stringify(r)
  );
} catch (e) {
  falhas++;
  console.log(`  ✘ o ensaio quebrou: ${e.message}`);
} finally {
  await db.query("rollback");
  await db.end();
}

console.log(`\n${ok} conferências OK, ${falhas} falha(s). Transação desfeita — nada gravado.`);
if (ok === 0) {
  console.log("NÃO MEDI: nenhuma conferência rodou.");
  process.exit(2);
}
process.exit(falhas > 0 ? 1 : 0);
