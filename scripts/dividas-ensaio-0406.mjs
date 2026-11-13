// ENSAIO DA 0406 (Levantamento de Dívidas, fase 3 — Contas a Pagar) no banco
// de TREINO, numa transação DESFEITA: nada fica.
// Uso: node scripts/dividas-ensaio-0406.mjs --confirmar [--quebrar]
//      (rede sem IPv6: RISARTE_TREINO_POOLER=1)
//
// A régua obrigatória da fase 3 (D5 e ajuste 4 do dono):
//   1. As 9 funções que leem o razão: o corpo novo = o corpo VIVO no banco com
//      SÓ o trecho da regra trocado (prova de que partimos da versão certa).
//   2. Os números de todas elas, para todas as unidades, ANTES e DEPOIS da
//      migração: idênticos.
//   3. Depois de gerar e pagar títulos de dívida de origem A: DRE, ponto de
//      equilíbrio, orçado × realizado, custo fixo da hora clínica, consolidado
//      e resumo da rede CONTINUAM idênticos; o fluxo de caixa muda só na linha
//      "dividas".
//   4. Origem B entra na DRE na competência; C só vincula; editar atualiza o
//      título não pago e é recusado depois do pagamento; excluir cancela (ou
//      recusa com pagamento); o título não se mexe pelo Contas a Pagar;
//      tudo pago = "Quitada — pendências de baixa"; vencido do saldo de
//      implantação separado (D1-c).
//   5. RLS (D1-a): Gerente e Franqueado da unidade não veem título da
//      franqueadora.
// `--quebrar`: a regra única esquece a 5.5 — o ensaio TEM de falhar.
// Só contagens e valores de teste na saída (LGPD).
import { readFileSync, readdirSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0406_dividas_contas_a_pagar.sql";
if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO dentro de transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const todas = async (sql, p = []) => (await c.query(sql, p)).rows;
let sp = 0;
async function como(uid, fn) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  try { return await fn(); } finally {
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claims', '', true)");
  }
}
async function erroDe(sql, p = []) {
  const nome = `s${++sp}`;
  await c.query(`savepoint ${nome}`);
  try { await c.query(sql, p); await c.query(`release savepoint ${nome}`); return null; }
  catch (e) { await c.query(`rollback to savepoint ${nome}`); return e.message; }
}
const falhas = [];
const ok = (nome, v) => { console.log(`  ${v ? "✓" : "✗"} ${nome}`); if (!v) falhas.push(nome); };
const j = (o) => JSON.stringify(o);

const LEITORES = ["_dre_lines_raw", "breakeven_lines_raw", "profit_cash_bridge", "budget_vs_actual",
  "fill_budget_from_actual", "consolidated_dre", "network_units_summary", "clinic_fixed_costs_by_month", "cash_flow_series_raw"];
const BLOCO = /(\n[ \t]*)and e\.account_code not like '6%'[ \t]*\n[ \t]*and e\.account_code not like '5\.1%'[ \t]*\n[ \t]*and e\.account_code not like '5\.3%'[ \t]*\n[ \t]*and e\.account_code not like '5\.4%'/gi;
const ATIV = (a) => new RegExp(`case\\s*\\n\\s*when ${a}\\.account_code like '5\\.1%' or ${a}\\.account_code like '6\\.3%' then 'investimento'\\s*\\n\\s*when ${a}\\.account_code like '5\\.3%'\\s*\\n\\s*or ${a}\\.account_code like '5\\.4%'\\s+then 'financiamento'\\s*\\n\\s*else 'operacional'\\s*\\n\\s*end`, "gi");
// Onde cada leitora foi definida pela última vez ANTES da 0406.
const ORIGEM = { _dre_lines_raw: "0320", breakeven_lines_raw: "0230", profit_cash_bridge: "0228", budget_vs_actual: "0229",
  fill_budget_from_actual: "0229", consolidated_dre: "0236", network_units_summary: "0236", clinic_fixed_costs_by_month: "0330",
  cash_flow_series_raw: "0301" };
// A definição antiga, tirada do arquivo da migração (o último create da função nele).
function definicaoAntiga(fn) {
  const arq = readdirSync("supabase/migrations").find((x) => x.startsWith(ORIGEM[fn] + "_"));
  const txt = readFileSync("supabase/migrations/" + arq, "utf8").replace(/\r\n/g, "\n");
  const re = new RegExp(`create or replace function public[.]${fn}[ \\t\\n]*[(]`, "gi");
  let m, ini = -1;
  while ((m = re.exec(txt))) ini = m.index;
  if (ini < 0) throw new Error("NÃO MEDI: sem a definição de " + fn + " em " + arq);
  const asM = /\bas\s+(\$[a-z_]*\$)/i.exec(txt.slice(ini));
  if (!asM) throw new Error("NÃO MEDI: sem o corpo de " + fn + " em " + arq);
  const abre = ini + asM.index + asM[0].length;
  const fecha = txt.indexOf(asM[1], abre);
  return txt.slice(ini, txt.indexOf(";", fecha) + 1);
}
const corpo = (def) => { const m = /\$([a-z_]*)\$([\s\S]*)\$\1\$/i.exec(def); return m ? m[2] : null; };
const norm = (s) => s.replace(/\s+/g, " ").trim();

// Os números de todas as leituras, por unidade, num período largo.
async function medir(ids, clinicas, rotulo) {
  const r = {};
  for (const cl of clinicas) {
    const q = async (sql) => (await todas(sql, [cl])).map((x) => j(x)).sort();
    r[cl] = {
      dre: await q("select * from public._dre_lines_raw($1, '2025-01-01', '2027-12-31', null)"),
      breakeven: await q("select * from public.breakeven_lines_raw($1, '2025-01-01', '2027-12-31', null)"),
      caixa: await q("select day, kind, activity, inflow_cents, outflow_cents from public.cash_flow_series_raw($1, '2025-01-01', '2027-12-31')"),
    };
  }
  await como(ids.admin, async () => {
    for (const cl of clinicas) {
      const q = async (sql) => (await todas(sql, [cl])).map((x) => j(x)).sort();
      r[cl].bridge = await q("select * from public.profit_cash_bridge($1, '2025-01-01', '2027-12-31')");
      r[cl].budget = await q("select * from public.budget_vs_actual($1, 2026, 11)");
      r[cl].fixos = await q("select * from public.clinic_fixed_costs_by_month($1, '2025-01-01', '2027-12-31')");
    }
    r.consolidado = (await todas("select * from public.consolidated_dre('2025-01-01', '2027-12-31', 'grupo')")).map(j).sort();
    r.consolidadoRede = (await todas("select * from public.consolidated_dre('2025-01-01', '2027-12-31', 'rede')")).map(j).sort();
    r.resumo = (await todas("select * from public.network_units_summary('2025-01-01', '2027-12-31')")).map(j).sort();
  });
  const linhas = Object.values(r).flatMap((v) => (Array.isArray(v) ? v : Object.values(v).flat())).length;
  console.log(`  (${rotulo}: ${linhas} linhas medidas)`);
  return r;
}
const iguais = (a, b, sem = []) => {
  const dif = [];
  for (const k of Object.keys(a)) {
    if (Array.isArray(a[k])) { if (j(a[k]) !== j(b[k])) dif.push(k); continue; }
    for (const f of Object.keys(a[k])) if (!sem.includes(f) && j(a[k][f]) !== j(b[k][f])) dif.push(`${k}.${f}`);
  }
  return dif;
};

let saida = 1;
try {
  await c.query("begin");
  const PESSOAS = ["admin", "financeiro", "gerente", "franqueado", "recepcao", "dentista"];
  const ids = {};
  for (const p of PESSOAS) ids[p] = (await um("select id from auth.users where email = $1", [`${p}@example.com`])).id;
  const clinicas = (await todas("select id from public.clinics order by code")).map((x) => x.id);
  const ldn = (await um("select id from public.clinics where code = 'LDN'")).id;
  const rf = (await um("select id from public.clinics where code = 'RF'")).id;

  console.log("1. O corpo novo = o corpo vivo com só a regra trocada");
  const vivos = {};
  const lerViva = async (fn) => (await um("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).d;
  for (const fn of LEITORES) vivos[fn] = await lerViva(fn);
  // O treino já pode ter a 0406: então volta (só dentro desta transação) as 9
  // leitoras à versão anterior, tirada das migrações de origem, e mede a partir dela.
  const jaTinha = LEITORES.filter((fn) => /account_outside_result/.test(vivos[fn] ?? ""));
  if (jaTinha.length) {
    console.log(`  O banco já tem a 0406 em ${jaTinha.length} leitora(s): voltando-as à versão anterior dentro da transação.`);
    for (const fn of LEITORES) { await c.query(definicaoAntiga(fn)); vivos[fn] = await lerViva(fn); }
    ok("versão anterior restaurada nas 9 (sem a regra única)", LEITORES.every((fn) => !/account_outside_result/.test(vivos[fn])));
  }
  // Títulos de dívida que já existem no treino (feitos na tela) entrariam na
  // DRE da versão anterior e o "antes" deixaria de ser o mundo sem dívidas.
  // Somem SÓ dentro desta transação (que é desfeita), com os gatilhos parados.
  const existentes = (await um("select count(*)::int n from public.payables where debt_id is not null")).n;
  if (existentes) {
    await c.query("set local session_replication_role = replica");
    await c.query(`delete from public.financial_entries
      where source_id in (select id from public.payables where debt_id is not null)
         or source_id in (select pp.id from public.payable_payments pp join public.payables p on p.id = pp.payable_id where p.debt_id is not null)`);
    await c.query("delete from public.payable_payments where payable_id in (select id from public.payables where debt_id is not null)");
    await c.query("delete from public.payables where debt_id is not null");
    await c.query("update public.debts set finance_synced_at = null where finance_synced_at is not null");
    await c.query("set local session_replication_role = origin");
    console.log(`  ${existentes} título(s) de dívida já existentes tirados só dentro da transação (o "antes" sem dívidas).`);
  }

  const antes = await medir(ids, clinicas, "antes");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query(sql);
  console.log("  Migração aplicada duas vezes sem erro (idempotente).");
  for (const fn of LEITORES) {
    const novo = (await um("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).d;
    let esperado = corpo(vivos[fn]).replace(BLOCO, (_x, ind) => `${ind}and not public.account_outside_result(e.account_code)`);
    if (fn === "cash_flow_series_raw") esperado = esperado.replace(ATIV("e"), "public.account_cash_activity(e.account_code)").replace(ATIV("p"), "public.account_cash_activity(p.account_code)");
    ok(`${fn}: corpo novo = corpo vivo com só a regra trocada`, norm(esperado) === norm(corpo(novo)) && norm(esperado) !== norm(corpo(vivos[fn])));
  }

  console.log("\n2. Números idênticos antes e depois da migração");
  const depois = await medir(ids, clinicas, "depois");
  const dif1 = iguais(antes, depois);
  ok(`todas as leituras iguais (diferenças: ${dif1.length ? dif1.join(", ") : "nenhuma"})`, dif1.length === 0);

  console.log("\n3. Títulos de dívida de origem A não mexem nos indicadores");
  const sup = (await um("select id from public.suppliers where active order by name limit 1")).id;
  const salvar = (p) => como(ids.financeiro, async () => (await um("select public.debt_save($1::jsonb) v", [j(p)])).v);
  const gerar = (id) => como(ids.financeiro, async () => (await um("select public.debt_sync_finance($1) v", [id])).v);
  const base = { clinic_id: ldn, supplier_id: sup, original_cents: 100000, updated_cents: 130000, updated_ref_date: "2026-11-13", due_date: "2026-08-10", issue_date: "2025-02-01", origin: "A" };
  const dPrev = await salvar(base);
  const prev = await como(ids.financeiro, async () => await um("select * from public.debt_finance_preview($1)", [dPrev]));
  const goLive = (await um("select go_live_on::text d from public.clinics where id = $1", [ldn])).d;
  const dataDe = (x) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x).slice(0, 10));
  ok("prévia da origem A: conta 5.5.01, valor atualizado, fora da DRE, competência na implantação, sem problema",
    prev.account_code === "5.5.01" && Number(prev.amount_cents) === 130000 && prev.opening_balance === true
      && prev.in_result === false && dataDe(prev.accrual_date) === goLive && prev.problem === null);
  // O caixa "dividas" que já existia no treino (pagamentos feitos na tela): o ensaio mede a diferença.
  const dividasAntes = Number((await um("select coalesce(sum(outflow_cents),0)::bigint s from public.cash_flow_series_raw($1, '2025-01-01', '2027-12-31') where activity = 'dividas' and kind = 'realizado'", [ldn])).s);
  const dA = await salvar(base);
  const tA = await gerar(dA);
  const pA = await um("select * from public.payables where id = $1", [tA]);
  const eA = await um("select count(*)::int n, max(account_code) conta from public.financial_entries where source_type = 'payable_accrual' and source_id = $1", [tA]);
  ok("título A gerado: 5.5.01, R$ 1.300,00, sem alçada, saldo de implantação, competência = implantação, com lançamento",
    pA.account_code === "5.5.01" && Number(pA.amount_cents) === 130000 && pA.status === "aberta" && pA.approval_mode === "automatica"
      && pA.opening_balance === true && pA.debt_link === "gerado" && eA.n === 1
      && dataDe(pA.accrual_date) === goLive);
  // Paga metade com juros (juros vão para 4.2.01: ESSE muda a DRE, de propósito — D6).
  await como(ids.financeiro, () => c.query("select public.register_payable_payment(p_payable_id => $1, p_amount_cents => 65000, p_paid_at => '2026-11-13', p_payment_method => 'pix')", [tA]));
  const loan = await salvar({ ...base, original_cents: 500000, updated_cents: 520000, account_code: null, category_id: (await um("select id from public.debt_categories where name = 'Empréstimos e financiamentos' and parent_id is null")).id });
  const tLoan = await gerar(loan);
  ok("empréstimo antigo usa 5.3.01", (await um("select account_code from public.payables where id = $1", [tLoan])).account_code === "5.3.01");
  if (process.argv.includes("--quebrar")) {
    await c.query("create or replace function public.account_outside_result(p_code text) returns boolean language sql immutable set search_path = '' as $q$ select coalesce(p_code,'') like '6%' or coalesce(p_code,'') like '5.1%' or coalesce(p_code,'') like '5.3%' or coalesce(p_code,'') like '5.4%' $q$");
    console.log("  ⚠️ MODO QUEBRAR: a regra única esquece a 5.5 depois de gerar os títulos (o ensaio tem de FALHAR).");
  }
  const comTitulos = await medir(ids, clinicas, "com títulos A");
  const dif2 = iguais(antes, comTitulos, ["caixa", "bridge"]);
  ok(`DRE, ponto de equilíbrio, orçado × realizado, hora clínica, consolidado e resumo iguais (diferenças: ${dif2.length ? dif2.join(", ") : "nenhuma"})`, dif2.length === 0);
  const caixaDiv = await todas("select activity, sum(outflow_cents)::bigint s from public.cash_flow_series_raw($1, '2025-01-01', '2027-12-31') group by 1", [ldn]);
  const realizadoDiv = await um("select coalesce(sum(outflow_cents),0)::bigint s from public.cash_flow_series_raw($1, '2025-01-01', '2027-12-31') where activity = 'dividas' and kind = 'realizado'", [ldn]);
  ok("o pagamento da dívida antiga aparece no caixa na linha própria \"dividas\" (realizado)", Number(realizadoDiv.s) - dividasAntes === 65000 && caixaDiv.some((r) => r.activity === "dividas"));
  const outrasLinhas = (x) => x[ldn].caixa.filter((l) => !l.includes('"dividas"') && !l.includes('"financiamento"'));
  ok("as outras linhas do caixa (operacional, investimento) não mudaram", j(outrasLinhas(antes)) === j(outrasLinhas(comTitulos)));

  console.log("\n4. Origem B, C, edição, exclusão, trava, quitação, vencido");
  const catB = (await um("select id from public.debt_categories where name = 'Utilidades (energia, água, telefonia, internet)' and parent_id is null")).id;
  const contaDespesa = (await um("select code from public.chart_of_accounts where is_analytic and active and code like '3.%' and code <> '3.3.05' order by code limit 1")).code;
  const dB0 = await salvar({ ...base, origin: "B", issue_date: "2026-11-20", accrual_month: "2026-11-01", due_date: "2026-12-10", category_id: catB, original_cents: 40000, updated_cents: null });
  const eSemConta = await como(ids.financeiro, () => erroDe("select public.debt_sync_finance($1)", [dB0]));
  ok("origem B sem conta de despesa: recusa explicando", eSemConta !== null && /conta de despesa/.test(eSemConta));
  const dB = await salvar({ ...base, origin: "B", issue_date: "2026-11-20", accrual_month: "2026-11-01", due_date: "2026-12-10", account_code: contaDespesa, original_cents: 40000, updated_cents: null });
  const dreAntesB = Number((await um("select coalesce(sum(amount_cents),0)::bigint s from public._dre_lines_raw($1, '2026-11-01', '2026-11-30', null) where account_code = $2", [ldn, contaDespesa])).s);
  const tB = await gerar(dB);
  const dreDepoisB = Number((await um("select coalesce(sum(amount_cents),0)::bigint s from public._dre_lines_raw($1, '2026-11-01', '2026-11-30', null) where account_code = $2", [ldn, contaDespesa])).s);
  ok(`origem B entra na DRE de novembro na conta de despesa (−R$ 400,00; veio ${dreDepoisB - dreAntesB})`, dreDepoisB - dreAntesB === -40000);
  const eConta5 = await como(ids.financeiro, () => erroDe("select public.debt_save($1::jsonb)", [j({ ...base, id: dB, origin: "B", issue_date: "2026-11-20", accrual_month: "2026-11-01", due_date: "2026-12-10", account_code: "5.5.01", original_cents: 40000, updated_cents: null })]));
  ok("dívida B não aceita conta de saldo (5.5)", eConta5 !== null && /saldo/.test(eConta5));
  // Edição antes do pagamento atualiza título e lançamento.
  await salvar({ ...base, id: dB, origin: "B", issue_date: "2026-11-20", accrual_month: "2026-11-01", due_date: "2026-12-15", account_code: contaDespesa, original_cents: 45000, updated_cents: null });
  const pB = await um("select amount_cents, due_date::text d from public.payables where id = $1", [tB]);
  const eB = await um("select amount_cents from public.financial_entries where source_type = 'payable_accrual' and source_id = $1", [tB]);
  ok("editar antes do pagamento atualiza o título e o lançamento", Number(pB.amount_cents) === 45000 && pB.d === "2026-12-15" && Number(eB.amount_cents) === 45000);
  // Edição depois do pagamento é recusada (e nada muda).
  const eEdit = await como(ids.financeiro, () => erroDe("select public.debt_save($1::jsonb)", [j({ ...base, id: dA, updated_cents: 999999 })]));
  ok("editar valor depois do pagamento: recusa", eEdit !== null && /pagamento/.test(eEdit));
  // Trava do título pelo Contas a Pagar.
  const eCancel = await como(ids.financeiro, () => erroDe("select public.cancel_payable($1, 'teste de trava')", [tB]));
  ok("cancelar o título da dívida pelo Contas a Pagar: recusa", eCancel !== null && /Levantamento de Dívidas/.test(eCancel));
  const eMexe = await erroDe("update public.payables set amount_cents = 1 where id = $1", [tB]);
  ok("mudar o valor do título por fora (nem o superusuário): recusa", eMexe !== null);
  // Origem C: vincula um título que já existe.
  const tExist = (await um(`insert into public.payables (clinic_id, supplier_id, account_code, description, due_date, amount_cents, status, approval_mode)
       values ($1, $2, $3, 'ensaio C', '2026-10-01', 22200, 'aberta', 'automatica') returning id`, [ldn, sup, contaDespesa])).id;
  const dC = await salvar({ ...base, origin: "C", original_cents: 22200, updated_cents: null, due_date: "2026-10-01" });
  const eGerarC = await como(ids.financeiro, () => erroDe("select public.debt_sync_finance($1)", [dC]));
  ok("origem C não gera título", eGerarC !== null && /vincule/.test(eGerarC));
  const nC = await como(ids.financeiro, async () => (await um("select public.debt_link_payables($1, $2::uuid[]) v", [dC, [tExist]])).v);
  const pC = await um("select debt_id, debt_link from public.payables where id = $1", [tExist]);
  ok("origem C vincula o título existente, sem criar outro", nC === 1 && pC.debt_id === dC && pC.debt_link === "vinculado"
    && (await um("select count(*)::int n from public.payables where debt_id = $1", [dC])).n === 1);
  const eOutro = await como(ids.financeiro, async () => {
    const dC2 = (await um("select public.debt_save($1::jsonb) v", [j({ ...base, origin: "C", due_date: "2026-10-01" })])).v;
    return erroDe("select public.debt_link_payables($1, $2::uuid[])", [dC2, [tExist]]);
  });
  ok("o mesmo título não vincula em duas dívidas", eOutro !== null);
  // Excluir: com pagamento recusa; sem pagamento cancela; C desvincula.
  const eDelPago = await como(ids.financeiro, () => erroDe("select public.debt_delete($1, 'ensaio exclusão')", [dA]));
  ok("excluir dívida com título pago: recusa", eDelPago !== null && /pagamento/.test(eDelPago));
  await como(ids.financeiro, () => c.query("select public.debt_delete($1, 'ensaio exclusão')", [dB]));
  const pBdel = await um("select p.status, e.status es from public.payables p join public.financial_entries e on e.source_id = p.id and e.source_type = 'payable_accrual' where p.id = $1", [tB]);
  ok("excluir sem pagamento cancela o título e o lançamento", pBdel.status === "cancelada" && pBdel.es === "cancelled");
  await como(ids.financeiro, () => c.query("select public.debt_delete($1, 'ensaio exclusão C')", [dC]));
  const pCdel = await um("select debt_id, status from public.payables where id = $1", [tExist]);
  ok("excluir origem C desvincula e não cancela o título", pCdel.debt_id === null && pCdel.status === "aberta");
  // Quitação: paga o resto.
  await como(ids.financeiro, () => c.query("select public.register_payable_payment(p_payable_id => $1, p_amount_cents => 65000, p_paid_at => '2026-11-13', p_payment_method => 'pix')", [tA]));
  ok("tudo pago → Quitada — pendências de baixa", (await um("select status from public.debts where id = $1", [dA])).status === "quitada_pendencias");
  // Vencido do saldo de implantação à parte (D1-c).
  const dV = await salvar({ ...base, updated_cents: 77700, due_date: "2026-01-10" });
  const tVid = await gerar(dV);
  const ov = await como(ids.admin, async () => await um("select * from public.cash_overdue($1)", [ldn]));
  const ovNormal = await como(ids.admin, async () => Number((await um(`select coalesce(sum(amount_cents - paid_amount_cents),0)::bigint s from public.payables
      where clinic_id = $1 and not opening_balance and status in ('aberta','parcial','aguardando_autorizacao') and due_date < public.today_br()`, [ldn])).s));
  ok("vencido: saldo de implantação numa linha própria, fora do \"a pagar vencido\"",
    Number(ov.opening_cents) >= 77700 && Number(ov.opening_count) >= 1 && Number(ov.payable_cents) === ovNormal);

  console.log("\n5. RLS (D1-a)");
  const dRF = await salvar({ ...base, clinic_id: rf, updated_cents: 33300 });
  const tRF = await gerar(dRF);
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, 'unit_manager'), ($3, $2, 'franchisee') on conflict do nothing", [ids.gerente, ldn, ids.franqueado]);
  for (const p of ["gerente", "franqueado"]) {
    const v = await como(ids[p], async () => ({
      rf: (await um("select count(*)::int n from public.payables where id = $1", [tRF])).n,
      ldn: (await um("select count(*)::int n from public.payables where id = $1", [tVid])).n,
      divida: (await um("select count(*)::int n from public.debts")).n,
    }));
    ok(`${p} da unidade: não vê o título da franqueadora, vê o da própria unidade, não vê a dívida`, v.rf === 0 && v.ldn === 1 && v.divida === 0);
  }
  for (const p of ["recepcao", "dentista"]) {
    const n = await como(ids[p], async () => (await um("select count(*)::int n from public.payables where debt_id is not null")).n);
    ok(`${p}: não vê título de dívida`, n === 0);
  }
  const anon = await (async () => { await c.query("savepoint an"); await c.query("set local role anon");
    try { await c.query("select public.debt_sync_finance(gen_random_uuid())"); return "EXECUTOU"; }
    catch (e) { return e.code; } finally { await c.query("rollback to savepoint an"); } })();
  ok(`anônimo não executa debt_sync_finance (veio ${anon})`, anon === "42501");

  saida = falhas.length === 0 ? 0 : 1;
  console.log(saida === 0 ? "\nENSAIO OK." : `\nENSAIO FALHOU: ${falhas.length} conferência(s).`);

} catch (e) {
  console.error("ERRO NO ENSAIO (não medi):", e.message);
  saida = 1;
} finally {
  await c.query("rollback");
  await c.end();
  console.log("(transação desfeita — nada ficou no treino)");
}
process.exit(saida);
