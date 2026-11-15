// ENSAIO DA 0408 (Levantamento de Dívidas, fase 5 — renegociação e
// encerramento) no banco de TREINO, numa transação DESFEITA: nada fica.
// Uso: node scripts/dividas-ensaio-0408.mjs --confirmar [--quebrar]
//      (rede sem IPv6: RISARTE_TREINO_POOLER=1)
//
// Como o Financeiro da Franqueadora de teste (e o Admin de teste para aprovar):
//   1. a conferência do acordo (base S por título, desconto, problemas);
//   2. o acordo vale: títulos antigos "renegociada", parcelas na 5.5.02,
//      desconto obtido na data do acordo, travas (pagar o antigo, cancelar a
//      parcela, editar/excluir a dívida, outro acordo em cima);
//   3. parcela em atraso (aviso no dia seguinte), quebra passada a tolerância
//      (aviso crítico, Admin incluso), retomada ao pagar;
//   4. o credor restabeleceu: S − pago, estorno do desconto com data de hoje;
//   5. acordo novo por cima do restabelecido, acima do valor de aprovação:
//      espera o Admin (nada nasce), o Financeiro não aprova, o Admin aprova;
//      desconto proporcional a cada pagamento (e o estorno do pagamento);
//      cumprido → quitada → checklist → encerrada;
//   6. desfazer (proposta volta a ativa) e recusar (com motivo);
//   7. quem pode: Gerente não lê nem renegocia; anônimo não executa nada.
// `--quebrar`: o acordo "esquece" de renegociar os títulos antigos — o ensaio
// TEM de falhar. Só valores de teste na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO dentro de transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const ARQ = "supabase/migrations/0408_dividas_renegociacao_e_encerramento.sql";
const c = await connect();
if (process.env.ENSAIO_DETALHE) { const q0 = c.query.bind(c); c.query = async (...a) => { try { return await q0(...a); } catch (e) { if (!/aborted/.test(e.message)) console.log("   [erro]", e.message.slice(0, 160), "|", String(a[0]).slice(0, 70).replace(/s+/g, " ")); throw e; } }; }
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
const dia = (x) => (x instanceof Date ? x.toISOString().slice(0, 10) : x == null ? null : String(x).slice(0, 10));
const mais = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

let saida = 1;
try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query(sql);
  console.log("Migração aplicada duas vezes sem erro (idempotente).");
  if (process.argv.includes("--quebrar")) {
    const ini = sql.indexOf("create or replace function public._debt_agreement_activate");
    const corpo = sql.slice(ini, sql.indexOf("revoke execute on function public._debt_agreement_activate"));
    await c.query(corpo.replace("set status = 'renegociada', renegotiated_by_agreement_id = a.id, updated_at = now()\n   where status in ('aberta', 'parcial')", () => "set updated_at = now()\n   where false and status in ('aberta', 'parcial')"));
    console.log("⚠️ MODO QUEBRAR: o acordo não renegocia os títulos antigos (o ensaio tem de FALHAR).");
  }

  const ids = {};
  for (const p of ["admin", "financeiro", "gerente"]) ids[p] = (await um("select id from auth.users where email = $1", [`${p}@example.com`])).id;
  const ldn = (await um("select id from public.clinics where code = 'LDN'")).id;
  const hoje = dia((await um("select public.today_br() d")).d);
  // Nenhum mês fechado atrapalha o ensaio (só dentro da transação).
  await c.query("delete from public.fiscal_periods where clinic_id = $1", [ldn]);
  await c.query("update public.debt_settings set agreement_approval_threshold_cents = null, discount_recognition = 'na_data_do_acordo', surcharge_recognition = 'na_data_do_acordo', agreement_broken_tolerance_bdays = 3 where clinic_id is null");
  const [sup, sup2] = (await todas("select id from public.suppliers where active order by name limit 2")).map((r) => r.id);

  const salvar = (p) => como(ids.financeiro, async () => (await um("select public.debt_save($1::jsonb) v", [j(p)])).v);
  const gerar = (id) => como(ids.financeiro, async () => (await um("select public.debt_sync_finance($1) v", [id])).v);
  const pagar = (pid, v, data = hoje) => como(ids.financeiro, async () => (await um(
    "select public.register_payable_payment(p_payable_id => $1, p_amount_cents => $2, p_paid_at => $3::date, p_payment_method => 'pix') v", [pid, v, data])).v);
  const previa = (uid, p) => como(uid, async () => (await um("select public.debt_agreement_preview($1::jsonb) v", [j(p)])).v);
  const acordo = (uid, p) => como(uid, async () => (await um("select public.debt_agreement_save($1::jsonb) v", [j(p)])).v);
  const situacao = async (id) => (await um("select status from public.debts where id = $1", [id])).status;
  const doAcordo = async (aid) => await um("select * from public.debt_agreements where id = $1", [aid]);
  const parcelas = async (aid) => await todas("select * from public.payables where debt_agreement_id = $1 and debt_link = 'acordo' order by debt_installment_no", [aid]);
  const posicoes = async (lista) => Object.fromEntries((await todas("select * from public._debt_positions($1::uuid[])", [lista])).map((r) => [r.debt_id, r]));
  const reconhecido = async (aid, w) => Number((await um("select public._debt_agreement_recognized($1, $2) v", [aid, w])).v);
  const mexer = async (sqlTxt, p) => { await c.query("select set_config('risarte.debt_sync', 'on', true)"); await c.query(sqlTxt, p); await c.query("select set_config('risarte.debt_sync', '', true)"); };
  const sched = (lista) => lista.map(([due, v], i) => ({ due_date: due, amount_cents: v, entrada: i === 0 }));

  const base = { clinic_id: ldn, supplier_id: sup, original_cents: 100000, updated_cents: 120000, updated_ref_date: hoje,
    due_date: "2025-05-10", issue_date: "2025-01-01", origin: "A" };
  const dA = await salvar(base);
  const dB = await salvar({ ...base, original_cents: 30000, updated_cents: null });
  const dX = await salvar({ ...base, supplier_id: sup2, original_cents: 5000, updated_cents: null });
  const tA = await gerar(dA); const tB = await gerar(dB); await gerar(dX);
  await pagar(tA, 20000);
  // Restrições que o encerramento tem de lembrar.
  await c.query("insert into public.debt_negativations (debt_id, bureau, included_on) values ($1, 'serasa', '2025-06-01')", [dA]);
  await c.query("insert into public.debt_lawsuits (debt_id, process_number) values ($1, 'ENSAIO-0408')", [dB]);
  const prop = await como(ids.financeiro, async () => (await um("select public.debt_save_proposal($1::jsonb) v",
    [j({ debt_id: dA, proposed_on: hoje, amount_cents: 100000, payment_kind: "parcelado", installments: 5, source: "credor" })])).v);

  console.log("\n1. A conferência do acordo");
  const cond = { debt_ids: [dA, dB], agreed_on: hoje, total_cents: 100000, proposal_id: prop,
    schedule: sched([[hoje, 20000], [mais(hoje, 30), 20000], [mais(hoje, 60), 20000], [mais(hoje, 90), 20000], [mais(hoje, 120), 20000]]) };
  const pv = await previa(ids.financeiro, cond);
  ok("S = o que falta pagar por título (R$ 1.000 + R$ 300), desconto R$ 300, 2 títulos, sem aprovação",
    pv.problem === null && Number(pv.base_cents) === 130000 && Number(pv.discount_cents) === 30000 && Number(pv.surcharge_cents) === 0
      && pv.titles === 2 && pv.needs_approval === false && pv.installments === 5);
  ok("credor diferente: recusa", /mesmo credor/.test((await previa(ids.financeiro, { ...cond, debt_ids: [dA, dX] })).problem ?? ""));
  ok("parcelas que não fecham com o total: recusa", /não fecha/.test((await previa(ids.financeiro, { ...cond, total_cents: 99999 })).problem ?? ""));
  ok("data futura: recusa", /futura/.test((await previa(ids.financeiro, { ...cond, agreed_on: mais(hoje, 1) })).problem ?? ""));

  console.log("\n2. O acordo vale");
  const a1 = await acordo(ids.financeiro, { ...cond, primary_debt_id: dA, method: "pix", channel: "ligacao" });
  const A1 = await doAcordo(a1);
  const p1 = await parcelas(a1);
  const antigos = await todas("select status, renegotiated_by_agreement_id r from public.payables where id = any ($1::uuid[])", [[tA, tB]]);
  ok("os títulos antigos viraram \"renegociada\" por este acordo", antigos.every((t) => t.status === "renegociada" && t.r === a1));
  ok("5 parcelas na 5.5.02, com lançamento, código AD-, situação em andamento",
    p1.length === 5 && p1.every((t) => t.account_code === "5.5.02" && t.status === "aberta" && t.debt_id === dA) && /^AD-\d{5}$/.test(A1.code)
      && A1.status === "em_andamento"
      && (await um("select count(*)::int n from public.financial_entries where source_type = 'payable_accrual' and source_id = any ($1::uuid[])", [p1.map((t) => t.id)])).n === 5);
  ok("nomes: \"entrada\" e \"parcela 1/4\" a \"4/4\" (a entrada não conta na numeração)",
    /· entrada ·/.test(p1[0].description) && p1[1].description.includes("parcela 1/4") && p1[4].description.includes("parcela 4/4"));
  const eDesc = await um("select * from public.financial_entries where source_type = 'debt_agreement_discount' and source_id = $1", [a1]);
  ok("desconto obtido R$ 300 na 4.1.03, na data do acordo", eDesc && eDesc.account_code === "4.1.03" && eDesc.direction === "inflow"
    && Number(eDesc.amount_cents) === 30000 && dia(eDesc.accrual_date) === hoje);
  ok("as duas dívidas: acordo em andamento; a proposta virou aceita",
    (await situacao(dA)) === "acordo_em_andamento" && (await situacao(dB)) === "acordo_em_andamento"
      && (await um("select status from public.debt_proposals where id = $1", [prop])).status === "aceita");
  let pos = await posicoes([dA, dB]);
  if (process.env.ENSAIO_DETALHE) console.log(pos);
  ok("saldo do acordo repartido pela base (R$ 1.000 → 1.000 : 300) e fecha no centavo",
    Number(pos[dA].balance_cents) + Number(pos[dB].balance_cents) === 100000 && Number(pos[dA].balance_cents) === 76924
      && pos[dA].agreement_code === A1.code);
  ok("título renegociado não recebe pagamento", /PAYABLE_RENEGOTIATED/.test((await como(ids.financeiro, () => erroDe("select public.register_payable_payment(p_payable_id => $1, p_amount_cents => 100, p_payment_method => 'pix')", [tA]))) ?? ""));
  ok("parcela do acordo não se cancela pelo Contas a Pagar", /Levantamento de Dívidas/.test((await erroDe("update public.payables set status = 'cancelada' where id = $1", [p1[1].id])) ?? ""));
  ok("renegociada não se desfaz por fora", /Levantamento de Dívidas|acordo/.test((await erroDe("update public.payables set status = 'aberta', renegotiated_by_agreement_id = null where id = $1", [tA])) ?? ""));
  ok("editar o valor da dívida renegociada: recusa", /renegociada/.test((await como(ids.financeiro, () => erroDe("select public.debt_save($1::jsonb)", [j({ ...base, id: dA, updated_cents: 999999 })]))) ?? ""));
  ok("excluir a dívida do acordo: recusa", /acordo/.test((await como(ids.financeiro, () => erroDe("select public.debt_delete($1, 'ensaio da exclusão')", [dB]))) ?? ""));
  ok("outro acordo em cima do que está em andamento: recusa", /já está no acordo/.test((await previa(ids.financeiro, { ...cond, proposal_id: null })).problem ?? ""));
  await pagar(p1[0].id, 20000);
  ok("entrada paga: continua em andamento", (await doAcordo(a1)).status === "em_andamento");
  ok("desfazer com parcela paga: recusa", /paga/.test((await como(ids.financeiro, () => erroDe("select public.debt_agreement_undo($1, 'ensaio do desfazer')", [a1]))) ?? ""));

  console.log("\n3. Atraso, quebra e retomada");
  const nAntes = Number((await um("select count(*) n from public.notifications where link like $1", [`/financeiro/dividas/${dA}%`])).n);
  await mexer("update public.payables set due_date = $2 where id = $1", [p1[1].id, mais(hoje, -1)]);
  await c.query("select public._debt_agreements_daily()");
  ok("venceu ontem: aviso de parcela em atraso, ainda em andamento (dentro da tolerância)",
    (await doAcordo(a1)).status === "em_andamento"
      && (await um("select count(*)::int n from public.debt_notices where subject_id = $1 and kind = 'parcela_em_atraso'", [a1])).n === 1);
  await c.query("select public._debt_agreements_daily()");
  ok("o aviso não se repete no dia seguinte da rotina", (await um("select count(*)::int n from public.debt_notices where subject_id = $1 and kind = 'parcela_em_atraso'", [a1])).n === 1);
  await mexer("update public.payables set due_date = $2 where id = $1", [p1[1].id, mais(hoje, -10)]);
  await c.query("select public._debt_agreements_daily()");
  const admins = Number((await um("select count(*) n from public.profiles where is_admin_master and is_active")).n);
  const avisos = await todas("select user_id, title from public.notifications where link like $1 and title like '%quebrado%'", [`/financeiro/dividas/${dA}%`]);
  ok("passada a tolerância: acordo quebrado, dívidas \"Acordo quebrado\"",
    (await doAcordo(a1)).status === "quebrado" && (await situacao(dA)) === "acordo_quebrado" && (await situacao(dB)) === "acordo_quebrado");
  ok(`aviso crítico: Financeiro e Admin Master (${avisos.length} pessoas)`, avisos.some((x) => x.user_id === ids.admin) && avisos.length >= admins);
  await pagar(p1[1].id, 20000, mais(hoje, 0));
  ok("pagou a parcela atrasada: volta a em andamento", (await doAcordo(a1)).status === "em_andamento" && (await situacao(dA)) === "acordo_em_andamento");
  await mexer("update public.payables set due_date = $2 where id = $1", [p1[2].id, mais(hoje, -12)]);
  await c.query("select public._debt_agreements_daily()");
  ok("outra parcela passa da tolerância: quebra de novo (outro aviso)", (await doAcordo(a1)).status === "quebrado"
    && (await um("select count(*)::int n from public.debt_notices where subject_id = $1 and kind = 'acordo_quebrado'", [a1])).n === 2);
  void nAntes;

  console.log("\n4. O credor restabeleceu a dívida");
  ok("sem motivo: recusa", /motivo/.test((await como(ids.financeiro, () => erroDe("select public.debt_agreement_reestablish($1, '{}'::jsonb)", [a1]))) ?? ""));
  const tR = await como(ids.financeiro, async () => (await um("select public.debt_agreement_reestablish($1, $2::jsonb) v",
    [a1, j({ due_date: hoje, reason: "Credor voltou a cobrar o saldo" })])).v);
  const R = await um("select * from public.payables where id = $1", [tR]);
  const abertas1 = (await parcelas(a1)).filter((t) => t.status === "aberta").length;
  ok("título restabelecido = S − pago no acordo (R$ 1.300 − R$ 400 = R$ 900), na 5.5.02",
    Number(R.amount_cents) === 90000 && R.debt_link === "restabelecido" && R.account_code === "5.5.02" && R.debt_agreement_id === a1);
  ok("as parcelas em aberto do acordo viraram renegociada", abertas1 === 0 && (await parcelas(a1)).filter((t) => t.status === "renegociada").length === 3);
  const est = await um("select * from public.financial_entries where source_type = 'debt_agreement_reversal' and source_id = $1", [a1]);
  ok("o desconto volta com lançamento NOVO e oposto, com data de hoje (o original fica)",
    est && est.direction === "outflow" && Number(est.amount_cents) === 30000 && dia(est.accrual_date) === hoje
      && (await um("select status from public.financial_entries where id = $1", [eDesc.id])).status === "open"
      && (await reconhecido(a1, "d")) === 0);
  pos = await posicoes([dA, dB]);
  ok("acordo restabelecido; saldo das duas = R$ 900; a situação volta a contar pelo título",
    (await doAcordo(a1)).status === "restabelecido" && Number(pos[dA].balance_cents) + Number(pos[dB].balance_cents) === 90000
      && (await situacao(dA)) === "a_vencer" && pos[dA].agreement_id === null);

  console.log("\n5. Acordo novo acima do valor de aprovação, desconto proporcional");
  await c.query("update public.debt_settings set agreement_approval_threshold_cents = 50000, discount_recognition = 'proporcional' where clinic_id is null");
  const cond2 = { debt_ids: [dB], agreed_on: hoje, total_cents: 60000,
    schedule: sched([[hoje, 20000], [mais(hoje, 30), 20000], [mais(hoje, 60), 20000]]) };
  const pv2 = await previa(ids.financeiro, cond2);
  ok("escolheu só uma: a outra do acordo anterior entra junto; S = R$ 900; pede aprovação",
    pv2.problem === null && (pv2.added_debt_ids ?? []).includes(dA) && Number(pv2.base_cents) === 90000 && pv2.needs_approval === true
      && pv2.discount_recognition === "proporcional");
  const nAdm = Number((await um("select count(*) n from public.notifications where user_id = $1 and title like '%aprovação%'", [ids.admin])).n);
  const a2 = await acordo(ids.financeiro, cond2);
  ok("aguardando aprovação: nada nasce, o restabelecido continua em aberto, o Admin é avisado",
    (await doAcordo(a2)).status === "aguardando_aprovacao" && (await parcelas(a2)).length === 0
      && (await um("select status from public.payables where id = $1", [tR])).status === "aberta"
      && (await situacao(dB)) === "acordo_em_andamento"
      && Number((await um("select count(*) n from public.notifications where user_id = $1 and title like '%aprovação%'", [ids.admin])).n) === nAdm + 1);
  ok("o Financeiro não aprova", /Admin Master/.test((await como(ids.financeiro, () => erroDe("select public.debt_agreement_decide($1, true, null)", [a2]))) ?? ""));
  await como(ids.admin, () => c.query("select public.debt_agreement_decide($1, true, 'ok')", [a2]));
  const p2 = await parcelas(a2);
  ok("o Admin aprova: o restabelecido vira renegociada, 3 parcelas, sem desconto ainda (proporcional)",
    (await doAcordo(a2)).status === "em_andamento" && (await doAcordo(a2)).approved_by === ids.admin && p2.length === 3
      && (await um("select status from public.payables where id = $1", [tR])).status === "renegociada"
      && (await reconhecido(a2, "d")) === 0);
  const pg1 = await pagar(p2[0].id, 20000);
  ok("pagou 1/3: desconto reconhecido R$ 100 (D × pago ÷ T)", (await reconhecido(a2, "d")) === 10000);
  await como(ids.financeiro, () => c.query("select public.reverse_payable_payment($1, 'ensaio do estorno')", [pg1]));
  ok("estornou o pagamento: o desconto volta a zero", (await reconhecido(a2, "d")) === 0);
  await pagar(p2[0].id, 20000); await pagar(p2[1].id, 20000); await pagar(p2[2].id, 20000);
  ok("tudo pago: desconto = R$ 300 no centavo; acordo cumprido", (await reconhecido(a2, "d")) === 30000 && (await doAcordo(a2)).status === "cumprido");
  const itensA = await todas("select item, due_on from public.debt_closing_items where debt_id = $1 order by item", [dA]);
  const itensB = await todas("select item from public.debt_closing_items where debt_id = $1 order by item", [dB]);
  ok("quitadas: checklist só com o que se aplica (A: quitação + negativação com prazo; B: quitação + processo)",
    (await situacao(dA)) === "quitada_pendencias" && (await situacao(dB)) === "quitada_pendencias"
      && j(itensA.map((x) => x.item)) === j(["baixa_negativacao", "quitacao"]) && itensA[0].due_on !== null
      && j(itensB.map((x) => x.item)) === j(["processo_extinto", "quitacao"]));
  const item = async (debt, it) => (await um("select id from public.debt_closing_items where debt_id = $1 and item = $2", [debt, it])).id;
  ok("\"não se aplica\" sem motivo: recusa", /aplica/.test((await como(ids.financeiro, async () => erroDe("select public.debt_closing_save($1::jsonb)", [j({ id: await item(dA, "baixa_negativacao"), applicable: false })]))) ?? ""));
  const eQ = await como(ids.financeiro, async () => erroDe("select public.debt_closing_save($1::jsonb)", [j({ id: await item(dA, "quitacao"), done: true, done_on: hoje })]));
  if (eQ) console.log("   erro:", eQ);
  ok("falta um item: segue pendências", (await situacao(dA)) === "quitada_pendencias");
  await como(ids.financeiro, async () => c.query("select public.debt_closing_save($1::jsonb)", [j({ id: await item(dA, "baixa_negativacao"), done: true })]));
  ok("checklist completo: Quitada — encerrada", (await situacao(dA)) === "quitada_encerrada");

  console.log("\n6. Desfazer e recusar");
  await c.query("update public.debt_settings set agreement_approval_threshold_cents = null, discount_recognition = 'na_data_do_acordo' where clinic_id is null");
  const dU = await salvar({ ...base, original_cents: 50000, updated_cents: null });
  const tU = await gerar(dU);
  const propU = await como(ids.financeiro, async () => (await um("select public.debt_save_proposal($1::jsonb) v",
    [j({ debt_id: dU, proposed_on: hoje, amount_cents: 60000, payment_kind: "a_vista", source: "credor" })])).v);
  const a3 = await acordo(ids.financeiro, { debt_ids: [dU], agreed_on: hoje, total_cents: 60000, proposal_id: propU, schedule: sched([[mais(hoje, 5), 60000]]) });
  const eSur = await um("select * from public.financial_entries where source_type = 'debt_agreement_surcharge' and source_id = $1", [a3]);
  ok("T > S: encargos da renegociação R$ 100 na 4.2.01", eSur && eSur.account_code === "4.2.01" && eSur.direction === "outflow" && Number(eSur.amount_cents) === 10000);
  await como(ids.financeiro, () => c.query("select public.debt_agreement_undo($1, 'Combinado errado')", [a3]));
  ok("desfeito: título volta a aberta, a parcela é cancelada, os encargos também, a proposta volta a ativa",
    (await um("select status from public.payables where id = $1", [tU])).status === "aberta"
      && (await parcelas(a3)).every((t) => t.status === "cancelada")
      && (await um("select status from public.financial_entries where id = $1", [eSur.id])).status === "cancelled"
      && (await um("select status from public.debt_proposals where id = $1", [propU])).status === "ativa"
      && (await doAcordo(a3)).status === "desfeito" && (await situacao(dU)) !== "acordo_em_andamento");
  await c.query("update public.debt_settings set agreement_approval_threshold_cents = 100 where clinic_id is null");
  const a4 = await acordo(ids.admin, { debt_ids: [dU], agreed_on: hoje, total_cents: 40000, schedule: sched([[hoje, 40000]]) });
  ok("o Admin que registrou não aprova o próprio acordo", /outro Admin/.test((await como(ids.admin, () => erroDe("select public.debt_agreement_decide($1, true, null)", [a4]))) ?? ""));
  const a5 = await como(ids.financeiro, () => erroDe("select public.debt_agreement_save($1::jsonb)",
    [j({ debt_ids: [dU], agreed_on: hoje, total_cents: 40000, schedule: sched([[hoje, 40000]]) })]));
  ok("dois acordos esperando na mesma dívida: recusa", /já está no acordo/.test(a5 ?? ""));
  ok("recusar sem motivo: recusa", /motivo/.test((await como(ids.financeiro, () => erroDe("select public.debt_agreement_undo($1, '')", [a4]))) ?? ""));
  await como(ids.financeiro, () => c.query("select public.debt_agreement_undo($1, 'Desisti do pedido')", [a4]));
  ok("acordo esperando aprovação pode ser desfeito antes", (await doAcordo(a4)).status === "desfeito");
  const a6 = await acordo(ids.financeiro, { debt_ids: [dU], agreed_on: hoje, total_cents: 40000, schedule: sched([[hoje, 40000]]) });
  await como(ids.admin, () => c.query("select public.debt_agreement_decide($1, false, 'Desconto pequeno demais')", [a6]));
  ok("recusado: nada gerado, título intacto, situação de volta",
    (await doAcordo(a6)).status === "recusado" && (await parcelas(a6)).length === 0
      && (await um("select status from public.payables where id = $1", [tU])).status === "aberta" && (await situacao(dU)) !== "acordo_em_andamento");

  console.log("\n7. Quem pode");
  ok("Gerente não lê acordos, dívidas do acordo nem checklist", (await como(ids.gerente, async () => Number((await um(
    "select (select count(*) from public.debt_agreements) + (select count(*) from public.debt_agreement_debts) + (select count(*) from public.debt_closing_items) n")).n))) === 0);
  ok("Gerente não renegocia", /permissão/.test((await previa(ids.gerente, cond2)).problem ?? "")
    && /permissão/.test((await como(ids.gerente, () => erroDe("select public.debt_agreement_save($1::jsonb)", [j(cond2)]))) ?? ""));
  ok("Gerente não vê posições", (await como(ids.gerente, async () => (await todas("select * from public.debt_positions()")).length)) === 0);
  for (const fn of ["debt_agreement_save('{}'::jsonb)", "debt_agreement_preview('{}'::jsonb)", "debt_agreement_decide(gen_random_uuid(), true, null)",
    "debt_agreement_undo(gen_random_uuid(), 'x')", "debt_agreement_reestablish(gen_random_uuid(), '{}'::jsonb)", "debt_closing_save('{}'::jsonb)",
    "debt_positions()", "_debt_positions('{}'::uuid[])", "_debt_agreement_activate(gen_random_uuid())", "_debt_agreements_daily()"]) {
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
