// ENSAIO DA 4012 (ASA4, entrega 1, parte 2 — a cobrança nasce sozinha) no
// banco de TREINO, numa transação DESFEITA (rollback): nada fica gravado e o
// Asaas não é chamado (a emissão no Asaas é do servidor; aqui se prova o banco).
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa4-entrega1-gatilhos.mjs --confirmar [--quebrar=marca|cancelada]
//
// PROVADO QUEBRANDO: `--quebrar=marca` tira o índice único da marca da venda
// (o aviso repetido marcaria duas vezes); `--quebrar=cancelada` faz a rotina
// recriar a cobrança cancelada à mão. Os dois têm de reprovar o ensaio.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4012_asa4_cobranca_na_assinatura_e_rotina.sql";
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

try {
  await c.query("begin");
  let sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query("savepoint dup");
  try {
    await c.query(sql);
    await c.query("release savepoint dup");
    conf("a 4012 roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4012 roda duas vezes sem erro (${e.message})`, false);
  }
  if (QUEBRAR === "marca") {
    await c.query("alter table public.sale_auto_charges drop constraint if exists sale_auto_charges_direct_sale_id_key");
    await c.query("create or replace function public.direct_sales_auto_charge() returns trigger language plpgsql security definer set search_path = '' as $$ begin if new.method_rule = 'asa4' and new.contract_signed and public._auto_charge_unit_on(new.clinic_id) then insert into public.sale_auto_charges (clinic_id, direct_sale_id, source) values (new.clinic_id, new.id, 'venda_direta'); end if; return new; end; $$");
    console.log("   (QUEBRADO de propósito: a marca da venda deixa de ser única)");
  } else if (QUEBRAR === "cancelada") {
    await c.query("create or replace function public._auto_charge_cancelled_by_hand(p_installment_id uuid) returns boolean language sql stable security definer set search_path = '' as $$ select false $$");
    console.log("   (QUEBRADO de propósito: a rotina ignora o cancelamento à mão)");
  }

  // --- o cenário -------------------------------------------------------------
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
  const pronta = (await um("select public.central_is_ready($1) as x", [ldn])).x;
  if (!pronta) throw new Error("NÃO MEDI: Londrina não está pronta na Central (treino).");
  // Um cliente com CPF válido e sem responsável financeiro.
  const cli = await um(
    `select c.id, c.full_name from public.clients c
      where c.clinic_id = $1 and public._cpf_ok(c.cpf) and c.birth_date < current_date - interval '19 years'
        and not exists (select 1 from public.client_guardians g where g.client_id = c.id and g.is_financial)
      order by c.created_at limit 1`, [ldn]);
  if (!cli) throw new Error("NÃO MEDI: nenhum cliente de Londrina com CPF válido.");

  // --- 1) configuração --------------------------------------------------------
  conf("o prazo padrão é 15 dias", (await um("select window_days from public.gateway_auto_charge_settings where id")).window_days === 15);
  conf("prazo igual ao 1º lembrete (10) é recusado", erro(await pessoa(P.admin, "select public.auto_charge_settings_set('{\"window_days\": 10}'::jsonb)"), "WINDOW_NOT_ABOVE_REMINDER"));
  conf("só o Admin Master configura", erro(await pessoa(P.gerente, "select public.auto_charge_settings_set('{\"window_days\": 20}'::jsonb)"), "NOT_ALLOWED"));

  // --- 2) venda assinada com a unidade DESLIGADA continua manual ---------------
  await c.query("delete from public.gateway_auto_charge_units where clinic_id = $1", [ldn]);
  const novaVenda = async () => {
    const v = await um("insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, created_by) values ($1, $2, $3, 30000, 'boleto', 3, $4) returning id", [ldn, cli.id, cli.full_name, P.recepcao]);
    const hoje = new Date();
    const d = (n) => new Date(hoje.getTime() + n * 86400000).toISOString().slice(0, 10);
    const plano = JSON.stringify([
      { kind: "parcela", due_date: d(5), amount_cents: 10000, payment_method: "boleto" },
      { kind: "parcela", due_date: d(12), amount_cents: 10000, payment_method: "pix" },
      { kind: "parcela", due_date: d(40), amount_cents: 10000, payment_method: "boleto" },
    ]);
    const s = await pessoa(P.recepcao, "select public.save_payment_schedule(null, $1, $2::jsonb)", [v.id, plano]);
    if (!passou(s)) throw new Error(`parcelamento: ${s}`);
    return v.id;
  };
  const antes = await novaVenda();
  await c.query("update public.direct_sales set contract_signed = true where id = $1", [antes]);
  conf("unidade desligada: a venda assinada NÃO é marcada (fica manual)", !(await um("select 1 x from public.sale_auto_charges where direct_sale_id = $1", [antes])));

  // --- 3) liga a unidade; assina; a marca nasce uma vez ------------------------
  conf("o Admin liga a emissão automática na unidade", passou(await pessoa(P.admin, "select public.auto_charge_settings_set($1::jsonb)", [JSON.stringify({ units: [{ clinic_id: ldn, enabled: true }] })])));
  await c.query("update public.gateway_auto_charge_units set enabled_from = now() - interval '1 minute' where clinic_id = $1", [ldn]);
  conf("a venda assinada ANTES de ligar continua sem marca", !(await um("select 1 x from public.sale_auto_charges where direct_sale_id = $1", [antes])));
  const venda = await novaVenda();
  await c.query("update public.direct_sales set contract_signed = true where id = $1", [venda]);
  await c.query("update public.direct_sales set contract_signed = false where id = $1", [venda]);
  await c.query("update public.direct_sales set contract_signed = true where id = $1", [venda]);
  conf("assinada depois de ligar: UMA marca, mesmo assinando duas vezes", (await um("select count(*)::int n from public.sale_auto_charges where direct_sale_id = $1", [venda])).n === 1);

  // --- 4) a lista da rotina (proposta A) --------------------------------------
  const due = await todos("select * from public._auto_charge_due(null, null, $1, 50)", [venda]);
  conf("dentro do prazo (15 dias) entram a de 5 e a de 12 dias; a de 40 fica agendada", due.length === 2);
  conf("o meio do Asaas sai da parcela (boleto e Pix)", due.map((d) => d.billing_type).sort().join(",") === "BOLETO,PIX");
  conf("a venda antiga (sem marca) não entra na lista", (await todos("select * from public._auto_charge_due(null, null, $1, 50)", [antes])).length === 0);

  // --- 5) a porta sem usuário cria a cobrança; repetir não duplica -----------
  const ids = [];
  for (const d of due) {
    const r = await servidor("select public._charge_prepare_system($1, $2, 'venda_direta') as id", [d.installment_id, d.billing_type]);
    if (passou(r)) ids.push(r[0].id);
    else conf(`a porta do sistema criou a cobrança (${r})`, false);
  }
  conf("a porta do sistema criou as 2 cobranças ('emitindo', origem venda_direta, sem usuário)", ids.length === 2 && (await um("select count(*)::int n from public.charges where id = any($1) and status = 'emitindo' and auto_origin = 'venda_direta' and created_by is null", [ids])).n === 2);
  const repetida = await servidor("select public._charge_prepare_system($1, $2, 'rotina') as id", [due[0].installment_id, due[0].billing_type]);
  conf("a mesma parcela de novo é recusada (sem cobrança em dobro)", erro(repetida, "NOT_DUE"));
  conf("a porta do sistema é fechada para quem está logado", erro(await pessoa(P.admin, "select public._charge_prepare_system($1, 'BOLETO', 'rotina')", [due[0].installment_id]), "permission denied"));
  conf("com as duas criadas, a lista da venda fica vazia", (await todos("select * from public._auto_charge_due(null, null, $1, 50)", [venda])).length === 0);

  // --- 6) cancelada à mão não volta; recebeu parte depois, volta -------------
  const [c1, c2] = ids;
  await c.query("update public.charges set status = 'cancelada', cancelled_at = now() - interval '1 minute' where id = $1", [c1]);
  conf("cobrança cancelada à mão NÃO volta pela rotina", (await todos("select * from public._auto_charge_due(null, null, $1, 50)", [venda])).length === 0);
  const inst1 = (await um("select payment_installment_id from public.charges where id = $1", [c1])).payment_installment_id;
  const rec = await pessoa(P.recepcao, "select public.register_payment_receipt($1, 4000, current_date, 'dinheiro', null, null, null) as id", [inst1]);
  conf("recebeu parte em dinheiro depois do cancelamento", passou(rec));
  const volta = await todos("select * from public._auto_charge_due(null, null, $1, 50)", [venda]);
  conf("…e o restante volta para a rotina (4011, decisão 4)", volta.length === 1 && volta[0].installment_id === inst1);
  conf("o motivo na lista de pendências diz 'aguardando_rotina'", (await um("select public._auto_charge_reason($1) as m", [inst1])).m === "aguardando_rotina");

  // --- 7) a ZapSign: contrato assinado marca a negociação --------------------
  const neg = await um("select cs.negotiation_id as id from public.commercial_sales cs where cs.clinic_id = $1 and cs.negotiation_id is not null and not exists (select 1 from public.sale_auto_charges m where m.negotiation_id = cs.negotiation_id) limit 1", [ldn]);
  if (neg) {
    await c.query("update public.commercial_sales set contract_signed = false where negotiation_id = $1", [neg.id]);
    await c.query("update public.commercial_sales set contract_signed = true where negotiation_id = $1", [neg.id]);
    await c.query("update public.commercial_sales set contract_signed = false where negotiation_id = $1", [neg.id]);
    await c.query("update public.commercial_sales set contract_signed = true where negotiation_id = $1", [neg.id]);
    conf("contrato do plano assinado (ZapSign ou papel): uma marca da negociação", (await um("select count(*)::int n from public.sale_auto_charges where negotiation_id = $1 and source = 'assinatura'", [neg.id])).n === 1);
  } else conf("NÃO MEDI: negociação aberta de Londrina para o contrato", false);

  // --- 8) Cobranças da venda: quem lê e o registro do envio -------------------
  await c.query("update public.charges set status = 'emitida', issued_at = now() - interval '3 days', invoice_url = 'https://sandbox.asaas.com/i/x' where id = $1", [c2]);
  const ler = (who) => pessoa(P[who], "select public.sale_charges_read(null, $1) as r", [venda]);
  const lido = await ler("recepcao");
  conf("quem fechou a venda (registrou) lê as Cobranças da venda", passou(lido) && lido[0].r.parcelas.length === 3);
  conf("o Gerente lê", passou(await ler("gerente")));
  conf("o Financeiro da Franqueadora lê", passou(await ler("financeiro")));
  const cmb = (await um("select id from public.clinics where name like 'Risarte Camb%Centro'"))?.id;
  if (P.consultor && cmb) {
    await papel("consultor", cmb, "unit_manager");
    conf("o Gerente de OUTRA unidade não lê", erro(await ler("consultor"), "NOT_ALLOWED"));
  }
  const p3 = lido[0].r.parcelas.find((x) => x.seq === 3);
  conf("a parcela de 40 dias aparece 'Agendada' para 15 dias antes", p3.cobranca === null && p3.agendada_para !== null);
  conf("o envio fica registrado (canal, quem, quando)", passou(await pessoa(P.recepcao, "select public.charge_link_sent($1, 'whatsapp')", [c2])));
  const depois = (await ler("recepcao"))[0].r.parcelas.find((x) => x.cobranca?.id === c2);
  conf("a cobrança mostra o último envio pelo riSZon", depois?.ultimo_envio?.canal === "whatsapp");

  // --- 9) os avisos de link não enviado (régua desligada) -------------------
  await c.query("delete from public.routine_notices");
  await c.query("delete from public.charge_link_sends where charge_id = $1", [c2]);
  await c.query("update public.charges set due_date = current_date + 1, asaas_sent_at = null where id = $1", [c2]);
  const n1 = Number((await um("select public.charge_link_alerts_run() as n")).n);
  const avisos = await todos("select user_id, title from public.notifications where created_at > now() - interval '1 minute' and title in ('Link de cobrança não enviado', 'Cobrança vence em 2 dias úteis sem envio')");
  conf("aviso (a): 1 dia útil sem envio → quem fechou a venda", avisos.some((a) => a.user_id === P.recepcao && a.title === "Link de cobrança não enviado"));
  conf("aviso (b): 2 dias úteis do vencimento → também o Gerente", avisos.some((a) => a.user_id === P.gerente && a.title.startsWith("Cobrança vence")));
  conf("os avisos não se repetem", n1 > 0 && Number((await um("select public.charge_link_alerts_run() as n")).n) === 0);
  // régua ligada e a primeira não aberta
  await c.query("update public.charges set asaas_sent_at = now(), viewed_at = null where id = $1", [c2]);
  await c.query("delete from public.routine_notices where kind = 'nao_aberta'");
  await um("select public.charge_link_alerts_run() as n");
  conf("régua ligada: primeira cobrança não aberta 1 dia útil antes → quem fechou (ajuste 4)", (await um("select count(*)::int n from public.notifications where user_id = $1 and title = 'Primeira cobrança ainda não aberta' and created_at > now() - interval '1 minute'", [P.recepcao])).n === 1);

  // --- 10) "Aberta pelo pagador" ---------------------------------------------
  const ch2 = await um("select gateway_account_id from public.charges where id = $1", [c2]);
  await c.query("update public.charges set asaas_payment_id = 'pay_ensaio_4012' where id = $1", [c2]);
  await c.query("insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload) values ($1, 'evt_ensaio_4012', 'PAYMENT_CHECKOUT_VIEWED', '{\"payment\": {\"id\": \"pay_ensaio_4012\"}}')", [ch2.gateway_account_id]);
  conf("o aviso de visualização do Asaas marca 'Aberta pelo pagador'", (await um("select viewed_at from public.charges where id = $1", [c2])).viewed_at !== null);

  // --- 11) rodadas, pendências e o vigia --------------------------------------
  const run = (await um("select public._routine_run_start('cobrancas', 'rodar_agora', $1) as id", [P.admin])).id;
  await c.query("select public._routine_run_finish($1, true, 2, 0, 1, null, '{}'::jsonb)", [run]);
  const painel = await pessoa(P.gerente, "select public.auto_charge_panel_read($1) as p", [ldn]);
  conf("o Gerente vê o painel (pendências e rodadas) da unidade", passou(painel) && painel[0].p.rodadas.some((r) => r.origin === "rodar_agora" && r.quem));
  conf("a Recepção não vê o painel", erro(await pessoa(P.recepcao, "select public.auto_charge_panel_read($1)", [ldn]), "NOT_ALLOWED"));
  conf("as pendências trazem o motivo", painel[0].p.pendencias.some((x) => x.installment_id === inst1 && x.motivo === "aguardando_rotina"));
  await c.query("delete from public.routine_notices");
  await c.query("delete from public.gateway_routine_runs");
  await c.query("update public.gateway_auto_charge_settings set watch_enabled = true where id");
  const v1 = Number((await um("select public.routine_watch_run() as n")).n);
  const hora = Number((await um("select extract(hour from now() at time zone 'America/Sao_Paulo')::int h")).h);
  conf("o vigia avisa a régua parada (sem rodada há 1 hora) — Admin e Financeiro", v1 > 0 && (await um("select count(*)::int n from public.notifications where user_id = $1 and title = 'A fila da régua parou' and created_at > now() - interval '1 minute'", [P.financeiro])).n === 1);
  if (hora >= 11) conf("o vigia avisa a criação de cobranças sem rodada", (await um("select count(*)::int n from public.notifications where title = 'A criação das cobranças não rodou hoje' and created_at > now() - interval '1 minute'")).n > 0);
  conf("o vigia não repete o aviso", Number((await um("select public.routine_watch_run() as n")).n) === 0);

  // --- 12) o 2º disparo: só onde o pg_net existe ------------------------------
  const temNet = (await um("select exists (select 1 from pg_extension where extname = 'pg_net') x")).x;
  if (!temNet) {
    conf("sem pg_net, nenhum 2º disparo é criado", (await um("select count(*)::int n from cron.job where jobname like 'risarte-2o-%'")).n === 0);
    await c.query("savepoint net");
    try {
      await c.query("create extension if not exists pg_net");
      const n = Number((await um("select public.routine_second_dispatch_enable() as n")).n);
      const jobs = (await todos("select jobname, schedule from cron.job where jobname like 'risarte-2o-%' order by 1")).map((j) => `${j.jobname} ${j.schedule}`);
      conf("com pg_net, 3 disparos: split 01:35, contas 08:10, cobranças 09:30 (Brasília)", n === 3 && jobs.join("|") === "risarte-2o-cobrancas 30 12 * * *|risarte-2o-contas 10 11 * * *|risarte-2o-split-diario 35 4 * * *");
      const tok = (await um("select public._db_cron_token() t")).t;
      conf("a senha do disparo nasce no Vault e confere", (await um("select public._db_cron_token_ok($1) x", [tok])).x === true && (await um("select public._db_cron_token_ok('errada-errada-errada-errada-errada-1') x")).x === false);
    } finally {
      await c.query("rollback to savepoint net");
    }
    conf("…e o ensaio desfez o pg_net (o treino continua sem ele)", !(await um("select exists (select 1 from pg_extension where extname = 'pg_net') x")).x);
  }
  conf("o vigia roda no banco de hora em hora", (await um("select count(*)::int n from cron.job where jobname = 'risarte-vigia-rotinas' and schedule = '5 * * * *'")).n === 1);

  // --- 13) as portas internas estão fechadas ------------------------------------
  const internas = ["_charge_prepare_system", "_auto_charge_due", "_routine_run_start", "_routine_run_finish", "routine_watch_run", "charge_link_alerts_run", "_db_cron_token", "_db_cron_token_ok", "_routine_http_dispatch", "_notify_users", "_charge_mark_asaas_sent"];
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

console.log(`\nEnsaio da 4012 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log("  FALHOU:", f);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
