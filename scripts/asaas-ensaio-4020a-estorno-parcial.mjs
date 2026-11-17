// ENSAIO DA 4020a (o estorno parcial pelo Asaas, spec 19.38) no banco de TREINO,
// numa transação DESFEITA. O Asaas não é chamado: o que o servidor grava depois
// do pedido e os avisos do Asaas são simulados pelas mesmas portas.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4020a-estorno-parcial.mjs --confirmar [--quebrar=parcial|taxa|parcela|confirma|regua]
//
// PROVADO QUEBRANDO:
//   `parcial`  = o aviso do parcial desfaz a baixa;
//   `taxa`     = o parcial apaga a taxa da rede;
//   `parcela`  = a parcela estornada inteira volta a ser cobrada (não fica "Estornada");
//   `confirma` = quem pediu confirma o próprio estorno de cartão;
//   `regua`    = a queda dos 30 dias não devolve a cobrança a "Paga".
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const Q = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const c = await connect();
const ok = [];
const falha = [];
const conf = (n, v) => (v ? ok : falha).push(n);
const um = async (s, p = []) => (await c.query(s, p)).rows[0];
const todos = async (s, p = []) => (await c.query(s, p)).rows;
const n = (x) => Number(x ?? 0);
async function pessoa(id, sql, params = []) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  await c.query("savepoint p");
  try {
    const r = (await c.query(sql, params)).rows;
    await c.query("release savepoint p");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint p");
    return `erro: ${e.message}`;
  } finally {
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claims', '', true)");
  }
}
const erro = (r, k) => typeof r === "string" && r.includes(k);

try {
  await c.query("begin");
  const sql = readFileSync("supabase/migrations/4020a_asa4_estorno_parcial_pelo_asaas.sql", "utf8");
  await c.query(sql);
  await c.query(sql);
  conf("a 4020a roda duas vezes sem erro", true);
  const trocar = async (sig, de, para) => {
    const f = (await um(`select pg_get_functiondef('${sig}'::regprocedure) d`)).d;
    if (!f.includes(de)) throw new Error(`QUEBRA: trecho não achado em ${sig}`);
    await c.query(f.replace(de, para));
  };
  if (Q === "parcial") await trocar("public._charge_refund_partial_event(uuid, jsonb)", "        update public.charges set refund_state = null where id = p_charge_id;",
    "        update public.charges set refund_state = null where id = p_charge_id;\n        perform public._gateway_reverse_receipt((select receipt_id from public.charges where id = p_charge_id), 'quebra');");
  if (Q === "taxa") await trocar("public._charge_refund_partial_event(uuid, jsonb)", "        update public.charges set refund_state = null where id = p_charge_id;",
    "        update public.charges set refund_state = null where id = p_charge_id;\n        update public.split_charges set reversed = true where charge_id = p_charge_id;");
  if (Q === "parcela") await c.query("drop trigger if exists zz_payment_receipts_refund_close on public.payment_receipts");
  if (Q === "confirma") await trocar("public.refund_request_confirm(uuid)", "  if r.requested_by = v_user then raise exception 'SELF_CONFIRM'; end if;", "");
  if (Q === "regua") await trocar("public._refund_fell(uuid, text)", "  update public.charges set refund_state = null where id = f.charge_id;", "");
  if (Q) console.log(`   (QUEBRADO de propósito: ${Q})`);

  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "recepcao"]) P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`])).id;
  const U = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'")).id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("gerente", U, "unit_manager");
  await papel("financeiro", franq, "finance_franchisor");
  await papel("recepcao", U, "receptionist");
  const BLOCO = "4bd55119-985e-4ca0-9d60-92b2bc93b043";
  const parcelas = await todos("select id, installment_number, paid_cents, receipt_id, payment_installment_id, client_id from public.charges where installment_block = $1 order by installment_number", [BLOCO]);
  if (parcelas.length !== 3) throw new Error("NÃO MEDI: o parcelamento de prova não está no treino.");
  await c.query("delete from public.charge_refunds where charge_id = any($1)", [parcelas.map((x) => x.id)]);
  await c.query("update public.charges set refund_state = null where installment_block = $1", [BLOCO]);
  await c.query("update public.gateway_split_settings set card_refund_confirm_above_cents = null where id");

  // --- 1) a repartição prevista e a confirmação reforçada ---------------------------
  const prev = (await pessoa(P.admin, "select public.refund_request_preview($1::jsonb) j", [JSON.stringify({ block_id: BLOCO, amount_cents: 12000 })]))[0].j;
  const ex = prev.expected_split ?? [];
  conf(`a previsão do parcelado: a parcela 1 inteira (R$ 100,00) e R$ 20,00 da 2 (${JSON.stringify(ex.map((x) => [x.numero, x.valor_cents, x.inteira]))})`,
    ex.length === 2 && ex[0].numero === 1 && ex[0].inteira === true && n(ex[0].valor_cents) === 10000 && ex[1].numero === 2 && n(ex[1].valor_cents) === 2000 && ex[1].inteira === false);
  conf("a previsão mostra o paciente e diz que precisa da confirmação (limite em branco)", prev.needs_confirm === true && !!prev.patient?.code);
  conf("a Recepção não pede estorno", erro(await pessoa(P.recepcao, "select public.refund_request_create($1::jsonb)", [JSON.stringify({ block_id: BLOCO, amount_cents: 12000, reason: "teste da recepção" })]), "NOT_ALLOWED"));
  conf("o estorno pede motivo", erro(await pessoa(P.admin, "select public.refund_request_create($1::jsonb)", [JSON.stringify({ block_id: BLOCO, amount_cents: 12000, reason: "x" })]), "REASON_REQUIRED"));
  conf("acima do que foi pago, recusa", erro(await pessoa(P.admin, "select public.refund_request_create($1::jsonb)", [JSON.stringify({ block_id: BLOCO, amount_cents: 99999, reason: "valor alto demais" })]), "AMOUNT_OVER_BALANCE"));
  const rq = (await pessoa(P.admin, "select public.refund_request_create($1::jsonb) j", [JSON.stringify({ block_id: BLOCO, amount_cents: 12000, reason: "Desistência parcial do tratamento" })]))[0].j;
  conf("o pedido de cartão fica esperando a confirmação", rq.needs_confirm === true && (await um("select status from public.refund_requests where id = $1", [rq.id])).status === "confirmar");
  conf("o Gerente é avisado para confirmar", !!(await um("select 1 x from public.notifications where user_id = $1 and title = 'Estorno de cartão para confirmar'", [P.gerente])));
  conf("um segundo pedido no mesmo parcelamento é recusado", erro(await pessoa(P.admin, "select public.refund_request_create($1::jsonb)", [JSON.stringify({ block_id: BLOCO, amount_cents: 1000, reason: "segundo pedido" })]), "REFUND_PENDING"));
  conf("quem pediu não confirma o próprio estorno", erro(await pessoa(P.admin, "select public.refund_request_confirm($1)", [rq.id]), "SELF_CONFIRM"));
  conf("a Recepção não confirma", erro(await pessoa(P.recepcao, "select public.refund_request_confirm($1)", [rq.id]), "NOT_ALLOWED"));
  const lidoG = (await pessoa(P.gerente, "select public.refund_requests_read($1) j", [parcelas[0].client_id]))[0].j;
  conf("a ficha mostra ao Gerente o botão de confirmar", lidoG.some((x) => x.id === rq.id && x.can_confirm === true));
  conf("o Gerente confirma", Array.isArray(await pessoa(P.gerente, "select public.refund_request_confirm($1)", [rq.id])));
  const env = (await um("select public._refund_request_for_send($1) j", [rq.id])).j;
  conf("pronto para ir ao Asaas, com as parcelas e a parte da franqueadora", env?.kind === "cartao" && (env.charges ?? []).length === 3 && env.hq_part_cents !== undefined);

  // O limite na Central: abaixo dele, o cartão vai sem a confirmação; Pix nunca precisa.
  await c.query("update public.gateway_split_settings set card_refund_confirm_above_cents = 50000 where id");
  conf("abaixo do limite da Central, o cartão não precisa da confirmação", (await um("select public._refund_needs_confirm('cartao', 12000) v")).v === false);
  conf("o Pix nunca precisa da confirmação", (await um("select public._refund_needs_confirm('pix', 9999999) v")).v === false);
  await c.query("update public.gateway_split_settings set card_refund_confirm_above_cents = null where id");

  // --- 2) o que o Asaas fez (cuidado 2) --------------------------------------------
  await c.query("select public._refund_request_sent($1, $2::jsonb)", [rq.id, JSON.stringify({
    result: "ok",
    refunds: [
      { charge_id: parcelas[0].id, amount_cents: 10000, inteira: true, asaas_status: "DONE" },
      { charge_id: parcelas[1].id, amount_cents: 2000, inteira: false, asaas_status: "PENDING" },
    ],
  })]);
  const r1 = await um("select status, split_differs from public.refund_requests where id = $1", [rq.id]);
  conf(`a repartição real igual à prevista: sem aviso (${r1.status}, difere=${r1.split_differs})`, r1.status === "enviado" && r1.split_differs === false);
  const fr = await todos("select charge_id, status, amount_cents from public.charge_refunds where request_id = $1", [rq.id]);
  conf("a parcela inteira fica concluída; a parte, pedida", fr.some((x) => x.charge_id === parcelas[0].id && x.status === "concluido" && x.amount_cents === null)
    && fr.some((x) => x.charge_id === parcelas[1].id && x.status === "pedido" && n(x.amount_cents) === 2000));

  // A repartição diferente avisa quem pediu e o Financeiro.
  const rq2 = (await um(`insert into public.refund_requests (clinic_id, client_id, installment_block, kind, amount_cents, partial, reason, requested_by, status, expected_split)
     values ($1, $2, gen_random_uuid(), 'cartao', 3000, true, 'teste da repartição', $3, 'enviar', $4::jsonb) returning id`,
    [U, parcelas[0].client_id, P.admin, JSON.stringify([{ charge_id: parcelas[2].id, valor_cents: 3000, inteira: false }])])).id;
  await c.query("select public._refund_request_sent($1, $2::jsonb)", [rq2, JSON.stringify({ result: "ok", refunds: [{ charge_id: parcelas[2].id, amount_cents: 2500, inteira: false, asaas_status: "PENDING" }] })]);
  conf("a repartição diferente da prevista avisa quem pediu e o Financeiro", (await um("select split_differs from public.refund_requests where id = $1", [rq2])).split_differs === true
    && !!(await um("select 1 x from public.notifications where user_id = $1 and title = 'Estorno: o Asaas repartiu diferente da previsão'", [P.financeiro])));
  await c.query("delete from public.charge_refunds where request_id = $1", [rq2]);

  // --- 3) o aviso do parcial: a parcela continua paga, a taxa continua -----------------
  const ROOT = (await um("select gateway_account_id id from public.charges where id = $1", [parcelas[1].id])).id;
  const pay2 = (await um("select asaas_payment_id from public.charges where id = $1", [parcelas[1].id])).asaas_payment_id;
  const taxaAntes = await um("select count(*) filter (where not reversed) n, sum(retained_cents) r from public.split_charges where charge_id = $1", [parcelas[1].id]);
  const evento = async (ev, payId, chargeId, extra) => {
    const e = await um(`insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload) values ($1, $2, $3, $4::jsonb) returning id`,
      [ROOT, `evt_4020a_${ev}_${Math.random()}`, ev, JSON.stringify({ payment: { id: payId, externalReference: chargeId, ...extra } })]);
    return (await um("select public._gateway_apply_event($1) r", [e.id])).r;
  };
  const rp = await evento("PAYMENT_PARTIALLY_REFUNDED", pay2, parcelas[1].id, {
    value: 100, status: "CONFIRMED", refunds: [{ value: 20, status: "DONE", transactionReceiptUrl: "https://sandbox.asaas.com/comprovantes/ensaio" }],
  });
  const f2 = await um("select status, receipt_url from public.charge_refunds where charge_id = $1 and request_id = $2", [parcelas[1].id, rq.id]);
  conf(`o aviso do parcial fecha o pedido com o comprovante (${rp}, ${f2.status})`, rp === "estorno_parcial" && f2.status === "concluido" && !!f2.receipt_url);
  const inst2 = await um("select status from public.payment_installments where id = $1", [parcelas[1].payment_installment_id]);
  conf(`a parcela do parcial continua paga (${inst2.status})`, inst2.status === "paga");
  const taxaDepois = await um("select count(*) filter (where not reversed) n, sum(retained_cents) r from public.split_charges where charge_id = $1", [parcelas[1].id]);
  conf("a taxa da rede da parcela do parcial continua (nada estornado, o retido igual)", n(taxaDepois.n) === n(taxaAntes.n) && n(taxaDepois.r) === n(taxaAntes.r));

  // --- 4) a parcela estornada inteira: "Estornada" (cuidado 3) ------------------------
  const pay1 = (await um("select asaas_payment_id from public.charges where id = $1", [parcelas[0].id])).asaas_payment_id;
  await evento("PAYMENT_REFUNDED", pay1, parcelas[0].id, { value: 100, status: "REFUNDED" });
  const inst1 = await um("select status, refund_closed_at from public.payment_installments where id = $1", [parcelas[0].payment_installment_id]);
  conf(`a parcela estornada inteira fica encerrada como "Estornada" (${inst1.status})`, inst1.status === "cancelada" && !!inst1.refund_closed_at);
  conf("a taxa da rede dela continua devida (mantida no estorno, não estornada)",
    !!(await um("select 1 x from public.split_charges where receipt_id = $1 and kept_after_refund and not reversed", [parcelas[0].receipt_id])));
  conf("a Recepção não reabre", erro(await pessoa(P.recepcao, "select public.installment_refund_reopen($1, 'reabrir agora')", [parcelas[0].payment_installment_id]), "NOT_ALLOWED"));
  conf("reabrir exige motivo", erro(await pessoa(P.gerente, "select public.installment_refund_reopen($1, 'x')", [parcelas[0].payment_installment_id]), "REASON_REQUIRED"));
  conf("o Gerente reabre, com motivo", Array.isArray(await pessoa(P.gerente, "select public.installment_refund_reopen($1, 'Paciente voltou a pagar')", [parcelas[0].payment_installment_id]))
    && (await um("select status from public.payment_installments where id = $1", [parcelas[0].payment_installment_id])).status === "em_aberto");

  // --- 5) a régua: o Pix esperando a autorização, a queda e a recusa -----------------
  const pix = await um(`select c.id, c.client_id from public.charges c where c.billing_type = 'PIX' and c.status in ('paga', 'liquidada')
                         and c.installment_block is null and c.source_type = 'installment' and c.receipt_id is not null and c.refund_state is null limit 1`);
  await c.query("delete from public.charge_refunds where charge_id = $1", [pix.id]);
  const rp1 = (await pessoa(P.admin, "select public.refund_request_create($1::jsonb) j", [JSON.stringify({ charge_id: pix.id, amount_cents: 100, reason: "Devolução parcial do Pix" })]))[0].j;
  conf("o Pix parcial vai direto, sem confirmação", rp1.needs_confirm === false && (await um("select status from public.refund_requests where id = $1", [rp1.id])).status === "enviar");
  await c.query("select public._refund_request_sent($1, $2::jsonb)", [rp1.id, JSON.stringify({ result: "ok", refunds: [{ charge_id: pix.id, amount_cents: 100, inteira: false, asaas_status: "AWAITING_CRITICAL_ACTION_AUTHORIZATION" }] })]);
  conf("o Pix fica esperando a autorização do titular", (await um("select refund_state from public.charges where id = $1", [pix.id])).refund_state === "aguardando_autorizacao");
  const fpix = (await um("select id from public.charge_refunds where charge_id = $1 and status = 'pedido'", [pix.id])).id;
  await c.query("select public._refund_regua_notice($1, 'semana')", [fpix]);
  await c.query("select public._refund_regua_notice($1, 'dia25')", [fpix]);
  conf("os lembretes da semana e do 25º dia saem", n((await um("select reminders from public.charge_refunds where id = $1", [fpix])).reminders) === 2
    && !!(await um("select 1 x from public.notifications where title = 'Estorno cai em 5 dias sem a autorização' and created_at = now()")));
  // A devolução do distrato ligada a este pedido volta para "pedir" quando cai.
  const canc = await um("select id, clinic_id from public.plan_cancellations limit 1");
  const dr = canc ? (await um(`insert into public.distrato_refunds (clinic_id, cancellation_id, client_id, amount_cents, reason, term_path, status, requested_by, method, charge_id)
       values ($1, $2, $3, 100, 'devolução de teste', 'ensaio/termo.pdf', 'autorizada', $4, 'estorno_asaas', $5) returning id`, [canc.clinic_id, canc.id, pix.client_id, P.gerente, pix.id])).id : null;
  if (dr) await c.query("update public.refund_requests set distrato_refund_id = $2 where id = $1", [rp1.id, dr]);
  await c.query("select public._refund_fell($1, 'caiu')", [fpix]);
  conf("caiu aos 30 dias: a cobrança volta a \"Paga\"", (await um("select refund_state from public.charges where id = $1", [pix.id])).refund_state === null
    && (await um("select status from public.charge_refunds where id = $1", [fpix])).status === "caiu");
  if (dr) conf("e a devolução do distrato volta para \"pedir\"", (await um("select status from public.distrato_refunds where id = $1", [dr])).status === "pedida");

  // --- 6) sem saldo: a unidade não vê o saldo da franqueadora --------------------------
  const rp2r = await pessoa(P.admin, "select public.refund_request_create($1::jsonb) j", [JSON.stringify({ charge_id: pix.id, reason: "Estorno total do Pix" })]);
  conf("depois da queda, um novo pedido pode ser feito", Array.isArray(rp2r));
  const rp2 = Array.isArray(rp2r) ? rp2r[0].j : { id: "00000000-0000-0000-0000-000000000000" };
  await c.query("select public._refund_request_sent($1, $2::jsonb)", [rp2.id, JSON.stringify({ result: "sem_saldo", detalhe: "A conta da franqueadora tem R$ 1,00 e a parte dela é R$ 2,00." })]);
  const nq = await um("select body from public.notifications where user_id = $1 and title = 'Estorno pelo Asaas temporariamente indisponível' order by created_at desc limit 1", [P.admin]);
  conf("sem saldo: quem pediu vê só \"temporariamente indisponível\", sem o saldo", !!nq && !/R\$/.test(nq.body));
  conf("o Financeiro recebe o detalhe do saldo", !!(await um("select 1 x from public.notifications where user_id = $1 and title = 'Estorno parado por falta de saldo' and body like '%R$ 1,00%'", [P.financeiro])));
  await c.query("select public._refund_request_balance_back($1)", [rp2.id]);
  conf("o saldo voltou: quem pediu é avisado", !!(await um("select 1 x from public.notifications where user_id = $1 and title = 'O estorno pelo Asaas voltou a ficar disponível'", [P.admin])));

  // --- 7) o distrato: autorizado pelo Financeiro, vai pelo Asaas -------------------------
  if (canc) {
    const d2 = (await um(`insert into public.distrato_refunds (clinic_id, cancellation_id, client_id, amount_cents, reason, term_path, status, requested_by, method, charge_id)
         values ($1, $2, $3, 100, 'devolução pelo Asaas', 'ensaio/termo.pdf', 'pedida', $4, 'estorno_asaas', $5) returning id`, [canc.clinic_id, canc.id, pix.client_id, P.gerente, pix.id])).id;
    const dec = await pessoa(P.financeiro, "select public.distrato_refund_decide($1, true, 'ok') id", [d2]);
    const req = Array.isArray(dec) ? await um("select status, confirmed_by, distrato_refund_id from public.refund_requests where id = $1", [dec[0].id]) : null;
    conf("o distrato pelo Asaas: o Financeiro autoriza e o pedido fica pronto para ir (sem conta a pagar)", req?.status === "enviar" && req?.confirmed_by === P.financeiro && req?.distrato_refund_id === d2
      && !(await um("select payable_id from public.distrato_refunds where id = $1", [d2])).payable_id);
  }

  const fechadas = await todos(`select distinct p.tablename, f.proname from pg_policies p
      join pg_proc f on strpos(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), f.proname || '(') > 0
      join pg_namespace ns on ns.oid = f.pronamespace and ns.nspname = 'public'
     where not has_function_privilege('authenticated', f.oid, 'execute')`);
  conf(`nenhuma regra de acesso chama função fechada (${fechadas.map((x) => x.proname).join(", ") || "nenhuma"})`, fechadas.length === 0);
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
