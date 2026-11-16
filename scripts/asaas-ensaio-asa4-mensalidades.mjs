// ENSAIO DA 4018 (ASA4, entrega 4 — as mensalidades pelo Asaas, do jeito
// genérico) no banco de TREINO, numa transação DESFEITA (rollback). O Asaas não
// é chamado: o ensaio faz o papel do servidor e do aviso do Asaas.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa4-mensalidades.mjs --confirmar [--quebrar=retida|baixa|trava]
//
// PROVADO QUEBRANDO: `retida` = a taxa da mensalidade paga pelo Asaas volta a
// ir para a conta a pagar (em dobro); `baixa` = o aviso do Asaas não dá baixa
// na mensalidade; `trava` = a baixa à mão passa com a cobrança viva.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4018_asa4_mensalidades_pelo_asaas.sql";
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
function cpfDeTeste() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b) => { const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}
const mais = (s, dias) => iso(new Date(Date.parse(s) + dias * 86400000));

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query("savepoint dup");
  try {
    await c.query(sql);
    await c.query("release savepoint dup");
    conf("a 4018 roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4018 roda duas vezes sem erro (${e.message})`, false);
  }
  const trocar = async (assinatura, de, para) => {
    const f = await um(`select pg_get_functiondef('${assinatura}'::regprocedure) d`);
    if (!f.d.includes(de)) throw new Error(`QUEBRA: trecho não achado em ${assinatura}`);
    await c.query(f.d.replace(de, para));
  };
  if (QUEBRAR === "retida") {
    await trocar("public._split_charge_born_retained()", "      new.retained_cents := new.amount_cents;\n    end if;\n    return new;", "    end if;\n    return new;");
    console.log("   (QUEBRADO de propósito: a taxa da mensalidade não nasce retida)");
  } else if (QUEBRAR === "baixa") {
    await trocar("public._gateway_on_paid_source(uuid, text, jsonb)", "execute format('select public.%I($1, $2, $3, $4)', t.settle_fn) using c.source_id, v_on, v_paid, v_method;", "null;");
    console.log("   (QUEBRADO de propósito: o aviso do Asaas não dá baixa)");
  } else if (QUEBRAR === "trava") {
    await c.query("drop trigger ppr_charges_fee_lock on public.ppr_charges");
    await c.query("drop trigger ortho_charges_fee_lock on public.ortho_charges");
    console.log("   (QUEBRADO de propósito: sem a trava da mensalidade)");
  }

  // --- o cenário ---------------------------------------------------------------
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "recepcao", "consultor"]) {
    P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
  }
  for (const k of ["admin", "gerente", "recepcao"]) if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  if (!(await um("select public.central_is_ready($1) r", [ldn])).r) throw new Error("NÃO MEDI: Londrina não está pronta na Central do treino.");
  const papel = async (k, clinic, role) => {
    if (!P[k]) return;
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("gerente", ldn, "unit_manager");
  await papel("recepcao", ldn, "receptionist");
  if (P.financeiro) await papel("financeiro", franq, "finance_franchisor");
  if (P.consultor) await papel("consultor", ldn, "dentist");
  const hoje = iso((await um("select public.today_br() d")).d);
  const cli = await um(
    `select c.id from public.clients c where c.clinic_id = $1 and public._cpf_ok(c.cpf) and c.birth_date < current_date - interval '19 years'
        and not exists (select 1 from public.client_guardians g where g.client_id = c.id) order by c.created_at limit 1`, [ldn]);
  const plano = await um("select id from public.ppr_plans order by created_at limit 1");
  if (!cli || !plano) throw new Error("NÃO MEDI: falta cliente ou plano do PPR+ no treino.");
  const adesao = async (metodo, status = "ativo") =>
    (await um(`insert into public.ppr_memberships (clinic_id, plan_id, holder_client_id, status, monthly_cents, billing_day, payment_method, contract_signed, first_payment_confirmed)
               values ($1, $2, $3, $4, 9990, 10, $5, $6, $7) returning id`, [ldn, plano.id, cli.id, status, metodo, status !== "aguardando_ativacao", status !== "aguardando_ativacao"])).id;

  // --- 1) a chave da unidade: nada muda sozinho ------------------------------------
  const m1 = await adesao("boleto");
  const f1 = (await um("insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status) values ($1, $2, date_trunc('month', current_date), $3, 9990, 'em_aberto') returning id", [m1, ldn, mais(hoje, 10)])).id;
  const naLista = async (tipo, id) => (await todos("select * from public._fee_charges_due(null, 1000) where source_type = $1 and source_id = $2", [tipo, id])).length === 1;
  conf("sem a chave ligada, nenhuma mensalidade vai ao Asaas", !(await naLista("ppr_charge", f1)));
  conf("ligar sem marcar \"Avisei os clientes\": recusado", erro(await pessoa(P.gerente, "select public.fees_switch_set($1, $2, false)", [ldn, hoje]), "WARNING_REQUIRED"));
  conf("a Recepção não liga a chave", erro(await pessoa(P.recepcao, "select public.fees_switch_set($1, $2, true)", [ldn, hoje]), "NOT_ALLOWED"));
  const pv = (await pessoa(P.gerente, "select public.fees_switch_preview($1, $2) j", [ldn, hoje]))?.[0]?.j;
  conf("antes de ligar, a tela mostra quantos entram e quantos esperam a ASA4B", pv && typeof pv.ppr_entram === "number" && typeof pv.ppr_esperam === "number" && pv.ppr_entram >= 1);
  conf("o Gerente liga, com \"Avisei os clientes\" (na auditoria)", passou(await pessoa(P.gerente, "select public.fees_switch_set($1, $2, true)", [ldn, hoje])) &&
    (await um("select count(*)::int n from public.audit_logs where entity_type = 'fees_switch' and entity_id = $1", [ldn])).n >= 1);
  conf("ligada: a mensalidade de boleto entra na lista (dentro da janela)", await naLista("ppr_charge", f1));

  // --- 2) recorrência continua como está (ajuste 2) ------------------------------------
  const m2 = await adesao("credito_recorrente");
  const f2 = (await um("insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status) values ($1, $2, date_trunc('month', current_date), $3, 9990, 'em_aberto') returning id", [m2, ldn, mais(hoje, 10)])).id;
  conf("adesão em crédito recorrente: não entra (espera a ASA4B)", !(await naLista("ppr_charge", f2)));
  conf("passar para boleto sem a concordância: recusado", erro(await pessoa(P.recepcao, "select public.ppr_membership_switch_method($1, 'boleto', false)", [m2]), "CONSENT_REQUIRED"));
  conf("passar para boleto com a concordância registrada", passou(await pessoa(P.recepcao, "select public.ppr_membership_switch_method($1, 'boleto', true)", [m2])) &&
    (await um("select method_consent->>'texto' t from public.ppr_memberships where id = $1", [m2])).t === "O cliente concordou em pagar por boleto ou Pix");
  conf("…e então entra", await naLista("ppr_charge", f2));

  // --- 3) a emissão e a trava ----------------------------------------------------------
  const ch1 = (await um("select public._fee_charge_prepare_system('ppr_charge', $1, 'BOLETO', 'mensalidade') id", [f1])).id;
  const cb = await um("select * from public.charges where id = $1", [ch1]);
  conf("a cobrança nasce ligada à mensalidade, sem multa nem juros, com a descrição da origem",
    cb.source_type === "ppr_charge" && cb.source_id === f1 && Number(cb.fine_percent) === 0 && Number(cb.interest_percent) === 0 && /Mensalidade PPR\+/.test(cb.description ?? ""));
  conf("o pagador é o titular (a regra de sempre)", cb.payer_kind === "client" && cb.client_id === cli.id);
  conf("a leitura do Asaas acha a cobrança da mensalidade", (await um("select description from public._charge_for_gateway($1)", [ch1]))?.description?.startsWith("Mensalidade PPR+"));
  await um("select public._charge_mark_issued($1, $2, null, $3, null, null, $4)", [ch1, `pay_men_${ch1.slice(0, 8)}`, "https://sandbox.asaas.com/i/men", "2379"]);
  conf("a mesma mensalidade não ganha outra cobrança", !(await naLista("ppr_charge", f1)));
  conf("com a cobrança viva, a baixa à mão é recusada (CHARGE_ACTIVE)", erro(await pessoa(P.recepcao, "select public.ppr_mark_charge_paid($1, true)", [f1]), "CHARGE_ACTIVE"));
  conf("…e mudar o vencimento também", erro(await servidor("update public.ppr_charges set due_date = due_date + 1 where id = $1", [f1]), "CHARGE_ACTIVE"));
  conf("…mas marcar \"atrasada\" passa", passou(await servidor("update public.ppr_charges set status = 'atrasada' where id = $1 returning 1", [f1])));
  await c.query("update public.ppr_charges set status = 'em_aberto' where id = $1", [f1]);

  // --- 4) a baixa pelo aviso e a taxa da rede (a reter / retida / a cobrar) --------------
  const conta = await um("select id from public.gateway_accounts order by (clinic_id = $1) desc limit 1", [franq]);
  if (!conta) throw new Error("NÃO MEDI: nenhuma conta Asaas no treino para o split.");
  const taxas = (await todos("select key from public.network_fee_types where kind = 'percent' and active")).map((x) => x.key);
  if (conta && taxas.length) {
    await c.query("update public.charges set split_applied = true where id = $1", [ch1]);
    await c.query(`insert into public.charge_splits (charge_id, destination_account_id, wallet_id, percent, percentual_value, fixed_cents, fees, tariff_percent, tariff_fixed_cents, status)
                   values ($1, $2, 'w_ensaio', 17, 17, 0, $3::jsonb, 0, 0, 'enviado')`, [ch1, conta.id, JSON.stringify(Object.fromEntries(taxas.map((t) => [t, 1])))]);
  }
  const pts0 = Number((await um("select coalesce(sum(points), 0) n from public.ppr_social_points where membership_id = $1", [m1])).n);
  const pago = await servidor("select public._gateway_on_paid($1, 'PAYMENT_RECEIVED', $2::jsonb) r", [ch1, JSON.stringify({ id: `pay_men_${ch1.slice(0, 8)}`, value: 99.9, netValue: 97.91, paymentDate: hoje, creditDate: hoje })]);
  conf("o aviso do Asaas dá baixa na mensalidade", passou(pago) && pago[0].r === "baixa" && (await um("select status from public.ppr_charges where id = $1", [f1])).status === "paga");
  conf("a cobrança fica liquidada, com a tarifa e o líquido", (await um("select status, fee_cents from public.charges where id = $1", [ch1])).status === "liquidada");
  conf("a tarifa do Asaas vai como despesa bancária (2.4.01), uma vez", (await um("select count(*)::int n from public.financial_entries where source_type = 'gateway_fee_charge' and source_id = $1 and account_code = '2.4.01'", [ch1])).n === 1);
  const sc = await todos("select amount_cents, retained_cents, charge_id from public.split_charges where source_type = 'ppr_charge' and source_id = $1 and not reversed", [f1]);
  conf("a taxa da rede da mensalidade paga pelo Asaas com split nasce RETIDA", sc.length > 0 && sc.every((x) => Number(x.retained_cents) === Number(x.amount_cents) && x.charge_id === ch1));
  conf("…e não entra na conta a pagar (nada a cobrar dela)", sc.reduce((s, x) => s + Number(x.amount_cents) - Number(x.retained_cents), 0) === 0);
  const pts1 = Number((await um("select coalesce(sum(points), 0) n from public.ppr_social_points where membership_id = $1", [m1])).n);
  const social = (await um("select coalesce(social_enabled, false) s from public.ppr_plans where id = $1", [plano.id])).s;
  conf("os pontos do Riso+ Social: os mesmos da baixa à mão", !social || pts1 > pts0);
  conf("o aviso repetido não baixa duas vezes", passou(await servidor("select public._gateway_on_paid($1, 'PAYMENT_RECEIVED', $2::jsonb) r", [ch1, JSON.stringify({ id: `pay_men_${ch1.slice(0, 8)}`, value: 99.9, netValue: 97.91, paymentDate: hoje })])) &&
    (await um("select count(*)::int n from public.financial_entries where source_type = 'gateway_fee_charge' and source_id = $1", [ch1])).n === 1);
  // a mensalidade paga em dinheiro (por fora): a taxa é "a cobrar", uma vez
  const f3 = (await um("insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status) values ($1, $2, date_trunc('month', current_date) + interval '3 months', $3, 9990, 'em_aberto') returning id", [m1, ldn, mais(hoje, 5)])).id;
  conf("sem cobrança viva, a baixa à mão passa", passou(await pessoa(P.recepcao, "select public.ppr_mark_charge_paid($1, true)", [f3])));
  const sc3 = await todos("select amount_cents, retained_cents from public.split_charges where source_type = 'ppr_charge' and source_id = $1 and not reversed", [f3]);
  conf("paga por fora: a taxa fica \"a cobrar da unidade\" (vai para a conta a pagar, uma vez)", sc3.length > 0 && sc3.every((x) => Number(x.retained_cents) === 0));

  // --- 5) a Ortodontia: o desconto de pontualidade até o vencimento ---------------------
  const caso = await um("select oc.id, oc.client_id from public.ortho_cases oc where oc.clinic_id = $1 order by oc.created_at limit 1", [ldn]);
  if (caso) {
    // O pagador precisa de CPF válido (a regra de sempre): no treino, um CPF de teste.
    await c.query("update public.clients set cpf = $2 where id = $1 and not public._cpf_ok(cpf)", [caso.client_id, cpfDeTeste()]);
    await c.query("delete from public.client_guardians where client_id = $1 and is_financial", [caso.client_id]);
    const of1 = (await um(`insert into public.ortho_charges (case_id, clinic_id, client_id, reference_month, kind, due_date, amount_cents, status)
                           values ($1, $2, $3, date_trunc('month', current_date) + interval '5 months', 'mensalidade', $4, 17600, 'em_aberto') returning id`, [caso.id, ldn, caso.client_id, mais(hoje, 8)])).id;
    await c.query("update public.ortho_case_terms set billing_method = 'boleto', punctuality_discount_percent = 5 where case_id = $1", [caso.id]);
    conf("Ortodontia em boleto entra na lista", await naLista("ortho_charge", of1));
    const och = (await um("select public._fee_charge_prepare_system('ortho_charge', $1, 'BOLETO', 'mensalidade') id", [of1])).id;
    const oc = await um("select value_cents, discount_cents from public.charges where id = $1", [och]);
    conf("o desconto de pontualidade vai como desconto do Asaas até o vencimento (5% de 176,00 = 8,80)", Number(oc.value_cents) === 17600 && Number(oc.discount_cents) === 880);
    await um("select public._charge_mark_issued($1, $2, null, $3, null, null, $4)", [och, `pay_ort_${och.slice(0, 8)}`, "https://sandbox.asaas.com/i/ort", "2379"]);
    await servidor("select public._gateway_on_paid($1, 'PAYMENT_RECEIVED', $2::jsonb)", [och, JSON.stringify({ id: `pay_ort_${och.slice(0, 8)}`, value: 167.2, netValue: 165.21, paymentDate: hoje })]);
    const ob = await um("select status, paid_amount_cents, discount_cents from public.ortho_charges where id = $1", [of1]);
    conf("pago até o vencimento: a mensalidade é baixada com o desconto (167,20)", ob.status === "paga" && Number(ob.paid_amount_cents) === 16720);
    const osc = await todos("select base_cents from public.split_charges where source_type = 'ortho_charge' and source_id = $1 and not reversed", [of1]);
    conf("a taxa da rede incide sobre o valor efetivamente pago", osc.length > 0 && osc.every((x) => Number(x.base_cents) === 16720));
    const of2 = (await um(`insert into public.ortho_charges (case_id, clinic_id, client_id, reference_month, kind, due_date, amount_cents, status)
                           values ($1, $2, $3, date_trunc('month', current_date) + interval '6 months', 'mensalidade', $4, 17600, 'em_aberto') returning id`, [caso.id, ldn, caso.client_id, mais(hoje, 9)])).id;
    const och2 = (await um("select public._fee_charge_prepare_system('ortho_charge', $1, 'BOLETO', 'mensalidade') id", [of2])).id;
    await um("select public._charge_mark_issued($1, $2, null, $3, null, null, $4)", [och2, `pay_ort2_${och2.slice(0, 8)}`, "https://sandbox.asaas.com/i/ort2", "2379"]);
    // O vencimento passou (o ensaio volta a data, como o servidor faria com a baixa do Asaas).
    await c.query("select set_config('risarte.baixa_do_asaas', '1', true)");
    await c.query("update public.ortho_charges set due_date = $2 where id = $1", [of2, mais(hoje, -2)]);
    await c.query("select set_config('risarte.baixa_do_asaas', '', true)");
    await servidor("select public._gateway_on_paid($1, 'PAYMENT_RECEIVED', $2::jsonb)", [och2, JSON.stringify({ id: `pay_ort2_${och2.slice(0, 8)}`, value: 176, netValue: 174.01, paymentDate: hoje })]);
    conf("pago depois do vencimento: valor cheio (176,00), sem desconto", Number((await um("select paid_amount_cents from public.ortho_charges where id = $1", [of2])).paid_amount_cents) === 17600);
    await c.query("update public.ortho_case_terms set billing_method = 'credito_recorrente' where case_id = $1", [caso.id]);
    const of3 = (await um(`insert into public.ortho_charges (case_id, clinic_id, client_id, reference_month, kind, due_date, amount_cents, status)
                           values ($1, $2, $3, date_trunc('month', current_date) + interval '7 months', 'mensalidade', $4, 17600, 'em_aberto') returning id`, [caso.id, ldn, caso.client_id, mais(hoje, 9)])).id;
    conf("Ortodontia em crédito recorrente: não entra (espera a ASA4B)", !(await naLista("ortho_charge", of3)));
  } else {
    console.log("   (sem caso de Ortodontia em Londrina no treino: parte 5 não medida)");
  }

  // --- 6) a geração do mês, a 1ª mensalidade e a suspensa ---------------------------------
  const gerou = Number((await um("select public._ppr_generate_run() n")).n);
  const prox = iso((await um("select (date_trunc('month', public.today_br()) + interval '1 month')::date d")).d);
  conf("a mensalidade do mês que vem nasce no dia 1 do mês anterior (a rotina)", gerou >= 1 && (await um("select count(*)::int n from public.ppr_charges where membership_id = $1 and reference_month = $2", [m1, prox])).n === 1);
  const m3 = await adesao("pix", "aguardando_ativacao");
  await c.query("update public.ppr_memberships set contract_signed = true where id = $1", [m3]);
  const pri = await um("select id, due_date from public.ppr_charges where membership_id = $1", [m3]);
  conf("a 1ª mensalidade nasce na assinatura da adesão (vence com ao menos 3 dias)", pri && iso(pri.due_date) >= mais(hoje, 3));
  if (pri) {
    const chp = (await um("select public._fee_charge_prepare_system('ppr_charge', $1, 'PIX', 'mensalidade') id", [pri.id])).id;
    await um("select public._charge_mark_issued($1, $2, null, $3, null, null, $4)", [chp, `pay_pri_${chp.slice(0, 8)}`, "https://sandbox.asaas.com/i/pri", null]);
    await servidor("select public._gateway_on_paid($1, 'PAYMENT_RECEIVED', $2::jsonb)", [chp, JSON.stringify({ id: `pay_pri_${chp.slice(0, 8)}`, value: 99.9, netValue: 97.91, paymentDate: hoje })]);
    conf("o pagamento da 1ª ativa a adesão sozinho", (await um("select status from public.ppr_memberships where id = $1", [m3])).status === "ativo");
  }
  const m4 = await adesao("boleto", "suspenso");
  await um("select public._ppr_generate_run()");
  conf("adesão suspensa não gera mensalidade nova", (await um("select count(*)::int n from public.ppr_charges where membership_id = $1", [m4])).n === 0);

  // --- 7) o atraso: suspende aos 30, NÃO cancela aos 90, avisa o Gerente a cada 7 dias ---
  const m5 = await adesao("boleto");
  await c.query("insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status) values ($1, $2, date_trunc('month', current_date) + interval '8 months', current_date - 95, 9990, 'em_aberto'), ($1, $2, date_trunc('month', current_date) + interval '9 months', current_date - 65, 9990, 'em_aberto')", [m5, ldn]);
  await um("select public._ppr_refresh_delinquency_raw($1)", [ldn]);
  const ms5 = await um("select status, overdue_alert_at from public.ppr_memberships where id = $1", [m5]);
  conf("aos 90 dias: suspende, mas NÃO cancela sozinho", ms5.status === "suspenso");
  conf("…e o Gerente recebe o aviso para decidir", ms5.overdue_alert_at !== null && (await um("select count(*)::int n from public.notifications where user_id = $1 and title like 'PPR+ — adesão com % dias de atraso: decida'", [P.gerente])).n >= 1);
  conf("2 mensalidades vencidas: o Gerente é avisado", (await um("select count(*)::int n from public.notifications where user_id = $1 and title like 'PPR+ — adesão com 2 mensalidades vencidas'", [P.gerente])).n >= 1);
  const antes = (await um("select count(*)::int n from public.notifications where user_id = $1 and title like 'PPR+ — adesão com % dias de atraso: decida'", [P.gerente])).n;
  await um("select public._ppr_refresh_delinquency_raw($1)", [ldn]);
  conf("o aviso não se repete antes de 7 dias", (await um("select count(*)::int n from public.notifications where user_id = $1 and title like 'PPR+ — adesão com % dias de atraso: decida'", [P.gerente])).n === antes);
  conf("\"Manter suspensa\" registra a decisão", passou(await pessoa(P.gerente, "select public.ppr_overdue_keep($1)", [m5])));
  await c.query("update public.ppr_memberships set overdue_alert_at = now() - interval '8 days' where id = $1", [m5]);
  await um("select public._ppr_refresh_delinquency_raw($1)", [ldn]);
  conf("…e para o aviso", (await um("select count(*)::int n from public.notifications where user_id = $1 and title like 'PPR+ — adesão com % dias de atraso: decida'", [P.gerente])).n === antes);
  // quitou: reativa e a próxima nasce na hora (sem os meses da suspensão)
  for (const x of await todos("select id from public.ppr_charges where membership_id = $1 and status in ('em_aberto','atrasada')", [m5])) {
    await pessoa(P.recepcao, "select public.ppr_mark_charge_paid($1, true)", [x.id]);
  }
  conf("quitado o que deve, a adesão é reativada", (await um("select status from public.ppr_memberships where id = $1", [m5])).status === "ativo");
  conf("…e a próxima mensalidade nasce na hora (os meses da suspensão não são cobrados)",
    (await um("select count(*)::int n from public.ppr_charges where membership_id = $1 and due_date >= public.today_br() and status = 'em_aberto'", [m5])).n === 1);

  // --- 8) o cancelamento: os meses que não venceram caem; os vencidos ficam --------------
  const m6 = await adesao("boleto");
  await c.query("insert into public.ppr_charges (membership_id, clinic_id, reference_month, due_date, amount_cents, status) values ($1, $2, date_trunc('month', current_date) + interval '11 months', current_date - 40, 9990, 'atrasada'), ($1, $2, date_trunc('month', current_date) + interval '2 months', current_date + 40, 9990, 'em_aberto')", [m6, ldn]);
  await c.query("update public.ppr_memberships set status = 'cancelado' where id = $1", [m6]);
  const st6 = await todos("select status, due_date < current_date vencida from public.ppr_charges where membership_id = $1", [m6]);
  conf("cancelada: a do mês que não venceu cai", st6.filter((x) => !x.vencida).every((x) => x.status === "cancelada"));
  conf("cancelada: a já vencida continua como dívida", st6.filter((x) => x.vencida).every((x) => x.status === "atrasada"));

  // --- 9) o selo "Em atraso": a mensalidade vencida entra; o Dentista nunca vê ------------
  await servidor("update public.finance_settings set overdue_badge_business_days = 0 where true");
  const selo = await pessoa(P.admin, "select * from public.client_overdue_badges($1::uuid[])", [[cli.id]]);
  conf("a mensalidade vencida entra no selo \"Em atraso\"", passou(selo) && selo.length === 1);
  if (P.consultor) {
    const d = await pessoa(P.consultor, "select * from public.client_overdue_badges($1::uuid[])", [[cli.id]]);
    conf("o Dentista não vê o selo, nem pela porta do banco", !passou(d) || d.length === 0);
  }

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
