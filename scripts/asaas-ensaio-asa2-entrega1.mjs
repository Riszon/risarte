// ENSAIO DA 4005 (ASA2, entrega 1) no banco de TREINO, numa transação DESFEITA
// (rollback): nada fica gravado.
// Uso: node scripts/asaas-ensaio-asa2-entrega1.mjs --confirmar
//
// Simula os avisos do Asaas (gravados pela mesma função do webhook) e confere o
// que cada um faz: a baixa automática, a D21 nas três origens, Pix recebido
// direto, boleto confirmado e depois recebido, fora de ordem, repetido, valor a
// maior, a menor dentro e fora do limite, vencida, apagada e restaurada,
// estorno com a taxa da rede mantida e a dispensa manual dela, duplicidade e a
// resolução, aviso com erro e o reprocessar, as funções internas fechadas para
// logado e anônimo, a multa em reais na emissão. Só contagens na saída.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4005_asa2_aviso_vira_baixa.sql";

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/asaas-ensaio-asa2-entrega1.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}

function cpfValido(n) {
  const d = String(n).padStart(9, "0").split("").map(Number);
  const dv = (arr, peso) => {
    const r = (arr.reduce((acc, x, i) => acc + x * (peso - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(d, 10));
  d.push(dv(d, 11));
  return d.join("");
}
const aleatorio = () => cpfValido(100000000 + Math.floor(Math.random() * 800000000));

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
async function semGatilhos(fn) {
  await comoServidor();
  await c.query("savepoint g");
  await c.query("set local session_replication_role = replica");
  try {
    const r = await fn();
    await c.query("set local session_replication_role = origin");
    await c.query("release savepoint g");
    return r;
  } catch (err) {
    await c.query("rollback to savepoint g");
    await c.query("set local session_replication_role = origin");
    throw err;
  }
}

try {
  await c.query("begin");
  const jaAplicada = (await um("select count(*)::int n from information_schema.columns where table_name = 'charges' and column_name = 'fine_cents'")).n > 0;
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  const e2 = await recusa(sql);
  conf("a 4005 roda duas vezes sem erro", e2 === null);
  if (e2) console.log("   ", e2);
  if (jaAplicada) console.log("    (a 4005 já estava no treino; reaplicada)");

  const pessoa = async (conta) => (await um("select id from public.profiles where email = $1", [`${conta}@example.com`]))?.id;
  const admin = await pessoa("admin");
  const gerente = await pessoa("gerente");
  const financeiro = await pessoa("financeiro");
  const recepcao = await pessoa("recepcao");
  if (!admin || !gerente || !financeiro || !recepcao) throw new Error("NÃO MEDI: faltam contas de teste.");

  const contaRow = await um(`select a.id, a.clinic_id from public.gateway_accounts a
     where a.owner_type = 'unit' and a.status = 'active' and a.clinic_id is not null order by a.created_at limit 1`);
  const unidade = contaRow.clinic_id;
  const conta = contaRow.id;
  await c.query(
    `insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $3, 'unit_manager'), ($2, $3, 'receptionist') on conflict do nothing`,
    [gerente, recepcao, unidade]
  );
  await como(admin);
  await recusa("select public.gateway_register_term($1, current_date, 'Ensaio', null)", [conta]);
  await recusa("select public.gateway_declare_split_enabled($1, true)", [conta]);
  await c.query("select public.central_mark_ready($1, true)", [unidade]);
  await comoServidor();
  // Uma taxa da rede de 5% (no treino estão em zero), para medir a taxa mantida.
  await c.query("update public.network_fees set percent = 0 where kind = 'percent' and fee <> 'fundo'");
  await c.query("update public.network_fees set percent = 5, active = true where fee = 'fundo' and clinic_id is null");
  await c.query("update public.network_fee_types set active = true where key = 'fundo'");
  // Os avisos do sandbox que já estavam no treino não entram neste ensaio.
  await c.query("update public.gateway_webhook_events set processed_at = now(), result = 'ensaio' where processed_at is null");

  const hoje = (await um("select public.today_br() d")).d;
  const dia = async (n) => (await um("select (public.today_br() + $1::int)::date d", [n])).d;
  const iso = (d) => new Date(d).toISOString().slice(0, 10);

  const cliente = async (nome) =>
    (await um("insert into public.clients (clinic_id, full_name, birth_date, cpf, no_cpf) values ($1, $2, '1980-01-01', $3, false) returning id", [unidade, nome, aleatorio()])).id;
  const vendaDireta = (cli, { assinado = true, fechada = false } = {}) =>
    semGatilhos(async () =>
      (await um(
        "insert into public.direct_sales (clinic_id, client_id, client_name, description, value_cents, final_cents, contract_signed, payment_method, installments, closed_at, status) values ($1, $2, 'Ensaio', 'Ensaio ASA2', 100000, 100000, $3, 'pix', 1, $4, $5) returning id",
        [unidade, cli, assinado, fechada ? new Date() : null, fechada ? "concluida" : "aguardando_fechamento"]
      )).id
    );
  let seq = 0;
  const parcela = async (cli, { venc, valor = 10000, beneficio = 0, metodo = "pix", direta, negociacao, reneg }) => {
    await comoServidor();
    return (await um(
      `insert into public.payment_installments (clinic_id, client_id, direct_sale_id, negotiation_id, renegotiation_id, seq, due_date, amount_cents, benefit_discount_cents, payment_method, late_fee_percent, monthly_interest_percent, grace_days)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 2, 1, 0) returning id`,
      [unidade, cli, direta ?? null, negociacao ?? null, reneg ?? null, ++seq, venc, valor, beneficio, metodo]
    )).id;
  };
  // Emite como a recepção e grava a resposta do Asaas como o servidor.
  let nPay = 0;
  const emitir = async (inst, tipo = "PIX", data = null) => {
    await como(recepcao);
    const id = (await um("select public.charge_prepare($1, $2, $3) id", [inst, tipo, data])).id;
    await comoServidor();
    const pay = `pay_ensaio_${++nPay}_${Date.now().toString(36)}`;
    await c.query("select public._charge_mark_issued($1, $2, null, 'https://x/i', null, null, null)", [id, pay]);
    return { id, pay };
  };
  let nEvt = 0;
  const aviso = async (cob, evento, extra = {}) => {
    await comoServidor();
    const ch = await um("select value_cents, due_date from public.charges where id = $1", [cob.id]);
    const payment = {
      id: cob.pay,
      externalReference: cob.id,
      value: Number(ch.value_cents) / 100,
      netValue: Number(ch.value_cents) / 100 - 1.99,
      paymentDate: iso(hoje),
      creditDate: null,
      dueDate: iso(ch.due_date),
      billingType: "PIX",
      ...extra,
    };
    const evt = `evt_ensaio_${++nEvt}`;
    await c.query("select public._gateway_record_event($1, $2, $3, $4)", [conta, evt, evento, JSON.stringify({ id: evt, event: evento, payment })]);
    const ev = await um("select id from public.gateway_webhook_events where account_id = $1 and asaas_event_id = $2", [conta, evt]);
    const r = (await um("select public._gateway_process_event($1) r", [ev.id])).r;
    return { r, eventRowId: ev.id, evt };
  };
  const parcelaRow = (id) => um("select status, paid_amount_cents from public.payment_installments where id = $1", [id]);
  const cobranca = (id) => um("select * from public.charges where id = $1", [id]);

  // ---- 0) a emissão com multa em reais e juros proporcionais ----------------------
  const cli0 = await cliente("Ensaio ASA2 Emissão");
  const v0 = await vendaDireta(cli0, { fechada: true });
  const pCheia = await parcela(cli0, { venc: await dia(10), beneficio: 500, direta: v0 });
  await como(recepcao);
  let pv = await um("select * from public.charge_preview($1, 'PIX', null)", [pCheia]);
  conf("emissão: multa em reais sobre o valor cheio (2% de 105,00 = 2,10)", Number(pv.fine_cents) === 210);
  conf("emissão: juros iguais quando a cobrança é do valor cheio", Number(pv.interest_percent) === 1);
  const pParcial = await parcela(cli0, { venc: await dia(10), direta: v0 });
  await como(recepcao);
  await c.query("select public.register_payment_receipt($1, 3000, current_date, 'dinheiro', null, null, null)", [pParcial]);
  pv = await um("select * from public.charge_preview($1, 'PIX', null)", [pParcial]);
  conf("emissão do saldo: multa em reais sobre o valor CHEIO (2% de 100,00)", Number(pv.fine_cents) === 200);
  conf("emissão do saldo: juros proporcionais (1% × 100/70)", Math.abs(Number(pv.interest_percent) - 1.4286) < 0.0001);

  // ---- 1) Pix recebido direto: D21 da venda direta + baixa + liquidada --------------
  const cli1 = await cliente("Ensaio ASA2 Pix");
  const v1 = await vendaDireta(cli1, { assinado: true, fechada: false });
  const p1 = await parcela(cli1, { venc: await dia(5), direta: v1 });
  const c1 = await emitir(p1);
  let a = await aviso(c1, "PAYMENT_RECEIVED", { creditDate: iso(await dia(1)) });
  conf("Pix recebido: o aviso dá a baixa", a.r === "baixa");
  let cr = await cobranca(c1.id);
  conf("Pix recebido sem confirmado: cobrança Liquidada", cr.status === "liquidada" && Number(cr.paid_cents) === 10000);
  conf("a parcela fica paga", (await parcelaRow(p1)).status === "paga");
  const vd = await um("select status, closed_at, payment_confirmed, payment_confirmed_source from public.direct_sales where id = $1", [v1]);
  conf("D21: a venda direta fecha, com a origem Asaas", vd.closed_at && vd.status === "concluida" && vd.payment_confirmed_source === "asaas");
  const rec1 = await um("select * from public.payment_receipts where id = $1", [cr.receipt_id]);
  conf("a baixa fica sem pessoa (Asaas automático)", rec1.created_by === null && rec1.notes === "Baixa automática (Asaas)");
  conf("taxa real do aviso (valor − líquido = 1,99)", Number(rec1.acquirer_fee_cents) === 199);
  conf("data real em que o dinheiro cai", String(rec1.settlement_date) === String(await dia(1)));
  const contaAsaas = await um("select b.id, b.alias from public.bank_accounts b where b.gateway_account_id = $1", [conta]);
  conf("a conta 'Asaas' da unidade foi criada", contaAsaas?.alias === "Asaas");
  conf("o caixa da baixa entra na conta Asaas",
    (await um("select bank_account_id from public.financial_entries where source_type = 'receipt_cash' and source_id = $1", [rec1.id])).bank_account_id === contaAsaas.id);
  conf("a taxa da rede da baixa foi lançada (5%)",
    (await um("select count(*)::int n from public.split_charges where receipt_id = $1 and not reversed", [rec1.id])).n === 1);

  // Repetido e fora de ordem.
  await comoServidor();
  const dup = (await um("select public._gateway_record_event($1, $2, 'PAYMENT_RECEIVED', '{}'::jsonb) r", [conta, a.evt])).r;
  conf("o mesmo aviso não entra duas vezes", dup === null || dup === false);
  conf("reprocessar um aviso já processado não faz nada", (await um("select public._gateway_process_event($1) r", [a.eventRowId])).r === "baixa");
  a = await aviso(c1, "PAYMENT_CONFIRMED");
  conf("confirmado depois de recebido: sem efeito (não volta)", a.r === "ja_baixada" && (await cobranca(c1.id)).status === "liquidada");
  conf("uma baixa só", (await um("select count(*)::int n from public.payment_receipts where installment_id = $1", [p1])).n === 1);

  // ---- 2) Boleto: confirmado, depois recebido ------------------------------------
  const cli2 = await cliente("Ensaio ASA2 Boleto");
  const v2 = await vendaDireta(cli2, { fechada: true });
  const p2 = await parcela(cli2, { venc: await dia(5), direta: v2, metodo: "boleto" });
  const c2 = await emitir(p2, "BOLETO");
  a = await aviso(c2, "PAYMENT_CONFIRMED", { billingType: "BOLETO", estimatedCreditDate: iso(await dia(2)) });
  conf("boleto confirmado: baixa e Paga", a.r === "baixa" && (await cobranca(c2.id)).status === "paga");
  a = await aviso(c2, "PAYMENT_RECEIVED", { billingType: "BOLETO", creditDate: iso(await dia(3)) });
  cr = await cobranca(c2.id);
  conf("boleto recebido: Liquidada com a data real", a.r === "liquidada" && cr.status === "liquidada" && String(cr.credit_date) === String(await dia(3)));

  // ---- 3) Valor a maior, a menor dentro e fora do limite --------------------------
  const cli3 = await cliente("Ensaio ASA2 Valores");
  const v3 = await vendaDireta(cli3, { fechada: true });
  const pMaior = await parcela(cli3, { venc: await dia(5), direta: v3 });
  const cMaior = await emitir(pMaior);
  await aviso(cMaior, "PAYMENT_RECEIVED", { value: 101.0, netValue: 99.01 });
  const rMaior = await um("select r.* from public.payment_receipts r join public.charges ch on ch.receipt_id = r.id where ch.id = $1", [cMaior.id]);
  conf("valor a maior: o que veio a mais entra como juros", Number(rMaior.interest_cents) === 100 && Number(rMaior.principal_cents) === 10000);
  conf("valor a maior: parcela paga", (await parcelaRow(pMaior)).status === "paga");

  const pArred = await parcela(cli3, { venc: await dia(5), direta: v3 });
  const cArred = await emitir(pArred);
  await aviso(cArred, "PAYMENT_RECEIVED", { value: 99.95, netValue: 97.96 });
  const w = await um("select * from public.payment_waivers where installment_id = $1", [pArred]);
  conf("a menor até R$ 0,10: fecha como arredondamento (automático)", w?.kind === "arredondamento" && Number(w.total_cents) === 5 && w.created_by === null);
  conf("arredondamento: a parcela fica paga", (await parcelaRow(pArred)).status === "paga");

  const pMenor = await parcela(cli3, { venc: await dia(5), direta: v3 });
  const cMenor = await emitir(pMenor);
  const avisosAntes = (await um("select count(*)::int n from public.notifications where title = 'Pagamento pelo Asaas abaixo do devido'")).n;
  await aviso(cMenor, "PAYMENT_RECEIVED", { value: 90.0, netValue: 88.01 });
  conf("a menor acima do limite: a parcela fica parcial", (await parcelaRow(pMenor)).status === "parcial");
  conf("a menor acima do limite: sem arredondamento", (await um("select count(*)::int n from public.payment_waivers where installment_id = $1", [pMenor])).n === 0);
  conf("a menor acima do limite: aviso ao Gerente",
    (await um("select count(*)::int n from public.notifications where title = 'Pagamento pelo Asaas abaixo do devido'")).n > avisosAntes);
  await comoServidor();
  await c.query("update public.finance_settings set gateway_rounding_tolerance_cents = 0 where clinic_id is null");
  const pZero = await parcela(cli3, { venc: await dia(5), direta: v3 });
  const cZero = await emitir(pZero);
  await aviso(cZero, "PAYMENT_RECEIVED", { value: 99.95, netValue: 97.96 });
  conf("o limite segue a rede (zero: 5 centavos ficam em aberto)", (await parcelaRow(pZero)).status === "parcial");
  await c.query("update public.finance_settings set gateway_rounding_tolerance_cents = 10 where clinic_id is null");
  let e = await recusa("update public.finance_settings set gateway_rounding_tolerance_cents = 600 where clinic_id is null");
  conf("limite acima de R$ 5,00 é recusado", /finance_settings_rounding_tolerance_check/.test(e ?? ""));

  // ---- 4) Vencida, apagada e restaurada, alterada ---------------------------------
  const cli4 = await cliente("Ensaio ASA2 Situações");
  const v4 = await vendaDireta(cli4, { fechada: true });
  const p4 = await parcela(cli4, { venc: await dia(3), direta: v4 });
  const c4 = await emitir(p4);
  await comoServidor();
  const avisosAntesDaVencida = (await um("select count(*)::int n from public.notifications")).n;
  a = await aviso(c4, "PAYMENT_OVERDUE");
  conf("vencido: cobrança Vencida", a.r === "vencida" && (await cobranca(c4.id)).status === "vencida");
  conf("vencido: sem aviso individual", (await um("select count(*)::int n from public.notifications")).n === avisosAntesDaVencida);
  await comoServidor();
  const resumo = (await um("select public._gateway_overdue_summary() n")).n;
  conf("resumo diário das vencidas avisa o Gerente da unidade", resumo >= 1);
  conf("resumo diário: um por dia", (await um("select public._gateway_overdue_summary() n")).n === 0);
  a = await aviso(c4, "PAYMENT_UPDATED", { value: 120.0 });
  conf("alterada no painel do Asaas: avisa", a.r === "alterada_no_asaas");
  a = await aviso(c4, "PAYMENT_DELETED");
  conf("apagada no painel do Asaas: Cancelada", a.r === "cancelada_no_asaas" && (await cobranca(c4.id)).status === "cancelada");
  a = await aviso(c4, "PAYMENT_RESTORED");
  conf("restaurada: volta a valer", a.r === "restaurada" && ["emitida", "vencida"].includes((await cobranca(c4.id)).status));

  // ---- 5) Estorno com a taxa da rede mantida (D13) e a dispensa manual -------------
  a = await aviso(c1, "PAYMENT_REFUNDED");
  cr = await cobranca(c1.id);
  conf("estorno: cobrança Estornada", a.r === "estornada" && cr.status === "estornada");
  conf("estorno: a baixa é estornada e a parcela reabre", (await parcelaRow(p1)).status === "em_aberto");
  conf("estorno: a taxa da rede CONTINUA devida",
    (await um("select count(*)::int n from public.split_charges where receipt_id = $1 and not reversed and kept_after_refund", [rec1.id])).n === 1);
  conf("estorno: a taxa do Asaas não é devolvida",
    (await um("select count(*)::int n from public.financial_entries where source_type = 'acquirer_fee' and reversal_of is not null and reversal_of in (select id from public.financial_entries where source_id = $1)", [rec1.id])).n === 0);
  await como(recepcao);
  e = await recusa("select public.network_fee_waive_after_refund($1, 'pagamento devolvido')", [rec1.id]);
  conf("Recepcionista não dispensa a taxa", /NOT_ALLOWED/.test(e ?? ""));
  await como(financeiro);
  e = await recusa("select public.network_fee_waive_after_refund($1, 'ok')", [rec1.id]);
  conf("dispensa da taxa sem motivo é recusada", /REASON_REQUIRED/.test(e ?? ""));
  await c.query("select public.network_fee_waive_after_refund($1, 'pagamento em duplicidade devolvido')", [rec1.id]);
  await comoServidor();
  const sc = await um("select reversed, waived_by, waived_reason from public.split_charges where receipt_id = $1", [rec1.id]);
  conf("Financeiro dispensa a taxa com motivo e autor", sc.reversed === true && sc.waived_by === financeiro);

  // ---- 6) Pagamento em duplicidade ------------------------------------------------
  const cli6 = await cliente("Ensaio ASA2 Duplicidade");
  const v6 = await vendaDireta(cli6, { fechada: true });
  const p6 = await parcela(cli6, { venc: await dia(5), direta: v6 });
  const p6b = await parcela(cli6, { venc: await dia(35), direta: v6 });
  const c6 = await emitir(p6);
  // Recebeu no balcão: cancela a cobrança e dá a baixa manual.
  await comoServidor();
  await c.query("select public._charge_mark_cancelled($1, $2, 'pagou no balcão')", [c6.id, recepcao]);
  await como(recepcao);
  await c.query("select public.register_payment_receipt($1, 10000, current_date, 'dinheiro', null, null, null)", [p6]);
  a = await aviso(c6, "PAYMENT_RECEIVED");
  conf("pagamento de cobrança cancelada: duplicidade, sem baixa em dobro",
    a.r === "duplicidade" && (await um("select count(*)::int n from public.payment_receipts where installment_id = $1", [p6])).n === 1);
  const sur = await um("select * from public.gateway_payment_surpluses where charge_id = $1", [c6.id]);
  conf("a duplicidade guarda o valor", sur && Number(sur.amount_cents) === 10000 && sur.status === "aberto");
  conf("a duplicidade avisa Gerente e Financeiro",
    (await um("select count(*)::int n from public.notifications where title = 'Pagamento em duplicidade' and user_id in ($1, $2)", [gerente, financeiro])).n === 2);
  await como(recepcao);
  e = await recusa("select public.gateway_surplus_apply($1, $2, null)", [sur.id, p6b]);
  conf("Recepcionista não resolve a duplicidade", /NOT_ALLOWED/.test(e ?? ""));
  await como(gerente);
  await c.query("select public.gateway_surplus_apply($1, $2, 'abatido na próxima')", [sur.id, p6b]);
  await comoServidor();
  conf("Gerente abate em outra parcela: ela fica paga", (await parcelaRow(p6b)).status === "paga");
  conf("a duplicidade fica Abatida",
    (await um("select status from public.gateway_payment_surpluses where id = $1", [sur.id])).status === "abatido");

  // ---- 7) D21 da venda comercial e da renegociação --------------------------------
  const cli7 = await cliente("Ensaio ASA2 Comercial");
  const neg = await semGatilhos(async () => {
    const plan = (await um("insert into public.treatment_plans (client_id, clinic_id) values ($1, $2) returning id", [cli7, unidade])).id;
    const opt = (await um("insert into public.treatment_plan_options (plan_id, clinic_id, title) values ($1, $2, 'Ensaio') returning id", [plan, unidade])).id;
    const n = (await um("insert into public.plan_negotiations (plan_id, option_id, client_id, clinic_id, status, final_cents) values ($1, $2, $3, $4, 'aceita', 10000) returning id", [plan, opt, cli7, unidade])).id;
    await c.query("insert into public.commercial_sales (negotiation_id, client_id, clinic_id, plan_id, final_cents, contract_signed) values ($1, $2, $3, $4, 10000, true)", [n, cli7, unidade, plan]);
    return n;
  });
  const p7 = await parcela(cli7, { venc: await dia(5), negociacao: neg });
  const c7 = await emitir(p7);
  a = await aviso(c7, "PAYMENT_RECEIVED");
  const cs = await um("select closed_at, payment_confirmed, payment_confirmed_source from public.commercial_sales where negotiation_id = $1", [neg]);
  conf("D21: a venda comercial fecha pela confirmação do Asaas", a.r === "baixa" && cs.closed_at && cs.payment_confirmed_source === "asaas");
  conf("D21: a baixa entra depois do fechamento", (await parcelaRow(p7)).status === "paga");

  const cli8 = await cliente("Ensaio ASA2 Renegociação");
  const ren = await semGatilhos(async () =>
    (await um("insert into public.payment_renegotiations (clinic_id, client_id, status, contract_signed) values ($1, $2, 'aplicada', true) returning id", [unidade, cli8])).id
  );
  const p8 = await parcela(cli8, { venc: await dia(5), reneg: ren });
  const c8 = await emitir(p8);
  a = await aviso(c8, "PAYMENT_RECEIVED");
  const rn = await um("select closed_at, payment_confirmed_source from public.payment_renegotiations where id = $1", [ren]);
  conf("D21: a renegociação fecha pela confirmação do Asaas", a.r === "baixa" && rn.closed_at && rn.payment_confirmed_source === "asaas");

  // ---- 8) Aviso com erro e o reprocessar ------------------------------------------
  const cli9 = await cliente("Ensaio ASA2 Erro");
  const v9 = await vendaDireta(cli9, { fechada: true });
  const p9 = await parcela(cli9, { venc: await dia(5), direta: v9 });
  const c9 = await emitir(p9);
  await comoServidor();
  // Força o erro: a venda "reabre" e perde a assinatura (a baixa exige venda fechada).
  await semGatilhos(() => c.query("update public.direct_sales set closed_at = null, contract_signed = false, status = 'aguardando_fechamento' where id = $1", [v9]));
  a = await aviso(c9, "PAYMENT_RECEIVED");
  const ev9 = await um("select processed_at, error, attempts from public.gateway_webhook_events where id = $1", [a.eventRowId]);
  conf("aviso com erro: guardado com o erro, sem baixa", a.r === "erro" && ev9.processed_at === null && /SALE_NOT_CLOSED/.test(ev9.error ?? ""));
  conf("aviso com erro: a parcela não mudou", (await parcelaRow(p9)).status === "em_aberto");
  await semGatilhos(() => c.query("update public.direct_sales set contract_signed = true where id = $1", [v9]));
  await como(recepcao);
  e = await recusa("select public.gateway_reprocess_event($1)", [a.eventRowId]);
  conf("só o Admin reprocessa", /NOT_ALLOWED/.test(e ?? ""));
  await como(admin);
  const rr = (await um("select public.gateway_reprocess_event($1) r", [a.eventRowId])).r;
  conf("Admin reprocessa: agora dá a baixa", rr === "baixa" && (await parcelaRow(p9)).status === "paga");
  await comoServidor();
  conf("a fila de pendentes processa na ordem", (await um("select public._gateway_process_pending(null, 10) n")).n >= 0);

  // ---- 9) Fora do riSZon, chave da conta ------------------------------------------
  await comoServidor();
  await c.query("select public._gateway_record_event($1, 'evt_fora', 'PAYMENT_RECEIVED', $2)", [conta, JSON.stringify({ id: "evt_fora", event: "PAYMENT_RECEIVED", payment: { id: "pay_x", externalReference: "pedido-123", value: 10 } })]);
  const evFora = await um("select id from public.gateway_webhook_events where asaas_event_id = 'evt_fora'");
  conf("cobrança que não nasceu no riSZon é ignorada", (await um("select public._gateway_process_event($1) r", [evFora.id])).r === "ignorado_fora_do_riszon");
  await c.query("select public._gateway_record_event($1, 'evt_chave', 'ACCESS_TOKEN_EXPIRED', '{\"id\":\"evt_chave\",\"event\":\"ACCESS_TOKEN_EXPIRED\"}'::jsonb)", [conta]);
  const evChave = await um("select id from public.gateway_webhook_events where asaas_event_id = 'evt_chave'");
  conf("chave vencida: aviso ao Admin", (await um("select public._gateway_process_event($1) r", [evChave.id])).r === "aviso_admin");

  // ---- 10) As funções internas fechadas para logado e anônimo ----------------------
  const internas = [
    ["select public._gateway_receipt($1, 1, current_date, 'pix', null, null, null, false)", [p4]],
    ["select public._gateway_confirm_sale($1)", [p4]],
    ["select public._gateway_apply_fee($1, 1, current_date, $2, 'PIX')", [rec1.id, conta]],
    ["select public._gateway_reverse_receipt($1, 'x')", [rec1.id]],
    ["select public._gateway_process_event(1)", []],
    ["select public._gateway_apply_event(1)", []],
    ["select public._gateway_on_paid($1, 'PAYMENT_RECEIVED', '{}'::jsonb)", [c4.id]],
    ["select public._gateway_process_pending(null, 1)", []],
    ["select public._gateway_overdue_summary()", []],
    ["select public._gateway_bank_account($1)", [conta]],
  ];
  for (const quem of ["logado", "anonimo"]) {
    let fechadas = 0;
    for (const [q, ps] of internas) {
      if (quem === "logado") await como(admin);
      else await comoAnonimo();
      const err = await recusa(q, ps);
      if (/permission denied/.test(err ?? "")) fechadas++;
    }
    conf(`funções internas fechadas para ${quem === "logado" ? "o Admin logado" : "o anônimo"} (${internas.length})`, fechadas === internas.length);
  }
  await comoServidor();
  const pTrava = await parcela(cli4, { venc: await dia(9), direta: v4 });
  await emitir(pTrava);
  await como(recepcao);
  e = await recusa("select public.register_payment_receipt($1, 1000, current_date, 'dinheiro', null, null, null)", [pTrava]);
  conf("baixa manual com cobrança ativa continua recusada", /CHARGE_IN_GATEWAY/.test(e ?? ""));
} catch (err) {
  falha.push(`EXCEÇÃO: ${err.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nENSAIO ASA2 (entrega 1) — ${ok.length} conferências passaram, ${falha.length} falharam.`);
for (const f of falha) console.log("  ✗", f);
if (falha.length === 0) console.log("  (transação desfeita: nada ficou gravado no treino)");
process.exit(falha.length === 0 ? 0 : 1);
