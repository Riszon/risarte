// ENSAIO DA 0410 (Levantamento de Dívidas, fase 8 — os avisos) no banco de
// TREINO, numa transação DESFEITA: nada fica.
// Uso: node scripts/dividas-ensaio-0410.mjs --confirmar [--quebrar]
//      (rede sem IPv6: RISARTE_TREINO_POOLER=1)
//
//   1. a rotina: proposta vencendo (marco 7 e depois 2), parcela de acordo
//      vencendo, prestes a virar inadimplente, checklist parado, baixa da
//      negativação não confirmada, próxima ação vencida — cada um UMA vez;
//   2. o responsável recebe; sem responsável, os Financeiros; o Admin Master
//      não recebe os não críticos;
//   3. novo protesto e nova ação judicial: críticos (Admin incluso), quem
//      lançou não recebe; protesto de dívida criada na mesma transação pela
//      importação não avisa;
//   4. anônimo não executa.
// `--quebrar`: a rotina esquece o aviso da próxima ação — o ensaio TEM de falhar.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO dentro de transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const ARQ = "supabase/migrations/0410_dividas_avisos.sql";
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
const dia = (x) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x).slice(0, 10));
const mais = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

let saida = 1;
try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query(sql);
  console.log("Migração aplicada duas vezes sem erro (idempotente).");
  if (process.argv.includes("--quebrar")) {
    const ini = sql.indexOf("create or replace function public._debt_notices_daily");
    const corpo = sql.slice(ini, sql.indexOf("revoke execute on function public._debt_notices_daily"));
    await c.query(corpo.replace("d.next_action_on < v_hoje", () => "false"));
    console.log("⚠️ MODO QUEBRAR: a rotina esquece a próxima ação vencida (o ensaio tem de FALHAR).");
  }
  const ids = {};
  for (const p of ["financeiro", "admin"]) ids[p] = (await um("select id from auth.users where email = $1", [`${p}@example.com`])).id;
  const ldn = (await um("select id from public.clinics where code = 'LDN'")).id;
  const hoje = dia((await um("select public.today_br() d")).d);
  const sup = (await um("select id from public.suppliers where active order by name limit 1")).id;
  await c.query("delete from public.fiscal_periods where clinic_id = $1", [ldn]);
  await c.query("update public.debt_settings set proposal_alert_days = '{7,2}', about_to_default_days = 5, closing_stale_days = 15, days_to_default = 30 where clinic_id is null");
  await c.query("delete from public.debt_settings where clinic_id = $1", [ldn]);
  await c.query("delete from public.debt_default_rules");

  const salvar = (p) => como(ids.financeiro, async () => (await um("select public.debt_save($1::jsonb) v", [JSON.stringify(p)])).v);
  const base = { clinic_id: ldn, supplier_id: sup, original_cents: 10000, issue_date: "2025-01-01", origin: "A" };
  const avisos = async (kind, subj) => Number((await um("select count(*) n from public.debt_notices where kind = $1 and ($2::uuid is null or subject_id = $2)", [kind, subj ?? null])).n);
  const quem = async (titulo) => (await c.query("select user_id from public.notifications where title like $1", [titulo])).rows.map((r) => r.user_id);
  const rotina = () => c.query("select public._debt_notices_daily()");
  const financeiros = (await c.query(`select distinct u.user_id from public.user_clinic_roles_all u join public.profiles p on p.id = u.user_id and p.is_active
     where u.role = 'finance_franchisor'`)).rows.map((r) => r.user_id);

  console.log("\n1. A rotina");
  // Proposta: vale até daqui a 6 dias → marco 7; depois a 2 → marco 2.
  const dP = await salvar({ ...base, due_date: mais(hoje, 40) });
  const prop = await como(ids.financeiro, async () => (await um("select public.debt_save_proposal($1::jsonb) v",
    [JSON.stringify({ debt_id: dP, proposed_on: hoje, amount_cents: 8000, payment_kind: "a_vista", source: "credor", valid_until: mais(hoje, 6) })])).v);
  await rotina(); await rotina();
  ok("proposta vencendo: um aviso no marco de 7 dias, mesmo rodando duas vezes", (await avisos("proposta_vencendo", prop)) === 1);
  // A proposta não muda depois de gravada (0405): o marco de 2 dias vem de uma nova.
  await como(ids.financeiro, () => c.query("select public.debt_save_proposal($1::jsonb)",
    [JSON.stringify({ debt_id: dP, proposed_on: hoje, amount_cents: 7000, payment_kind: "a_vista", source: "credor", valid_until: mais(hoje, 1) })]));
  await rotina();
  ok("e outro no marco de 2 dias", Number((await um("select count(*) n from public.debt_notices where kind = 'proposta_vencendo' and key = '2'")).n) >= 1);
  const recebeu = await quem("Dívidas: proposta vencendo%");
  ok("sem responsável: os Financeiros recebem; o Admin não (não é crítico)", financeiros.every((u) => recebeu.includes(u)) && !recebeu.includes(ids.admin));

  // Prestes a virar inadimplente: venceu há 27 dias (prazo 30, aviso 5 antes).
  const dI = await salvar({ ...base, due_date: mais(hoje, -27), owner_user_id: ids.financeiro });
  await c.query("select public._debt_refresh_status($1, true)", [dI]);
  const dLonge = await salvar({ ...base, due_date: mais(hoje, -5) });
  await c.query("select public._debt_refresh_status($1, true)", [dLonge]);
  await rotina();
  ok("prestes a virar inadimplente: avisa a de 27 dias de atraso, não a de 5", (await avisos("prestes_inadimplente", dI)) === 1 && (await avisos("prestes_inadimplente", dLonge)) === 0);
  ok("com responsável, só ele recebe", JSON.stringify(await quem("Dívidas: % vira inadimplente%")) === JSON.stringify([ids.financeiro]));

  // Próxima ação vencida.
  const dA = await salvar({ ...base, due_date: mais(hoje, 60), next_action: "Ligar para o banco", next_action_on: mais(hoje, -1) });
  await rotina();
  ok("próxima ação vencida", (await avisos("proxima_acao", dA)) === 1);

  // Quitada com checklist parado e baixa da negativação vencida.
  const dQ = await salvar({ ...base, due_date: mais(hoje, -100) });
  await c.query("insert into public.debt_negativations (debt_id, bureau, included_on) values ($1, 'serasa', '2025-06-01')", [dQ]);
  const tQ = await como(ids.financeiro, async () => (await um("select public.debt_sync_finance($1) v", [dQ])).v);
  await como(ids.financeiro, () => c.query("select public.register_payable_payment(p_payable_id => $1, p_amount_cents => 10000, p_paid_at => $2::date, p_payment_method => 'pix')", [tQ, mais(hoje, -30)]));
  ok("(a dívida ficou quitada com o checklist)", (await um("select status from public.debts where id = $1", [dQ])).status === "quitada_pendencias");
  await c.query("update public.debts set status_changed_at = now() - interval '20 days' where id = $1", [dQ]);
  await c.query("update public.debt_closing_items set due_on = $2 where debt_id = $1 and item = 'baixa_negativacao'", [dQ, mais(hoje, -3)]);
  await rotina();
  ok("checklist parado há mais de 15 dias", (await avisos("checklist_parado", dQ)) === 1);
  ok("baixa da negativação não confirmada no prazo", (await avisos("baixa_negativacao")) >= 1);

  // Parcela de acordo vencendo em 2 dias.
  const dV = await salvar({ ...base, due_date: mais(hoje, -10) });
  await como(ids.financeiro, () => c.query("select public.debt_sync_finance($1)", [dV]));
  const ag = await como(ids.financeiro, async () => (await um("select public.debt_agreement_save($1::jsonb) v", [JSON.stringify({
    debt_ids: [dV], agreed_on: hoje, total_cents: 9000, schedule: [{ due_date: mais(hoje, 2), amount_cents: 9000, entrada: false }] })])).v);
  await rotina();
  ok("parcela de acordo vencendo em 3 dias ou menos", Number((await um("select count(*) n from public.debt_notices n join public.payables p on p.id = n.subject_id where n.kind = 'parcela_vencendo' and p.debt_agreement_id = $1", [ag])).n) === 1);

  console.log("\n2. Protesto e ação judicial: críticos, na hora");
  const nAdmin = async () => Number((await um("select count(*) n from public.notifications where user_id = $1 and title like 'Dívidas: nov%'", [ids.admin])).n);
  const antes = await nAdmin();
  await como(ids.financeiro, () => c.query("select public.debt_save_protest($1::jsonb)", [JSON.stringify({ debt_id: dA, protested_on: hoje, amount_cents: 5000 })]));
  await como(ids.financeiro, () => c.query("select public.debt_save_lawsuit($1::jsonb)", [JSON.stringify({ debt_id: dA, process_number: "ENSAIO-0410" })]));
  ok("novo protesto e nova ação: o Admin Master recebe os dois", (await nAdmin()) === antes + 2);
  ok("quem lançou (o Financeiro) não recebe o próprio aviso",
    !(await quem("Dívidas: novo protesto%")).includes(ids.financeiro) && !(await quem("Dívidas: novo ação judicial%")).includes(ids.financeiro));
  // Importação: dívida criada nesta mesma transação com lote → sem aviso.
  const lote = await um("select id from public.debt_import_batches order by created_at limit 1");
  if (!lote) throw new Error("NÃO MEDI: nenhum lote de importação no treino.");
  await c.query("update public.debts set import_batch_id = $2, created_at = now() where id = $1", [dP, lote.id]);
  const antesImp = await nAdmin();
  await como(ids.financeiro, () => c.query("select public.debt_save_protest($1::jsonb)", [JSON.stringify({ debt_id: dP, protested_on: hoje, amount_cents: 1000 })]));
  ok("protesto da carga da planilha (mesma transação) não avisa um a um", (await nAdmin()) === antesImp);

  console.log("\n3. O anônimo");
  for (const fn of ["_debt_notices_daily()", "_debt_setting_int(null, 'x', 1)"]) {
    const r = await (async () => { await c.query("savepoint an"); await c.query("set local role anon");
      try { await c.query(`select public.${fn}`); return "EXECUTOU"; } catch (e) { return e.code; } finally { await c.query("rollback to savepoint an"); } })();
    ok(`anônimo não executa ${fn.split("(")[0]} (veio ${r})`, r === "42501");
  }

  saida = falhas.length === 0 ? 0 : 1;
  console.log(saida === 0 ? "\nENSAIO OK." : `\nENSAIO FALHOU: ${falhas.length} conferência(s).`);
} catch (e) {
  console.error("ERRO NO ENSAIO (não medi):", e.message, e.where ?? "");
  saida = 1;
} finally {
  await c.query("rollback");
  await c.end();
  console.log("(transação desfeita — nada ficou no treino)");
}
process.exit(saida);
