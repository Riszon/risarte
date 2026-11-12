// ENSAIO DA 4006 (ASA2, entrega 2) no banco de TREINO, numa transação DESFEITA
// (rollback): nada fica gravado.
// Uso: node scripts/asaas-ensaio-asa2-entrega2.mjs --confirmar
//
// Confere: o corte do "em atraso" (dias úteis, fim de semana e feriado
// nacional, com 0, 3 e 5 dias); o selo por papel nas DUAS etapas e o TETO
// (dentista, planner, TSB, ASB e SDR nunca, mesmo marcados); o escopo por
// unidade; "há N dias" desde o vencimento; o Painel de cobranças só para quem
// pode e no escopo dele, a Recepcionista nunca; a planilha registrada na
// auditoria com os filtros; a taxa e o líquido gravados pelo aviso; as funções
// internas fechadas e as públicas fechadas para anônimo. Só contagens na saída.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4006_asa2_selo_em_atraso_e_painel_de_cobrancas.sql";

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/asaas-ensaio-asa2-entrega2.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, valor) => (valor ? ok : falha).push(nome);
async function recusa(sql, params = []) {
  await c.query("savepoint s");
  try {
    await c.query(sql, params);
    await c.query("release savepoint s");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint s");
    return `${e.code ?? ""} ${e.message}`;
  }
}
const um = async (sql, params = []) => {
  try {
    return (await c.query(sql, params)).rows[0];
  } catch (err) {
    throw new Error(`${err.message} ← ${sql.slice(0, 90)}`);
  }
};
const todos = async (sql, params = []) => {
  try {
    return (await c.query(sql, params)).rows;
  } catch (err) {
    throw new Error(`${err.message} ← ${sql.slice(0, 90)}`);
  }
};
async function como(userId) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await c.query("set local role authenticated");
}
async function comoAnonimo() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
  await c.query("set local role anon");
}
async function comoServidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}

// A conta de referência, feita AQUI, sem o banco: o maior D com D + N dias
// úteis < hoje (fora sábado, domingo e feriado nacional).
function corteEsperado(hoje, n, feriados) {
  const util = (iso) => {
    const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
    return dow !== 0 && dow !== 6 && !feriados.has(iso);
  };
  const soma = (iso, dias) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  };
  const maisUteis = (iso, k) => {
    let x = iso;
    let falta = k;
    while (falta > 0) {
      x = soma(x, 1);
      if (util(x)) falta -= 1;
    }
    return x;
  };
  let d = soma(hoje, -1);
  while (maisUteis(d, n) >= hoje) d = soma(d, -1);
  return d;
}

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  const e2 = await recusa(sql);
  conf("a 4006 roda duas vezes sem erro", e2 === null);
  if (e2) console.log("   ", e2);

  // --- 1) o corte -------------------------------------------------------------
  const hoje = (await um("select public.today_br()::text d")).d;
  const feriados = new Set(
    (await todos("select holiday_date::text d from public.holidays where scope = 'national'")).map((r) => r.d)
  );
  for (const n of [0, 3, 5]) {
    await c.query("update public.finance_settings set overdue_badge_business_days = $1 where clinic_id is null", [n]);
    const corte = (await um("select public.overdue_badge_cutoff()::text d")).d;
    conf(`o corte com ${n} dia(s) útil(eis) bate com a conta feita fora do banco`, corte === corteEsperado(hoje, n, feriados));
  }
  await c.query("update public.finance_settings set overdue_badge_business_days = 3 where clinic_id is null");
  // Feriado no meio: quinta 19/11/2026 + 3 úteis pula o 20/11 (Consciência Negra) e o fim de semana.
  const comFeriado = (await um("select public._payout_add_business_days('2026-11-19', 3)::text d")).d;
  conf("o feriado nacional e o fim de semana não contam (19/11 + 3 úteis = 25/11)", comFeriado === "2026-11-25");
  const fora = await recusa("update public.finance_settings set overdue_badge_business_days = 16 where clinic_id is null");
  conf("a tolerância fora de 0 a 15 é recusada", fora !== null);

  // --- 2) o cenário -------------------------------------------------------------
  const pessoa = async (conta) => (await um("select id from public.profiles where email = $1", [`${conta}@example.com`]))?.id;
  const P = {};
  for (const k of ["admin", "gerente", "franqueado", "recepcao", "consultor", "assistente", "financeiro", "dentista", "planner", "tsb", "asb", "sdr"]) {
    P[k] = await pessoa(k);
    if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  }
  const [uA, uB] = (await todos("select id from public.clinics where type = 'franchise_unit' and is_active order by name limit 2")).map((r) => r.id);
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  if (!uA || !uB || !franq) throw new Error("NÃO MEDI: faltam duas unidades e a franqueadora.");
  // Ninguém de teste com papel na unidade B, para o escopo ser medido de verdade.
  await c.query("delete from public.user_clinic_roles_all where clinic_id = $1 and user_id = any($2)", [uB, Object.values(P)]);
  const papeis = [
    ["gerente", "unit_manager"], ["franqueado", "franchisee"], ["recepcao", "receptionist"],
    ["consultor", "commercial_consultant"], ["assistente", "commercial_assistant"], ["dentista", "dentist"],
    ["planner", "planner_dentist"], ["tsb", "tsb"], ["asb", "asb"], ["sdr", "sdr"],
  ];
  // Cada conta só com o papel do teste: os da unidade na unidade A; os da
  // franqueadora (Consultor, Assistente, Planner, SDR) na franqueadora, de onde
  // alcançam as unidades do escopo deles.
  const DA_FRANQUEADORA = new Set(["commercial_consultant", "commercial_assistant", "planner_dentist", "sdr"]);
  for (const [k, role] of papeis) {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    // Na franqueadora, com o escopo "todas as unidades" (como o cadastro real).
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role, unit_scope) values ($1, $2, $3, $4)", [
      P[k],
      DA_FRANQUEADORA.has(role) ? franq : uA,
      role,
      DA_FRANQUEADORA.has(role) ? "all" : null,
    ]);
  }
  await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P.financeiro]);
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, 'finance_franchisor')", [P.financeiro, franq]);

  const corte = (await um("select public.overdue_badge_cutoff()::text d")).d;
  const naoAtrasada = (await um("select (public.overdue_badge_cutoff() + 1)::text d")).d;
  const antiga = (await um("select (public.overdue_badge_cutoff() - 10)::text d")).d;
  const cliente = async (unidade, nome) =>
    (await um(
      "insert into public.clients (clinic_id, full_name, birth_date) values ($1, $2, '1980-01-01') returning id",
      [unidade, nome]
    )).id;
  // A parcela precisa de uma origem: uma venda direta de mentira por parcela.
  const parcela = async (unidade, cli, venc, status = "em_aberto") => {
    const venda = (await um(
      `insert into public.direct_sales (clinic_id, client_id, client_name, description, value_cents, final_cents,
         payment_method, installments, contract_signed)
       values ($1, $2, 'Ensaio', 'Ensaio 4006', 10000, 10000, 'boleto', 1, true) returning id`,
      [unidade, cli]
    )).id;
    return (await um(
      `insert into public.payment_installments (clinic_id, client_id, direct_sale_id, seq, due_date, amount_cents, payment_method, status)
       values ($1, $2, $5, 1, $3, 10000, 'boleto', $4) returning id`,
      [unidade, cli, venc, status, venda]
    )).id;
  };
  await comoServidor();
  await c.query("set local session_replication_role = replica");
  const cA = await cliente(uA, "Ensaio Selo Atrasado");
  const cA2 = await cliente(uA, "Ensaio Selo Em Dia");
  const cB = await cliente(uB, "Ensaio Selo Outra Unidade");
  await parcela(uA, cA, corte);
  await parcela(uA, cA, antiga);
  await parcela(uA, cA, antiga, "paga");
  await parcela(uA, cA2, naoAtrasada);
  await parcela(uB, cB, corte);
  await c.query("set local session_replication_role = origin");

  const selo = async (quem) => {
    await como(P[quem]);
    const r = await todos("select client_id, days_late from public.client_overdue_badges($1)", [[cA, cA2, cB]]);
    await comoServidor();
    return new Map(r.map((x) => [x.client_id, x.days_late]));
  };

  // --- 3) o selo, etapa 1 (padrão: Gerente e Franqueado) -----------------------
  const dias = (await um("select (public.today_br() - $1::date)::int n", [antiga])).n;
  const sA = await selo("admin");
  conf("o Admin vê o selo nas duas unidades", sA.has(cA) && sA.has(cB));
  conf("\"há N dias\" conta desde o vencimento mais antigo em aberto", sA.get(cA) === dias);
  conf("a parcela dentro da tolerância não acende o selo", !sA.has(cA2));
  const sG = await selo("gerente");
  conf("etapa 1: o Gerente vê o selo da própria unidade", sG.has(cA));
  conf("o Gerente não vê o selo da outra unidade", !sG.has(cB));
  conf("etapa 1: o Franqueado vê o selo da própria unidade", (await selo("franqueado")).has(cA));
  for (const k of ["recepcao", "consultor", "assistente", "financeiro"]) {
    conf(`etapa 1: ${k} ainda não vê o selo`, (await selo(k)).size === 0);
  }

  // --- 4) etapa 2: o dono libera na matriz ------------------------------------
  await c.query(
    `insert into public.permission_matrix (capability, role) values
       ('acao.cobranca.selo_atraso','receptionist'), ('acao.cobranca.selo_atraso','commercial_consultant'),
       ('acao.cobranca.selo_atraso','commercial_assistant'), ('acao.cobranca.selo_atraso','finance_franchisor')
     on conflict (capability, role) do update set allowed = true`
  );
  const sR = await selo("recepcao");
  conf("etapa 2: a Recepcionista vê o selo da unidade dela e não o da outra", sR.has(cA) && !sR.has(cB));
  for (const k of ["consultor", "assistente"]) {
    conf(`etapa 2: ${k} (da franqueadora) vê o selo nas unidades do escopo`, (await selo(k)).has(cA));
  }
  const sF = await selo("financeiro");
  conf("etapa 2: o Financeiro da Franqueadora vê o selo da rede", sF.has(cA) && sF.has(cB));

  // --- 5) o TETO: marcados na matriz, continuam sem ver --------------------------
  await c.query(
    `insert into public.permission_matrix (capability, role)
     select 'acao.cobranca.selo_atraso', r::public.user_role from unnest(array['dentist','planner_dentist','tsb','asb','sdr']) r
     on conflict (capability, role) do update set allowed = true`
  );
  for (const k of ["dentista", "planner", "tsb", "asb", "sdr"]) {
    conf(`o teto: ${k} nunca vê o selo, mesmo marcado na matriz`, (await selo(k)).size === 0);
  }

  // --- 6) o Painel de cobranças ---------------------------------------------------
  const conta = (await um("select id from public.gateway_accounts order by created_at limit 1"))?.id ?? null;
  await comoServidor();
  await c.query("set local session_replication_role = replica");
  const instA = await parcela(uA, cA, naoAtrasada);
  const instB = await parcela(uB, cB, naoAtrasada);
  const cobranca = async (unidade, cli, inst, pid, status) =>
    (await um(
      `insert into public.charges (clinic_id, gateway_account_id, source_type, payment_installment_id, client_id, billing_type,
         value_cents, due_date, status, asaas_payment_id, issued_at, paid_cents, paid_on, credit_date, receipt_id)
       values ($1, $2, 'installment', $3, $4, 'BOLETO', 1020, $5, $6, $7, now(), 1020, public.today_br(), public.today_br() + 2,
               case when $6 = 'paga' then (select r.id from public.payment_receipts r order by r.created_at limit 1) end)
       returning id`,
      [unidade, conta, inst, cli, naoAtrasada, status, pid]
    )).id;
  const chA = await cobranca(uA, cA, instA, "pay_ensaio_a", "paga");
  await cobranca(uB, cB, instB, "pay_ensaio_b", "paga");
  await c.query("set local session_replication_role = origin");

  const painel = async (quem, unidade = null) => {
    await como(P[quem]);
    await c.query("savepoint p");
    try {
      const r = await todos("select clinic_id from public.gateway_receivables_due($1)", [unidade]);
      await c.query("release savepoint p");
      await comoServidor();
      return r.map((x) => x.clinic_id);
    } catch (e) {
      await c.query("rollback to savepoint p");
      await comoServidor();
      return /NOT_ALLOWED/.test(e.message) ? "recusado" : `erro: ${e.message}`;
    }
  };
  conf("o Admin vê o painel da rede", (await painel("admin")).includes(uB));
  conf("padrão: o Gerente ainda não vê o painel (só o Admin, em testes)", (await painel("gerente")) === "recusado");
  await c.query(
    `insert into public.permission_matrix (capability, role)
     select 'modulo.painel_cobrancas', r::public.user_role
       from unnest(array['unit_manager','franchisee','finance_franchisor','receptionist']) r
     on conflict (capability, role) do update set allowed = true`
  );
  const pG = await painel("gerente");
  conf("liberado: o Gerente vê só a própria unidade", Array.isArray(pG) && pG.includes(uA) && !pG.includes(uB));
  conf("o Gerente pedindo a outra unidade é recusado", (await painel("gerente", uB)) === "recusado");
  const pFr = await painel("franqueado");
  conf("liberado: o Franqueado vê só a própria unidade", Array.isArray(pFr) && pFr.includes(uA) && !pFr.includes(uB));
  const pF = await painel("financeiro");
  conf("liberado: o Financeiro da Franqueadora vê a rede", Array.isArray(pF) && pF.includes(uA) && pF.includes(uB));
  conf("o teto: a Recepcionista nunca vê o painel, mesmo marcada", (await painel("recepcao")) === "recusado");

  // A planilha vai para a auditoria, com os filtros; a tela não.
  const antes = (await um("select count(*)::int n from public.audit_logs where entity_type = 'gateway_charges_panel'")).n;
  await como(P.gerente);
  const tela = await todos("select * from public.gateway_charges_list($1, null, array['BOLETO'], 'vencimento', null, null, false)", [uA]);
  await comoServidor();
  const depoisTela = (await um("select count(*)::int n from public.audit_logs where entity_type = 'gateway_charges_panel'")).n;
  conf("a lista na tela traz as cobranças da unidade", tela.some((r) => r.charge_id === chA));
  conf("olhar a lista na tela não grava auditoria", depoisTela === antes);
  await como(P.gerente);
  await todos("select * from public.gateway_charges_list($1, array['paga'], array['BOLETO'], 'vencimento', '2026-01-01', null, true)", [uA]);
  await comoServidor();
  const log = await um(
    "select user_id, action, details from public.audit_logs where entity_type = 'gateway_charges_panel' order by id desc limit 1"
  );
  conf(
    "baixar a planilha grava quem, a ação e os filtros",
    log?.user_id === P.gerente &&
      log.action === "export" &&
      log.details?.data === "vencimento" &&
      log.details?.de === "2026-01-01" &&
      JSON.stringify(log.details?.situacoes) === JSON.stringify(["paga"]) &&
      log.details?.unidade === uA
  );
  const ruim = await recusa("select * from public.gateway_charges_list(null, null, null, 'qualquer', null, null, false)");
  conf("campo de data inválido é recusado", ruim !== null);

  // --- 7) taxa e líquido gravados pelo aviso ---------------------------------------
  if (conta) {
    const ev = (await um(
      `insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload, charge_id)
       values ($1, 'evt_ensaio_4006', 'PAYMENT_CONFIRMED',
               jsonb_build_object('event','PAYMENT_CONFIRMED','payment', jsonb_build_object('id','pay_ensaio_a','value',10.20,'netValue',9.21)),
               $2) returning id`,
      [conta, chA]
    )).id;
    await c.query("update public.gateway_webhook_events set processed_at = now(), result = 'baixa' where id = $1", [ev]);
    const ch = await um("select fee_cents, net_cents from public.charges where id = $1", [chA]);
    conf("o aviso processado grava taxa e líquido na cobrança (0,99 e 9,21)", Number(ch.fee_cents) === 99 && Number(ch.net_cents) === 921);
  } else {
    falha.push("NÃO MEDI: sem conta Asaas no treino para o aviso");
  }

  // --- 8) portas ------------------------------------------------------------------
  const internas = ["_gateway_cap_clinics('modulo.painel_cobrancas')", "_overdue_badge_business_days()", "_gateway_cap_default_roles('x')", "_gateway_cap_ceiling('x')"];
  for (const f of internas) {
    await como(P.gerente);
    const e = await recusa(`select public.${f}`);
    conf(`interna fechada para logado: ${f.split("(")[0]}`, e !== null && /permission denied/.test(e));
  }
  for (const f of ["client_overdue_badges(array[]::uuid[])", "gateway_receivables_due(null)", "gateway_charges_list(null,null,null,null,null,null,false)", "overdue_badge_cutoff()"]) {
    await comoAnonimo();
    const e = await recusa(`select * from public.${f}`);
    conf(`fechada para anônimo: ${f.split("(")[0]}`, e !== null && /permission denied/.test(e));
  }
  await comoServidor();
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

for (const n of ok) console.log(`  ✓ ${n}`);
for (const n of falha) console.log(`  ✗ ${n}`);
console.log(`\n${ok.length} conferências certas, ${falha.length} erradas.`);
process.exit(falha.length ? 1 : 0);
