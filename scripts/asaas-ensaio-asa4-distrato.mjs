// ENSAIO DA 4020 (o distrato com checklist) no banco de TREINO, numa transação
// DESFEITA (rollback). O Asaas não é chamado.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa4-distrato.mjs --confirmar [--quebrar=antes|proporcao|taxa|pontos|parcial]
//
// PROVADO QUEBRANDO (19.35.12):
//   `antes`     = efetiva sem a checklist concluída;
//   `proporcao` = o acordo de várias vendas sem a proporção (a parte da venda vira 100%);
//   `taxa`      = a taxa da rede some no distrato (as linhas viram estornadas);
//   `pontos`    = o estorno da mensalidade do PPR+ deixa os pontos do Riso+ Social;
//   `parcial`   = a parcela parcial não cai.
// Cada um tem de reprovar.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4020_asa4_distrato_com_checklist.sql";
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
const DEBUG = process.env.ENSAIO_DEBUG === "1";
const erro = (r, ...k) => {
  const v = typeof r === "string" && k.some((x) => r.includes(x));
  if (DEBUG && !v) console.log("   [debug erro esperado", k.join("|"), "→", typeof r === "string" ? r : JSON.stringify(r).slice(0, 200), "]");
  return v;
};
const passou = (r) => {
  if (DEBUG && !Array.isArray(r)) console.log("   [debug falhou →", r, "]");
  return Array.isArray(r);
};
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const mesesDepois = (s, k) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + k, d)));
};
const n = (x) => Number(x ?? 0);

try {
  await c.query("begin");
  await c.query("update public.charges set auto_origin = null where auto_origin not in ('assinatura', 'venda_direta', 'rotina', 'rodar_agora', 'restante')");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query("savepoint dup");
  try {
    await c.query(sql);
    await c.query("release savepoint dup");
    conf("a 4020 roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4020 roda duas vezes sem erro (${e.message})`, false);
  }
  const trocar = async (assinatura, de, para) => {
    const f = await um(`select pg_get_functiondef('${assinatura}'::regprocedure) d`);
    if (!f.d.includes(de)) throw new Error(`QUEBRA: trecho não achado em ${assinatura}`);
    await c.query(f.d.replace(de, para));
  };
  if (QUEBRAR === "antes") {
    await trocar("public._distrato_ready(uuid)", "if v_n < 8 then raise exception 'CHECKLIST_INCOMPLETE: %', 8 - v_n; end if;", "null;");
    console.log("   (QUEBRADO de propósito: efetiva sem a checklist)");
  } else if (QUEBRAR === "proporcao") {
    await trocar("public._distrato_share(uuid, uuid, uuid, integer)", "return least(1, v_part / v_total);", "return 1;");
    console.log("   (QUEBRADO de propósito: a parte da venda vira 100%)");
  } else if (QUEBRAR === "taxa") {
    await trocar("public._apply_direct_sale_distrato(uuid, uuid)", "  perform public._distrato_apply_agreements(p_id, null, v_c.direct_sale_id, p_user);",
      "  perform public._distrato_apply_agreements(p_id, null, v_c.direct_sale_id, p_user);\n  update public.split_charges sc set reversed = true from public.payment_receipts r join public.payment_installments i on i.id = r.installment_id where sc.receipt_id = r.id and i.direct_sale_id = v_c.direct_sale_id;");
    console.log("   (QUEBRADO de propósito: a taxa some no distrato)");
  } else if (QUEBRAR === "pontos") {
    await trocar("public._gateway_apply_event(bigint)", "      if c.source_type = 'ppr_charge' then\n        delete from public.ppr_social_points sp", "      if false then\n        delete from public.ppr_social_points sp");
    console.log("   (QUEBRADO de propósito: o estorno deixa os pontos)");
  } else if (QUEBRAR === "parcial") {
    await trocar("public.apply_plan_cancellation(uuid)", "(status = 'em_aberto' or (v_c.checklist_required and status = 'parcial'))", "status = 'em_aberto'");
    console.log("   (QUEBRADO de propósito: a parcial não cai)");
  }

  // --- o cenário ---------------------------------------------------------------
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "recepcao", "consultor"]) {
    P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
  }
  for (const k of ["admin", "gerente", "financeiro", "recepcao"]) if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const papel = async (k, clinic, role) => {
    if (!P[k]) return;
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("financeiro", franq, "finance_franchisor");
  const hoje = iso((await um("select public.today_br() d")).d);
  const futuro = mesesDepois(hoje, 2);
  const vendas = await todos(
    `select cs.negotiation_id, n.clinic_id, n.client_id from public.commercial_sales cs join public.plan_negotiations n on n.id = cs.negotiation_id
      where cs.closed_at is not null and cs.cancelled_at is null and n.status <> 'cancelada'
        and not exists (select 1 from public.plan_cancellations pc where pc.negotiation_id = cs.negotiation_id and pc.status in ('rascunho','assinado'))
        and (select count(*) from public.payment_installments i where i.negotiation_id = cs.negotiation_id and i.status = 'em_aberto'
              and not public._installment_has_active_charge(i.id, false)) >= 3
        and public._sale_open_agreements(cs.negotiation_id, null) = '{}'
      order by cs.closed_at desc limit 5`);
  if (vendas.length < 5) throw new Error("NÃO MEDI: o treino não tem 5 vendas de plano com 3 parcelas livres.");
  const [A, B, C, D, E] = vendas;
  const vez = async (clinic) => {
    await papel("gerente", clinic, "unit_manager");
    await papel("recepcao", clinic, "receptionist");
    await papel("consultor", clinic, "dentist");
  };
  const livres = (neg, k) => todos("select id, amount_cents from public.payment_installments where negotiation_id = $1 and status = 'em_aberto' and not public._installment_has_active_charge(id, false) order by due_date, seq limit $2", [neg, k]);
  const receber = (inst, cents, meio = "pix") => pessoa(P.recepcao, "select public.register_payment_receipt(p_installment_id => $1, p_amount_cents => $2, p_received_at => current_date, p_payment_method => $3, p_client_token => gen_random_uuid())", [inst, cents, meio]);
  const acordo = async (clientId, ids, entradas) => {
    const s = await pessoa(P.gerente, "select public.save_renegotiation($1, $2::uuid[], $3::jsonb, 'ensaio 4020', 0) id", [clientId, ids, JSON.stringify(entradas)]);
    if (!passou(s)) throw new Error(`acordo: ${s}`);
    return s[0].id;
  };
  const assinar = (id) => servidor("select public.renegotiation_apply_signed($1, 'zapsign', null)", [id]);
  const abrir = (neg) => pessoa(P.gerente, "select public.open_plan_cancellation($1, 'ensaio 4020', 'reevaluation', null, null) id", [neg]);
  const checklist = async (id, quem = P.gerente) => {
    for (let k = 1; k <= 8; k++) await pessoa(quem, "select public.distrato_checklist_set($1, $2, 'feito', null)", [id, k]);
  };
  const assinarTermo = (id) => pessoa(P.gerente, "select public.sign_plan_cancellation($1, true)", [id]);
  const efetivar = (id) => pessoa(P.gerente, "select public.apply_plan_cancellation($1)", [id]);
  const taxaDas = async (ids) =>
    (await um("select count(*)::int n, coalesce(sum(s.amount_cents), 0)::bigint v from public.split_charges s join public.payment_receipts r on r.id = s.receipt_id where r.installment_id = any($1) and not s.reversed", [ids]));
  const notas = async (user, titulo) => n((await um("select count(*)::int n from public.notifications where user_id = $1 and title = $2", [user, titulo])).n);

  // --- 1) o pedido de distrato e a decisão do Gerente ------------------------------
  await vez(B.clinic_id);
  conf("a Recepção registra o pedido de distrato", passou(await pessoa(P.recepcao, "select public.distrato_request($1, null, 'o paciente pediu para encerrar') id", [B.negotiation_id])));
  conf("o Gerente é avisado do pedido", (await notas(P.gerente, "Pedido de distrato para decidir")) >= 1);
  if (P.consultor) conf("o Dentista não registra o pedido", erro(await pessoa(P.consultor, "select public.distrato_request($1, null, 'pedido do dentista')", [B.negotiation_id]), "NOT_ALLOWED"));
  conf("um segundo pedido aberto é recusado", erro(await pessoa(P.recepcao, "select public.distrato_request($1, null, 'de novo o pedido')", [B.negotiation_id]), "ALREADY_REQUESTED"));
  const pedB = (await um("select id from public.distrato_requests where negotiation_id = $1 and status = 'aberto'", [B.negotiation_id])).id;
  conf("a Recepção não decide (manter é do Gerente)", erro(await pessoa(P.recepcao, "select public.distrato_request_keep($1, 'manter o contrato')", [pedB]), "NOT_ALLOWED"));
  conf("manter sem motivo é recusado", erro(await pessoa(P.gerente, "select public.distrato_request_keep($1, 'ok')", [pedB]), "REASON_REQUIRED"));
  conf("o Gerente mantém o contrato, com o motivo", passou(await pessoa(P.gerente, "select public.distrato_request_keep($1, 'o paciente voltou atrás')", [pedB])) &&
    (await um("select status from public.distrato_requests where id = $1", [pedB])).status === "mantido");

  // --- 2) o contrato em atraso avisa o Gerente (nada é automático) -------------------
  await c.query("update public.finance_settings set distrato_overdue_days = 60 where clinic_id is null");
  const [atr] = await livres(C.negotiation_id, 1);
  const r1 = await servidor("update public.payment_installments set due_date = public.today_br() - 70 where id = $1 returning 1", [atr.id]);
  if (!passou(r1)) throw new Error(`NÃO MEDI: não deu para envelhecer a parcela (${r1}).`);
  await vez(C.clinic_id);
  const antes = await notas(P.gerente, "Contrato em atraso: decidir o distrato");
  await um("select public._distrato_watch_run()");
  const avC = await um("select id, origin, status from public.distrato_requests where negotiation_id = $1 and status = 'aberto'", [C.negotiation_id]);
  conf("o contrato em atraso há 70 dias vira aviso para o Gerente decidir", avC?.origin === "atraso" && (await notas(P.gerente, "Contrato em atraso: decidir o distrato")) === antes + 1);
  await um("select public._distrato_watch_run()");
  conf("rodar de novo no mesmo dia não repete o aviso (a cada 7 dias)", (await notas(P.gerente, "Contrato em atraso: decidir o distrato")) === antes + 1);
  conf("o contrato continua de pé (nada é distratado sozinho)", !(await um("select cancelled_at from public.commercial_sales where negotiation_id = $1", [C.negotiation_id])).cancelled_at);
  await pessoa(P.gerente, "select public.distrato_request_keep($1, 'combinado de pagar no mês que vem')", [avC.id]);
  await um("select public._distrato_watch_run()");
  conf("mantido: o aviso para até o próximo vencimento perdido", !(await um("select id from public.distrato_requests where negotiation_id = $1 and status = 'aberto'", [C.negotiation_id])));
  await c.query("update public.finance_settings set distrato_overdue_days = 90 where clinic_id is null");
  conf("o prazo do aviso vem da Central (rede)", n((await um("select public._distrato_overdue_days() d")).d) === 90);
  await c.query("update public.finance_settings set distrato_overdue_days = 60 where clinic_id is null");

  // --- 3) o distrato do contrato com o acordo de VÁRIAS vendas, a parcial e o pago ----
  await vez(A.clinic_id);
  const cli = await um("select id, clinic_id, full_name from public.clients where id = $1", [A.client_id]);
  const novaDireta = async (total = 20000, meio = "dinheiro") => {
    const v = (await um("insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, created_by) values ($1, $2, $3, $4, $5, 2, $6) returning id", [cli.clinic_id, cli.id, cli.full_name, total, meio, P.recepcao])).id;
    const s = await pessoa(P.recepcao, "select public.save_payment_schedule(null, $1, $2::jsonb)", [v, JSON.stringify([
      { kind: "parcela", due_date: futuro, amount_cents: total / 2, payment_method: meio },
      { kind: "parcela", due_date: mesesDepois(futuro, 1), amount_cents: total / 2, payment_method: meio }])]);
    if (!passou(s)) throw new Error(`venda direta: ${s}`);
    await c.query("update public.direct_sales set contract_signed = true where id = $1", [v]);
    return v;
  };
  const dA = await novaDireta();
  const [xd] = await todos("select id, amount_cents from public.payment_installments where direct_sale_id = $1 and status = 'em_aberto' order by due_date", [dA]);
  const [p0, p1, p2] = await livres(A.negotiation_id, 3);
  conf("a parcial (cenário): parte da parcela paga", passou(await receber(p2.id, 1000)));
  const totalR = n(p0.amount_cents) + n(xd.amount_cents);
  const metadeR = Math.floor(totalR / 2);
  const R = await acordo(cli.id, [p0.id, xd.id], [
    { kind: "parcela", due_date: futuro, amount_cents: metadeR, payment_method: "dinheiro" },
    { kind: "parcela", due_date: mesesDepois(futuro, 1), amount_cents: totalR - metadeR, payment_method: "dinheiro" }]);
  conf("o acordo que junta o contrato e a venda direta (cenário)", passou(await assinar(R)));
  const novasR = await todos("select id, amount_cents from public.payment_installments where renegotiation_id = $1 order by seq", [R]);
  conf("o cliente paga uma parte no acordo (cenário)", passou(await receber(novasR[0].id, 1000, "dinheiro")));
  const share = n((await um("select public._distrato_share($1, $2, null) s", [R, A.negotiation_id])).s);
  const esperado = n(p0.amount_cents) / totalR;
  conf(`a parte do contrato no acordo é a proporção da origem (${(share * 100).toFixed(2)}%)`, Math.abs(share - esperado) < 0.0001);
  const pagoContrato = n((await um("select coalesce(sum(r.amount_cents),0) v from public.payment_receipts r join public.payment_installments i on i.id = r.installment_id where i.negotiation_id = $1 and not r.reversed and r.reversal_of is null", [A.negotiation_id])).v);
  const idsTaxa = [...(await todos("select id from public.payment_installments where negotiation_id = $1", [A.negotiation_id])).map((x) => x.id), ...novasR.map((x) => x.id)];
  const taxa0 = await taxaDas(idsTaxa);
  const abA = await abrir(A.negotiation_id);
  conf("abrir o distrato com acordo assinado em aberto: aceito (o distrato trata o acordo)", passou(abA));
  const dist = passou(abA) ? abA[0].id : null;
  const pcA = dist ? await um("select * from public.plan_cancellations where id = $1", [dist]) : null;
  conf("o acerto conta a parte do contrato no pago do acordo", pcA && n(pcA.agreement_paid_cents) === Math.round(1000 * share) && n(pcA.paid_cents) === pagoContrato + Math.round(1000 * share));
  conf("o distrato nasce com a checklist obrigatória", pcA?.checklist_required === true && pcA?.kind === "contrato");
  const leituraR = dist ? await pessoa(P.gerente, "select public.distrato_read($1) j", [dist]) : null;
  if (DEBUG && !passou(leituraR)) console.log("   [debug leitura]", leituraR);
  const leitura = passou(leituraR) ? leituraR[0].j : null;
  conf("o termo mostra o acordo antes e depois (reduzir, na proporção)", leitura && leitura.plano_dos_acordos.length === 2 && leitura.plano_dos_acordos.every((x) => x.acao === "reduzir"));
  conf("a multa mostra o % e a origem (rede, unidade ou zero)", leitura && ["rede", "unidade", "zero"].includes(leitura.multa.origem));
  await assinarTermo(dist);
  conf("efetivar SEM a checklist é recusado (nada é cancelado)", erro(await efetivar(dist), "CHECKLIST_INCOMPLETE") &&
    (await um("select status from public.payment_installments where id = $1", [p1.id])).status === "em_aberto");
  conf("\"não se aplica\" sem motivo é recusado", erro(await pessoa(P.gerente, "select public.distrato_checklist_set($1, 1, 'nao_se_aplica', null)", [dist]), "REASON_REQUIRED"));
  conf("a Recepção não marca a checklist", erro(await pessoa(P.recepcao, "select public.distrato_checklist_set($1, 1, 'feito', null)", [dist]), "NOT_ALLOWED"));
  await checklist(dist);
  const abertoR = novasR.reduce((s, x) => s + n(x.amount_cents), 0);
  const ef = await efetivar(dist);
  conf("com a checklist e o termo assinado, o distrato é efetivado", passou(ef));
  if (passou(ef)) {
    const st = await todos("select id, status from public.payment_installments where id = any($1)", [[p1.id, p2.id]]);
    conf("as parcelas em aberto do contrato caem", st.find((x) => x.id === p1.id)?.status === "cancelada");
    conf("a parcial cai também (o pago dela está no acerto)", st.find((x) => x.id === p2.id)?.status === "cancelada");
    const depois = await todos("select amount_cents, status from public.payment_installments where renegotiation_id = $1 order by seq", [R]);
    const corte = abertoR - depois.reduce((s, x) => s + n(x.amount_cents), 0);
    conf(`as parcelas do acordo são REDUZIDAS na parte do contrato (corte ${corte} ≈ ${Math.round(abertoR * share)})`, Math.abs(corte - Math.round(abertoR * share)) <= 1 && depois.every((x) => ["em_aberto", "parcial"].includes(x.status)));
    conf("o acordo continua para a venda direta (não fica encerrado)", (await um("select status from public.payment_renegotiations where id = $1", [R])).status !== "encerrada");
    conf("as parcelas da venda direta não mudam", (await um("select count(*)::int n from public.payment_installments where direct_sale_id = $1 and status = 'em_aberto'", [dA])).n === 1);
    conf("o plano do acordo fica gravado no distrato (para o termo e a auditoria)", Array.isArray((await um("select agreement_changes a from public.plan_cancellations where id = $1", [dist])).a));
    const taxa1 = await taxaDas(idsTaxa);
    conf("a taxa da rede sobre o que o cliente pagou continua devida (nada estornado)", taxa1.n === taxa0.n && n(taxa1.v) === n(taxa0.v));
  }

  // --- 4) entrou pagamento depois do termo: o acerto do termo não vale ---------------
  await vez(D.clinic_id);
  const abD = await abrir(D.negotiation_id);
  conf("abrir o distrato de outro contrato (cenário)", passou(abD));
  if (passou(abD)) {
    await checklist(abD[0].id);
    await assinarTermo(abD[0].id);
    const [pd] = await livres(D.negotiation_id, 1);
    await receber(pd.id, 500);
    conf("pagamento depois do termo: efetivar é recusado (descarte e abra de novo)", erro(await efetivar(abD[0].id), "SETTLEMENT_CHANGED"));
  }

  // --- 5) o acordo que ainda não vale é cancelado antes -----------------------------
  await vez(E.clinic_id);
  const [pe] = await livres(E.negotiation_id, 1);
  const Rp = await acordo(E.client_id, [pe.id], [{ kind: "parcela", due_date: futuro, amount_cents: n(pe.amount_cents), payment_method: "pix" }]);
  conf("acordo pendente: o distrato pede para cancelá-lo antes", erro(await abrir(E.negotiation_id), "PENDING_FIRST"));
  await pessoa(P.gerente, "select public.renegotiation_cancel_pending($1, 'cancelar para o distrato')", [Rp]);

  // --- 6) a Ortodontia: o caso fica interrompido e as mensalidades futuras caem ------
  const caso = await servidor(
    `insert into public.ortho_cases (clinic_id, client_id, negotiation_id, status, start_date)
     values ($1, $2, $3, 'em_tratamento', public.today_br() - 60) returning id`, [E.clinic_id, E.client_id, E.negotiation_id]);
  if (!passou(caso)) {
    conf(`NÃO MEDI a Ortodontia (o caso de ensaio não nasceu: ${caso})`, false);
  } else {
    const oc = caso[0].id;
    const mes = (k) => mesesDepois(hoje.slice(0, 8) + "01", k);
    // O mês de referência é futuro (o mês fechado recusa o lançamento: PERIOD_CLOSED);
    // a "vencida" tem o vencimento no passado.
    const ins = await servidor(
      `insert into public.ortho_charges (case_id, clinic_id, client_id, reference_month, due_date, amount_cents, status) values
         ($1, $2, $3, $4, public.today_br() - 20, 25000, 'atrasada'),
         ($1, $2, $3, $5, public.today_br() + 20, 25000, 'em_aberto'),
         ($1, $2, $3, $6, public.today_br() + 50, 25000, 'em_aberto') returning id`, [oc, E.clinic_id, E.client_id, mes(1), mes(2), mes(3)]);
    conf("as mensalidades do caso (cenário)", passou(ins));
    const abE = await abrir(E.negotiation_id);
    if (passou(abE)) {
      await checklist(abE[0].id);
      await assinarTermo(abE[0].id);
      conf("o distrato com o caso de Ortodontia é efetivado", passou(await efetivar(abE[0].id)));
      const o = await um("select status, interrupted_at from public.ortho_cases where id = $1", [oc]);
      const ms = await todos("select status, due_date < public.today_br() vencida from public.ortho_charges where case_id = $1", [oc]);
      conf("o caso fica interrompido", o.status === "interrompido" && Boolean(o.interrupted_at));
      conf("as mensalidades futuras caem", ms.filter((x) => !x.vencida).every((x) => x.status === "cancelada"));
      conf("a vencida continua como dívida", ms.filter((x) => x.vencida).every((x) => x.status === "atrasada"));
    } else conf(`o distrato com a Ortodontia abre (${abE})`, false);
  }

  // --- 7) a venda direta: sem pago, o cancelamento simples; com pago, o distrato ------
  await vez(cli.clinic_id);
  const dSem = await novaDireta();
  conf("venda direta sem nada pago: o cancelamento simples, como hoje", passou(await pessoa(P.gerente, "select public.cancel_direct_sale($1)", [dSem])));
  const dPago = await novaDireta();
  await c.query("update public.direct_sales set closed_at = null where id = $1", [dPago]);
  const [xp] = await todos("select id from public.payment_installments where direct_sale_id = $1 and status = 'em_aberto' order by due_date", [dPago]);
  await receber(xp.id, 1000, "dinheiro");
  await c.query("update public.direct_sales set closed_at = null where id = $1", [dPago]);
  conf("venda direta em aberto com algo pago: o cancelamento simples é recusado (DISTRATO_REQUIRED)", erro(await pessoa(P.gerente, "select public.cancel_direct_sale($1)", [dPago]), "DISTRATO_REQUIRED"));
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  const raiz = await um("select id, wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' and wallet_id is not null order by created_at limit 1");
  const taxas = (await todos("select key from public.network_fee_types where kind = 'percent' and active")).map((r) => r.key);
  if (!ldn || !raiz || !taxas.length) {
    conf("NÃO MEDI o cartão parcelado aprovado (falta Londrina, a conta raiz ou as taxas no treino)", false);
  } else {
    await vez(ldn);
    const cl = await um(
      `select c.id, c.full_name from public.clients c where c.clinic_id = $1 and public._cpf_ok(c.cpf) and c.birth_date < current_date - interval '19 years'
        and not exists (select 1 from public.client_guardians g where g.client_id = c.id and g.is_financial) order by c.created_at limit 1`, [ldn]);
    let primeiro = iso(new Date(Date.now() + 5 * 86400000));
    if (Number(primeiro.slice(8, 10)) > 28) primeiro = primeiro.slice(0, 8) + "05";
    const v = (await um("insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, created_by) values ($1, $2, $3, 30001, 'cartao_parcelado_asaas', 3, $4) returning id", [ldn, cl.id, cl.full_name, P.recepcao])).id;
    await pessoa(P.recepcao, "select public.save_payment_schedule(null, $1, $2::jsonb)", [v, JSON.stringify([10000, 10000, 10001].map((x, k) => ({ kind: "parcela", due_date: mesesDepois(primeiro, k), amount_cents: x, payment_method: "cartao_parcelado_asaas" })))]);
    await c.query("insert into public.gateway_auto_charge_units (clinic_id, enabled, enabled_from) values ($1, true, now() - interval '1 minute') on conflict (clinic_id) do update set enabled = true, enabled_from = now() - interval '1 minute'", [ldn]);
    await c.query("update public.direct_sales set contract_signed = true where id = $1", [v]);
    const bloco = (await um("select public._card_block_prepare_system(null, $1, 'venda_direta') as b", [v])).b;
    const cs = await todos("select id, value_cents from public.charges where installment_block = $1 order by installment_number", [bloco]);
    for (const [k, x] of cs.entries()) {
      await um("select public._charge_mark_issued($1, $2, null, $3, null, null, null)", [x.id, `pay_dist_${k + 1}`, `https://sandbox.asaas.com/i/dist${k + 1}`]);
      await um("select public._charge_save_split($1, $2::jsonb)", [x.id, JSON.stringify([{ accountId: raiz.id, walletId: raiz.wallet_id, percent: 17, percentualValue: 17.4341, fixedCents: 2, fees: Object.fromEntries(taxas.map((t) => [t, 17 / taxas.length])), tariffPercent: 2.49, tariffFixedCents: 16, asaasSplitId: `split_dist_${k + 1}` }])]);
    }
    await um("select public._card_block_save_installment($1, 'inst_dist')", [bloco]);
    for (const [k, x] of cs.entries()) {
      await um("select public._gateway_on_paid($1, 'PAYMENT_CONFIRMED', $2::jsonb)", [x.id, JSON.stringify({ id: `pay_dist_${k + 1}`, value: n(x.value_cents) / 100, netValue: (n(x.value_cents) - 265) / 100, confirmedDate: hoje, estimatedCreditDate: mesesDepois(primeiro, k + 1) })]);
    }
    const linhas = async () => todos("select sc.amount_cents, sc.retained_cents, sc.reversed, public._split_charge_awaiting(sc.id) a from public.split_charges sc join public.charges ch on ch.receipt_id = sc.receipt_id where ch.installment_block = $1", [bloco]);
    const l0 = await linhas();
    conf("o parcelado aprovado: as parcelas pagas, a taxa A RETER pelo split (cenário)", l0.length === 3 * taxas.length && l0.every((r) => r.a === true && !r.reversed));
    conf("venda direta concluída (a 1ª baixa fecha): o cancelamento simples é recusado; o caminho é o distrato", erro(await pessoa(P.gerente, "select public.cancel_direct_sale($1)", [v]), "ALREADY_CLOSED", "DISTRATO_REQUIRED"));
    conf("a Recepção não abre o distrato (Gerente ou Admin)", erro(await pessoa(P.recepcao, "select public.open_direct_sale_distrato($1, 'desistiu do tratamento')", [v]), "NOT_ALLOWED"));
    const ov = await pessoa(P.gerente, "select public.open_direct_sale_distrato($1, 'desistiu do tratamento') id", [v]);
    conf("o Gerente abre o distrato da venda direta", passou(ov));
    if (passou(ov)) {
      const dv = ov[0].id;
      const pv = await um("select * from public.plan_cancellations where id = $1", [dv]);
      conf("o acerto da venda direta: sem multa; nada feito, tudo pago volta", pv.kind === "venda_direta" && n(pv.penalty_cents) === 0 && n(pv.paid_cents) === 30001 && n(pv.clinic_refunds_cents) === 30001);
      await checklist(dv);
      await assinarTermo(dv);
      conf("o distrato da venda direta é efetivado", passou(await efetivar(dv)));
      conf("a venda direta fica cancelada", (await um("select cancelled from public.direct_sales where id = $1", [v])).cancelled === true);
      const l1 = await linhas();
      conf("a taxa A RETER das parcelas pagas do parcelado NÃO cai no distrato", l1.length === l0.length && l1.every((r) => r.a === true && !r.reversed));
      conf("o distrato não cria a conta a pagar sozinho (a devolução é pedida e autorizada)", n((await um("select count(*)::int n from public.payables where account_code = '1.9.03' and reference = $1", [pv.code])).n) === 0);
      // A devolução por Pix da conta da unidade, com o termo anexado.
      conf("pedir a devolução sem o termo é recusado", erro(await pessoa(P.gerente, "select public.distrato_refund_request($1::jsonb)", [JSON.stringify({ cancellation_id: dv, amount_cents: 10000, reason: "devolver o pago", term_path: `${ldn}/distrato-${dv}/termo.pdf` })]), "TERM_REQUIRED"));
      await c.query("insert into storage.objects (bucket_id, name) values ('devolucoes', $1)", [`${ldn}/distrato-${dv}/termo.pdf`]);
      const pd = await pessoa(P.gerente, "select public.distrato_refund_request($1::jsonb) id", [JSON.stringify({ cancellation_id: dv, amount_cents: 30001, reason: "devolver o pago", term_path: `${ldn}/distrato-${dv}/termo.pdf`, term_name: "termo.pdf" })]);
      conf("o Gerente pede a devolução com o termo anexado", passou(pd));
      conf("o Financeiro da Franqueadora é avisado do pedido", (await notas(P.financeiro, "Devolução do distrato para autorizar")) >= 1);
      conf("pedir mais do que falta devolver é recusado", erro(await pessoa(P.gerente, "select public.distrato_refund_request($1::jsonb)", [JSON.stringify({ cancellation_id: dv, amount_cents: 1, reason: "mais um pouco", term_path: `${ldn}/distrato-${dv}/termo.pdf` })]), "AMOUNT_OVER_BALANCE"));
      if (passou(pd)) {
        conf("o Gerente não autoriza a devolução", erro(await pessoa(P.gerente, "select public.distrato_refund_decide($1, true, 'ok')", [pd[0].id]), "NOT_ALLOWED"));
        const dec = await pessoa(P.financeiro, "select public.distrato_refund_decide($1, true, 'ok') p", [pd[0].id]);
        conf("o Financeiro da Franqueadora autoriza: vira conta a pagar 1.9.03", passou(dec) && (await um("select account_code, amount_cents from public.payables where id = $1", [dec[0].p]))?.account_code === "1.9.03");
        const lista = (await pessoa(P.financeiro, "select public.devolucoes_read() j", []))?.[0]?.j ?? [];
        conf("o Financeiro vê todas as devoluções (a do distrato na lista)", lista.some((x) => x.id === pd[0].id && x.tipo === "pix_unidade"));
        const l2 = await linhas();
        conf("depois da devolução, a taxa continua a reter (devida)", l2.every((r) => r.a === true && !r.reversed));
      }
    }
  }

  // --- 8) o Riso+ Social: o estorno da mensalidade do PPR+ tira os pontos dela --------
  const conta = await um("select id from public.gateway_accounts where status = 'active' order by created_at limit 1");
  const plano = await um("select id from public.ppr_plans order by created_at limit 1");
  if (!conta || !plano) {
    conf("NÃO MEDI o Riso+ Social (falta conta ou plano do PPR+ no treino)", false);
  } else {
    const mb = await servidor("insert into public.ppr_memberships (clinic_id, plan_id, holder_client_id, status, monthly_cents, billing_day, payment_method, contract_signed, first_payment_confirmed) values ($1, $2, $3, 'ativo', 9990, 10, 'boleto', true, true) returning id", [cli.clinic_id, plano.id, cli.id]);
    const ref = hoje.slice(0, 8) + "01";
    const fee = passou(mb) ? await servidor("insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status, paid_at) values ($1, $2, $3, public.today_br(), 9990, 'paga', now()) returning id", [mb[0].id, cli.clinic_id, ref]) : mb;
    const pts = passou(fee) ? await servidor("insert into public.ppr_social_points (membership_id, clinic_id, client_id, reference_month, points, source_cents) values ($1, $2, $3, $4, 9, 9990) on conflict (membership_id, reference_month) do update set points = 9 returning 1", [mb[0].id, cli.clinic_id, cli.id, ref]) : fee;
    const ch = passou(pts) ? await servidor("insert into public.charges (clinic_id, source_type, source_id, client_id, status, gateway_account_id, asaas_payment_id, value_cents, billing_type, due_date, payer_kind) values ($1, 'ppr_charge', $2, $3, 'paga', $4, 'pay_soc_ensaio', 9990, 'BOLETO', public.today_br(), 'client') returning id", [cli.clinic_id, fee[0].id, cli.id, conta.id]) : pts;
    if (!passou(ch)) {
      conf(`NÃO MEDI o Riso+ Social (cenário: ${ch})`, false);
    } else {
      const evt = "evt_dist_soc";
      await c.query("select public._gateway_record_event($1, $2, $3, $4)", [conta.id, evt, "PAYMENT_REFUNDED", JSON.stringify({ id: evt, event: "PAYMENT_REFUNDED", payment: { id: "pay_soc_ensaio", externalReference: ch[0].id, value: 99.9 } })]);
      const ev = await um("select id from public.gateway_webhook_events where account_id = $1 and asaas_event_id = $2", [conta.id, evt]);
      const r = (await um("select public._gateway_process_event($1) r", [ev.id])).r;
      const sobra = n((await um("select coalesce(sum(points),0) n from public.ppr_social_points where membership_id = $1", [mb[0].id])).n);
      conf(`o estorno da mensalidade do PPR+ pelo Asaas tira os pontos do Riso+ Social (${r})`, sobra === 0);
      conf("…e a mensalidade continua paga (a unidade decide desfazer a baixa)", (await um("select status from public.ppr_charges where id = $1", [fee[0].id])).status === "paga");
    }
  }

  // --- 9) as leituras não vazam para quem não deve ------------------------------
  if (P.consultor) {
    await papel("consultor", A.clinic_id, "dentist");
    conf("o Dentista não lê os distratos da unidade", ((await pessoa(P.consultor, "select public.distratos_read() j", []))?.[0]?.j?.abertos ?? []).length === 0);
  }

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
