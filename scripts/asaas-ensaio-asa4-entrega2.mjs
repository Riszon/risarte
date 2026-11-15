// ENSAIO DA 4013 (ASA4, entrega 2 — cartão parcelado pelo Asaas) no banco de
// TREINO, numa transação DESFEITA (rollback): nada fica gravado e o Asaas não é
// chamado (a emissão é do servidor; aqui se prova o banco — o bloco, as portas, a
// baixa de cada parcela, a taxa "a reter pelo split" e o estorno inteiro).
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa4-entrega2.mjs --confirmar [--quebrar=bloco|parcela|areter]
//
// PROVADO QUEBRANDO: `--quebrar=bloco` desliga a conferência do bloco (valores e
// datas fora do que o Asaas faz passariam); `--quebrar=parcela` deixa a parcela
// do bloco virar cobrança sozinha; `--quebrar=areter` faz a taxa a reter pelo
// split sumir do apurado. Os três têm de reprovar o ensaio.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4013_asa4_cartao_parcelado_pelo_asaas.sql";
const QUEBRAR = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, valor) => (valor ? ok : falha).push(nome);
const um = async (sql, params = []) => {
  try {
    return (await c.query(sql, params)).rows[0];
  } catch (err) {
    throw new Error(`${err.message} ← ${sql.slice(0, 90)}`);
  }
};
const todos = async (sql, params = []) => (await c.query(sql, params)).rows;
async function como(userId) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await c.query("set local role authenticated");
}
async function comoServidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}
async function pessoa(userId, sql, params = []) {
  await como(userId);
  await c.query("savepoint p");
  try {
    const r = (await c.query(sql, params)).rows;
    await c.query("release savepoint p");
    await comoServidor();
    return r;
  } catch (e) {
    await c.query("rollback to savepoint p");
    await comoServidor();
    return `erro: ${e.message}`;
  }
}
async function servidor(sql, params = []) {
  await c.query("savepoint s");
  try {
    const r = (await c.query(sql, params)).rows;
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    return `erro: ${e.message}`;
  }
}
const erro = (r, codigo) => typeof r === "string" && r.includes(codigo);
const passou = (r) => Array.isArray(r);
const iso = (d) => d.toISOString().slice(0, 10);
const mesesDepois = (s, k) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + k, d)));
};

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query("savepoint dup");
  try {
    await c.query(sql);
    await c.query("release savepoint dup");
    conf("a 4013 roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4013 roda duas vezes sem erro (${e.message})`, false);
  }
  // As migrações seguintes redefinem parte desta: o ensaio roda por cima delas,
  // como o banco está de verdade (rodar só esta de novo deixaria as funções antigas).
  for (const depois of ["4014_asa4_parcelado_devolucao_contestacao_e_avisos.sql", "4015_asa4_forma2_todos_os_boletos_agora.sql", "4015a_asa4_recusa_cancelar_venda_com_acordo_aberto.sql", "4017_asa4_renegociacao_assinada.sql"]) await c.query(readFileSync(`supabase/migrations/${depois}`, "utf8"));
  if (QUEBRAR === "bloco") {
    await c.query("create or replace function public._card_block_check(p_negotiation_id uuid, p_direct_sale_id uuid) returns void language plpgsql stable security definer set search_path = '' as $$ begin return; end; $$");
    console.log("   (QUEBRADO de propósito: o bloco não é conferido)");
  } else if (QUEBRAR === "parcela") {
    await c.query("drop trigger if exists charges_card_block_rule on public.charges");
    console.log("   (QUEBRADO de propósito: a parcela do bloco vira cobrança sozinha)");
  } else if (QUEBRAR === "areter") {
    await c.query("create or replace function public._split_charge_awaiting(p_split_charge_id uuid) returns boolean language sql stable security definer set search_path = '' as $$ select false $$");
    console.log("   (QUEBRADO de propósito: a taxa a reter some do apurado)");
  }

  // --- o cenário -------------------------------------------------------------
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "recepcao"]) {
    P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
    if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  }
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("gerente", ldn, "unit_manager");
  await papel("recepcao", ldn, "receptionist");
  await papel("financeiro", franq, "finance_franchisor");
  if (!(await um("select public.central_is_ready($1) as x", [ldn])).x) throw new Error("NÃO MEDI: Londrina não está pronta na Central (treino).");
  const cli = await um(
    `select c.id, c.full_name from public.clients c
      where c.clinic_id = $1 and public._cpf_ok(c.cpf) and c.birth_date < current_date - interval '19 years'
        and not exists (select 1 from public.client_guardians g where g.client_id = c.id and g.is_financial)
      order by c.created_at limit 1`, [ldn]);
  if (!cli) throw new Error("NÃO MEDI: nenhum cliente de Londrina com CPF válido.");
  const raiz = await um("select id, wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' and wallet_id is not null order by created_at limit 1");
  const taxas = (await todos("select key from public.network_fee_types where kind = 'percent' and active")).map((r) => r.key);

  // O 1º vencimento: daqui a 5 dias, até o dia 28.
  let primeiro = iso(new Date(Date.now() + 5 * 86400000));
  if (Number(primeiro.slice(8, 10)) > 28) primeiro = primeiro.slice(0, 8) + "05";
  const linha = (k, v, m = "cartao_parcelado_asaas", dd = null) => ({ kind: "parcela", due_date: dd ?? mesesDepois(primeiro, k), amount_cents: v, payment_method: m });
  const novaVenda = async (total) =>
    (await um("insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, created_by) values ($1, $2, $3, $4, 'cartao_parcelado_asaas', 3, $5) returning id", [ldn, cli.id, cli.full_name, total, P.recepcao])).id;
  const salvar = (venda, linhas) => pessoa(P.recepcao, "select public.save_payment_schedule(null, $1, $2::jsonb)", [venda, JSON.stringify(linhas)]);

  // --- 1) o bloco como o Asaas faz ---------------------------------------------
  const v1 = await novaVenda(30001);
  conf("3× de R$ 300,01 com a sobra na ÚLTIMA: aceito", passou(await salvar(v1, [linha(0, 10000), linha(1, 10000), linha(2, 10001)])));
  const proj = await todos("select due_date, expected_settlement_date from public.payment_installments where direct_sale_id = $1 order by seq", [v1]);
  conf("a previsão de crédito: cerca de 30 dias depois de cada vencimento", proj.length === 3 && proj.every((r) => (new Date(r.expected_settlement_date) - new Date(r.due_date)) / 86400000 === 30));
  const v2 = await novaVenda(30001);
  conf("a sobra na PRIMEIRA é recusada (não é o que o Asaas faz)", erro(await salvar(v2, [linha(0, 10001), linha(1, 10000), linha(2, 10000)]), "PARCELADO_ASAAS_VALORES"));
  conf("datas fora do mês a mês são recusadas", erro(await salvar(v2, [linha(0, 10000), linha(1, 10000, undefined, mesesDepois(primeiro, 1).slice(0, 8) + "28"), linha(2, 10001)]), "PARCELADO_ASAAS_DATAS"));
  const v3 = await novaVenda(10000);
  conf("uma parcela só no parcelado é recusada", erro(await salvar(v3, [linha(0, 10000)]), "PARCELADO_ASAAS_MIN_2"));
  const v4 = await novaVenda(40001);
  conf("entrada em Pix + 3× no cartão pelo Asaas: aceito (só o cartão forma o bloco)",
    passou(await salvar(v4, [{ kind: "entrada", due_date: iso(new Date(Date.now() + 86400000)), amount_cents: 10000, payment_method: "pix" }, linha(0, 10000), linha(1, 10000), linha(2, 10001)])));

  // --- 2) a parcela do bloco não vira cobrança sozinha; sem baixa à mão ---------
  await c.query("update public.direct_sales set contract_signed = true where id = $1", [v1]);
  const p1 = await um("select id from public.payment_installments where direct_sale_id = $1 order by seq limit 1", [v1]);
  conf("a emissão por parcela recusa a parcela do bloco", erro(await pessoa(P.admin, "select public.charge_prepare($1, 'CREDIT_CARD', null)", [p1.id]), "USE_O_PARCELAMENTO"));
  conf("a baixa à mão na parcela do bloco é recusada",
    erro(await pessoa(P.admin, "select public.register_payment_receipt($1, 10000, current_date, 'cartao_parcelado', null, null)", [p1.id]), "PARCELADO_ASAAS_SO_PELO_ASAAS") ||
    erro(await servidor("insert into public.payment_receipts (clinic_id, client_id, installment_id, amount_cents, received_at, payment_method) values ($1, $2, $3, 10000, current_date, 'cartao_parcelado')", [ldn, cli.id, p1.id]), "PARCELADO_ASAAS_SO_PELO_ASAAS"));

  // --- 3) nasce inteiro na assinatura (a marca da entrega 1) ---------------------
  await c.query("insert into public.gateway_auto_charge_units (clinic_id, enabled, enabled_from) values ($1, true, now() - interval '1 minute') on conflict (clinic_id) do update set enabled = true, enabled_from = now() - interval '1 minute'", [ldn]);
  await c.query("update public.direct_sales set contract_signed = false where id = $1", [v1]);
  await c.query("update public.direct_sales set contract_signed = true where id = $1", [v1]);
  const due = await todos("select * from public._card_blocks_due(null, null, $1, 10)", [v1]);
  conf("a venda assinada entra na lista do parcelamento, inteira e sem prazo", due.length === 1 && due[0].parcelas === 3 && Number(due[0].total_cents) === 30001);
  conf("a lista por parcela (prazo) NÃO pega a parcela do bloco", (await todos("select * from public._auto_charge_due(null, null, $1, 50)", [v1])).length === 0);
  const blocoR = await servidor("select public._card_block_prepare_system(null, $1, 'venda_direta') as b", [v1]);
  const bloco = passou(blocoR) ? blocoR[0].b : null;
  const cs = bloco ? await todos("select id, installment_number n, installment_count t, value_cents, discount_cents, billing_type, status, due_date from public.charges where installment_block = $1 order by installment_number", [bloco]) : [];
  conf("3 cobranças, uma por parcela, no mesmo bloco, numeradas 1 a 3", cs.length === 3 && cs.every((x, k) => x.n === k + 1 && x.t === 3 && x.billing_type === "CREDIT_CARD" && x.status === "emitindo"));
  conf("o valor de cada uma é o da parcela, sem desconto (o cartão não tem)", cs.map((x) => Number(x.value_cents)).join() === "10000,10000,10001" && cs.every((x) => Number(x.discount_cents) === 0));
  conf("rodar de novo não cria outro parcelamento", erro(await servidor("select public._card_block_prepare_system(null, $1, 'venda_direta')", [v1]), "NOT_DUE"));
  // À mão: a mesma permissão da emissão por parcela (4004: Gerente e Recepção da unidade).
  conf("à mão, sem o contrato assinado, o parcelamento não nasce", erro(await pessoa(P.recepcao, "select public.charge_block_prepare(null, $1)", [v4]), "CONTRACT_NOT_SIGNED"));

  // --- 4) as portas por parcela recusam ------------------------------------------
  conf("cancelar UMA parcela é recusado (só o parcelamento inteiro)", erro(await pessoa(P.admin, "select * from public.charge_cancel_check($1, 'cancel')", [cs[0].id]), "USE_O_PARCELAMENTO"));
  conf("cancelar o parcelamento não pago: a porta do bloco aceita", passou(await pessoa(P.gerente, "select * from public.card_block_cancel_check($1, 'motivo do ensaio')", [bloco])));
  conf("a Recepção não cancela o parcelamento (Gerente, Financeiro ou Admin)", erro(await pessoa(P.recepcao, "select * from public.card_block_cancel_check($1, 'motivo do ensaio')", [bloco]), "NOT_ALLOWED"));

  // --- 5) a emissão (como o servidor grava) e o split por parcela ---------------
  for (const [k, x] of cs.entries()) {
    await um("select public._charge_mark_issued($1, $2, null, $3, null, null, null)", [x.id, `pay_ensaio_${k + 1}`, `https://sandbox.asaas.com/i/ensaio${k + 1}`]);
    await um("select public._charge_save_split($1, $2::jsonb)", [x.id, JSON.stringify([{ accountId: raiz.id, walletId: raiz.wallet_id, percent: 17, percentualValue: 17.4341, fixedCents: 2, fees: Object.fromEntries(taxas.map((t) => [t, 17 / taxas.length])), tariffPercent: 2.49, tariffFixedCents: 16, asaasSplitId: `split_ensaio_${k + 1}` }])]);
  }
  await um("select public._card_block_save_installment($1, 'inst_ensaio')", [bloco]);
  const resumo = (await um("select public._card_block_summary(null, $1) r", [v1])).r;
  conf("as Cobranças da venda mostram o parcelamento aguardando, com o link da 1ª", resumo?.situacao === "aguardando" && resumo?.link === "https://sandbox.asaas.com/i/ensaio1" && resumo?.pode_cancelar === true);

  // --- 6) a baixa: cada parcela no seu aviso, como cartão parcelado --------------
  const credito = (k) => mesesDepois(primeiro, k + 1);
  for (const [k, x] of cs.entries()) {
    const pay = { id: `pay_ensaio_${k + 1}`, value: Number(x.value_cents) / 100, netValue: (Number(x.value_cents) - (k === 2 ? 265 : 265)) / 100, confirmedDate: iso(new Date()), estimatedCreditDate: credito(k) };
    await um("select public._gateway_on_paid($1, 'PAYMENT_CONFIRMED', $2::jsonb)", [x.id, JSON.stringify(pay)]);
  }
  const rec = await todos(
    `select r.payment_method, r.acquirer_modality, r.settlement_date, r.acquirer_fee_cents, ch.status from public.charges ch join public.payment_receipts r on r.id = ch.receipt_id
      where ch.installment_block = $1 order by ch.installment_number`, [bloco]);
  conf("as 3 parcelas com baixa, como cartão parcelado, com a tarifa do parcelado", rec.length === 3 && rec.every((r) => r.payment_method === "cartao_parcelado" && r.acquirer_modality === "credito_parcelado" && r.status === "paga"));
  conf("a data de crédito de cada uma vem do Asaas (mês a mês)", rec.every((r, k) => iso(new Date(r.settlement_date)) === credito(k)));
  conf("a 1ª baixa fechou a venda", Boolean((await um("select closed_at from public.direct_sales where id = $1", [v1])).closed_at));
  conf("o mesmo aviso de novo não muda nada", (await um("select public._gateway_on_paid($1, 'PAYMENT_CONFIRMED', $2::jsonb) r", [cs[0].id, JSON.stringify({ id: "pay_ensaio_1", value: 100, netValue: 97.35 })])).r === "ja_baixada");

  // --- 7) a taxa: a reter pelo split, nunca conta a pagar, nunca em dobro --------
  const sc = await todos("select sc.id, sc.amount_cents, sc.retained_cents, public._split_charge_awaiting(sc.id) a from public.split_charges sc join public.charges ch on ch.receipt_id = sc.receipt_id where ch.installment_block = $1", [bloco]);
  const devida = sc.reduce((s, r) => s + Number(r.amount_cents), 0);
  conf("uma linha de taxa por parcela e por taxa (sem duplicar)", sc.length === 3 * taxas.length);
  conf("a taxa das parcelas a creditar nasce retida e A RETER pelo split", sc.length > 0 && sc.every((r) => Number(r.retained_cents) === Number(r.amount_cents) && r.a === true));
  const hoje = new Date();
  const apurado = async () => (await todos("select coalesce(sum(retained_cents),0)::bigint ret, coalesce(sum(awaiting_cents),0)::bigint ar from public.network_fee_summary($1, $2, $3)", [ldn, hoje.getUTCFullYear(), hoje.getUTCMonth() + 1]))[0];
  await como(P.admin);
  const ap1 = await apurado();
  await comoServidor();
  conf("o apurado do mês mostra o valor a reter pelo split", Number(ap1.ar) >= devida);
  // O 1º crédito: o Asaas liquida o split da parcela 1.
  await c.query("update public.charge_splits set status = 'liquidado', settled_cents = 1743, settled_at = now() where charge_id = $1", [cs[0].id]);
  const sc2 = await todos("select public._split_charge_awaiting(sc.id) a, ch.installment_number n from public.split_charges sc join public.charges ch on ch.receipt_id = sc.receipt_id where ch.installment_block = $1", [bloco]);
  conf("o 1º crédito: a parcela 1 vira retida; as outras continuam a reter", sc2.filter((r) => r.n === 1).every((r) => !r.a) && sc2.filter((r) => r.n > 1).every((r) => r.a));

  // --- 8) o estorno inteiro mostra antes o que a unidade perde -----------------
  conf("cancelar o parcelamento pago é recusado (use o estorno)", erro(await pessoa(P.gerente, "select * from public.card_block_cancel_check($1, 'motivo do ensaio')", [bloco]), "PARCELADO_ASAAS_PAGO_USE_ESTORNO"));
  conf("estornar UMA parcela é recusado", erro(await pessoa(P.admin, "select * from public.charge_refund_check($1, 'motivo do ensaio')", [cs[0].id]), "USE_O_PARCELAMENTO"));
  const previa = await pessoa(P.admin, "select public.card_block_refund_preview($1) p", [bloco]);
  const pv = passou(previa) ? previa[0].p : null;
  conf("a prévia: valor devolvido, tarifa que não volta e taxa devida sobre o valor inteiro",
    pv && Number(pv.devolvido_cents) === 30001 && Number(pv.tarifa_que_nao_volta_cents) === 795 && Number(pv.taxa_devida_cents) === devida && pv.estornavel === true);
  conf("a porta do estorno inteiro aceita quem pode estornar", passou(await pessoa(P.admin, "select * from public.card_block_refund_check($1, 'motivo do ensaio')", [bloco])));
  conf("a Recepção não vê a prévia do estorno", erro(await pessoa(P.recepcao, "select public.card_block_refund_preview($1)", [bloco]), "NOT_ALLOWED"));

  // --- 9) o custo no fechamento ---------------------------------------------------
  const tab = await pessoa(P.recepcao, "select public.card_block_fee_table($1) t", [ldn]);
  conf("a tabela do custo: as faixas do parcelado da unidade e os 17% da rede", passou(tab) && tab[0].t.faixas.length >= 3 && Number(tab[0].t.rede_percent) > 0);

  // --- 10) as portas internas estão fechadas -----------------------------------
  const internas = ["_card_block_rows", "_card_block_check", "_card_block_project", "_settlement_projection_base", "_card_blocks_due", "_card_block_insert", "_card_block_prepare_system", "_card_block_mark_error", "_card_block_save_installment", "_split_charge_awaiting", "_card_block_summary", "_card_block_has_charge"];
  let fechadas = 0;
  for (const f of internas) {
    const r = await um("select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [f]);
    if (r.x === false) fechadas++;
  }
  conf("as funções internas estão fechadas para quem está logado", fechadas === internas.length);
} catch (e) {
  falha.push(`o ensaio parou: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nEnsaio da 4013 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log("  FALHOU:", f);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
