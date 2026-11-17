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
  // Uma prévia aberta em Cambé (como o Admin), para ter o que ler. O teste de
  // ponta a ponta de 17/11 já pagou a de outubro: dentro da transação desfeita,
  // os lotes de Cambé de outubro saem do caminho.
  await c.query("update franchise_monthly_batches set status = 'cancelada' where clinic_id = $1 and period = '2026-10-01'", [cambe]);
  const lote = (await tenta(adm, "select public.franchise_monthly_open($1,'2026-10-01') id", [cambe]))[0].id;
  const item = (await um("select id from franchise_monthly_items where batch_id=$1 and kind='percentual' limit 1", [lote])).id;
  const ldnLote = (await um("select id from franchise_monthly_batches where clinic_id=$1 and status<>'cancelada' limit 1", [ldn])).id;
  // PARTE 0 (17/11/2026, pedido do dono): o Gerente com os papéis REAIS do treino
  // (Unidade Teste, Cambé e Londrina) diante de uma unidade que ele NÃO gere.
  const fake = (await um("select id from clinics where name='Risarte Unidade Fake'")).id;
  const geridas = (await c.query("select clinic_id from user_clinic_roles_all where user_id=$1 and role='unit_manager'", [ger])).rows.map((x) => x.clinic_id);
  res.push(["(papéis reais) o Gerente gere mais de uma unidade, e não a Fake", geridas.length >= 2 && !geridas.includes(fake)]);
  await tenta(adm, "select public.franchise_billing_unit_save($1, $2::jsonb)", [fake, JSON.stringify({ finance_email: "financeiro.fake@example.com", monthly_from: "2026-10-01", example_values: true })]);
  let fakeLote = (await tenta(adm, "select public.franchise_monthly_open($1,'2026-10-01') id", [fake]))?.[0]?.id;
  if (!fakeLote) {
    fakeLote = (await um(`insert into franchise_monthly_batches (clinic_id, period, status, total_cents, preview_deadline)
                          values ($1, '2026-10-01', 'previa', 10000, public.today_br() + 5) returning id`, [fake])).id;
  }
  let fakeItem = (await um("select id from franchise_monthly_items where batch_id=$1 limit 1", [fakeLote]))?.id;
  if (!fakeItem) {
    fakeItem = (await um(`insert into franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, amount_cents, description)
                          values ($1, $2, 'ajuste', 'royalty', '2026-10-01', 10000, 'teste de papéis') returning id`, [fakeLote, fake])).id;
  }
  res.push(["(papéis reais) Gerente lê a de Cambé (uma das suas)", Array.isArray(await tenta(ger, "select public.franchise_monthly_read($1)", [lote]))]);
  res.push(["(papéis reais) Gerente não lê a da Fake", String(await tenta(ger, "select public.franchise_monthly_read($1)", [fakeLote])).includes("NOT_ALLOWED")]);
  res.push(["(papéis reais) Gerente não contesta a da Fake", String(await tenta(ger, "select public.franchise_monthly_contest($1,'motivo do teste')", [fakeItem])).includes("NOT_ALLOWED")]);
  const listaG = await tenta(ger, "select public.franchise_monthly_list(null) j");
  res.push(["(papéis reais) a lista do Gerente só tem as unidades dele", Array.isArray(listaG) && (listaG[0].j ?? []).every((x) => geridas.includes(x.clinic_id)) && !(listaG[0].j ?? []).some((x) => x.clinic_id === fake)]);
  res.push(["(papéis reais) Gerente não lê a conferência da Fake", String(await tenta(ger, "select public.franchise_reconciliation_read(null,$1)", [fake])).includes("NOT_ALLOWED")]);
  const confG = await tenta(ger, "select public.franchise_reconciliation_read(null, null) j");
  res.push(["(papéis reais) a conferência do Gerente só mostra as unidades dele", Array.isArray(confG) && (confG[0].j.units ?? []).every((x) => geridas.includes(x.clinic_id))]);
  res.push(["(papéis reais) Gerente não vê os itens da Fake pela tabela", (await tenta(ger, "select count(*) n from franchise_monthly_items where clinic_id=$1", [fake]))[0].n === "0"]);
  const rep = await tenta(ger, "select public.franchise_payouts_read(current_date - 30, current_date, $1) j", [fake]);
  // A porta do painel nem é liberada ao Gerente ("permission denied") ou recusa a unidade (NOT_ALLOWED).
  res.push(["(papéis reais) Gerente não lê o Painel de repasses da Fake", typeof rep === "string" && /NOT_ALLOWED|permission denied/.test(rep)]);
  const pedidos = await tenta(ger, "select count(*) n from refund_requests where clinic_id=$1", [fake]);
  res.push(["(papéis reais) Gerente não vê pedidos de estorno da Fake", Array.isArray(pedidos) && pedidos[0].n === "0"]);

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
