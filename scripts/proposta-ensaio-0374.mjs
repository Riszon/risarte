// Ensaio da 0374 (a proposta de pagamento mora na negociação; a cobrança nasce
// no "Cliente aceitou") — NO TREINO, numa transação DESFEITA. Nada fica gravado.
//
// Uso: node scripts/proposta-ensaio-0374.mjs
//      QUEBRA=proposta → salvar com a negociação aberta cria cobrança (tem de reprovar)
//      QUEBRA=aceite   → o aceite não cria as cobranças (tem de reprovar)
//      QUEBRA=volta    → renegociar depois do aceite deixa as cobranças (tem de reprovar)
//      QUEBRA=acerto   → as cobranças antigas da proposta ficam (tem de reprovar)
// Só ids internos e contagens saem na tela — nenhum dado de pessoa.
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

const ARQ = "supabase/migrations/0374_proposta_de_pagamento_mora_na_negociacao.sql";
let sql = readFileSync(ARQ, "utf8");
const trocar = (de, para) => {
  if (!sql.includes(de)) throw new Error(`QUEBRA não achou o trecho: ${de.slice(0, 60)}`);
  sql = sql.replace(de, () => para);
};
if (process.env.QUEBRA === "proposta") {
  trocar("     where id = p_negotiation_id;\n    return;\n  end if;", "     where id = p_negotiation_id;\n  end if;");
}
if (process.env.QUEBRA === "aceite") {
  trocar("    perform public._materialize_negotiation_schedule(new.id);", "    null;");
}
if (process.env.QUEBRA === "volta") {
  trocar("    perform public._schedule_back_to_proposal(new.id);", "    null;");
}
if (process.env.QUEBRA === "acerto") {
  trocar(" where i.negotiation_id = g.id and i.status = 'em_aberto';", " where false;");
}

const cobrancas = async (neg) =>
  Number((await um(
    "select count(*) c from public.payment_installments where negotiation_id=$1 and status <> 'cancelada'",
    [neg]
  )).c);
const proposta = async (neg) =>
  (await um("select proposed_schedule p from public.plan_negotiations where id=$1", [neg])).p;
async function comoAdmin(id) {
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.query("set local role authenticated");
}
const comoDono = () => db.query("reset role");
const parcelas = (valores) =>
  JSON.stringify(
    valores.map((v, i) => ({
      kind: "parcela",
      due_date: `2027-0${i + 1}-10`,
      amount_cents: v,
    }))
  );

await db.query("begin");
try {
  const admin = await um("select id from public.profiles where is_admin_master limit 1");
  if (!admin) throw new Error("NÃO MEDI: o treino não tem Admin Master.");
  const negs = await q(`
    select n.id, n.clinic_id, n.client_id from public.plan_negotiations n
     where not exists (select 1 from public.commercial_sales cs where cs.negotiation_id = n.id)
     limit 2`);
  if (negs.length < 2) throw new Error("NÃO MEDI: o treino não tem 2 negociações sem venda.");
  const [A, B] = negs.map((n) => n.id);
  console.log(`negociações de ensaio: ${A} (aberta) e ${B} (aceita)`);

  // O estado antigo: as duas com cobranças "em aberto" (como o sistema fazia).
  // Se o treino já tem a 0374, tira o gatilho e a proposta dentro da transação.
  const tem = (await um("select count(*) c from information_schema.columns where table_name='plan_negotiations' and column_name='proposed_schedule'")).c > 0;
  if (tem) {
    await q("drop trigger if exists plan_negotiations_schedule_on_status on public.plan_negotiations");
    await q("update public.plan_negotiations set proposed_schedule=null where id = any($1::uuid[])", [[A, B]]);
    console.log("(o treino já tinha a 0374: voltei ao estado antigo nesta transação)");
  }
  await q("update public.plan_negotiations set status='em_negociacao', final_cents=100000 where id=$1", [A]);
  await q("update public.plan_negotiations set status='aceita', final_cents=100000 where id=$1", [B]);
  for (const n of negs) {
    await q("delete from public.payment_installments where negotiation_id=$1", [n.id]);
    for (const [seq, v] of [[1, 60000], [2, 40000]]) {
      await q(
        `insert into public.payment_installments (clinic_id, client_id, negotiation_id, seq, kind, due_date, amount_cents)
         values ($1,$2,$3,$4,'parcela', current_date + $4 * 30, $5)`,
        [n.clinic_id, n.client_id, n.id, seq, v]
      );
    }
  }

  // ---- Aplica a 0374 (com o acerto) -------------------------------------
  await db.query(sql);
  console.log("\n0374 aplicada (na transação). O acerto:");
  confere("negociação ABERTA: as cobranças saem da tabela de cobranças", (await cobrancas(A)) === 0, `(ficaram ${await cobrancas(A)})`);
  const pA = await proposta(A);
  confere(
    "…e viram a proposta dela, com o mesmo valor (R$ 1.000 em 2)",
    Array.isArray(pA) && pA.length === 2 && pA.reduce((s, e) => s + e.amount_cents, 0) === 100000
  );
  confere("negociação ACEITA: as cobranças ficam", (await cobrancas(B)) === 2);

  // ---- O comportamento novo -----------------------------------------------
  console.log("\nDepois da 0374:");
  await comoAdmin(admin.id);
  await q("select public.save_payment_schedule($1, null, $2::jsonb)", [A, parcelas([50000, 30000, 20000])]);
  await comoDono();
  confere("salvar a negociação aberta NÃO cria cobrança", (await cobrancas(A)) === 0, `(criou ${await cobrancas(A)})`);
  confere("…guarda a proposta nova (3 parcelas)", (await proposta(A))?.length === 3);

  await q("update public.plan_negotiations set status='aceita' where id=$1", [A]);
  confere("\"Cliente aceitou\": as 3 cobranças nascem da proposta", (await cobrancas(A)) === 3, `(deu ${await cobrancas(A)})`);
  const receita = Number((await um(
    `select count(*) c from public.financial_entries e join public.payment_installments i on i.id = e.source_id
      where i.negotiation_id=$1 and e.source_type='installment_accrual' and e.status='open'`, [A])).c);
  confere("…sem receita na DRE (só com o contrato assinado, 0373)", receita === 0);

  await q("update public.plan_negotiations set status='em_negociacao' where id=$1", [A]);
  confere("renegociar depois do aceite: as cobranças voltam a ser proposta", (await cobrancas(A)) === 0, `(ficaram ${await cobrancas(A)})`);
  confere("…sem perder a proposta (3 parcelas)", (await proposta(A))?.length === 3);

  await q("update public.plan_negotiations set final_cents=99999 where id=$1", [A]);
  const erro = await erroDe("update public.plan_negotiations set status='aceita' where id=$1", [A]);
  confere("aceite com a proposta somando diferente do valor final é recusado", /SCHEDULE_TOTAL_MISMATCH/.test(erro ?? ""), `(${erro})`);
  await q("update public.plan_negotiations set final_cents=100000 where id=$1", [A]);

  await q("update public.plan_negotiations set status='aceita' where id=$1", [A]);
  await comoAdmin(admin.id);
  await q("select public.save_payment_schedule($1, null, $2::jsonb)", [A, parcelas([70000, 30000])]);
  await comoDono();
  confere("depois do aceite, salvar reescreve as cobranças (como sempre)", (await cobrancas(A)) === 2);

  await q("update public.plan_negotiations set status='aceita' where id=$1", [B]);
  confere("aceitar de novo não duplica cobranças", (await cobrancas(B)) === 2);
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
