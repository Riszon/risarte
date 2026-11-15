// ENSAIO DA 4017 (ASA4, entrega 3 — a renegociação assinada pela ZapSign) no
// banco de TREINO, numa transação DESFEITA (rollback): nada fica gravado; o
// Asaas e a ZapSign não são chamados (o cancelamento no Asaas e o envio do termo
// são do servidor; aqui se prova o banco, fazendo o papel do servidor).
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa4-renegociacao.mjs --confirmar [--quebrar=assinatura|pagamento|expira|falha]
//
// PROVADO QUEBRANDO (19.28.12, pedido do Jeferson):
//   --quebrar=assinatura  a assinatura deixa de cancelar os antigos e criar os novos
//   --quebrar=pagamento   o pagamento antes da assinatura deixa de cancelar o acordo
//   --quebrar=expira      a rotina deixa de expirar o termo vencido
//   --quebrar=falha       a aplicação deixa de recusar parcela antiga que mudou (falha no meio)
// Os quatro têm de reprovar o ensaio.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4017_asa4_renegociacao_assinada.sql";
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
const erro = (r, ...codigos) => typeof r === "string" && codigos.some((k) => r.includes(k));
const passou = (r) => Array.isArray(r);
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const mesesDepois = (s, k) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + k, d)));
};
const sha = (t) => createHash("sha256").update(t).digest("hex");

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query("savepoint dup");
  try {
    await c.query(sql);
    await c.query("release savepoint dup");
    conf("a 4017 roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4017 roda duas vezes sem erro (${e.message})`, false);
  }
  const trocar = async (assinatura, de, para) => {
    const f = await um(`select pg_get_functiondef('${assinatura}'::regprocedure) d`);
    if (!f.d.includes(de)) throw new Error(`QUEBRA: trecho não achado em ${assinatura}`);
    await c.query(f.d.replace(de, para));
  };
  if (QUEBRAR === "assinatura") {
    await trocar("public.renegotiation_apply_signed(uuid, text, uuid)", "perform public.apply_renegotiation(p_id);", "");
    console.log("   (QUEBRADO de propósito: a assinatura não aplica)");
  } else if (QUEBRAR === "pagamento") {
    await c.query("drop trigger payment_receipts_cancel_pending_renegotiation on public.payment_receipts");
    console.log("   (QUEBRADO de propósito: o pagamento antes da assinatura não cancela o acordo)");
  } else if (QUEBRAR === "expira") {
    await trocar("public.renegotiation_expire_run()", "and sign_deadline < public.today_br()", "and false");
    console.log("   (QUEBRADO de propósito: a rotina não expira)");
  } else if (QUEBRAR === "falha") {
    await trocar("public.renegotiation_apply_signed(uuid, text, uuid)", "raise exception 'SOURCE_CHANGED';", "null;");
    console.log("   (QUEBRADO de propósito: a aplicação não confere a parcela antiga)");
  }

  // --- o cenário ---------------------------------------------------------------
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "recepcao", "consultor"]) {
    P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
  }
  for (const k of ["admin", "gerente", "financeiro", "recepcao"]) if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("gerente", ldn, "unit_manager");
  await papel("recepcao", ldn, "receptionist");
  await papel("financeiro", franq, "finance_franchisor");
  const cli = await um(
    `select c.id, c.full_name from public.clients c
      where c.clinic_id = $1 and public._cpf_ok(c.cpf) and c.birth_date < current_date - interval '19 years'
        and not exists (select 1 from public.client_guardians g where g.client_id = c.id)
      order by c.created_at limit 1`, [ldn]);
  if (!cli) throw new Error("NÃO MEDI: nenhum cliente de Londrina com CPF válido.");
  if (!(await um("select public.central_is_ready($1) r", [ldn])).r) throw new Error("NÃO MEDI: Londrina não está pronta na Central do treino.");
  await c.query("insert into public.gateway_auto_charge_units (clinic_id, enabled, enabled_from) values ($1, true, now() - interval '1 minute') on conflict (clinic_id) do update set enabled = true, enabled_from = now() - interval '1 minute'", [ldn]);
  await c.query("update public.sale_method_settings set card_machine_direct_sale = false where id");
  const hoje = iso((await um("select public.today_br() d")).d);
  let primeiro = iso(new Date(Date.now() + 5 * 86400000));
  if (Number(primeiro.slice(8, 10)) > 28) primeiro = primeiro.slice(0, 8) + "05";

  // Uma venda direta (forma 2) com 6 boletos e 1 Pix, assinada, com os boletos emitidos.
  const novaVenda = async (forma = "todos", assinar = true) => {
    const v = (await um("insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, created_by) values ($1, $2, $3, 70000, 'boleto', 7, $4) returning id", [ldn, cli.id, cli.full_name, P.recepcao])).id;
    const linhas = [
      ...Array.from({ length: 6 }, (_, k) => ({ kind: "parcela", due_date: mesesDepois(primeiro, k), amount_cents: 10000, payment_method: "boleto" })),
      { kind: "parcela", due_date: mesesDepois(primeiro, 1), amount_cents: 10000, payment_method: "dinheiro" },
    ];
    const s = await pessoa(P.recepcao, "select public.save_payment_schedule(null, $1, $2::jsonb)", [v, JSON.stringify(linhas)]);
    if (!passou(s)) throw new Error(`parcelamento: ${s}`);
    if (forma === "todos" && !passou(await pessoa(P.gerente, "select public.sale_boleto_mode_set(null, $1, 'todos')", [v]))) throw new Error("forma 2");
    if (assinar) {
      await c.query("update public.direct_sales set contract_signed = true, closed_at = now() where id = $1", [v]);
      for (const d of await todos("select d.installment_id from public._auto_charge_due(null, null, $1, 100) d where d.billing_type = 'BOLETO'", [v])) {
        const id = (await um("select public._charge_prepare_system($1, 'BOLETO', 'venda_direta') id", [d.installment_id])).id;
        await um("select public._charge_mark_issued($1, $2, null, $3, null, null, $4)", [id, `pay_rn_${id.slice(0, 8)}`, `https://sandbox.asaas.com/i/${id.slice(0, 6)}`, "23790001"]);
      }
    }
    return v;
  };
  const parcelasDa = (v, meio = "boleto") => todos("select i.id, i.seq, i.due_date, i.amount_cents from public.payment_installments i where i.direct_sale_id = $1 and i.payment_method = $2 and i.status in ('em_aberto','parcial') order by i.due_date, i.seq", [v, meio]);
  const novas = (k, meio = "boleto", valor = 10000, inicio = mesesDepois(primeiro, 8)) =>
    Array.from({ length: k }, (_, j) => ({ kind: "parcela", due_date: mesesDepois(inicio, j), amount_cents: valor, payment_method: meio }));
  const salvar = (quem, ids, entradas, modo = null) =>
    pessoa(quem, "select public.save_renegotiation($1, $2::uuid[], $3::jsonb, 'ensaio 4017', 0, $4) id", [cli.id, ids, JSON.stringify(entradas), modo]);
  const reneg = (id) => um("select * from public.payment_renegotiations where id = $1", [id]);
  const vivosDe = (ids) => todos("select id from public.charges where payment_installment_id = any($1) and status in ('emitida','vencida','emitindo') and not is_external", [ids]);
  // O papel do servidor na assinatura: cancela os boletos vivos (como o Asaas faria) e aplica.
  const assinar = async (id) => {
    const r = await reneg(id);
    const primeira = await servidor("select public.renegotiation_apply_signed($1, 'zapsign', null)", [id]);
    if (passou(primeira)) return primeira;
    if (!erro(primeira, "CHARGE_ACTIVE")) return primeira;
    for (const v of await vivosDe(r.source_installment_ids)) await um("select public._charge_mark_cancelled_system($1, $2, 'renegociação assinada')", [v.id, P.gerente]);
    return servidor("select public.renegotiation_apply_signed($1, 'zapsign', null)", [id]);
  };

  // --- 1) salvar não muda nada nas antigas -----------------------------------------
  const v1 = await novaVenda("todos");
  // A lista da venda existe ANTES da renegociação (o cliente já recebeu o link).
  const token = randomBytes(32).toString("hex");
  conf("a lista da venda é gerada", passou(await pessoa(P.gerente, "select public.boleto_list_issue(null, $1, $2)", [v1, sha(token)])));
  const [a1, a2] = await parcelasDa(v1);
  const vivosAntes = (await vivosDe([a1.id, a2.id])).length;
  const s1 = await salvar(P.gerente, [a1.id, a2.id], novas(3, "boleto", 6667).map((e, j) => (j === 2 ? { ...e, amount_cents: 6666 } : e)));
  conf("a renegociação salva (cenário)", passou(s1));
  const r1id = passou(s1) ? s1[0].id : null;
  const r1 = r1id ? await reneg(r1id) : null;
  conf("salvar: fica aguardando assinatura (não aplica)", r1?.status === "aguardando_assinatura" && !r1?.applied_at && r1?.flow === "assinatura");
  conf("salvar: as parcelas antigas continuam em aberto", (await um("select count(*)::int n from public.payment_installments where id = any($1) and status = 'em_aberto'", [[a1.id, a2.id]])).n === 2);
  conf("salvar: nenhum boleto antigo é cancelado", vivosAntes === 2 && (await vivosDe([a1.id, a2.id])).length === 2);
  conf("o prazo do termo: até 5 dias, nunca depois do 1º vencimento novo", iso(r1?.sign_deadline) === iso(new Date(Math.min(Date.parse(hoje) + 5 * 86400000, Date.parse(mesesDepois(primeiro, 8)) - 86400000))));
  conf("a foto de cada parcela no dia (2 linhas)", (await um("select count(*)::int n from public.payment_renegotiation_sources where renegotiation_id = $1", [r1id])).n === 2);
  conf("as vendas de origem gravadas", (r1?.origin_direct_sale_ids ?? []).includes(v1));
  conf("a forma vem da venda de origem (forma 2)", r1?.boleto_mode === "todos");
  conf("o histórico da situação começa", (await um("select count(*)::int n from public.payment_renegotiation_events where renegotiation_id = $1 and status = 'aguardando_assinatura'", [r1id])).n === 1);
  conf("a ficha avisa a baixa da parcela presa", (await pessoa(P.recepcao, "select public.installment_pending_renegotiation($1) j", [a1.id]))?.[0]?.j?.status === "aguardando_assinatura");
  conf("a mesma parcela não entra em outro acordo enquanto este não vale", erro(await salvar(P.gerente, [a1.id], novas(1, "pix", 10000)), "RENEGOTIATION_PENDING"));

  // --- 2) o cancelamento da venda com o acordo aguardando assinatura: recusado (4015a) ---
  conf("cancelar a venda com o acordo aguardando assinatura: recusado", erro(await servidor("update public.direct_sales set cancelled = true where id = $1", [v1]), "RENEGOTIATED_OPEN"));

  // --- 3) assinado: cancela os boletos antigos e cria os novos -----------------------
  const ap = await assinar(r1id);
  conf("assinado: aplica (o servidor cancelou os boletos vivos antes)", passou(ap));
  const r1b = await reneg(r1id);
  conf("assinado: o acordo fica aplicado e assinado pela ZapSign", r1b.status === "aplicada" && r1b.signed_via === "zapsign" && r1b.contract_signed);
  conf("assinado: as antigas viram renegociadas", (await um("select count(*)::int n from public.payment_installments where id = any($1) and status = 'renegociada'", [[a1.id, a2.id]])).n === 2);
  conf("assinado: os boletos antigos ficaram cancelados pelo sistema", (await um("select count(*)::int n from public.charges where payment_installment_id = any($1) and status = 'cancelada' and cancel_system", [[a1.id, a2.id]])).n === 2);
  const n1 = await todos("select id from public.payment_installments where renegotiation_id = $1 order by seq", [r1id]);
  conf("assinado: as 3 parcelas novas nascem", n1.length === 3);
  const due1 = await todos("select * from public._auto_charge_due(null, null, null, 100, $1)", [r1id]);
  conf("assinado: as novas entram na cobrança automática (forma 2: todas, sem prazo)", due1.length === 3 && due1.every((d) => d.billing_type === "BOLETO" && d.origem === "renegociacao"));
  conf("aviso repetido da ZapSign não aplica duas vezes", passou(await servidor("select public.renegotiation_apply_signed($1, 'zapsign', null)", [r1id])) && (await todos("select id from public.payment_installments where renegotiation_id = $1", [r1id])).length === 3);
  const ids1 = [];
  for (const d of due1) {
    const id = (await um("select public._charge_prepare_system($1, 'BOLETO', 'renegociacao') id", [d.installment_id])).id;
    await um("select public._charge_mark_issued($1, $2, null, $3, null, null, $4)", [id, `pay_rn_n_${id.slice(0, 8)}`, `https://sandbox.asaas.com/i/n${id.slice(0, 6)}`, "23790002"]);
    ids1.push(id);
  }
  conf("os boletos novos saem pelo carnê (forma do acordo)", (await um("select count(*)::int n from public.charges where id = any($1) and via_carne and auto_origin = 'renegociacao'", [ids1])).n === 3);
  conf("o histórico registra a assinatura", (await um("select count(*)::int n from public.payment_renegotiation_events where renegotiation_id = $1 and status = 'aplicada' and previous_status = 'aguardando_assinatura'", [r1id])).n === 1);

  // --- 4) a lista da venda: um link só, com os novos e as antigas substituídas ----------
  const ler = async () => (await um("select public._boleto_list_read($1, 'ip', 'ensaio') j", [sha(token)])).j;
  const l1 = await ler();
  const sit = (l, s) => (l?.boletos ?? []).filter((b) => b.situacao === s).length;
  conf("a lista mostra as 2 antigas como substituídas", sit(l1, "substituido_renegociacao") === 2);
  conf("a lista mostra os 3 boletos novos do acordo (mesmo pagador)", (l1?.boletos ?? []).length === 6 + 3 && sit(l1, "a_pagar") === 4 + 3);
  conf("o aviso \"A lista mudou\" sai para o Gerente", (await um("select count(*)::int n from public.notifications where title = 'A lista de boletos mudou: reenvie o link' and user_id = $1", [P.gerente])).n >= 1);

  // --- 5) a troca do responsável financeiro entre a venda e a renegociação ---------------
  const g = (await um("insert into public.client_guardians (client_id, full_name, cpf, relationship, is_financial) values ($1, 'Responsável do ensaio', '52998224725', 'mãe', true) returning id", [cli.id])).id;
  const [a3] = await parcelasDa(v1);
  const s2 = await salvar(P.gerente, [a3.id], novas(1, "boleto", 10000, mesesDepois(primeiro, 12)));
  conf("renegociação depois da troca do responsável (cenário)", passou(s2));
  if (passou(s2)) {
    await assinar(s2[0].id);
    for (const d of await todos("select * from public._auto_charge_due(null, null, null, 100, $1)", [s2[0].id])) {
      const id = (await um("select public._charge_prepare_system($1, 'BOLETO', 'renegociacao') id", [d.installment_id])).id;
      await um("select public._charge_mark_issued($1, $2, null, $3, null, null, $4)", [id, `pay_rn_g_${id.slice(0, 8)}`, `https://sandbox.asaas.com/i/g${id.slice(0, 6)}`, "23790003"]);
      conf("o boleto novo sai no nome do responsável financeiro", (await um("select payer_guardian_id from public.charges where id = $1", [id])).payer_guardian_id === g);
    }
  }
  const l2 = await ler();
  conf("outro pagador: a lista antiga marca a antiga como substituída", sit(l2, "substituido_renegociacao") === 3);
  conf("outro pagador: a lista antiga NÃO mostra o boleto novo nem o valor do acordo", (l2?.boletos ?? []).length === (l1?.boletos ?? []).length);
  await c.query("delete from public.client_guardians where id = $1", [g]);

  // --- 6) o pagamento numa parcela antiga antes da assinatura ----------------------------
  const [d1] = await parcelasDa(v1, "dinheiro");
  const s3 = await salvar(P.gerente, [d1.id], novas(2, "pix", 5000));
  conf("acordo com parcela em dinheiro (cenário)", passou(s3));
  const pago = await pessoa(P.recepcao, "select public.register_payment_receipt(p_installment_id => $1, p_amount_cents => 10000, p_received_at => current_date, p_payment_method => 'dinheiro', p_client_token => gen_random_uuid())", [d1.id]);
  conf("o pagamento é aceito (a baixa não é recusada)", passou(pago));
  const r3 = passou(s3) ? await reneg(s3[0].id) : null;
  conf("pagou antes de assinar: o acordo é cancelado", r3?.status === "cancelada_pagamento");
  conf("…com aviso para refazer a quem negociou e ao Gerente", (await um("select count(*)::int n from public.notifications where title like 'O cliente pagou uma parcela da renegociação antes de assinar%' and user_id = $1", [P.gerente])).n >= 1);
  conf("…e a assinatura que chegar depois não aplica", r3 && erro(await servidor("select public.renegotiation_apply_signed($1, 'zapsign', null)", [r3.id]), "NOT_PENDING"));

  // --- 7) o termo expirado ------------------------------------------------------------
  const v2 = await novaVenda("mensal");
  const [b1] = await parcelasDa(v2);
  const s4 = await salvar(P.gerente, [b1.id], novas(2, "pix", 5000));
  conf("acordo para expirar (cenário)", passou(s4));
  await c.query("update public.payment_renegotiations set sign_deadline = public.today_br() - 1, signature_package_id = null where id = $1", [s4[0]?.id]);
  await um("select public.renegotiation_expire_run() n");
  const r4 = passou(s4) ? await reneg(s4[0].id) : null;
  conf("prazo vencido: a renegociação expira sozinha", r4?.status === "expirada");
  conf("expirada: nada muda na parcela antiga nem no boleto dela", (await um("select status from public.payment_installments where id = $1", [b1.id])).status === "em_aberto" && (await vivosDe([b1.id])).length === 1);
  conf("expirada: quem negociou e o Gerente são avisados", (await um("select count(*)::int n from public.notifications where title like 'Renegociação expirada sem assinatura%' and user_id = $1", [P.gerente])).n >= 1);
  const de_novo = await salvar(P.gerente, [b1.id], novas(1, "pix", 10000));
  conf("expirada: a parcela pode ser renegociada de novo", passou(de_novo));
  if (passou(de_novo)) await c.query("update public.payment_renegotiations set status = 'cancelada' where id = $1", [de_novo[0].id]);

  // --- 8) a falha no meio da operação --------------------------------------------------
  const [, b2] = await parcelasDa(v2);
  const s5 = await salvar(P.gerente, [b2.id], novas(2, "pix", 5000));
  conf("acordo para a falha (cenário)", passou(s5));
  // O Asaas cancelou o boleto (o servidor), e a parcela mudou antes de o banco aplicar.
  for (const x of await vivosDe([b2.id])) await um("select public._charge_mark_cancelled_system($1, $2, 'renegociação assinada')", [x.id, P.gerente]);
  await servidor("update public.payment_installments set status = 'cancelada' where id = $1", [b2.id]);
  const f5 = passou(s5) ? await servidor("select public.renegotiation_apply_signed($1, 'zapsign', null)", [s5[0].id]) : null;
  conf("falha no meio: a aplicação é recusada (a parcela antiga mudou)", erro(f5, "SOURCE_CHANGED"));
  conf("falha no meio: nada foi aplicado", passou(s5) && (await todos("select id from public.payment_installments where renegotiation_id = $1", [s5[0].id])).length === 0);
  await um("select public._boleto_op_failure_record($1::jsonb)", [JSON.stringify({ clinic_id: ldn, client_id: cli.id, direct_sale_id: v2, operation: "renegociação", installment_ids: [b2.id], cancelled_charge_ids: [], error: "SOURCE_CHANGED", actor_id: P.gerente })]);
  conf("falha no meio: vira operação interrompida, com aviso ao Gerente", (await um("select count(*)::int n from public.notifications where title = 'Operação interrompida: boleto cancelado sem a mudança' and user_id = $1", [P.gerente])).n >= 1);

  // --- 9) as recusas da 19.28.12 B e dos meios --------------------------------------------
  const vAberta = await novaVenda("mensal", false);
  const [x1] = await parcelasDa(vAberta);
  conf("renegociar parcela de venda não fechada: recusado (SALE_NOT_CLOSED)", erro(await salvar(P.gerente, [x1.id], novas(1, "pix", 10000)), "SALE_NOT_CLOSED"));
  const [b3] = await parcelasDa(v2);
  conf("recorrência no cartão: fora (METHOD_NOT_ALLOWED)", erro(await salvar(P.gerente, [b3.id], novas(1, "credito_recorrente", 10000)), "METHOD_NOT_ALLOWED"));
  conf("maquininha com a chave desligada: fora", erro(await salvar(P.gerente, [b3.id], novas(1, "cartao_parcelado", 10000)), "METHOD_NOT_ALLOWED"));
  await c.query("update public.sale_method_settings set card_machine_direct_sale = true where id");
  const maq = await salvar(P.gerente, [b3.id], novas(1, "cartao_parcelado", 10000));
  conf("maquininha com a chave ligada: aceita", passou(maq));
  await c.query("update public.payment_renegotiations set status = 'cancelada' where status in ('aguardando_assinatura','aguardando_autorizacao') and $1 = any(source_installment_ids)", [b3.id]);
  await c.query("update public.sale_method_settings set card_machine_direct_sale = false where id");
  conf("permuta pelo Financeiro: recusada", erro(await salvar(P.financeiro, [b3.id], novas(1, "permuta", 10000)), "PERMUTA_NOT_ALLOWED"));
  conf("permuta sem descrição: recusada", erro(await salvar(P.gerente, [b3.id], novas(1, "permuta", 10000)), "PERMUTA_DESCRIPTION_REQUIRED"));
  const perm = await salvar(P.gerente, [b3.id], [{ ...novas(1, "permuta", 10000)[0], descricao: "serviço de marcenaria" }]);
  conf("permuta pelo Gerente, com descrição: aceita", passou(perm));
  if (passou(perm)) await c.query("update public.payment_renegotiations set status = 'cancelada' where id = $1", [perm[0].id]);
  conf("a Recepção não renegocia (as permissões de hoje)", erro(await salvar(P.recepcao, [b3.id], novas(1, "pix", 10000)), "NOT_ALLOWED"));
  conf("1º vencimento novo hoje: recusado (o termo não teria prazo)", erro(await salvar(P.gerente, [b3.id], novas(1, "pix", 10000, hoje)), "FIRST_DUE_TOO_SOON"));

  // --- 10) o cartão parcelado pelo Asaas do acordo -----------------------------------------
  // A sobra na PRIMEIRA (o Asaas põe na última): fora da regra.
  const errado = novas(3, "cartao_parcelado_asaas", 3333, mesesDepois(primeiro, 9)).map((e, j) => ({ ...e, amount_cents: j === 0 ? 3334 : 3333 }));
  const errR = await salvar(P.gerente, [b3.id], errado);
  conf("cartão parcelado com valores fora da regra do Asaas: recusado", erro(errR, "PARCELADO_ASAAS_VALORES"));
  const certo = errado.map((e, j) => ({ ...e, amount_cents: j === 2 ? 3334 : 3333 }));
  const s6 = await salvar(P.gerente, [b3.id], certo);
  conf("cartão parcelado na regra do bloco: aceito", passou(s6));
  if (passou(s6)) {
    await assinar(s6[0].id);
    const bl = await todos("select * from public._card_blocks_due(null, null, null, 100, $1)", [s6[0].id]);
    conf("assinado: o bloco do cartão parcelado do acordo entra na rotina (nasce inteiro)", bl.length === 1 && bl[0].parcelas === 3 && bl[0].renegotiation_id === s6[0].id);
  }

  // --- 11) a cobrança emitida fora do riSZon -----------------------------------------------
  const v3 = await novaVenda("mensal");
  const [e1] = await parcelasDa(v3);
  for (const x of await vivosDe([e1.id])) await um("select public._charge_mark_cancelled_system($1, $2, 'ensaio')", [x.id, P.gerente]);
  const ext = await pessoa(P.gerente, "select public.charge_mark_external($1, 'boleto emitido no painel do Asaas') id", [e1.id]);
  conf("cobrança externa marcada (cenário)", passou(ext));
  const s7 = await salvar(P.gerente, [e1.id], novas(1, "pix", 10000));
  conf("acordo com cobrança externa (cenário)", passou(s7));
  const chk = passou(s7) ? (await pessoa(P.gerente, "select public.renegotiation_send_check($1) j", [s7[0].id]))?.[0]?.j : null;
  conf("antes de enviar: a tela recebe a cobrança externa", chk?.externas?.length === 1);
  conf("enviar com a externa não confirmada: recusado", passou(s7) && erro(await servidor("select public.renegotiation_mark_sent($1, null, $2)", [s7[0].id, P.gerente]), "EXTERNAL_NOT_CONFIRMED"));
  conf("o Financeiro não confirma a externa (só Gerente ou Admin)", passou(s7) && erro(await pessoa(P.financeiro, "select public.renegotiation_confirm_external($1, $2::uuid[])", [s7[0].id, [ext[0].id]]), "NOT_ALLOWED"));
  conf("o Gerente confirma \"Cancelei no painel do Asaas\"", passou(s7) && passou(await pessoa(P.gerente, "select public.renegotiation_confirm_external($1, $2::uuid[])", [s7[0].id, [ext[0].id]])));
  conf("…a marcação externa é desfeita e fica na auditoria", (await um("select status from public.charges where id = $1", [ext[0].id])).status === "cancelada" && (await um("select count(*)::int n from public.audit_logs where entity_type = 'renegotiation_external_confirm' and entity_id = $1", [s7[0].id])).n === 1);
  conf("…e o envio passa", passou(s7) && passou(await servidor("select public.renegotiation_mark_sent($1, null, $2)", [s7[0].id, P.gerente])));

  // --- 12) o desconto por componente (a mesma ordem da dispensa) e a autorização ------------
  const d = await um("select * from public._desconto_por_componente(50000, 1000, 1000, 500, 1800)");
  conf("o desconto abate juros, multa, benefício e principal, nessa ordem", Number(d.interest_cents) === 500 && Number(d.fee_cents) === 1000 && Number(d.benefit_cents) === 300 && Number(d.principal_cents) === 0);
  // A dispensa do recebimento: o pagamento cobre principal → benefício → multa → juros; a dispensa é o que sobra.
  // Dívida 52.500 (50.000 + 1.000 + 1.000 + 500); a dispensa de 1.800 = pagar 50.700.
  const sobra = { principal: 0, beneficio: 0, multa: 0, juros: 0 };
  let resto = 50700; const base = [["principal", 50000], ["beneficio", 1000], ["multa", 1000], ["juros", 500]];
  for (const [k, v] of base) { const x = Math.min(resto, v); resto -= x; sobra[k] = v - x; }
  conf("…a mesma conta da dispensa do recebimento manual", sobra.juros === 500 && sobra.multa === 1000 && sobra.beneficio === 300 && sobra.principal === 0);
  const [, e2] = await parcelasDa(v3);
  const s8 = await salvar(P.financeiro, [e2.id], novas(1, "pix", 9000));
  conf("desconto dado pelo Financeiro espera o Gerente (a regra de hoje)", passou(s8) && (await reneg(s8[0].id)).status === "aguardando_autorizacao");
  conf("autorizado, vai para aguardando assinatura (não aplica)", passou(s8) && passou(await pessoa(P.gerente, "select public.authorize_renegotiation($1, true, 'ok')", [s8[0].id])) && (await reneg(s8[0].id)).status === "aguardando_assinatura");
  const r8 = passou(s8) ? await reneg(s8[0].id) : null;
  conf("o desconto fica separado por componente", r8 && Number(r8.discount_cents) === Number(r8.discount_interest_cents) + Number(r8.discount_fee_cents) + Number(r8.discount_benefit_cents) + Number(r8.discount_principal_cents));

  // --- 13) a taxa da rede: a já retida fica; a das novas só na baixa --------------------------
  const v4 = await novaVenda("mensal");
  const [t1] = await parcelasDa(v4, "dinheiro");
  await pessoa(P.recepcao, "select public.register_payment_receipt(p_installment_id => $1, p_amount_cents => 4000, p_received_at => current_date, p_payment_method => 'dinheiro', p_client_token => gen_random_uuid())", [t1.id]);
  const taxaAntes = Number((await um("select coalesce(sum(s.amount_cents), 0) n from public.split_charges s join public.payment_receipts r on r.id = s.receipt_id where r.installment_id = $1 and not s.reversed", [t1.id])).n);
  const s9 = await salvar(P.gerente, [t1.id], novas(2, "dinheiro", 3000));
  if (passou(s9)) await assinar(s9[0].id);
  const taxaDepois = Number((await um("select coalesce(sum(s.amount_cents), 0) n from public.split_charges s join public.payment_receipts r on r.id = s.receipt_id where r.installment_id = $1 and not s.reversed", [t1.id])).n);
  conf("a taxa já cobrada da parcela renegociada fica intocada", taxaAntes > 0 && taxaDepois === taxaAntes);
  const novasT = passou(s9) ? await todos("select id from public.payment_installments where renegotiation_id = $1 order by seq", [s9[0].id]) : [];
  const taxaNova0 = Number((await um("select coalesce(sum(s.amount_cents), 0) n from public.split_charges s join public.payment_receipts r on r.id = s.receipt_id where r.installment_id = any($1)", [novasT.map((x) => x.id)])).n);
  if (novasT[0]) await pessoa(P.recepcao, "select public.register_payment_receipt(p_installment_id => $1, p_amount_cents => 3000, p_received_at => current_date, p_payment_method => 'dinheiro', p_client_token => gen_random_uuid())", [novasT[0].id]);
  const taxaNova1 = Number((await um("select coalesce(sum(s.amount_cents), 0) n, coalesce(max(s.base_cents), 0) b from public.split_charges s join public.payment_receipts r on r.id = s.receipt_id where r.installment_id = any($1)", [novasT.map((x) => x.id)])).n);
  conf("a parcela nova só paga taxa quando é paga, sobre o valor pago", taxaNova0 === 0 && taxaNova1 > 0);

  // --- 14) a cadeia: acordo de acordo herda as vendas de origem --------------------------------
  const nova1 = n1[2];
  const s10 = await salvar(P.gerente, [nova1.id], novas(1, "pix", 6666, mesesDepois(primeiro, 14)));
  conf("acordo de acordo herda as vendas de origem", passou(s10) && ((await reneg(s10[0].id)).origin_direct_sale_ids ?? []).includes(v1));
  for (const x of await vivosDe([nova1.id])) await um("select public._charge_mark_cancelled_system($1, $2, 'ensaio')", [x.id, P.gerente]);
  conf("…e trava o cancelamento da venda de origem enquanto não vale", erro(await servidor("update public.direct_sales set cancelled = true where id = $1", [v1]), "RENEGOTIATED_OPEN"));

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
