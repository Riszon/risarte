// ENSAIO DA 4004 (ASA1, entrega 2) no banco de TREINO, numa transação DESFEITA
// (rollback): nada fica gravado.
// Uso: node scripts/asaas-ensaio-asa1-entrega2.mjs --confirmar
//
// Confere a cobrança de parcela (quem emite, as recusas, o pagador, o valor em
// dia e o da parcela vencida dentro do limite de dias), a única cobrança ativa,
// as travas na parcela e na baixa manual, a cobrança externa, o cancelamento
// para receber no balcão e a quitação por valor menor (a dispensa, a ordem,
// o razão e quem pode). Nenhuma chamada ao Asaas: o ensaio grava a resposta
// como o servidor gravaria. Clientes e parcelas inventados. Só contagens na saída.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4004_asa1_cobrancas_travas_e_dispensa.sql";

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/asaas-ensaio-asa1-entrega2.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}

/** CPF válido inventado (os dígitos verificadores certos). */
function cpfValido(base9) {
  const d = String(base9).padStart(9, "0").split("").map(Number);
  const dv = (arr, peso) => {
    const s = arr.reduce((acc, n, i) => acc + n * (peso - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(d, 10));
  d.push(dv(d, 11));
  return d.join("");
}

const CPF_ADULTO = cpfValido(100000000 + Math.floor(Math.random() * 800000000));
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
const um = async (sql, params = []) => (await c.query(sql, params)).rows[0];
async function como(userId) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await c.query("set local role authenticated");
}
async function comoServidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  // Com a 4005 no banco, as funções de emissão mudaram de formato (multa em
  // reais): a 4004 não é reaplicada, só conferida.
  const tem4005 = (await um("select count(*)::int n from information_schema.columns where table_name = 'charges' and column_name = 'fine_cents'")).n > 0;
  let e2 = null;
  if (!tem4005) {
    await c.query(sql);
    e2 = await recusa(sql);
  }
  conf("a 4004 roda duas vezes sem erro (ou a 4005 já está no banco)", e2 === null);
  if (e2) console.log("   ", e2);

  const pessoa = async (conta) =>
    (await um("select id from public.profiles where email = $1", [`${conta}@example.com`]))?.id;
  const admin = await pessoa("admin");
  const gerente = await pessoa("gerente");
  const financeiro = await pessoa("financeiro");
  const recepcao = await pessoa("recepcao");
  const coordenador = await pessoa("coordenador");
  if (!admin || !gerente || !financeiro || !recepcao || !coordenador) throw new Error("NÃO MEDI: faltam contas de teste.");

  // A unidade do ensaio é a que tem conta Asaas de teste (a 1ª unidade ativa).
  const unidade = (
    await um(`select a.clinic_id from public.gateway_accounts a
               where a.owner_type = 'unit' and a.status = 'active' and a.clinic_id is not null
               order by a.created_at limit 1`)
  )?.clinic_id;
  if (!unidade) throw new Error("NÃO MEDI: nenhuma unidade com conta Asaas de teste.");
  const conta = (await um("select public._gateway_account_of($1) id", [unidade])).id;

  // Gerente e recepção do ensaio passam a trabalhar nela (desfeito no fim).
  await c.query(
    `insert into public.user_clinic_roles_all (user_id, clinic_id, role)
     values ($1, $3, 'unit_manager'), ($2, $3, 'receptionist') on conflict do nothing`,
    [gerente, recepcao, unidade]
  );

  // ---- a unidade pronta ------------------------------------------------------
  await como(admin);
  await c.query("select public.gateway_register_term($1, current_date, 'Ensaio Franqueado', null)", [conta]);
  await c.query("select public.gateway_declare_split_enabled($1, true)", [conta]);
  await c.query("select public.central_mark_ready($1, true)", [unidade]);
  // Uma taxa da rede de 5% (no treino elas estão em zero), para medir a conta a pagar.
  await comoServidor();
  await c.query("update public.network_fees set percent = 5, active = true where fee = 'fundo' and clinic_id is null");
  await c.query("update public.network_fee_types set active = true where key = 'fundo'");
  await comoServidor();
  const faltando = (await c.query("select item from public._central_readiness_raw($1) where not ok", [unidade])).rows;
  conf("a unidade do ensaio fica com todos os itens de prontidão", faltando.length === 0);
  if (faltando.length) console.log("    faltam:", faltando.map((r) => r.item).join(", "));

  // ---- clientes e parcelas inventados ------------------------------------------
  const cliente = async (nome, nascimento, cpf) =>
    (await um(
      "insert into public.clients (clinic_id, full_name, birth_date, cpf, no_cpf, phone) values ($1, $2, $3, $4, $5, '43999990000') returning id",
      [unidade, nome, nascimento, cpf, cpf == null]
    )).id;
  const adulto = await cliente("Ensaio Cobrança Adulto", "1980-03-01", CPF_ADULTO);
  const adultoCpfRuim = await cliente("Ensaio CPF Ruim", "1980-03-01", CPF_ADULTO.slice(0, 9) + String((Number(CPF_ADULTO.slice(9)) + 1) % 100).padStart(2, "0"));
  const menor = await cliente("Ensaio Cobrança Menor", "2015-03-01", null);
  const menorSemPagador = await cliente("Ensaio Menor Sem Pagador", "2016-03-01", null);
  const cpfMae = cpfValido(100000000 + Math.floor(Math.random() * 800000000));
  await c.query(
    "insert into public.client_guardians (client_id, full_name, cpf, relationship, is_financial, phone) values ($1, 'Ensaio Mãe Pagadora', $2, 'mãe', true, '43988887777')",
    [menor, cpfMae]
  );

  // A venda nasce fechada SEM os gatilhos (o fechamento de venda direta pelo
  // gatilho da 0373 está quebrado no núcleo; não é o que este ensaio mede).
  const venda = async (cli, assinado) => {
    await comoServidor();
    await c.query("set local session_replication_role = replica");
    const id = (await um(
      "insert into public.direct_sales (clinic_id, client_id, client_name, description, value_cents, contract_signed, closed_at) values ($1, $2, 'Ensaio', 'Ensaio cobrança', 100000, $3, case when $3 then now() end) returning id",
      [unidade, cli, assinado]
    )).id;
    await c.query("set local session_replication_role = origin");
    return id;
  };
  let seq = 0;
  const parcela = async (cli, { venc, valor = 10000, beneficio = 0, metodo = "boleto", vendaId, carencia = 0 }) =>
    (await um(
      `insert into public.payment_installments
         (clinic_id, client_id, direct_sale_id, seq, due_date, amount_cents, benefit_discount_cents,
          payment_method, late_fee_percent, monthly_interest_percent, grace_days)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 2, 1, $9) returning id`,
      [unidade, cli, vendaId ?? (await venda(cli, true)), ++seq, venc, valor, beneficio, metodo, carencia]
    )).id;
  const hoje = (await um("select public.today_br() d")).d;
  const dia = async (n) => (await um("select (public.today_br() + $1::int)::date d", [n])).d;

  const emDia = await parcela(adulto, { venc: await dia(10), beneficio: 500 });
  const doMenor = await parcela(menor, { venc: await dia(10) });
  const vencida = await parcela(adulto, { venc: await dia(-30), metodo: "pix" });
  const semPagador = await parcela(menorSemPagador, { venc: await dia(10) });
  const cpfRuim = await parcela(adultoCpfRuim, { venc: await dia(10) });
  const parcelado = await parcela(adulto, { venc: await dia(10), metodo: "cartao_parcelado" });
  const naoAssinada = await parcela(adulto, { venc: await dia(10), vendaId: await venda(adulto, false) });

  const previa = async (inst, tipo, data = null) =>
    um("select * from public.charge_preview($1, $2, $3)", [inst, tipo, data]);

  // ---- 1) quem pode emitir -----------------------------------------------------
  await como(coordenador);
  conf("Coordenador: a prévia recusa (NOT_ALLOWED)", (await previa(emDia, "BOLETO")).error_code === "NOT_ALLOWED");
  let e = await recusa("select public.charge_prepare($1, 'BOLETO', null)", [emDia]);
  conf("Coordenador: emitir é recusado", /NOT_ALLOWED/.test(e ?? ""));

  // ---- 2) o valor em dia: cheio com o benefício como desconto até o vencimento -----
  await como(recepcao);
  let p = await previa(emDia, "BOLETO");
  if (p.error_code) console.log("    prévia em dia:", p.error_code);
  conf("em dia: valor = parcela + benefício", p.error_code === null && Number(p.value_cents) === 10500);
  conf("em dia: o benefício vai como desconto", Number(p.discount_cents) === 500);
  conf("em dia: multa e juros da parcela", Number(p.fine_percent) === 2 && Number(p.interest_percent) === 1);
  conf("em dia: vence no vencimento da parcela", String(p.due_date) === String(await dia(10)));
  conf("em dia: o pagador é o cliente adulto", p.payer_kind === "client");

  // ---- 3) o pagador ------------------------------------------------------------
  p = await previa(doMenor, "PIX");
  conf("menor: o pagador é o responsável financeiro", p.payer_kind === "guardian" && p.payer_name === "Ensaio Mãe Pagadora");
  conf("menor sem responsável financeiro é recusado", (await previa(semPagador, "PIX")).error_code === "PAYER_REQUIRED");
  conf("CPF inválido do cliente é recusado", (await previa(cpfRuim, "PIX")).error_code === "PAYER_CPF_INVALID_CLIENT");

  // ---- 4) as recusas por regra -----------------------------------------------------
  conf("cartão parcelado não emite na ASA1", (await previa(parcelado, "CREDIT_CARD")).error_code === "METHOD_NOT_SUPPORTED");
  conf("meio desconhecido é recusado", (await previa(emDia, "TED")).error_code === "BILLING_TYPE_INVALID");
  conf("contrato não assinado é recusado", (await previa(naoAssinada, "BOLETO")).error_code === "CONTRACT_NOT_SIGNED");

  // ---- 5) a parcela VENCIDA ----------------------------------------------------------
  conf("vencida: data no passado é recusada", (await previa(vencida, "PIX", await dia(-1))).error_code === "REISSUE_DATE_OUT_OF_RANGE");
  conf("vencida: além de 7 dias é recusada", (await previa(vencida, "PIX", await dia(8))).error_code === "REISSUE_DATE_OUT_OF_RANGE");
  const pHoje = await previa(vencida, "PIX", hoje);
  const p7 = await previa(vencida, "PIX", await dia(7));
  const saldo = async (inst, data) => {
    await comoServidor();
    return um("select * from public.installment_balance($1, $2)", [inst, data]);
  };
  const s7 = await saldo(vencida, await dia(7));
  await como(recepcao);
  conf("vencida: o valor é o saldo atualizado ATÉ a nova data", Number(p7.value_cents) === Number(s7.total_rem));
  conf("vencida: data mais longe cobra mais juros", Number(p7.value_cents) > Number(pHoje.value_cents));
  conf("vencida: sem multa nova e sem desconto", Number(p7.fine_percent) === 0 && Number(p7.discount_cents) === 0);
  // 4005: juros na proporção do valor cheio (parcela 100,00 ÷ valor da cobrança).
  conf("vencida: juros mensais a partir da nova data",
    tem4005 ? Math.abs(Number(p7.interest_percent) - Math.round((10000 / Number(p7.value_cents)) * 10000) / 10000) < 0.0001
            : Number(p7.interest_percent) === 1);
  conf("vencida: marcada como reemissão", p7.is_overdue_reissue === true && p7.max_reissue_days === 7);
  // O limite segue a rede.
  await comoServidor();
  await c.query("update public.finance_settings set overdue_reissue_max_days = 3 where clinic_id is null");
  await como(recepcao);
  conf("o limite segue a rede (3 dias: o 4º é recusado)", (await previa(vencida, "PIX", await dia(4))).error_code === "REISSUE_DATE_OUT_OF_RANGE");
  await comoServidor();
  e = await recusa("update public.finance_settings set overdue_reissue_max_days = 31 where clinic_id is null");
  conf("limite acima de 30 dias é recusado", /finance_settings_reissue_days_check/.test(e ?? ""));
  await c.query("update public.finance_settings set overdue_reissue_max_days = 7 where clinic_id is null");

  // ---- 6) emitir e a única cobrança ativa -------------------------------------------------
  await como(recepcao);
  const cob = (await um("select public.charge_prepare($1, 'BOLETO', null) id", [emDia])).id;
  const linha = async (id) => {
    await comoServidor();
    const r = await um("select * from public.charges where id = $1", [id]);
    return r;
  };
  let r = await linha(cob);
  conf("a cobrança nasce 'emitindo' com o valor da prévia", r.status === "emitindo" && Number(r.value_cents) === 10500);
  conf("a cobrança guarda quem emitiu", r.created_by === recepcao);
  await como(recepcao);
  e = await recusa("select public.charge_prepare($1, 'PIX', null)", [emDia]);
  conf("segunda cobrança ativa na mesma parcela é recusada", /CHARGE_ALREADY_ACTIVE/.test(e ?? ""));
  e = await recusa("insert into public.charges (clinic_id, source_type, payment_installment_id, status) values ($1, 'installment', $2, 'emitida')", [unidade, emDia]);
  conf("a tela não grava cobrança direto (sem regra de escrita)", e !== null);

  // O servidor grava o pagador e a resposta do Asaas.
  await comoServidor();
  const g = await um("select * from public._charge_for_gateway($1)", [cob]);
  conf("o servidor recebe CPF e nome do pagador", g.payer_cpf === CPF_ADULTO && g.payer_name === "Ensaio Cobrança Adulto");
  const cust = (await um("select public._gateway_customer_save($1, $2, 'cus_ensaio1', 'client', $3, null) id", [conta, g.payer_cpf, adulto])).id;
  const cust2 = (await um("select public._gateway_customer_save($1, $2, 'cus_ensaio1', 'client', $3, null) id", [conta, g.payer_cpf, adulto])).id;
  conf("o pagador no Asaas é um só por CPF e conta", cust === cust2);
  await c.query("select public._charge_mark_issued($1, 'pay_ensaio1', $2, 'https://x/i', 'https://x/b', null, '123')", [cob, cust]);
  r = await linha(cob);
  conf("emitida com a referência do Asaas", r.status === "emitida" && r.asaas_payment_id === "pay_ensaio1" && r.issued_at);
  e = await recusa("select public._charge_mark_issued($1, 'pay_x', null, null, null, null, null)", [cob]);
  conf("gravar a emissão duas vezes é recusado", /CHARGE_NOT_EMITTING/.test(e ?? ""));
  await como(recepcao);
  e = await recusa("select public._charge_mark_issued($1, 'pay_x', null, null, null, null, null)", [cob]);
  conf("a tela não chama as funções do servidor", /permission denied/.test(e ?? ""));

  // ---- 7) as travas -------------------------------------------------------------------------
  await comoServidor();
  e = await recusa("update public.payment_installments set amount_cents = 9000 where id = $1", [emDia]);
  conf("trava: valor da parcela com cobrança ativa", /CHARGE_ACTIVE/.test(e ?? ""));
  e = await recusa("update public.payment_installments set due_date = due_date + 1 where id = $1", [emDia]);
  conf("trava: vencimento da parcela com cobrança ativa", /CHARGE_ACTIVE/.test(e ?? ""));
  e = await recusa("update public.payment_installments set payment_method = 'pix' where id = $1", [emDia]);
  conf("trava: meio da parcela com cobrança ativa", /CHARGE_ACTIVE/.test(e ?? ""));
  e = await recusa("update public.payment_installments set status = 'cancelada' where id = $1", [emDia]);
  conf("trava: cancelar a parcela com cobrança ativa", /CHARGE_ACTIVE/.test(e ?? ""));
  e = await recusa("delete from public.payment_installments where id = $1", [emDia]);
  conf("trava: apagar a parcela com cobrança ativa", /CHARGE_ACTIVE/.test(e ?? ""));
  e = await recusa("update public.payment_installments set amount_cents = 9000 where id = $1", [doMenor]);
  conf("parcela SEM cobrança continua editável", e === null);
  await como(recepcao);
  e = await recusa("select public.register_payment_receipt($1, 1000, current_date, 'dinheiro', null, null, null)", [emDia]);
  conf("trava: baixa manual com cobrança do Asaas ativa", /CHARGE_IN_GATEWAY/.test(e ?? ""));
  await comoServidor();
  e = await recusa("delete from public.charges where id = $1", [cob]);
  conf("cobrança nunca é apagada", /CHARGE_NO_DELETE/.test(e ?? ""));

  // ---- 8) cancelar para receber no balcão -------------------------------------------------
  await como(recepcao);
  e = await recusa("select * from public.charge_cancel_check($1, 'cancel')", [cob]);
  conf("Recepcionista não cancela cobrança", /NOT_ALLOWED/.test(e ?? ""));
  const chk = await um("select * from public.charge_cancel_check($1, 'counter')", [cob]);
  conf("Recepcionista pode cancelar para receber no balcão", chk.asaas_payment_id === "pay_ensaio1");
  await comoServidor();
  await c.query("select public._charge_mark_cancelled($1, $2, 'pagou no balcão')", [cob, recepcao]);
  r = await linha(cob);
  conf("cancelada com autor e motivo", r.status === "cancelada" && r.cancelled_by === recepcao);
  await como(recepcao);
  e = await recusa("select public.register_payment_receipt($1, 1000, current_date, 'dinheiro', null, null, null)", [emDia]);
  conf("cancelada a cobrança, a baixa manual volta a passar", e === null);
  await como(gerente);
  conf("Gerente cancela cobrança da unidade",
    (await recusa("select public.charge_prepare($1, 'PIX', null)", [doMenor])) === null);
  const cobMenor = (await um("select id from public.charges where payment_installment_id = $1 and status = 'emitindo'", [doMenor])).id;
  conf("Gerente: a conferência de cancelamento passa", (await recusa("select * from public.charge_cancel_check($1, 'cancel')", [cobMenor])) === null);

  // Tentar de novo: erro de emissão volta a "emitindo".
  await comoServidor();
  await c.query("select public._charge_mark_error($1, 'timeout')", [cobMenor]);
  conf("erro de emissão fica registrado", (await linha(cobMenor)).status === "erro_emissao");
  await como(gerente);
  e = await recusa("select public.charge_retry_prepare($1)", [cobMenor]);
  conf("tentar de novo volta para 'emitindo'", e === null && (await linha(cobMenor)).status === "emitindo");
  await como(gerente);
  e = await recusa("select public.charge_retry_prepare($1)", [cobMenor]);
  conf("'emitindo' recente não pode ser repetida", /CHARGE_NOT_RETRYABLE/.test(e ?? ""));

  // ---- 9) cobrança externa (D17) ---------------------------------------------------------
  await como(recepcao);
  e = await recusa("select public.charge_mark_external($1, 'boleto pelo app do Asaas')", [vencida]);
  conf("Recepcionista não marca cobrança externa", /NOT_ALLOWED/.test(e ?? ""));
  await como(gerente);
  const ext = (await um("select public.charge_mark_external($1, 'boleto pelo app do Asaas') id", [vencida])).id;
  conf("Gerente marca cobrança externa", !!ext);
  e = await recusa("select public.charge_prepare($1, 'PIX', current_date)", [vencida]);
  conf("com cobrança externa não se emite outra", /CHARGE_ALREADY_ACTIVE/.test(e ?? ""));
  await comoServidor();
  e = await recusa("update public.payment_installments set amount_cents = 1 where id = $1", [vencida]);
  conf("a externa também trava a parcela", /CHARGE_ACTIVE/.test(e ?? ""));
  await como(recepcao);
  e = await recusa("select public.register_payment_receipt($1, 1000, current_date, 'pix', null, null, null)", [vencida]);
  conf("com cobrança externa a baixa manual continua", e === null);
  await como(gerente);
  await c.query("select public.charge_unmark_external($1, 'engano')", [ext]);
  conf("desfazer a marcação externa", (await linha(ext)).status === "cancelada");

  // ---- 10) quitação por valor menor --------------------------------------------------------
  const devendo = await parcela(adulto, { venc: await dia(-20), beneficio: 1000, metodo: "pix" });
  const s = await saldo(devendo, hoje);
  const pago = Number(s.principal_rem) - 2000; // fica faltando 2.000 de principal + benefício + multa + juros
  await como(recepcao);
  e = await recusa(
    "select public.register_payment_with_waiver($1, $2, current_date, 'pix', null, null, 'acordo com o paciente', null, null)",
    [devendo, pago]
  );
  conf("Recepcionista não quita por valor menor", /NOT_ALLOWED/.test(e ?? ""));
  await como(financeiro);
  e = await recusa(
    "select public.register_payment_with_waiver($1, $2, current_date, 'pix', null, null, 'acordo com o paciente', null, null)",
    [devendo, pago]
  );
  conf("Financeiro da Franqueadora não quita por valor menor", /NOT_ALLOWED/.test(e ?? ""));
  await como(gerente);
  e = await recusa(
    "select public.register_payment_with_waiver($1, $2, current_date, 'pix', null, null, 'ok', null, null)",
    [devendo, pago]
  );
  conf("sem motivo é recusado", /REASON_REQUIRED/.test(e ?? ""));
  const rec = (await um(
    "select public.register_payment_with_waiver($1, $2, current_date, 'pix', null, null, 'acordo com o paciente', null, null) id",
    [devendo, pago]
  )).id;
  await comoServidor();
  const w = await um("select * from public.payment_waivers where installment_id = $1", [devendo]);
  conf("a dispensa fica registrada com autor e motivo", w && w.created_by === gerente && w.reason === "acordo com o paciente" && w.receipt_id === rec);
  conf("a dispensa: juros, multa e benefício inteiros",
    Number(w.interest_cents) === Number(s.interest_rem) && Number(w.late_fee_cents) === Number(s.fee_rem) && Number(w.benefit_cents) === Number(s.benefit_rem));
  conf("a dispensa: o principal que faltou", Number(w.principal_cents) === 2000);
  conf("o total dispensado bate", Number(w.total_cents) === Number(s.total_rem) - pago);
  const inst = await um("select status, paid_amount_cents from public.payment_installments where id = $1", [devendo]);
  conf("a parcela fica paga", inst.status === "paga");
  conf("'pago' segue sendo só o dinheiro que entrou", Number(inst.paid_amount_cents) === pago);
  const s2 = await saldo(devendo, await dia(30));
  conf("quitada com dispensa não volta a correr juros", Number(s2.total_rem) === 0);
  const lanc = await c.query("select account_code, amount_cents, direction from public.financial_entries where source_type = 'receipt_waiver' and source_id = $1", [w.id]);
  conf("só o principal dispensado vai ao razão (1.9.02)",
    lanc.rows.length === 1 && lanc.rows[0].account_code === "1.9.02" && Number(lanc.rows[0].amount_cents) === 2000 && lanc.rows[0].direction === "outflow");
  e = await recusa("update public.payment_waivers set reason = 'outro' where id = $1", [w.id]);
  conf("a dispensa não se altera", /WAIVER_IMMUTABLE/.test(e ?? ""));
  // Pagou tudo: nada é dispensado.
  const cheia = await parcela(adulto, { venc: await dia(5), metodo: "pix" });
  await como(gerente);
  await c.query("select public.register_payment_with_waiver($1, 10000, current_date, 'pix', null, null, 'pagou tudo', null, null)", [cheia]);
  await comoServidor();
  conf("pagou tudo: não há dispensa", (await um("select count(*)::int n from public.payment_waivers where installment_id = $1", [cheia])).n === 0);

  // ---- 10b) pagamento PARCIAL pela recepção e nova cobrança do saldo ---------------------------
  const parcialEmDia = await parcela(adulto, { venc: await dia(10), metodo: "pix" });
  await como(recepcao);
  e = await recusa("select public.register_payment_receipt($1, 3000, current_date, 'dinheiro', null, null, null)", [parcialEmDia]);
  conf("Recepcionista recebe valor menor (baixa parcial)", e === null);
  await comoServidor();
  conf("a parcela fica parcial (o saldo continua em aberto)",
    (await um("select status from public.payment_installments where id = $1", [parcialEmDia])).status === "parcial");
  conf("a parcial da recepção não gera dispensa",
    (await um("select count(*)::int n from public.payment_waivers where installment_id = $1", [parcialEmDia])).n === 0);
  await como(recepcao);
  p = await previa(parcialEmDia, "PIX");
  conf("o saldo da parcial ganha nova cobrança (em dia: o que falta)", p.error_code === null && Number(p.value_cents) === 7000);
  e = await recusa("select public.charge_prepare($1, 'PIX', null)", [parcialEmDia]);
  conf("a recepção emite a cobrança do saldo", e === null);

  const parcialVencida = await parcela(adulto, { venc: await dia(-15), metodo: "pix" });
  await como(recepcao);
  await c.query("select public.register_payment_receipt($1, 2000, current_date, 'dinheiro', null, null, null)", [parcialVencida]);
  const sPv = await saldo(parcialVencida, await dia(2));
  await como(recepcao);
  p = await previa(parcialVencida, "PIX", await dia(2));
  conf("o saldo da parcial VENCIDA ganha nova cobrança (atualizado até a nova data)",
    p.error_code === null && Number(p.value_cents) === Number(sPv.total_rem));

  // ---- 10c) a taxa da franqueadora sobre o que ENTROU, uma vez por baixa ------------------------
  await comoServidor();
  const taxas = async (inst) =>
    (await c.query(
      `select s.receipt_id, s.fee, s.base_cents, r.amount_cents
         from public.split_charges s join public.payment_receipts r on r.id = s.receipt_id
        where r.installment_id = $1 and s.source_type = 'receipt'`,
      [inst]
    )).rows;
  const tiposDeTaxa = (await um(
    "select count(*)::int n from public.network_fee_types where kind = 'percent' and active"
  )).n;
  const confereTaxa = (nome, linhas, recebidas) => {
    const porBaixa = new Map();
    for (const l of linhas) porBaixa.set(l.receipt_id + l.fee, (porBaixa.get(l.receipt_id + l.fee) ?? 0) + 1);
    conf(`${nome}: a taxa usa o valor recebido`, linhas.every((l) => Number(l.base_cents) === Number(l.amount_cents)));
    conf(`${nome}: uma taxa por tipo e por baixa (sem duplicar)`, [...porBaixa.values()].every((n) => n === 1));
    if (tiposDeTaxa > 0) conf(`${nome}: a taxa foi lançada`, new Set(linhas.map((l) => l.receipt_id)).size === recebidas);
  };
  confereTaxa("recebeu no balcão", await taxas(emDia), 1);
  confereTaxa("baixa parcial", await taxas(parcialEmDia), 1);
  const tq = await taxas(devendo);
  confereTaxa("quitação por valor menor", tq, 1);
  conf("quitação por valor menor: a taxa é sobre o pago, não sobre o devido",
    tq.every((l) => Number(l.base_cents) === pago));
  if (tiposDeTaxa === 0) console.log("    (aviso: o treino não tem taxa percentual ativa; só a regra da base foi conferida)");

  // ---- 11) quem lê ------------------------------------------------------------------------------
  await como(recepcao);
  conf("Recepcionista da unidade lê as cobranças das parcelas dela",
    (await um("select count(*)::int n from public.charges where clinic_id = $1", [unidade])).n >= 3);
  conf("Recepcionista lê a dispensa da unidade", (await um("select count(*)::int n from public.payment_waivers where installment_id = $1", [devendo])).n === 1);
  conf("Recepcionista NÃO lê os pagadores no Asaas", (await um("select count(*)::int n from public.gateway_customers")).n === 0);
  await como(financeiro);
  conf("Financeiro lê os pagadores no Asaas", (await um("select count(*)::int n from public.gateway_customers")).n >= 1);
  await como(admin);
  conf("as permissões da tela nascem só com o Admin",
    (await um("select count(*)::int n from public.permission_defaults where capability like 'acao.cobranca.%' and roles = '{}'")).n === 3);
  await comoServidor();
  conf("cobranças, pagadores e dispensas entram na auditoria",
    (await um(`select count(distinct c.relname)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid
               where t.tgname = 'audit_capture_trg' and c.relname in ('charges','gateway_customers','payment_waivers')`)).n === 3);
} catch (e) {
  falha.push(`EXCEÇÃO: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nENSAIO ASA1 (entrega 2) — ${ok.length} conferências passaram, ${falha.length} falharam.`);
for (const f of falha) console.log("  ✗", f);
if (falha.length === 0) console.log("  (transação desfeita: nada ficou gravado no treino)");
process.exit(falha.length === 0 ? 0 : 1);
