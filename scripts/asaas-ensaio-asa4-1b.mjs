// ENSAIO DA 4015 (ASA4, 1B — forma 2, "Todos os boletos agora") no banco de TREINO,
// numa transação DESFEITA (rollback): nada fica gravado e o Asaas não é chamado
// (o cancelamento no Asaas é do servidor; aqui se prova o banco).
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa4-1b.mjs --confirmar [--quebrar=trava|mao|pendencia|lista]
//
// PROVADO QUEBRANDO: `--quebrar=trava` tira as travas da 4004 (a parcela muda com
// o boleto vivo); `--quebrar=mao` conta o cancelamento da operação como "à mão"
// (a parcela some da rotina); `--quebrar=pendencia` grava a operação interrompida
// sem avisar ninguém; `--quebrar=lista` deixa a lista abrir depois de revogada.
// Os quatro têm de reprovar o ensaio.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4015_asa4_forma2_todos_os_boletos_agora.sql";
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
const iso = (d) => d.toISOString().slice(0, 10);
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
    conf("a 4015 roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4015 roda duas vezes sem erro (${e.message})`, false);
  }
  if (QUEBRAR === "trava") {
    await c.query("drop trigger if exists payment_installments_charge_lock on public.payment_installments");
    await c.query("drop trigger if exists payment_receipts_charge_lock on public.payment_receipts");
    console.log("   (QUEBRADO de propósito: sem as travas da 4004)");
  } else if (QUEBRAR === "mao") {
    const f = await um("select pg_get_functiondef('public._auto_charge_cancelled_by_hand(uuid)'::regprocedure) d");
    await c.query(f.d.replace("and not c.cancel_system", ""));
    console.log("   (QUEBRADO de propósito: o cancelamento da operação conta como à mão)");
  } else if (QUEBRAR === "pendencia") {
    const f = await um("select pg_get_functiondef('public._boleto_op_failure_record(jsonb)'::regprocedure) d");
    await c.query(f.d.replace(/perform public\._notify_users\('operacao_interrompida'[\s\S]*?\);\n/, ""));
    console.log("   (QUEBRADO de propósito: a operação interrompida não avisa)");
  } else if (QUEBRAR === "lista") {
    const f = await um("select pg_get_functiondef('public._boleto_list_read(text, text, text)'::regprocedure) d");
    await c.query(f.d.replace("if l.revoked_at is not null or l.expires_at < public.today_br() then", "if false then"));
    console.log("   (QUEBRADO de propósito: a lista abre depois de revogada)");
  }

  // --- o cenário -------------------------------------------------------------
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "recepcao", "consultor"]) {
    P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
  }
  for (const k of ["admin", "gerente", "financeiro", "recepcao"]) if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  const cmb = (await um("select id from public.clinics where name = 'Risarte Cambé - Centro'"))?.id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("gerente", ldn, "unit_manager");
  await papel("recepcao", ldn, "receptionist");
  await papel("financeiro", franq, "finance_franchisor");
  if (P.consultor) await papel("consultor", cmb, "unit_manager"); // Gerente de OUTRA unidade
  const cli = await um(
    `select c.id, c.full_name, c.cpf from public.clients c
      where c.clinic_id = $1 and public._cpf_ok(c.cpf) and c.birth_date < current_date - interval '19 years'
        and not exists (select 1 from public.client_guardians g where g.client_id = c.id and g.is_financial)
      order by c.created_at limit 1`, [ldn]);
  if (!cli) throw new Error("NÃO MEDI: nenhum cliente de Londrina com CPF válido.");
  const conta = await um("select id from public.gateway_accounts where clinic_id = $1 and status = 'active'", [ldn]);
  await c.query("insert into public.gateway_auto_charge_units (clinic_id, enabled, enabled_from) values ($1, true, now() - interval '1 minute') on conflict (clinic_id) do update set enabled = true, enabled_from = now() - interval '1 minute'", [ldn]);
  const prazo = Number((await um("select public._auto_charge_window() w")).w);

  let primeiro = iso(new Date(Date.now() + 5 * 86400000));
  if (Number(primeiro.slice(8, 10)) > 28) primeiro = primeiro.slice(0, 8) + "05";
  // Uma venda direta nova com 12 boletos mês a mês e 1 Pix daqui a 2 meses.
  const novaVenda = async () => {
    const v = (await um("insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, created_by) values ($1, $2, $3, 130000, 'boleto', 13, $4) returning id", [ldn, cli.id, cli.full_name, P.recepcao])).id;
    const linhas = [
      ...Array.from({ length: 12 }, (_, k) => ({ kind: "parcela", due_date: mesesDepois(primeiro, k), amount_cents: 10000, payment_method: "boleto" })),
      { kind: "parcela", due_date: mesesDepois(primeiro, 2), amount_cents: 10000, payment_method: "pix" },
    ];
    const s = await pessoa(P.recepcao, "select public.save_payment_schedule(null, $1, $2::jsonb)", [v, JSON.stringify(linhas)]);
    if (!passou(s)) throw new Error(`parcelamento: ${s}`);
    return v;
  };

  // --- 1) a escolha da forma ------------------------------------------------------
  const v = await novaVenda();
  const modo = (u, m) => pessoa(u, "select public.sale_boleto_mode_set(null, $1, $2) r", [v, m]);
  conf("o Gerente de OUTRA unidade não escolhe a forma", !P.consultor || erro(await modo(P.consultor, "todos"), "NOT_ALLOWED"));
  await c.query("update public.gateway_auto_charge_units set enabled = false where clinic_id = $1", [ldn]);
  conf("com a unidade desligada, a forma 2 é recusada", erro(await modo(P.gerente, "todos"), "UNIT_NOT_ON"));
  await c.query("update public.gateway_auto_charge_units set enabled = true, enabled_from = now() - interval '1 minute' where clinic_id = $1", [ldn]);
  conf("quem fechou a venda escolhe a forma 2", passou(await modo(P.recepcao, "todos")));
  conf("a escolha fica na auditoria", (await um("select count(*)::int n from public.audit_logs where entity_type = 'sale_boleto_mode' and entity_id = $1", [v])).n === 1);

  // --- 2) os 12 boletos nascem de uma vez, pelo carnê; o Pix fica no prazo --------
  await c.query("update public.direct_sales set contract_signed = true where id = $1", [v]);
  const due = await todos("select d.*, i.payment_method from public._auto_charge_due(null, null, $1, 100) d join public.payment_installments i on i.id = d.installment_id", [v]);
  const boletosNaLista = due.filter((d) => d.payment_method === "boleto").length;
  const pixNaLista = due.filter((d) => d.payment_method === "pix").length;
  conf("forma 2: os 12 boletos entram na lista, sem prazo", boletosNaLista === 12);
  conf("o Pix da mesma venda segue o prazo (fora da lista agora)", pixNaLista === (mesesDepois(primeiro, 2) <= iso(new Date(Date.now() + prazo * 86400000)) ? 1 : 0));
  const ids = [];
  for (const d of due.filter((x) => x.payment_method === "boleto")) {
    ids.push((await um("select public._charge_prepare_system($1, 'BOLETO', 'venda_direta') id", [d.installment_id])).id);
  }
  conf("os 12 saem pelo cadastro do carnê", (await um("select count(*)::int n from public.charges where id = any($1) and via_carne", [ids])).n === 12);
  for (const [k, id] of ids.entries()) {
    await um("select public._charge_mark_issued($1, $2, null, $3, null, null, $4)", [id, `pay_1b_${v.slice(0, 6)}_${k}`, `https://sandbox.asaas.com/i/1b${k}`, `2379000${k}`]);
  }
  conf("os 12 boletos ficam na rotina do split (abertos: a virada do dia os pega)", (await um("select count(*)::int n from public.charges c where c.id = any($1) and public._charge_split_open(c)", [ids])).n === 12);

  // O cadastro do carnê: a régua do pagador entra na fila (principal e carnê no mesmo item).
  const cust = (await um("select public._gateway_customer_save($1, $2, 'cus_principal_1b', 'client', $3, null) id", [conta.id, cli.cpf, cli.id])).id;
  await c.query("update public.gateway_customers set regua_pending_since = null where id = $1", [cust]);
  await um("select public._gateway_carne_save($1, $2, 'cus_carne_1b')", [conta.id, cust]);
  conf("o cadastro do carnê põe a régua do pagador na fila (os dois recebem o contato)", Boolean((await um("select regua_pending_since from public.gateway_customers where id = $1", [cust])).regua_pending_since));

  // --- 3) a lista: link, leitura mínima, acesso registrado, limite, revogação ----
  const token = randomBytes(32).toString("hex");
  conf("a Recepção (quem fechou) gera o link da lista", passou(await pessoa(P.recepcao, "select public.boleto_list_issue(null, $1, $2) id", [v, sha(token)])));
  const ler = (t, ip = "ip1") => um("select public._boleto_list_read($1, $2, 'teste') r", [sha(t), sha(ip)]).then((x) => x.r);
  const l1 = await ler(token);
  conf("a lista mostra o primeiro nome e os 12 boletos a pagar", l1?.nome === cli.full_name.trim().split(" ")[0] && l1?.boletos?.length === 12 && l1.boletos.every((b) => b.situacao === "a_pagar" && b.link));
  conf("a lista NÃO mostra CPF nem nome completo", !JSON.stringify(l1).includes(cli.cpf) && (cli.full_name.trim().split(" ").length === 1 || !JSON.stringify(l1).includes(cli.full_name.trim())));
  conf("o acesso fica registrado (data e hora) e conta como \"aberta\"", (await um("select count(*)::int n from public.boleto_list_accesses a join public.boleto_lists l on l.id = a.list_id where l.direct_sale_id = $1", [v])).n === 1 && (await um("select count(*)::int n from public.charges where id = any($1) and viewed_at is not null", [ids])).n === 12);
  for (let i = 0; i < 20; i++) await ler(randomBytes(32).toString("hex"), "ip-ruim");
  conf("20 endereços errados por hora: o IP é barrado", (await ler(token, "ip-ruim"))?.erro === "limite");
  const token2 = randomBytes(32).toString("hex");
  await pessoa(P.gerente, "select public.boleto_list_issue(null, $1, $2)", [v, sha(token2)]);
  conf("gerar link novo: o antigo para na hora", (await ler(token))?.erro === "expirado" && !(await ler(token2))?.erro);
  await pessoa(P.gerente, "select public.boleto_list_revoke(null, $1)", [v]);
  conf("revogado, o link não abre", (await ler(token2))?.erro === "expirado");
  const token3 = randomBytes(32).toString("hex");
  await pessoa(P.gerente, "select public.boleto_list_issue(null, $1, $2)", [v, sha(token3)]);
  conf("o envio da lista conta como envio de cada boleto", (await pessoa(P.recepcao, "select public.boleto_list_sent(null, $1, 'lista_whatsapp') n", [v]))?.[0]?.n === 12);

  // --- 4) os 6 casos: com o boleto vivo, recusado; cancelado pela operação, passa --
  const parcelas = await todos("select i.id, i.seq, i.due_date, c.id charge_id from public.payment_installments i join public.charges c on c.payment_installment_id = i.id and c.status = 'emitida' where i.direct_sale_id = $1 and i.payment_method = 'boleto' order by i.due_date", [v]);
  const [p1, p2, p3, p4, p5] = parcelas;
  const cancelaDoSistema = (charge, motivo) => um("select public._charge_mark_cancelled_system($1, $2, $3)", [charge, P.gerente, motivo]);
  const situacao = async (inst) => (await ler(token3))?.boletos?.find((b) => b.vencimento === iso(new Date(inst.due_date)))?.situacao;
  // (c) troca de vencimento ou valor (salvar o parcelamento de novo)
  conf("trocar vencimento ou valor com boletos vivos: recusado", erro(await pessoa(P.recepcao, "select public.save_payment_schedule(null, $1, $2::jsonb)", [v, JSON.stringify([{ kind: "parcela", due_date: primeiro, amount_cents: 130000, payment_method: "boleto" }])]), "CHARGE_ACTIVE"));
  // (a) renegociação
  const reneg = () => pessoa(P.gerente, "select public.save_renegotiation($1, $2, $3::jsonb, 'ensaio 1B', 0)", [cli.id, [p1.id], JSON.stringify([{ kind: "parcela", due_date: mesesDepois(primeiro, 14), amount_cents: 10000, payment_method: "pix" }])]);
  conf("renegociação com o boleto vivo: recusada", erro(await reneg(), "CHARGE_ACTIVE"));
  await cancelaDoSistema(p1.charge_id, "renegociação");
  conf("renegociação depois do cancelamento na operação: passa", passou(await reneg()));
  conf("…e a lista mostra \"substituído pela renegociação\"", (await situacao(p1)) === "substituido_renegociacao");
  // (b) cancelamento do plano (a parcela vira "cancelada")
  const cancPlano = () => servidor("update public.payment_installments set status = 'cancelada' where id = $1", [p2.id]);
  conf("cancelamento do plano com o boleto vivo: recusado", erro(await cancPlano(), "CHARGE_ACTIVE"));
  await cancelaDoSistema(p2.charge_id, "cancelamento do plano");
  conf("cancelamento do plano depois do cancelamento na operação: passa", passou(await cancPlano()));
  conf("…e a lista mostra \"cancelado, não pague\"", (await situacao(p2)) === "cancelado");
  // (d) dinheiro no balcão
  const dinheiro = () => pessoa(P.recepcao, "select public.register_payment_receipt(p_installment_id => $1, p_amount_cents => 10000, p_received_at => current_date, p_payment_method => 'dinheiro', p_client_token => gen_random_uuid())", [p3.id]);
  conf("dinheiro no balcão com o boleto vivo: recusado", erro(await dinheiro(), "CHARGE_IN_GATEWAY"));
  await cancelaDoSistema(p3.charge_id, "pagou em dinheiro no balcão");
  conf("dinheiro depois do cancelamento na operação: passa", passou(await dinheiro()));
  conf("…e a lista mostra \"pago no balcão\"", (await situacao(p3)) === "pago_no_balcao");
  // (e) permuta (Gerente)
  conf("permuta com o boleto vivo: recusada", erro(await pessoa(P.gerente, "select public.register_payment_receipt(p_installment_id => $1, p_amount_cents => 10000, p_payment_method => 'permuta', p_notes => 'permuta do ensaio', p_client_token => gen_random_uuid())", [p4.id]), "CHARGE_IN_GATEWAY"));
  // (f) quitação por valor menor (Gerente)
  conf("valor menor com o boleto vivo: recusado", erro(await pessoa(P.gerente, "select public.register_payment_with_waiver(p_installment_id => $1, p_amount_cents => 5000, p_received_at => current_date, p_payment_method => 'pix', p_reference => null, p_notes => null, p_client_token => gen_random_uuid(), p_conta => '', p_reason => 'acordo do ensaio')", [p5.id]), "CHARGE_IN_GATEWAY", "CHARGE_ACTIVE"));
  // O cancelamento da operação não é "à mão": a parcela que continua existindo volta à rotina.
  await cancelaDoSistema(p5.charge_id, "parcelamento alterado");
  conf("cancelado pela operação, o boleto da parcela que continua volta pela rotina", (await todos("select 1 from public._auto_charge_due(null, null, $1, 100) where installment_id = $2", [v, p5.id])).length === 1);
  await c.query("update public.charges set status = 'cancelada', cancelled_at = now(), cancelled_by = $2 where id = $1", [p4.charge_id, P.gerente]);
  conf("cancelado À MÃO, não volta sozinho", (await todos("select 1 from public._auto_charge_due(null, null, $1, 100) where installment_id = $2", [v, p4.id])).length === 0);
  // O aviso de reenvio, um por dia.
  const avisos = (await um("select count(*)::int n from public.notifications where title = 'A lista de boletos mudou: reenvie o link' and user_id = $1", [P.gerente])).n;
  conf("a lista mudou: aviso ao Gerente e a quem fechou, uma vez no dia", avisos === 1 && (await um("select count(*)::int n from public.notifications where title = 'A lista de boletos mudou: reenvie o link' and user_id = $1", [P.recepcao])).n === 1);

  // --- 5) a troca de 2 para 1: só os de fora do prazo -------------------------------
  const r21 = await modo(P.gerente, "mensal");
  const aCancelar = passou(r21) ? r21[0].r.a_cancelar : null;
  const foraDoPrazo = (await um("select count(*)::int n from public.charges where id = any($1) and status = 'emitida' and due_date > current_date + $2::int", [ids, prazo])).n;
  conf("de 2 para 1: cancela só os boletos que vencem fora do prazo", Array.isArray(aCancelar) && aCancelar.length === foraDoPrazo && foraDoPrazo > 0);

  // --- 6) a operação interrompida ------------------------------------------------
  const f = await um("select public._boleto_op_failure_record($1::jsonb) id", [JSON.stringify({ clinic_id: ldn, client_id: cli.id, direct_sale_id: v, operation: "renegociação", installment_ids: [p5.id], cancelled_charge_ids: [p5.charge_id], error: "erro do ensaio", actor_id: P.recepcao })]);
  conf("a operação interrompida avisa quem fez e o Gerente", (await um("select count(*)::int n from public.notifications where title = 'Operação interrompida: boleto cancelado sem a mudança' and user_id in ($1, $2)", [P.recepcao, P.gerente])).n === 2);
  const lidas = await pessoa(P.gerente, "select public.boleto_op_failures_read($1) r", [ldn]);
  conf("…e aparece na lista de pendências do Gerente", passou(lidas) && lidas[0].r.some((x) => x.id === f.id));
  conf("a Recepção que fez a operação pode concluir", passou(await pessoa(P.recepcao, "select public.boleto_op_failure_resolve($1, 'refeita no ensaio')", [f.id])));

  // --- 7) o pagamento de um boleto cancelado ------------------------------------
  await c.query(
    "insert into public.gateway_payment_surpluses (clinic_id, charge_id, installment_id, client_id, asaas_payment_id, amount_cents, paid_on, reason) values ($1, $2, $3, $4, 'pay_pago_cancelado', 10000, current_date, 'cobranca_cancelada')",
    [ldn, p5.charge_id, p5.id, cli.id]);
  const alerta = await um("select body from public.notifications where title = 'Pagaram um boleto que o riSZon tinha cancelado' and user_id = $1 order by created_at desc limit 1", [P.gerente]);
  conf("boleto cancelado pago: alerta ao Gerente com o valor, a parcela e o que fazer", Boolean(alerta) && alerta.body.includes("R$ 100,00") && alerta.body.includes(`parcela ${p5.seq}`) && alerta.body.includes("abata"));
  conf("…e ao Financeiro da Franqueadora", (await um("select count(*)::int n from public.notifications where title = 'Pagaram um boleto que o riSZon tinha cancelado' and user_id = $1", [P.financeiro])).n === 1);
  await c.query("insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload, received_at) values ($1, 'evt_restaurada_1b', 'PAYMENT_RESTORED', $2::jsonb, now())",
    [conta.id, JSON.stringify({ event: "PAYMENT_RESTORED", payment: { id: `pay_1b_${v.slice(0, 6)}_3` } })]).catch(() => null);
  conf("o Asaas restaurar um boleto cancelado: alerta na hora", (await um("select count(*)::int n from public.notifications where title = 'O Asaas restaurou um boleto que o riSZon tinha cancelado' and user_id = $1", [P.gerente])).n === 1);

  // --- 8) as portas internas estão fechadas -----------------------------------
  const internas = ["_sale_boleto_mode", "_boleto_mode_can", "_charge_mark_cancelled_system", "_gateway_carne_save", "_boleto_list_read", "_boleto_op_failure_record", "_sale_boleto_summary"];
  let fechadas = 0;
  for (const fx of internas) {
    const r = await um("select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fx]);
    if (r.x === false) fechadas++;
  }
  conf("as funções internas estão fechadas para quem está logado", fechadas === internas.length);
} catch (e) {
  falha.push(`o ensaio parou: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nEnsaio da 4015 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const x of falha) console.log("  FALHOU:", x);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
