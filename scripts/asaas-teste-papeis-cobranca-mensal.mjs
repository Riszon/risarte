// TESTE DE PAPÉIS da Cobrança da rede e da Conferência das taxas, pela porta do banco (a API),
// numa transação DESFEITA no treino. Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-teste-papeis-cobranca-mensal.mjs --confirmar
import { connect } from "./test-db.mjs";
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Mexe no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const c = await connect();
const um = async (s, p = []) => (await c.query(s, p)).rows[0];
const res = [];
await c.query("begin");
try {
  const cambe = (await um("select id from clinics where name='Risarte Cambé - Centro'")).id;
  const ldn = (await um("select id from clinics where name='Risarte Londrina - Centro'")).id;
  const fr = (await um("select id from clinics where type='franchisor' order by created_at limit 1")).id;
  const adm = (await um("select id from profiles where email='admin@example.com'")).id;
  const u = (await um("select id from profiles where email='consultor@example.com'")).id;
  const ger = (await um("select id from profiles where email='gerente@example.com'")).id;
  const fin = (await um("select id from profiles where email='financeiro@example.com'")).id;
  const como = async (id) => { await c.query("reset role"); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, role: "authenticated" })]); await c.query("set local role authenticated"); };
  const tenta = async (id, sql, p = []) => { await como(id); await c.query("savepoint s"); try { const r = (await c.query(sql, p)).rows; await c.query("release savepoint s"); return r; } catch (e) { await c.query("rollback to savepoint s"); return "erro: " + e.message.slice(0, 60); } finally { await c.query("reset role"); await c.query("select set_config('request.jwt.claims', '', true)"); } };
  // Uma prévia aberta em Cambé (como o Admin), para ter o que ler.
  const lote = (await tenta(adm, "select public.franchise_monthly_open($1,'2026-10-01') id", [cambe]))[0].id;
  const item = (await um("select id from franchise_monthly_items where batch_id=$1 and kind='percentual' limit 1", [lote])).id;
  const ldnLote = (await um("select id from franchise_monthly_batches where clinic_id=$1 and status<>'cancelada' limit 1", [ldn])).id;
  // Gerente: só Cambé.
  await c.query("delete from user_clinic_roles_all where user_id=$1", [ger]);
  await c.query("insert into user_clinic_roles_all (user_id, clinic_id, role) values ($1,$2,'unit_manager')", [ger, cambe]);
  res.push(["Gerente lê a de Cambé (a sua)", Array.isArray(await tenta(ger, "select public.franchise_monthly_read($1)", [lote]))]);
  res.push(["Gerente não lê a de Londrina", String(await tenta(ger, "select public.franchise_monthly_read($1)", [ldnLote])).includes("NOT_ALLOWED")]);
  res.push(["Gerente contesta a da sua unidade", Array.isArray(await tenta(ger, "select public.franchise_monthly_contest($1,'motivo do teste')", [item]))]);
  res.push(["Quem contesta não aprova", String(await tenta(ger, "select public.franchise_monthly_approve($1)", [lote])).includes("NOT_ALLOWED")]);
  res.push(["Quem contesta não decide a contestação", String(await tenta(ger, "select public.franchise_monthly_decide($1,true,'aceito sim')", [item])).includes("NOT_ALLOWED")]);
  res.push(["Gerente lê a conferência só da sua unidade", ((await tenta(ger, "select public.franchise_reconciliation_read(null, null) j"))[0].j.units ?? []).every((x) => x.clinic_id === cambe)]);
  res.push(["Gerente não lê a conferência de Londrina", String(await tenta(ger, "select public.franchise_reconciliation_read(null,$1)", [ldn])).includes("NOT_ALLOWED")]);
  // Os seis papéis que não veem.
  for (const [papel, clinica] of [["dentist", cambe], ["planner_dentist", fr], ["asb", cambe], ["tsb", cambe], ["sdr", fr], ["receptionist", cambe]]) {
    await c.query("delete from user_clinic_roles_all where user_id=$1", [u]);
    await c.query("insert into user_clinic_roles_all (user_id, clinic_id, role) values ($1,$2,$3)", [u, clinica, papel]);
    const lista = await tenta(u, "select public.franchise_monthly_list(null) j");
    const ler = await tenta(u, "select public.franchise_monthly_read($1)", [lote]);
    const conf = await tenta(u, "select public.franchise_reconciliation_read(null,null) j");
    const contesta = await tenta(u, "select public.franchise_monthly_contest($1,'motivo qualquer')", [item]);
    const direto = await tenta(u, "select count(*) n from franchise_monthly_items");
    const cobr = await tenta(u, "select count(*) n from charges where source_type='franchise_monthly'");
    const ok = Array.isArray(lista) && lista[0].j.length === 0 && String(ler).includes("NOT_ALLOWED")
      && Array.isArray(conf) && (conf[0].j.units ?? []).length === 0 && (conf[0].j.issues ?? []).length === 0
      && String(contesta).includes("NOT_ALLOWED") && direto[0].n === "0" && cobr[0].n === "0";
    res.push([`${papel}: não vê a lista, o demonstrativo, a conferência, as tabelas nem a cobrança; não contesta`, ok]);
  }
  res.push(["Financeiro decide (controle)", Array.isArray(await tenta(fin, "select 1"))]);
} catch (e) { console.log("ERRO", e.message); }
await c.query("rollback"); await c.end();
for (const [n, v] of res) console.log(v ? "  ok  " : "  FALHA", n);
console.log(`${res.filter((x) => x[1]).length}/${res.length}`);
