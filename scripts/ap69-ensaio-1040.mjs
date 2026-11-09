// Ensaio da 1040 (AP69, etapa 2: Empresarial no razão da Franqueadora) —
// NO TREINO, numa transação DESFEITA.
// Uso: node scripts/ap69-ensaio-1040.mjs   (QUEBRA=implantacao | QUEBRA=split provam que reprova)
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
async function comoAdmin(id) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
  await db.query("set local role authenticated");
}

await db.query("begin");
try {
  let sql = readFileSync("supabase/migrations/1040_empresarial_no_razao_da_franqueadora.sql", "utf8");
  if (process.env.QUEBRA === "implantacao") {
    const antes = sql;
    sql = sql.replace("v_bill.billing_type <> 'MONTHLY' or ", () => "");
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  }
  if (process.env.QUEBRA === "split") {
    const antes = sql;
    sql = sql.replace("  if v_bill.split_at_source then", () => "  if not v_bill.split_at_source then");
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  }
  confere("a 1040 roda de novo sem erro", (await erroDe(sql)) === null);

  const adm = (await q("select id from public.profiles where is_admin_master and is_active limit 1"))[0]?.id;
  const franq = (await q("select id from public.clinics where type = 'franchisor' and is_active order by created_at limit 1"))[0]?.id;
  const abertas = await q(
    "select id, total_amount_cents::int t, reference_month from empresarial.adhesion_billing where billing_type = 'MONTHLY' and status in ('PENDING','OVERDUE') order by created_at limit 2"
  );
  const impl = (await q("select id from empresarial.adhesion_billing where billing_type = 'IMPLANTATION' and status in ('PENDING','OVERDUE') limit 1"))[0];
  if (!adm || !franq || abertas.length < 2 || !impl) throw new Error("NÃO MEDI: faltam dados no treino (admin, franqueadora, 2 mensalidades e 1 implantação em aberto)");
  const [m1, m2] = abertas;

  const receita = async (id) => (await q("select clinic_id, account_code, status, amount_cents::int a, cash_date from public.financial_entries where source_type = 'emp_billing' and source_id = $1", [id]))[0];
  const custo = async (id) => (await q("select account_code, status, amount_cents::int a from public.financial_entries where source_type = 'emp_rislife' and source_id = $1", [id]))[0];
  const conta = async (id) => (await q(
    "select p.id, p.status, p.amount_cents::int a, p.account_code, p.due_date::text d, (select status from public.financial_entries e where e.source_type = 'payable_accrual' and e.source_id = p.id) acc from public.payables p where p.empresarial_billing_id = $1", [id]
  ))[0];
  const split = async (id) => (await q("select split_rislife_cents::int r, split_risarte_cents::int s from empresarial.adhesion_billing where id = $1", [id]))[0];

  // 1) Baixa manual (sem split na fonte).
  await comoAdmin(adm);
  await q("select empresarial.settle_billing($1, now())", [m1.id]);
  await q("reset role");
  let r = await receita(m1.id);
  const s1 = await split(m1.id);
  confere("baixa manual: receita INTEIRA na Franqueadora, conta 1.2.02, quitada", r && r.clinic_id === franq && r.account_code === "1.2.02" && r.status === "settled" && r.a === m1.t && r.cash_date, JSON.stringify(r));
  let c = await conta(m1.id);
  confere("baixa manual: parte da RisLife vira conta a pagar (2.5.02) com o valor do split", c && c.status === "aberta" && c.account_code === "2.5.02" && c.a === s1.r && s1.r > 0, JSON.stringify({ c, s1 }));
  confere("baixa manual: a conta vence no dia 10 do mês seguinte e está na DRE (lançamento aberto)", c && /-10$/.test(c.d) && c.acc === "open", JSON.stringify(c));
  confere("baixa manual: nenhum custo 'quitado na fonte'", !(await custo(m1.id)));

  // 2) Estorno.
  await comoAdmin(adm);
  await q("select empresarial.reverse_billing($1, 'ensaio do estorno')", [m1.id]);
  await q("reset role");
  r = await receita(m1.id);
  c = await conta(m1.id);
  confere("estorno: receita cancelada", r.status === "cancelled", JSON.stringify(r));
  confere("estorno: conta a pagar à RisLife cancelada (e fora da DRE)", c.status === "cancelada" && c.acc === "cancelled", JSON.stringify(c));

  // 3) Pagar de novo.
  await comoAdmin(adm);
  await q("select empresarial.settle_billing($1, now())", [m1.id]);
  await q("reset role");
  r = await receita(m1.id);
  c = await conta(m1.id);
  const n = (await q("select count(*)::int n from public.financial_entries where source_type = 'emp_billing' and source_id = $1", [m1.id]))[0].n;
  confere("pagar de novo: a mesma receita volta a quitada (sem duplicar)", r.status === "settled" && n === 1);
  confere("pagar de novo: a mesma conta a pagar volta a aberta", c.status === "aberta" && c.acc === "open", JSON.stringify(c));

  // 4) A integração marca o split depois da baixa: a conta a pagar sai, o custo nasce quitado.
  await q("update empresarial.adhesion_billing set split_at_source = true where id = $1", [m1.id]);
  c = await conta(m1.id);
  let k = await custo(m1.id);
  confere("split marcado depois: conta a pagar cancelada", c.status === "cancelada", JSON.stringify(c));
  confere("split marcado depois: custo quitado na 2.5.02", k && k.status === "settled" && k.account_code === "2.5.02" && k.a === s1.r, JSON.stringify(k));

  // 5) Split na fonte desde a baixa.
  await q("update empresarial.adhesion_billing set split_at_source = true where id = $1", [m2.id]);
  await comoAdmin(adm);
  await q("select empresarial.settle_billing($1, now())", [m2.id]);
  await q("reset role");
  k = await custo(m2.id);
  confere("split na fonte: custo nasce quitado, sem conta a pagar", k && k.status === "settled" && !(await conta(m2.id)), JSON.stringify(k));

  // 6) Implantação fica fora.
  await comoAdmin(adm);
  await q("select empresarial.settle_billing($1, now())", [impl.id]);
  await q("reset role");
  confere("implantação paga: nada no razão (100% RisLife)", !(await receita(impl.id)) && !(await custo(impl.id)) && !(await conta(impl.id)));

  // 7) Excluir a cobrança paga.
  await comoAdmin(adm);
  await q("select empresarial.delete_billing($1)", [m2.id]);
  await q("reset role");
  r = await receita(m2.id);
  k = await custo(m2.id);
  confere("cobrança excluída: receita e custo cancelados", r.status === "cancelled" && k.status === "cancelled", JSON.stringify({ r, k }));

  // 8) Mês de referência fechado: cai no mês aberto, e a baixa não é recusada.
  const m3 = (await q("select id, reference_month from empresarial.adhesion_billing where billing_type = 'MONTHLY' and status in ('PENDING','OVERDUE') and id <> all($1) and reference_month is not null limit 1", [[m1.id, m2.id]]))[0];
  if (m3) {
    // Um mês já ENCERRADO (3 meses atrás): fechar o mês corrente não existe.
    await q("update empresarial.adhesion_billing set reference_month = (date_trunc('month', public.today_br()) - interval '3 months')::date where id = $1", [m3.id]);
    m3.reference_month = (await q("select reference_month from empresarial.adhesion_billing where id = $1", [m3.id]))[0].reference_month;
    await q("insert into public.fiscal_periods (clinic_id, year, month, status, closed_at) values ($1, extract(year from $2::date)::int, extract(month from $2::date)::int, 'closed', now()) on conflict (clinic_id, year, month) do update set status = 'closed'", [franq, m3.reference_month]);
    await comoAdmin(adm);
    const err = await erroDe("select empresarial.settle_billing($1, now())", [m3.id]);
    await q("reset role");
    const rr = (await q("select accrual_date::text a, date_trunc('month', public.today_br())::date::text h from public.financial_entries where source_type = 'emp_billing' and source_id = $1", [m3.id]))[0];
    confere("mês fechado: a baixa passa e a receita cai no mês aberto", err === null && rr && rr.a === rr.h, `${err} ${JSON.stringify(rr)}`);
  } else {
    confere("mês fechado (NÃO MEDI: sem 3ª mensalidade em aberto com referência)", false);
  }

  // 9) Segurança.
  await q("set local role anon");
  const e1 = await erroDe("select empresarial._billing_ledger_post(gen_random_uuid())");
  confere("sem login: o lançamento não executa", /permission denied/.test(e1 ?? ""), e1);
  await q("reset role");
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} de ${ok + falhas} conferências passaram.`);
if (falhas || ok === 0) process.exit(1);
