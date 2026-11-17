// ENSAIO DA 4018c (a linha de taxa que nasce retida passa pela conferência do
// split) no banco de TREINO, numa transação DESFEITA (rollback). O Asaas não é
// chamado: o ensaio faz o papel do aviso do Asaas.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4018c-taxa-retida-no-razao.mjs --confirmar [--quebrar=gatilho]
//
// AS DUAS ORDENS, com o mesmo resultado (pedido do dono, 17/11/2026):
//   B) a baixa antes do aviso do split (o caso comum);
//   A) o aviso do split ANTES da baixa (o caso das mensalidades no sandbox).
// Em cada uma: a linha retida, o razão da unidade e o da franqueadora, a conta
// a pagar sem a taxa retida, a marca do "split a mais" e a falta do split.
// PROVADO QUEBRANDO: `gatilho` = sem o gatilho novo, a ordem A fica sem razão.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4018c_asa3_taxa_retida_no_razao.sql";
const QUEBRAR = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, valor) => (valor ? ok : falha).push(nome);
const um = async (sql, params = []) => (await c.query(sql, params)).rows[0];
const todos = async (sql, params = []) => (await c.query(sql, params)).rows;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const mais = (s, dias) => iso(new Date(Date.parse(s) + dias * 86400000));

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  const r1 = await c.query(sql);
  const conferencia = [].concat(r1).at(-1)?.rows?.[0] ?? {};
  conf("a 4018c roda e a conferência mostra o gatilho e nenhuma linha retida sem razão",
    Number(conferencia.gatilho_novo) === 1 && Number(conferencia.linhas_sem_razao) === 0);
  await c.query("savepoint dup");
  try {
    await c.query(sql);
    await c.query("release savepoint dup");
    conf("a 4018c roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4018c roda duas vezes sem erro (${e.message})`, false);
  }
  if (QUEBRAR === "gatilho") {
    await c.query("drop trigger split_charges_after_born on public.split_charges");
    // (sem o gatilho, nada roda no fim da transação: a ordem A fica sem razão)
    console.log("   (QUEBRADO de propósito: sem o gatilho da 4018c)");
  }

  // --- o cenário: duas mensalidades do PPR+ em Londrina, pagas pelo Asaas com split ---
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  if (!ldn || !(await um("select public.central_is_ready($1) r", [ldn])).r) throw new Error("NÃO MEDI: Londrina não está pronta na Central do treino.");
  const conta = await um("select id from public.gateway_accounts where clinic_id = $1 and status = 'active' limit 1", [ldn]);
  const raiz = await um("select id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' order by created_at limit 1");
  if (!conta || !raiz) throw new Error("NÃO MEDI: falta a conta de Londrina ou a raiz no treino.");
  const hoje = iso((await um("select public.today_br() d")).d);
  const cli = await um(
    `select c.id from public.clients c where c.clinic_id = $1 and public._cpf_ok(c.cpf) and c.birth_date < current_date - interval '19 years'
        and not exists (select 1 from public.client_guardians g where g.client_id = c.id) order by c.created_at limit 1`, [ldn]);
  const plano = await um("select id from public.ppr_plans order by created_at limit 1");
  if (!cli || !plano) throw new Error("NÃO MEDI: falta cliente ou plano do PPR+ no treino.");
  const taxas = (await todos("select key from public.network_fee_types where kind = 'percent' and active")).map((x) => x.key);
  if (!taxas.length) throw new Error("NÃO MEDI: nenhuma taxa percentual ativa.");
  // A chave das mensalidades de Londrina ligada hoje (dentro da transação desfeita).
  await c.query(`insert into public.gateway_auto_charge_units (clinic_id, enabled, fees_enabled_from, changed_at)
                 values ($1, false, public.today_br(), now())
                 on conflict (clinic_id) do update set fees_enabled_from = public.today_br()`, [ldn]);
  const membro = (await um(`insert into public.ppr_memberships (clinic_id, plan_id, holder_client_id, status, monthly_cents, billing_day, payment_method, contract_signed, first_payment_confirmed)
                            values ($1, $2, $3, 'ativo', 9990, 10, 'boleto', true, true) returning id`, [ldn, plano.id, cli.id])).id;

  let mes = 6;
  async function mensalidade(tag) {
    const f = (await um(`insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status)
                         values ($1, $2, date_trunc('month', current_date) + make_interval(months => $4), $3, 9990, 'em_aberto') returning id`, [membro, ldn, mais(hoje, 10), mes++])).id;
    const ch = (await um("select public._fee_charge_prepare_system('ppr_charge', $1, 'BOLETO', 'mensalidade') id", [f])).id;
    await um("select public._charge_mark_issued($1, $2, null, $3, null, null, $4)", [ch, `pay_${tag}_${ch.slice(0, 8)}`, "https://sandbox.asaas.com/i/x", "2379"]);
    await c.query("update public.charges set split_applied = true where id = $1", [ch]);
    const cs = (await um(`insert into public.charge_splits (charge_id, destination_account_id, wallet_id, percent, percentual_value, fixed_cents, fees, tariff_percent, tariff_fixed_cents, status, asaas_split_id)
                          values ($1, $2, 'w_ensaio', 17, 17, 0, $3::jsonb, 0, 0, 'enviado', $4) returning id`,
                        [ch, raiz.id, JSON.stringify(Object.fromEntries(taxas.map((t) => [t, 1]))), `spl_${tag}_${ch.slice(0, 8)}`])).id;
    return { f, ch, cs, sid: `spl_${tag}_${ch.slice(0, 8)}`, pay: `pay_${tag}_${ch.slice(0, 8)}` };
  }
  // O gatilho da 4018c é adiado (roda no fim da transação). O ensaio nunca grava:
  // "set constraints … immediate" faz o papel do fim da transação do aviso.
  const fimDaTransacao = async () => {
    await c.query("set constraints all immediate");
    await c.query("set constraints all deferred");
  };
  const baixa = async (m) => {
    const r = await um("select public._gateway_on_paid($1, 'PAYMENT_RECEIVED', $2::jsonb) r", [m.ch, JSON.stringify({ id: m.pay, value: 99.9, netValue: 97.91, paymentDate: hoje, creditDate: hoje })]);
    await fimDaTransacao();
    return r;
  };
  async function avisoDoSplit(m, valorReais) {
    const ev = (await um(`insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload)
                          values ($1, $2, 'PAYMENT_SPLIT_DONE', $3::jsonb) returning id`,
      [conta.id, `evt_${m.sid}`, JSON.stringify({ event: "PAYMENT_SPLIT_DONE", additionalInfo: { splitId: m.sid },
        payment: { id: m.pay, externalReference: m.ch, split: [{ id: m.sid, walletId: "w_ensaio", totalValue: valorReais }] } })])).id;
    const r = (await um("select public._gateway_on_split_event($1) r", [ev])).r;
    await fimDaTransacao();
    return r;
  }
  const linhas = (m) => todos(`select sc.id, sc.fee, sc.amount_cents::int a, sc.retained_cents::int r,
      (select f.amount_cents::int from public.financial_entries f where f.source_type = 'split_retained' and f.source_id = sc.id and f.status in ('open','settled')) unidade,
      (select f.status from public.financial_entries f where f.source_type = 'split_retained' and f.source_id = sc.id) st_unidade,
      (select f.amount_cents::int from public.financial_entries f where f.source_type = 'split_retained_revenue' and f.source_id = sc.id and f.status in ('open','settled')) rede,
      (select f.clinic_id from public.financial_entries f where f.source_type = 'split_retained_revenue' and f.source_id = sc.id) clinica_rede
     from public.split_charges sc where sc.source_type = 'ppr_charge' and sc.source_id = $1 and not sc.reversed order by sc.fee`, [m.f]);
  const marca = async (m) => Number((await um("select coalesce(excess_cents, 0)::int x from public.charge_splits where id = $1", [m.cs])).x);
  const aPagar = async (fee) => Number((await um(`select coalesce(sum(amount_cents),0)::int s from public.payables where clinic_id = $1 and network_fee = $2
                                                   and fee_period = date_trunc('month', public.today_br())::date and status <> 'cancelada'`, [ldn, fee])).s);
  const aPagarTodas = async () => { const o = {}; for (const t of taxas) o[t] = await aPagar(t); return o; };
  const aPagarAntes = await aPagarTodas();

  // --- B) a baixa antes do aviso do split ----------------------------------------------
  const B = await mensalidade("b");
  conf("B: a baixa pelo aviso do pagamento", (await baixa(B)).r === "baixa");
  const lB0 = await linhas(B);
  conf("B: as linhas nascem retidas", lB0.length === taxas.length && lB0.every((l) => l.r === l.a && l.a > 0));
  conf("B: o razão já tem a despesa da unidade (em aberto, até o Asaas repassar)", lB0.every((l) => l.unidade === l.r && l.st_unidade === "open"));
  const devido = lB0.reduce((s, l) => s + l.a, 0);
  conf("B: o aviso do split liquidado", (await avisoDoSplit(B, devido / 100)) === "split_liquidado");
  const lB = await linhas(B);
  conf("B: depois do repasse, a despesa da unidade fica liquidada", lB.every((l) => l.unidade === l.r && l.st_unidade === "settled"));
  conf("B: a receita da franqueadora, do mesmo valor, na clínica da franqueadora", lB.every((l) => l.rede === l.r && l.clinica_rede && l.clinica_rede !== ldn));
  conf("B: sem marca de split a mais", (await marca(B)) === 0);

  // --- A) o aviso do split ANTES da baixa ----------------------------------------------
  const A = await mensalidade("a");
  conf("A: o aviso do split chega antes, sem linha ainda", (await avisoDoSplit(A, devido / 100)) === "split_liquidado" && (await linhas(A)).length === 0);
  conf("A: sem linha, nenhuma marca de split a mais", (await marca(A)) === 0);
  conf("A: depois, a baixa", (await baixa(A)).r === "baixa");
  const lA = await linhas(A);
  conf("A: as linhas nascem retidas", lA.length === taxas.length && lA.every((l) => l.r === l.a && l.a > 0));
  conf("A: o razão tem a despesa da unidade, já liquidada", lA.every((l) => l.unidade === l.r && l.st_unidade === "settled"));
  conf("A: e a receita da franqueadora", lA.every((l) => l.rede === l.r && l.clinica_rede && l.clinica_rede !== ldn));
  conf("A: sem marca de split a mais", (await marca(A)) === 0);
  conf("A: nenhum aviso falso de \"split a mais\" durante a baixa", Number((await um("select count(*)::int n from public.gateway_notices where kind = 'repasse_a_maior' and key = $1", [A.cs])).n) === 0);

  // --- o mesmo resultado nas duas ordens --------------------------------------------------
  const resumo = (ls) => JSON.stringify(ls.map((l) => [l.fee, l.a, l.r, l.unidade, l.st_unidade, l.rede]));
  conf("AS DUAS ORDENS DÃO O MESMO RESULTADO (linhas, retido, razão da unidade e da rede)", resumo(lA) === resumo(lB));
  const aPagarDepois = await aPagarTodas();
  conf("nas duas ordens, a taxa retida não vai para a conta a pagar", taxas.every((t) => aPagarDepois[t] === aPagarAntes[t]));

  // --- A com o Asaas repassando MENOS: a falta reduz a retenção (só com a linha presente) ---
  const A2 = await mensalidade("a2");
  const menos = devido - 50;
  await avisoDoSplit(A2, menos / 100);
  await baixa(A2);
  const lA2 = await linhas(A2);
  const retido = lA2.reduce((s, l) => s + l.r, 0);
  if (process.env.DEBUG) console.log({ devido, menos, retido, lA2, cs: await um("select status, settled_cents, excess_cents from public.charge_splits where id = $1", [A2.cs]), ch: await um("select split_absorb_tariff from public.charges where id = $1", [A2.ch]) });
  conf("A com repasse menor: a retenção fica no que o Asaas repassou", retido <= menos && retido >= menos - lA2.length);
  conf("A com repasse menor: a diferença fica \"a cobrar\" da unidade", lA2.reduce((s, l) => s + (l.a - l.r), 0) === devido - retido && devido - retido >= 50);
  conf("A com repasse menor: o razão acompanha a retenção", lA2.every((l) => l.unidade === l.r || (l.r === 0 && l.unidade == null)));

  // --- A com o Asaas repassando MAIS: a marca de split a mais aparece com a linha ----------
  const A3 = await mensalidade("a3");
  await avisoDoSplit(A3, (devido + 500) / 100);
  conf("A com repasse maior: antes da linha, nenhuma marca", (await marca(A3)) === 0);
  await baixa(A3);
  conf("A com repasse maior: com a linha, a marca de R$ 5,00 aparece", (await marca(A3)) === 500);

  console.log(`Ensaio da 4018c — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
  for (const f of falha) console.log(`  FALHOU: ${f}`);
} catch (e) {
  falha.push(`o ensaio parou: ${e.message}`);
  console.log(`Ensaio da 4018c — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
  for (const f of falha) console.log(`  FALHOU: ${f}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
  console.log("Nada ficou gravado (transação desfeita).");
}
process.exitCode = falha.length ? 1 : 0;
