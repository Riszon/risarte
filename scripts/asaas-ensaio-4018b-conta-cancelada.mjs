// ENSAIO DA 4018b (a conta de taxa cancelada à mão não volta sozinha) no banco
// de TREINO, numa transação DESFEITA.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4018b-conta-cancelada.mjs --confirmar [--quebrar=antiga]
// PROVADO QUEBRANDO: `antiga` = a função sem a trava (tem de reprovar).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const Q = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Mexe no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const c = await connect();
const ok = [];
const falha = [];
const conf = (n, v) => (v ? ok : falha).push(n);
const um = async (s, p = []) => (await c.query(s, p)).rows[0];
try {
  await c.query("begin");
  const sql = readFileSync("supabase/migrations/4018b_asa3_conta_cancelada_a_mao.sql", "utf8");
  await c.query(sql);
  await c.query(sql);
  conf("a 4018b roda duas vezes sem erro", true);
  if (Q === "antiga") {
    const f = (await um("select pg_get_functiondef('public.refresh_network_fee_payable(uuid, text, date)'::regprocedure) d")).d;
    const i = f.indexOf("  -- 4018b:");
    const j = f.indexOf("  end if;\n", i) + "  end if;\n".length;
    await c.query(f.slice(0, i) + f.slice(j));
    console.log("   (QUEBRADO de propósito: sem a trava)");
  }
  const cambe = (await um("select id from public.clinics where name = 'Risarte Cambé - Centro'")).id;
  const nov = "2026-11-01";
  await c.query("update public.fiscal_periods set status = 'open' where clinic_id = $1 and year = 2026 and month = 11", [cambe]);
  await c.query("delete from public.network_fees where clinic_id = $1 and kind = 'fixed'", [cambe]);
  await c.query("update public.network_fees set amount_cents = 50000, active = true where clinic_id is null and fee = 'sdr'");
  await c.query("update public.payables set status = 'cancelada', cancel_reason = 'Sem valor apurado no mês' where clinic_id = $1 and network_fee = 'sdr' and fee_period = $2", [cambe, nov]);
  await c.query("select public.refresh_network_fee_payable($1, 'sdr', $2)", [cambe, nov]);
  const p = await um("select id, status, amount_cents from public.payables where clinic_id = $1 and network_fee = 'sdr' and fee_period = $2", [cambe, nov]);
  conf(`a conta nasce (ou volta) pela apuração: ${p?.status} R$ ${Number(p?.amount_cents) / 100}`, p?.status === "aberta" && Number(p?.amount_cents) === 50000);

  // Cancelada à mão: não volta, nem pela apuração, nem pelo "Gerar taxas fixas do mês".
  await c.query("update public.payables set status = 'cancelada', cancel_reason = 'Cancelada a pedido do dono (teste)' where id = $1", [p.id]);
  await c.query("update public.financial_entries set status = 'cancelled' where source_id = $1 and source_type in ('payable_accrual', 'network_fee_revenue')", [p.id]);
  await c.query("select public.refresh_network_fee_payable($1, 'sdr', $2)", [cambe, nov]);
  await c.query("select public.charge_fixed_network_fees(2026, 11)");
  const d = await um("select status from public.payables where id = $1", [p.id]);
  const e = await um("select count(*) filter (where status <> 'cancelled') abertos from public.financial_entries where source_id = $1 and source_type in ('payable_accrual', 'network_fee_revenue')", [p.id]);
  conf(`cancelada à mão: continua cancelada (${d.status})`, d.status === "cancelada");
  conf(`e os lançamentos dela continuam cancelados (${e.abertos} aberto[s])`, Number(e.abertos) === 0);
  conf("nenhuma conta nova nasceu no lugar", Number((await um("select count(*) n from public.payables where clinic_id = $1 and network_fee = 'sdr' and fee_period = $2", [cambe, nov])).n) === 1);

  // A cancelada pela apuração continua sendo refeita (o caminho de sempre).
  await c.query("update public.payables set status = 'cancelada', cancel_reason = 'Sem valor apurado no mês' where id = $1", [p.id]);
  await c.query("select public.refresh_network_fee_payable($1, 'sdr', $2)", [cambe, nov]);
  conf("a cancelada pela apuração volta quando há valor", (await um("select status from public.payables where id = $1", [p.id])).status === "aberta");
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
