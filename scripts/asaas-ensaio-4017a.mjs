// ENSAIO DA 4017a (a exceção: cancelar venda com acordo de renegociação) no
// banco de TREINO, numa transação DESFEITA (rollback). O Asaas não é chamado.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4017a.mjs --confirmar [--quebrar=pago|autoriza|abertas]
//
// PROVADO QUEBRANDO (19.30.5): `pago` = o acerto deixa de contar o pago no
// acordo; `autoriza` = qualquer um autoriza (até quem pediu); `abertas` = as
// parcelas do acordo não são canceladas. Os três têm de reprovar.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4017a_asa4_excecao_cancelar_venda_com_acordo.sql";
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
const erro = (r, ...k) => typeof r === "string" && k.some((x) => r.includes(x));
const passou = (r) => Array.isArray(r);
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
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
    conf("a 4017a roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4017a roda duas vezes sem erro (${e.message})`, false);
  }
  const trocar = async (assinatura, de, para) => {
    const f = await um(`select pg_get_functiondef('${assinatura}'::regprocedure) d`);
    if (!f.d.includes(de)) throw new Error(`QUEBRA: trecho não achado em ${assinatura}`);
    await c.query(f.d.replace(de, para));
  };
  if (QUEBRAR === "pago") {
    await trocar("public.open_plan_cancellation(uuid, text, text, date, text)", "v_paid := v_paid + v_agr_paid;", "null;");
    console.log("   (QUEBRADO de propósito: o acerto não conta o pago no acordo)");
  } else if (QUEBRAR === "autoriza") {
    await trocar("public.sale_cancel_exception_decide(uuid, boolean, text)", "if e.requested_by = v_user then raise exception 'SELF_APPROVAL'; end if;", "");
    await trocar("public.sale_cancel_exception_decide(uuid, boolean, text)", "if not (public.is_finance_franchisor() or public.is_admin_master()) then raise exception 'NOT_ALLOWED'; end if;", "");
    console.log("   (QUEBRADO de propósito: qualquer um autoriza)");
  } else if (QUEBRAR === "abertas") {
    await trocar("public.apply_plan_cancellation(uuid)", "perform public._sale_agreements_close(v_c.negotiation_id, null, v_c.exception_id, v_user);", "null;");
    await trocar("public.cancel_direct_sale(uuid)", "perform public._sale_agreements_close(null, p_sale_id, v_exc, v_user);", "null;");
    console.log("   (QUEBRADO de propósito: as parcelas do acordo não são canceladas)");
  }

  // --- o cenário ---------------------------------------------------------------
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "recepcao"]) {
    P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
    if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  }
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("financeiro", franq, "finance_franchisor");
  const hoje = iso((await um("select public.today_br() d")).d);
  const futuro = mesesDepois(hoje, 2);

  // Uma venda de plano fechada, com 3 parcelas em aberto sem cobrança viva.
  const vendas = await todos(
    `select cs.negotiation_id, n.clinic_id, n.client_id from public.commercial_sales cs join public.plan_negotiations n on n.id = cs.negotiation_id
      where cs.closed_at is not null and cs.cancelled_at is null and n.status <> 'cancelada'
        and not exists (select 1 from public.plan_cancellations pc where pc.negotiation_id = cs.negotiation_id and pc.status in ('rascunho','assinado'))
        and (select count(*) from public.payment_installments i where i.negotiation_id = cs.negotiation_id and i.status = 'em_aberto'
              and not public._installment_has_active_charge(i.id, false)) >= 3
        and public._sale_open_agreements(cs.negotiation_id, null) = '{}'
      order by cs.closed_at desc limit 2`);
  if (vendas.length < 2) throw new Error("NÃO MEDI: o treino não tem 2 vendas de plano com 3 parcelas livres.");
  const [A, B] = vendas;
  await papel("gerente", A.clinic_id, "unit_manager");
  await papel("recepcao", A.clinic_id, "receptionist");
  const livres = (neg, n) => todos("select id, amount_cents from public.payment_installments where negotiation_id = $1 and status = 'em_aberto' and not public._installment_has_active_charge(id, false) order by due_date, seq limit $2", [neg, n]);
  const acordo = async (quem, clientId, ids, entradas) => {
    const s = await pessoa(quem, "select public.save_renegotiation($1, $2::uuid[], $3::jsonb, 'ensaio 4017a', 0) id", [clientId, ids, JSON.stringify(entradas)]);
    if (!passou(s)) throw new Error(`acordo: ${s}`);
    return s[0].id;
  };
  const assinar = (id) => servidor("select public.renegotiation_apply_signed($1, 'zapsign', null)", [id]);
  const abrir = (neg) => pessoa(P.gerente, "select public.open_plan_cancellation($1, 'ensaio 4017a', 'reevaluation', null, null) id", [neg]);
  const ler = async (quem, neg, ds) => (await pessoa(quem, "select public.sale_agreements_read($1, $2) j", [neg, ds]))?.[0]?.j;

  // --- 1) acordo pendente: cancela o acordo e o cancelamento segue ----------------
  await papel("gerente", B.clinic_id, "unit_manager");
  const pb = await livres(B.negotiation_id, 1);
  const rb = await acordo(P.gerente, B.client_id, [pb[0].id], [{ kind: "parcela", due_date: futuro, amount_cents: Number(pb[0].amount_cents), payment_method: "pix" }]);
  conf("acordo pendente: o cancelamento da venda é recusado", erro(await abrir(B.negotiation_id), "RENEGOTIATED_OPEN"));
  conf("acordo pendente: o pedido de exceção é recusado (cancele o acordo antes)", erro(await pessoa(P.gerente, "select public.sale_cancel_exception_request($1, null, 'ensaio pendente')", [B.negotiation_id]), "PENDING_FIRST"));
  conf("o acordo pendente é cancelado sem a franqueadora", passou(await pessoa(P.gerente, "select public.renegotiation_cancel_pending($1, 'cancelar a venda')", [rb])));
  const abB = await abrir(B.negotiation_id);
  conf("…e o cancelamento da venda segue normal", passou(abB));
  if (passou(abB)) await c.query("delete from public.plan_cancellations where id = $1", [abB[0].id]);
  await papel("gerente", A.clinic_id, "unit_manager");

  // --- 2) acordo assinado, de uma venda: pedir, autorizar, cancelar ----------------
  const pa = await livres(A.negotiation_id, 2);
  const total = pa.reduce((s, x) => s + Number(x.amount_cents), 0);
  const metade = Math.floor(total / 2);
  const ra = await acordo(P.gerente, A.client_id, pa.map((x) => x.id), [
    { kind: "parcela", due_date: futuro, amount_cents: metade, payment_method: "pix" },
    { kind: "parcela", due_date: mesesDepois(futuro, 1), amount_cents: total - metade, payment_method: "pix" },
  ]);
  conf("acordo assinado (cenário)", passou(await assinar(ra)));
  const novas = await todos("select id, amount_cents from public.payment_installments where renegotiation_id = $1 order by seq", [ra]);
  const pagoNoAcordo = 1000;
  conf("o cliente paga uma parte no acordo (cenário)", passou(await pessoa(P.recepcao, "select public.register_payment_receipt(p_installment_id => $1, p_amount_cents => $2, p_received_at => current_date, p_payment_method => 'pix', p_client_token => gen_random_uuid())", [novas[0].id, pagoNoAcordo])));
  const taxaAntes = Number((await um("select coalesce(sum(s.amount_cents), 0) n from public.split_charges s join public.payment_receipts r on r.id = s.receipt_id where r.installment_id = any($1) and not s.reversed", [novas.map((x) => x.id)])).n);
  conf("acordo assinado em aberto: o cancelamento é recusado", erro(await abrir(A.negotiation_id), "RENEGOTIATED_OPEN"));
  const lr = await ler(P.recepcao, A.negotiation_id, null);
  conf("a Recepção vê o acordo (aberto e pago), sem poder pedir", lr && lr.pode_pedir === false && lr.acordos.length === 1 && lr.acordos[0].pago === pagoNoAcordo && lr.acordos[0].aberto > 0 && !lr.acordos[0].pendente);
  conf("a Recepção não pede a exceção (3b)", erro(await pessoa(P.recepcao, "select public.sale_cancel_exception_request($1, null, 'ensaio recepção')", [A.negotiation_id]), "NOT_ALLOWED"));
  conf("o Financeiro não pede a exceção (3b)", erro(await pessoa(P.financeiro, "select public.sale_cancel_exception_request($1, null, 'ensaio financeiro')", [A.negotiation_id]), "NOT_ALLOWED"));
  const pedido = await pessoa(P.gerente, "select public.sale_cancel_exception_request($1, null, 'paciente mudou de cidade') id", [A.negotiation_id]);
  conf("o Gerente pede a exceção", passou(pedido));
  const eid = passou(pedido) ? pedido[0].id : null;
  conf("o Financeiro da Franqueadora é avisado do pedido", (await um("select count(*)::int n from public.notifications where user_id = $1 and title like 'Pedido de exceção: cancelar venda com acordo%'", [P.financeiro])).n >= 1);
  conf("o Financeiro vê o pedido na fila (a rede)", ((await pessoa(P.financeiro, "select public.sale_cancel_exceptions_read() j"))?.[0]?.j ?? []).some((x) => x.id === eid && x.pode_decidir));
  conf("pedido repetido: recusado", erro(await pessoa(P.gerente, "select public.sale_cancel_exception_request($1, null, 'de novo, ensaio')", [A.negotiation_id]), "ALREADY_REQUESTED"));
  conf("o Gerente não autoriza", erro(await pessoa(P.gerente, "select public.sale_cancel_exception_decide($1, true, 'ok')", [eid]), "NOT_ALLOWED", "SELF_APPROVAL"));
  await c.query("update public.sale_cancel_exceptions set requested_by = $2 where id = $1", [eid, P.admin]);
  conf("quem pediu não autoriza, nem o Admin Master (SELF_APPROVAL)", erro(await pessoa(P.admin, "select public.sale_cancel_exception_decide($1, true, 'ok')", [eid]), "SELF_APPROVAL"));
  conf("…e o Financeiro autoriza o pedido do Admin", passou(await pessoa(P.financeiro, "select public.sale_cancel_exception_decide($1, true, 'pode seguir')", [eid])));
  const ex = await um("select * from public.sale_cancel_exceptions where id = $1", [eid]);
  conf("a autorização vale 7 dias", ex.status === "autorizada" && iso(ex.valid_until) === iso(new Date(Date.parse(hoje) + 7 * 86400000)));
  conf("quem pediu é avisado da decisão", (await um("select count(*)::int n from public.notifications where user_id = $1 and title like 'Exceção autorizada%'", [P.admin])).n >= 1);

  // o termo de cancelamento: o pago no acordo entra no acerto
  const pagoVenda = Number((await um("select coalesce(sum(r.amount_cents) filter (where not r.reversed and r.reversal_of is null), 0) n from public.payment_receipts r join public.payment_installments i on i.id = r.installment_id where i.negotiation_id = $1", [A.negotiation_id])).n);
  const ab = await abrir(A.negotiation_id);
  conf("com a exceção, o termo de cancelamento abre", passou(ab));
  const pc = passou(ab) ? await um("select * from public.plan_cancellations where id = $1", [ab[0].id]) : null;
  conf("o acerto conta o pago no acordo (pago da venda + pago no acordo)", pc && Number(pc.agreement_paid_cents) === pagoNoAcordo && Number(pc.paid_cents) === pagoVenda + pagoNoAcordo);
  conf("o termo guarda a exceção usada", pc && pc.exception_id === eid);
  if (pc) {
    await c.query("update public.plan_cancellations set status = 'assinado', term_signed_at = now() where id = $1", [pc.id]);
    const ap = await pessoa(P.gerente, "select public.apply_plan_cancellation($1)", [pc.id]);
    conf("efetivar com a exceção: passa", passou(ap));
    if (!passou(ap)) console.log("   efetivar:", ap);
    conf("as parcelas do acordo em aberto são canceladas", (await um("select count(*)::int n from public.payment_installments where renegotiation_id = $1 and status in ('em_aberto','parcial')", [ra])).n === 0);
    conf("o acordo fica encerrado pelo cancelamento da venda", (await um("select status from public.payment_renegotiations where id = $1", [ra])).status === "encerrada");
    conf("a exceção fica usada (uma vez só)", (await um("select status from public.sale_cancel_exceptions where id = $1", [eid])).status === "usada");
    const taxaDepois = Number((await um("select coalesce(sum(s.amount_cents), 0) n from public.split_charges s join public.payment_receipts r on r.id = s.receipt_id where r.installment_id = any($1) and not s.reversed", [novas.map((x) => x.id)])).n);
    conf("a taxa da rede sobre o pago no acordo continua devida", taxaAntes === taxaDepois);
  }

  // --- 3) a autorização vence, vale uma vez e cai se o acordo mudar ------------------
  await papel("gerente", B.clinic_id, "unit_manager");
  await papel("recepcao", B.clinic_id, "receptionist");
  const pb2 = await livres(B.negotiation_id, 1);
  const rb2 = await acordo(P.gerente, B.client_id, [pb2[0].id], [
    { kind: "parcela", due_date: futuro, amount_cents: Math.floor(Number(pb2[0].amount_cents) / 2), payment_method: "pix" },
    { kind: "parcela", due_date: mesesDepois(futuro, 1), amount_cents: Number(pb2[0].amount_cents) - Math.floor(Number(pb2[0].amount_cents) / 2), payment_method: "pix" },
  ]);
  await assinar(rb2);
  const e2 = (await pessoa(P.gerente, "select public.sale_cancel_exception_request($1, null, 'ensaio do prazo') id", [B.negotiation_id]))?.[0]?.id;
  await pessoa(P.financeiro, "select public.sale_cancel_exception_decide($1, true, 'ok')", [e2]);
  await c.query("update public.sale_cancel_exceptions set valid_until = public.today_br() - 1 where id = $1", [e2]);
  conf("a autorização vencida (7 dias) não vale", erro(await abrir(B.negotiation_id), "RENEGOTIATED_OPEN"));
  await c.query("update public.sale_cancel_exceptions set valid_until = public.today_br() + 7 where id = $1", [e2]);
  conf("…no prazo, vale", (await um("select public._sale_cancel_exception_valid($1, null) id", [B.negotiation_id])).id === e2);
  const nb = await um("select id from public.payment_installments where renegotiation_id = $1 order by seq limit 1", [rb2]);
  await pessoa(P.recepcao, "select public.register_payment_receipt(p_installment_id => $1, p_amount_cents => 500, p_received_at => current_date, p_payment_method => 'pix', p_client_token => gen_random_uuid())", [nb.id]);
  conf("o acordo mudou depois da autorização (um pagamento): ela cai", (await um("select public._sale_cancel_exception_valid($1, null) id", [B.negotiation_id])).id === null);
  conf("…e o cancelamento volta a ser recusado", erro(await abrir(B.negotiation_id), "RENEGOTIATED_OPEN"));
  conf("…e a tela mostra que caiu", (await ler(P.gerente, B.negotiation_id, null))?.excecao?.situacao === "caiu");

  // --- 4) a venda direta: só sem pago no acordo; e o acordo de várias vendas ------------
  const cli = await um("select id, clinic_id, full_name from public.clients where id = $1", [A.client_id]);
  await papel("gerente", cli.clinic_id, "unit_manager");
  await papel("recepcao", cli.clinic_id, "receptionist");
  const novaDireta = async () => {
    const v = (await um("insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, created_by) values ($1, $2, $3, 20000, 'pix', 2, $4) returning id", [cli.clinic_id, cli.id, cli.full_name, P.recepcao])).id;
    const s = await pessoa(P.recepcao, "select public.save_payment_schedule(null, $1, $2::jsonb)", [v, JSON.stringify([
      { kind: "parcela", due_date: futuro, amount_cents: 10000, payment_method: "dinheiro" },
      { kind: "parcela", due_date: mesesDepois(futuro, 1), amount_cents: 10000, payment_method: "dinheiro" }])]);
    if (!passou(s)) throw new Error(`venda direta: ${s}`);
    await c.query("update public.direct_sales set contract_signed = true where id = $1", [v]);
    return v;
  };
  const parcelasDa = (v) => todos("select id, amount_cents from public.payment_installments where direct_sale_id = $1 and status = 'em_aberto' order by due_date", [v]);
  const d1 = await novaDireta();
  const [x1] = await parcelasDa(d1);
  const rd1 = await acordo(P.gerente, cli.id, [x1.id], [{ kind: "parcela", due_date: mesesDepois(futuro, 2), amount_cents: 10000, payment_method: "dinheiro" }]);
  await assinar(rd1);
  const ed = await pessoa(P.gerente, "select public.sale_cancel_exception_request(null, $1, 'venda direta desistida') id", [d1]);
  conf("venda direta sem pago no acordo: o Gerente pede", passou(ed));
  if (passou(ed)) await pessoa(P.financeiro, "select public.sale_cancel_exception_decide($1, true, 'ok')", [ed[0].id]);
  conf("…autorizada, a venda direta é cancelada", passou(await pessoa(P.gerente, "select public.cancel_direct_sale($1)", [d1])));
  conf("…e as parcelas do acordo dela são canceladas", (await um("select count(*)::int n from public.payment_installments where renegotiation_id = $1 and status = 'em_aberto'", [rd1])).n === 0);
  const d2 = await novaDireta();
  const [x2] = await parcelasDa(d2);
  const rd2 = await acordo(P.gerente, cli.id, [x2.id], [
    { kind: "parcela", due_date: mesesDepois(futuro, 2), amount_cents: 5000, payment_method: "dinheiro" },
    { kind: "parcela", due_date: mesesDepois(futuro, 3), amount_cents: 5000, payment_method: "dinheiro" }]);
  await assinar(rd2);
  const n2 = await um("select id from public.payment_installments where renegotiation_id = $1 order by seq limit 1", [rd2]);
  await pessoa(P.recepcao, "select public.register_payment_receipt(p_installment_id => $1, p_amount_cents => 5000, p_received_at => current_date, p_payment_method => 'dinheiro', p_client_token => gen_random_uuid())", [n2.id]);
  conf("venda direta com pago no acordo: recusado (fica para o distrato)", erro(await pessoa(P.gerente, "select public.sale_cancel_exception_request(null, $1, 'venda direta com pago')", [d2]), "DIRECT_SALE_PAID"));
  const d3 = await novaDireta();
  const d4 = await novaDireta();
  const [x3] = await parcelasDa(d3);
  const [x4] = await parcelasDa(d4);
  const rd3 = await acordo(P.gerente, cli.id, [x3.id, x4.id], [{ kind: "parcela", due_date: mesesDepois(futuro, 2), amount_cents: 20000, payment_method: "dinheiro" }]);
  await assinar(rd3);
  conf("acordo que junta duas vendas: sem exceção (MULTI_SALE)", erro(await pessoa(P.gerente, "select public.sale_cancel_exception_request(null, $1, 'acordo de duas vendas')", [d3]), "MULTI_SALE"));
  conf("…e a tela mostra que o acordo junta outras vendas", (await ler(P.gerente, null, d3))?.acordos?.[0]?.multi_venda === true);

  await c.query("rollback");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
for (const n of ok) console.log("  ok  ", n);
for (const n of falha) console.log("  FALHA", n);
console.log(`\n${ok.length}/${ok.length + falha.length}${QUEBRAR ? ` (quebrado: ${QUEBRAR})` : ""}`);
if (falha.length) process.exitCode = 1;
