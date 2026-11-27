// ENSAIO DA 0436 (Levantamento de Dívidas: a conta vencida vira dívida
// sozinha) no banco de TREINO, numa transação DESFEITA: nada fica.
// Uso: node scripts/dividas-ensaio-0436.mjs --confirmar [--quebrar]
//      (rede sem IPv6: RISARTE_TREINO_POOLER=1)
//
//   1. duas contas vencidas do mesmo fornecedor = UMA dívida (origem C,
//      automática, etiqueta, categoria pela conta, valor = soma, vencimento =
//      o mais antigo); a do dia (sem atraso) fica de fora;
//   2. o prazo do devedor manda; taxas da franquia, repasse, saldo de
//      implantação e conta já ligada a outra dívida ficam de fora;
//   3. sem fornecedor: não vira dívida, aparece na Qualidade dos dados;
//   4. conta nova do mesmo fornecedor entra na mesma dívida;
//   5. pagou tudo → quitada e ENCERRADA sozinha; conta nova depois → dívida nova;
//   6. cancelou a única conta → a dívida sai (excluída, com motivo);
//   7. excluída pela tela → a conta não volta;
//   8. sem aviso de "prestes a virar inadimplente" na automática;
//   9. a porta: o Financeiro roda, a Recepção e o anônimo não.
// `--quebrar`: a regra esquece a dívida excluída — o ensaio TEM de falhar.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO dentro de transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const ARQ = "supabase/migrations/0436_dividas_contas_vencidas_automaticas.sql";
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
async function erroDe(fn) {
  await c.query("savepoint s");
  try { await fn(); await c.query("release savepoint s"); return null; }
  catch (e) { await c.query("rollback to savepoint s"); return e.message; }
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
    const ini = sql.indexOf("create or replace function public._debt_auto_overdue_candidates");
    const corpo = sql.slice(ini, sql.indexOf("revoke execute on function public._debt_auto_overdue_candidates"));
    await c.query(corpo.replace("and d.deleted_at is not null", () => "and false"));
    console.log("⚠️ MODO QUEBRAR: a regra esquece a dívida excluída (o ensaio tem de FALHAR).");
  }

  const ids = {};
  for (const p of ["financeiro", "recepcao"]) ids[p] = (await um("select id from auth.users where email = $1", [`${p}@example.com`])).id;
  const ldn = (await um("select id from public.clinics where code = 'LDN'")).id;
  await c.query("delete from public.fiscal_periods where clinic_id = $1", [ldn]);
  await c.query("delete from public.debt_settings where clinic_id = $1", [ldn]);
  await c.query("update public.debt_settings set auto_overdue_days = 1, days_to_default = 30, about_to_default_days = 5 where clinic_id is null");
  const novoForn = async (nome) =>
    (await um("insert into public.suppliers (clinic_id, name, active) values ($1, $2, true) returning id", [ldn, nome])).id;
  const X = await novoForn("Ensaio 0436 — Laboratório X");
  const Y = await novoForn("Ensaio 0436 — Fornecedor Y");
  const conta = async (sup, acc, dias, valor, extra = {}) => {
    const cols = ["clinic_id", "supplier_id", "account_code", "description", "due_date", "amount_cents", ...Object.keys(extra)];
    const vals = [ldn, sup, acc, "Ensaio 0436", null, valor, ...Object.values(extra)];
    const ph = cols.map((_, i) => (cols[i] === "due_date" ? `public.today_br() - ${dias}` : `$${i + 1}`));
    const sqlIns = `insert into public.payables (${cols.join(", ")}) values (${ph.join(", ")}) returning id`;
    const params = vals.filter((_, i) => cols[i] !== "due_date");
    const sqlNum = sqlIns.replace(/\$(\d+)/g, (_, n) => `$${params.indexOf(vals[Number(n) - 1]) + 1}`);
    return (await um(sqlNum, params)).id;
  };
  const sync = () => um("select public._debt_auto_overdue_sync() n");
  const dividaDe = (pid) => um("select d.* from public.payables p join public.debts d on d.id = p.debt_id where p.id = $1", [pid]);

  console.log("\n1. Duas contas do mesmo fornecedor = uma dívida");
  const x1 = await conta(X, "2.3", 40, 100000);
  const x2 = await conta(X, "2.3", 5, 50000);
  const x0 = await conta(X, "2.3", 0, 70000);
  await sync();
  const d1 = await dividaDe(x1);
  const d1b = await dividaDe(x2);
  ok("as duas contas vencidas na mesma dívida", d1 && d1b && d1.id === d1b.id);
  ok("a do dia (sem atraso) fica de fora", !(await dividaDe(x0)));
  ok("origem C e automática", d1?.origin === "C" && d1?.auto_overdue === true);
  ok("valor = soma das contas (R$ 1.500,00)", Number(d1?.original_cents) === 150000);
  ok("vencimento = o mais antigo", (await um("select $1::date = public.today_br() - 40 v", [d1.due_date])).v);
  ok("categoria pela conta (Laboratório e prótese)", (await um("select name from public.debt_categories where id = $1", [d1.category_id]))?.name === "Laboratório e prótese");
  ok("etiqueta Automática", !!(await um("select 1 x from public.debt_tag_links l join public.debt_tags t on t.id = l.tag_id where l.debt_id = $1 and t.name = 'Automática — Contas a Pagar'", [d1.id])));
  ok("situação inadimplente (40 dias > 30)", d1?.status === "inadimplente");
  ok("título vinculado, não gerado", (await um("select debt_link from public.payables where id = $1", [x1])).debt_link === "vinculado");
  ok("nada novo no razão", Number((await um("select count(*) n from public.financial_entries where source_id = $1 and created_at = now()", [d1.id])).n) === 0);

  console.log("\n2. O prazo do devedor e o que fica de fora");
  await c.query("insert into public.debt_settings (clinic_id, auto_overdue_days) values ($1, 10)", [ldn]);
  const y5 = await conta(Y, "3.2.03", 5, 20000);
  await sync();
  ok("prazo da unidade de 10 dias: conta com 5 dias fica de fora", !(await dividaDe(y5)));
  await c.query("delete from public.debt_settings where clinic_id = $1", [ldn]);
  await sync();
  ok("sem o prazo próprio (rede = 1 dia) ela entra", !!(await dividaDe(y5)));
  const fee = await conta(null, "2.6.01", 20, 30000, { network_fee: "royalties" }).catch(() => null);
  const rep = await conta(Y, "2.1.01", 20, 30000);
  const imp = await conta(Y, "3.2.03", 20, 30000, { opening_balance: true });
  await sync();
  ok("repasse (2.1) fica de fora", !(await dividaDe(rep)));
  const dev = await conta(null, "1.9.03", 20, 10000);
  await sync();
  ok("devolução ao paciente (1.x) não é dívida nem pendência", !(await dividaDe(dev)) &&
    !(await um("select 1 x from public._debt_auto_overdue_candidates() where payable_id = $1", [dev])));
  ok("saldo de implantação fica de fora", !(await dividaDe(imp)));
  if (fee) ok("taxa da franquia fica de fora", !(await dividaDe(fee)));
  else console.log("  · taxa da franquia: não deu para criar a conta de ensaio (regra conferida pelo texto)");
  ok("a regra pula network_fee e 2.6 no texto", /p\.network_fee is null/.test(sql) && /not like '2\.6%'/.test(sql));

  console.log("\n3. Sem fornecedor");
  const semF = await conta(null, "3.3.01", 15, 9900);
  await sync();
  ok("não vira dívida", !(await um("select debt_id from public.payables where id = $1", [semF])).debt_id);
  const pend = await como(ids.financeiro, () => c.query("select payable_id from public.debt_auto_overdue_pending()"));
  ok("aparece na Qualidade dos dados para o Financeiro", pend.rows.some((r) => r.payable_id === semF));

  console.log("\n4. Conta nova do mesmo fornecedor");
  const x3 = await conta(X, "2.3", 3, 25000);
  await sync();
  ok("entra na mesma dívida", (await dividaDe(x3))?.id === d1.id);
  ok("valor atualizado (R$ 1.750,00)", Number((await um("select original_cents from public.debts where id = $1", [d1.id])).original_cents) === 175000);

  console.log("\n5. Pagou tudo");
  await c.query("update public.payables set status = 'paga', paid_amount_cents = amount_cents where id = any($1)", [[x1, x2, x3]]);
  await sync();
  ok("quitada e encerrada sozinha", (await um("select status from public.debts where id = $1", [d1.id])).status === "quitada_encerrada");
  const x4 = await conta(X, "2.3", 2, 10000);
  await sync();
  const d4 = await dividaDe(x4);
  ok("conta vencida depois → dívida NOVA", d4 && d4.id !== d1.id && d4.auto_overdue);

  console.log("\n6. Cancelou a única conta");
  await c.query("update public.payables set status = 'cancelada', cancel_reason = 'ensaio' where id = $1", [x4]);
  await sync();
  const d4b = await um("select deleted_at, deleted_reason from public.debts where id = $1", [d4.id]);
  ok("a dívida sai, com o motivo", !!d4b.deleted_at && /canceladas/.test(d4b.deleted_reason));
  ok("a conta cancelada ficou sem dívida", !(await um("select debt_id from public.payables where id = $1", [x4])).debt_id);

  console.log("\n7. Excluída pela tela não volta");
  const dy = await dividaDe(y5);
  const errDel = await erroDe(() => como(ids.financeiro, () => c.query("select public.debt_delete($1, 'Ensaio: não é dívida')", [dy.id])));
  ok("o Financeiro exclui a dívida automática", errDel === null);
  await sync();
  ok("a conta dela não volta para dívida nenhuma", !(await um("select debt_id from public.payables where id = $1", [y5])).debt_id);

  console.log("\n8. Sem aviso novo");
  const z = await conta(X, "2.3", 27, 12000);
  await sync();
  const dz = await dividaDe(z);
  ok("dívida automática em atraso perto do prazo", dz?.status === "em_atraso");
  await c.query("select public._debt_notices_daily()");
  ok("sem aviso de prestes a virar inadimplente", !(await um("select 1 x from public.debt_notices where subject_id = $1 and kind = 'prestes_inadimplente'", [dz.id])));
  // A régua enxerga o aviso: a mesma dívida, sem a marca de automática, avisa.
  await c.query("update public.debts set auto_overdue = false where id = $1", [dz.id]);
  await c.query("select public._debt_notices_daily()");
  ok("(controle) a dívida comum na mesma situação avisa", !!(await um("select 1 x from public.debt_notices where subject_id = $1 and kind = 'prestes_inadimplente'", [dz.id])));
  await c.query("update public.debts set auto_overdue = true where id = $1", [dz.id]);

  console.log("\n9. A porta");
  ok("o Financeiro roda", (await erroDe(() => como(ids.financeiro, () => c.query("select public.debt_auto_overdue_refresh()"))) === null));
  ok("a Recepção não", !!(await erroDe(() => como(ids.recepcao, () => c.query("select public.debt_auto_overdue_refresh()")))));
  ok("o anônimo não", !!(await erroDe(async () => {
    await c.query("set local role anon");
    try { await c.query("select public.debt_auto_overdue_refresh()"); } finally { await c.query("reset role"); }
  })));
  ok("o anônimo não lê a regra interna", !!(await erroDe(async () => {
    await c.query("set local role anon");
    try { await c.query("select * from public._debt_auto_overdue_candidates()"); } finally { await c.query("reset role"); }
  })));

  console.log(falhas.length ? `\n✗ ${falhas.length} falha(s): ${falhas.join("; ")}` : "\n✓ Tudo certo.");
  saida = falhas.length ? 1 : 0;
} catch (e) {
  console.error("\nO ENSAIO NÃO RODOU ATÉ O FIM:", e.message);
  saida = 1;
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
  console.log("Transação desfeita: nada ficou no treino.");
}
process.exit(saida);
