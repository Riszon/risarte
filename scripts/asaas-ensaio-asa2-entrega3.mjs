// ENSAIO DA 4007 (ASA2, entrega 3 — a régua) no banco de TREINO, numa
// transação DESFEITA (rollback): nada fica gravado.
// Uso: node scripts/asaas-ensaio-asa2-entrega3.mjs --confirmar
//
// Confere: o padrão da régua (D8) e nenhuma unidade ligada; celular e e-mail;
// quem lê, edita e declara; a trava do termo; os prazos que o Asaas aceita e a
// ordem dos lembretes; a versão da régua; a FILA (pagador novo, unidade
// ligada, régua alterada, contato da ficha, pedido de não receber na rede toda,
// conta desativada apagando o contato, erro com nova tentativa, mudança no meio
// da rodada); quem desliga e quem religa os avisos (D7); o retrato da unidade
// por papel; o histórico da aba; o comprovante gravado pelo aviso; as funções
// internas fechadas e as portas fechadas para anônimo. Só contagens na saída.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4007_asa2_regua_de_avisos_do_asaas.sql";

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/asaas-ensaio-asa2-entrega3.mjs --confirmar",
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
/** Roda como a pessoa; devolve as linhas, "recusado" (NOT_ALLOWED) ou o erro. */
async function comoPessoa(userId, sql, params = []) {
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
    return /NOT_ALLOWED/.test(e.message) ? "recusado" : `erro: ${e.message}`;
  }
}

function cpfValido(base9) {
  const d = base9.split("").map(Number);
  const dig = (arr) => {
    const s = arr.reduce((t, n, i) => t + n * (arr.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dig(d));
  d.push(dig(d));
  return d.join("");
}

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  const e2 = await recusa(sql);
  conf("a 4007 roda duas vezes sem erro", e2 === null);
  if (e2) console.log("   ", e2);

  // --- 1) o padrão --------------------------------------------------------------
  // O treino pode já ter mexido na régua: volta ao padrão para medir.
  await c.query(`update public.gateway_notification_rules set email = true, sms = true, whatsapp = (slot = 'vencida_1'), phone_call = false`);
  await c.query(`update public.gateway_notification_rules set schedule_offset = case slot when 'lembrete_1' then 10 when 'lembrete_2' then 0 when 'vencida_2' then 7 else schedule_offset end`);
  await c.query(`update public.gateway_notification_settings set privacy_declared_at = null, privacy_declared_by = null, privacy_note = null`);
  await c.query(`delete from public.gateway_notification_units`);
  await c.query(`delete from public.gateway_notification_optouts`);
  const regras = await todos("select * from public.gateway_notification_rules order by sort_order");
  conf("a régua tem os 8 avisos", regras.length === 8);
  conf("D8: WhatsApp só no aviso do dia do vencimento", regras.filter((r) => r.whatsapp).map((r) => r.slot).join() === "vencida_1");
  conf("D8: ligação desligada em tudo", regras.every((r) => !r.phone_call));
  conf("D8: e-mail e SMS em todos", regras.every((r) => r.email && r.sms));

  // --- 2) celular e e-mail ----------------------------------------------------------
  const cel = async (t) => (await um("select public._gateway_mobile($1) v", [t])).v;
  conf("celular com máscara vira só dígitos", (await cel("(43) 99999-8888")) === "43999998888");
  conf("celular com 55 na frente perde o 55", (await cel("+55 43 99999-8888")) === "43999998888");
  conf("telefone fixo não vai como celular", (await cel("(43) 3333-4444")) === null);
  conf("número curto não vai como celular", (await cel("99999-8888")) === null);
  const em = async (t) => (await um("select public._gateway_email($1) v", [t])).v;
  conf("e-mail válido vai em minúsculas", (await em(" Fulano@Exemplo.com ")) === "fulano@exemplo.com");
  conf("e-mail inválido não vai", (await em("fulano@")) === null);

  // --- 3) o cenário -------------------------------------------------------------------
  const pessoa = async (conta) => (await um("select id from public.profiles where email = $1", [`${conta}@example.com`]))?.id;
  const P = {};
  for (const k of ["admin", "gerente", "franqueado", "recepcao", "financeiro", "dentista", "asb"]) {
    P[k] = await pessoa(k);
    if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  }
  const [uA, uB] = (await todos("select id from public.clinics where type = 'franchise_unit' and is_active order by name limit 2")).map((r) => r.id);
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const contaA = (await um("select id from public.gateway_accounts where clinic_id = $1 and status = 'active'", [uA]))?.id;
  const contaB = (await um("select id from public.gateway_accounts where clinic_id = $1 and status = 'active'", [uB]))?.id;
  if (!uA || !uB || !contaA || !contaB) throw new Error("NÃO MEDI: faltam duas unidades com conta Asaas ativa.");
  const papeis = [["gerente", "unit_manager"], ["franqueado", "franchisee"], ["recepcao", "receptionist"], ["dentista", "dentist"], ["asb", "asb"]];
  for (const [k, role] of papeis) {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], uA, role]);
  }
  await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P.financeiro]);
  await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, 'finance_franchisor')", [P.financeiro, franq]);

  // --- 4) quem lê, edita e declara -----------------------------------------------------
  conf("o Gerente lê a régua", Array.isArray(await comoPessoa(P.gerente, "select * from public.gateway_regua_read()")));
  conf("o Franqueado lê a régua", Array.isArray(await comoPessoa(P.franqueado, "select * from public.gateway_regua_read()")));
  conf("a Recepcionista não lê a régua", (await comoPessoa(P.recepcao, "select * from public.gateway_regua_read()")) === "recusado");
  conf("o Dentista não lê a régua", (await comoPessoa(P.dentista, "select * from public.gateway_regua_read()")) === "recusado");

  const regua = (mud = {}) =>
    JSON.stringify(
      regras.map((r) => ({
        slot: r.slot,
        scheduleOffset: r.schedule_offset,
        email: r.email,
        sms: r.sms,
        whatsapp: r.whatsapp,
        phoneCall: r.phone_call,
        ...(mud[r.slot] ?? {}),
      }))
    );
  const versao = async () => (await um("select rules_version v from public.gateway_notification_settings")).v;
  const v0 = await versao();
  conf("o Gerente não grava a régua", (await comoPessoa(P.gerente, "select public.gateway_regua_save($1::jsonb)", [regua()])) === "recusado");
  const semMudar = await comoPessoa(P.financeiro, "select public.gateway_regua_save($1::jsonb)", [regua()]);
  conf("gravar sem mudar nada não muda a versão", Array.isArray(semMudar) && (await versao()) === v0);
  const prazoRuim = await comoPessoa(P.financeiro, "select public.gateway_regua_save($1::jsonb)", [regua({ vencida_2: { scheduleOffset: 3 } })]);
  conf("prazo que o Asaas não aceita é recusado", typeof prazoRuim === "string" && /offset_check/.test(prazoRuim));
  const ordem = await comoPessoa(P.financeiro, "select public.gateway_regua_save($1::jsonb)", [regua({ lembrete_2: { scheduleOffset: 10 } })]);
  conf("o segundo lembrete não pode vir antes do primeiro", typeof ordem === "string" && /REMINDERS_ORDER/.test(ordem));
  const curta = await comoPessoa(P.financeiro, "select public.gateway_regua_save('[]'::jsonb)");
  conf("régua sem os 8 avisos é recusada", typeof curta === "string" && /RULES_INVALID/.test(curta));

  // A trava do termo: ninguém liga antes da declaração.
  const antesDoTermo = await comoPessoa(P.financeiro, "select public.gateway_regua_unit_set($1, true)", [uA]);
  conf("sem a declaração do termo nenhuma unidade liga", typeof antesDoTermo === "string" && /PRIVACY_NOT_DECLARED/.test(antesDoTermo));
  conf("o Financeiro não declara o termo", (await comoPessoa(P.financeiro, "select public.gateway_regua_declare_privacy('Termo v3 de 12/11/2026')")) === "recusado");
  const notaCurta = await comoPessoa(P.admin, "select public.gateway_regua_declare_privacy('ok')");
  conf("a declaração pede onde está o termo", typeof notaCurta === "string" && /NOTE_REQUIRED/.test(notaCurta));
  conf("o Admin declara o termo", Array.isArray(await comoPessoa(P.admin, "select public.gateway_regua_declare_privacy('Termo v3 de 12/11/2026')")));
  const declarado = await um("select privacy_declared_at, privacy_declared_by from public.gateway_notification_settings");
  conf("a declaração guarda quem e quando", !!declarado.privacy_declared_at && declarado.privacy_declared_by === P.admin);
  await comoPessoa(P.admin, "select public.gateway_regua_declare_privacy('Outra versão qualquer')");
  conf("a declaração é uma vez (não é sobrescrita)", (await um("select privacy_note n from public.gateway_notification_settings")).n === "Termo v3 de 12/11/2026");
  conf("o Gerente não liga a unidade", (await comoPessoa(P.gerente, "select public.gateway_regua_unit_set($1, true)", [uA])) === "recusado");
  const naFranq = await comoPessoa(P.financeiro, "select public.gateway_regua_unit_set($1, true)", [franq]);
  conf("a franqueadora não é unidade da régua", typeof naFranq === "string" && /CLINIC_INVALID/.test(naFranq));

  // --- 5) a FILA ------------------------------------------------------------------------
  // Um CPF válido que ninguém usa no treino.
  let cpf1 = null;
  for (let i = 0; i < 50 && !cpf1; i++) {
    const cand = cpfValido(String(100000000 + Math.floor(Math.random() * 899999999)));
    const usado = await um(
      "select exists (select 1 from public.clients where public.cpf_digits(cpf) = $1) or exists (select 1 from public.gateway_customers where cpf_cnpj = $1) u",
      [cand]
    );
    if (!usado.u) cpf1 = cand;
  }
  if (!cpf1) throw new Error("NÃO MEDI: não achei CPF livre.");
  const cli = (await um(
    "insert into public.clients (clinic_id, full_name, birth_date, cpf, email, phone) values ($1, 'Ensaio Régua', '1980-01-01', $2, 'Ensaio@Exemplo.com', '(43) 99999-8888') returning id",
    [uA, cpf1]
  )).id;
  const k1 = (await um(
    "insert into public.gateway_customers (gateway_account_id, cpf_cnpj, asaas_customer_id, owner_kind, client_id) values ($1, $2, 'cus_ensaio_1', 'client', $3) returning id",
    [contaA, cpf1, cli]
  )).id;
  // O mesmo CPF pagador em outra unidade (para o "não receber" na rede toda).
  const k2 = (await um(
    "insert into public.gateway_customers (gateway_account_id, cpf_cnpj, asaas_customer_id, owner_kind, client_id) values ($1, $2, 'cus_ensaio_2', 'client', $3) returning id",
    [contaB, cpf1, cli]
  )).id;
  const est = async (id) => um("select * from public.gateway_customers where id = $1", [id]);
  conf("pagador novo nasce pendente", !!(await est(k1)).regua_pending_since);
  const fila = async () => todos("select * from public._gateway_regua_queue(50) where customer_id = any($1)", [[k1, k2]]);
  let f = await fila();
  conf("unidade desligada: a fila resolve no banco, sem chamar o Asaas", f.length === 0 && !(await est(k1)).regua_pending_since);

  conf("o Financeiro liga a unidade A", Array.isArray(await comoPessoa(P.financeiro, "select public.gateway_regua_unit_set($1, true)", [uA])));
  conf("ligar a unidade põe os pagadores dela na fila", !!(await est(k1)).regua_pending_since && !(await est(k2)).regua_pending_since);
  f = await fila();
  const item = f.find((x) => x.customer_id === k1);
  conf("a fila manda ligar, com e-mail e celular da ficha", item?.mode === "on" && item.email === "ensaio@exemplo.com" && item.mobile === "43999998888");
  conf("a fila leva a régua com os 8 avisos", Array.isArray(item?.rules) && item.rules.length === 8);
  conf("a fila não traz a unidade desligada", !f.some((x) => x.customer_id === k2));

  // Mudança no meio da rodada: o pendente não some.
  await c.query("update public.clients set email = 'novo@exemplo.com' where id = $1", [cli]);
  await um("select public._gateway_regua_done($1, 'on', $2, true, $3, null)", [k1, item.rules_version, item.started_at]);
  conf("mudou o contato durante a rodada: continua pendente", !!(await est(k1)).regua_pending_since);
  f = await fila();
  const item2 = f.find((x) => x.customer_id === k1);
  conf("a próxima rodada leva o e-mail novo", item2?.email === "novo@exemplo.com");
  await um("select public._gateway_regua_done($1, 'on', $2, true, $3, null)", [k1, item2.rules_version, item2.started_at]);
  let s1 = await est(k1);
  conf("aplicado: sai da fila, ligado, com a versão e o contato enviado", !s1.regua_pending_since && s1.regua_applied_on && s1.regua_contact_sent && s1.regua_applied_version === item2.rules_version);

  // Erro: nova tentativa mais tarde.
  await c.query("update public.clients set phone = '(43) 98888-7777' where id = $1", [cli]);
  f = await fila();
  const item3 = f.find((x) => x.customer_id === k1);
  await um("select public._gateway_regua_done($1, 'on', $2, false, $3, 'rate_limited')", [k1, item3.rules_version, item3.started_at]);
  s1 = await est(k1);
  conf("erro no Asaas: fica pendente, conta a tentativa e espera", !!s1.regua_pending_since && s1.regua_attempts === 1 && s1.regua_error === "rate_limited" && new Date(s1.regua_next_try_at) > new Date());
  conf("enquanto espera, a fila não o devolve", !(await fila()).some((x) => x.customer_id === k1));
  await c.query("update public.gateway_customers set regua_next_try_at = now() - interval '1 minute' where id = $1", [k1]);
  const item4 = (await fila()).find((x) => x.customer_id === k1);
  await um("select public._gateway_regua_done($1, 'on', $2, true, $3, null)", [k1, item4.rules_version, item4.started_at]);

  // Régua alterada: os ligados voltam à fila, com versão nova.
  const vAntes = await versao();
  const mudou = await comoPessoa(P.financeiro, "select public.gateway_regua_save($1::jsonb)", [regua({ vencida_2: { scheduleOffset: 15 } })]);
  conf("o Financeiro grava a régua", Array.isArray(mudou));
  conf("régua alterada: versão nova", (await versao()) === vAntes + 1);
  conf("régua alterada: os pagadores das unidades ligadas voltam à fila", !!(await est(k1)).regua_pending_since);
  const item5 = (await fila()).find((x) => x.customer_id === k1);
  conf("a régua nova vai na fila", item5?.rules.find((r) => r.slot === "vencida_2")?.scheduleOffset === 15);
  await um("select public._gateway_regua_done($1, 'on', $2, true, $3, null)", [k1, item5.rules_version, item5.started_at]);

  // --- 6) "não receber avisos" (D5, D7) ---------------------------------------------------
  const set = (quem, optOut, motivo = "o paciente pediu") =>
    comoPessoa(P[quem], "select public.gateway_optout_set($1, $2, $3)", [cli, optOut, motivo]);
  conf("o Dentista não desliga os avisos", (await set("dentista", true)) === "recusado");
  conf("a ASB não desliga os avisos", (await set("asb", true)) === "recusado");
  const semMotivo = await set("recepcao", true, "");
  conf("desligar pede motivo", typeof semMotivo === "string" && /REASON_REQUIRED/.test(semMotivo));
  conf("a Recepcionista desliga os avisos", Array.isArray(await set("recepcao", true)));
  conf("o pedido vale para o CPF nas duas unidades (os dois pagadores na fila)", !!(await est(k1)).regua_pending_since && !!(await est(k2)).regua_pending_since);
  f = await fila();
  conf("pedido de não receber: a fila manda desligar", f.find((x) => x.customer_id === k1)?.mode === "off");
  conf("na unidade desligada e nunca ligado: nada a fazer", !f.some((x) => x.customer_id === k2) && !(await est(k2)).regua_pending_since);
  const off = f.find((x) => x.customer_id === k1);
  await um("select public._gateway_regua_done($1, 'off', $2, false, $3, null)", [k1, off.rules_version, off.started_at]);
  conf("desligado: o pagador fica com os avisos desligados", (await est(k1)).regua_applied_on === false);
  const stRec = await comoPessoa(P.recepcao, "select * from public.gateway_optout_status($1)", [cli]);
  conf("a Recepcionista vê o pedido e não pode religar", Array.isArray(stRec) && stRec[0]?.opted_out && stRec[0]?.can_disable && !stRec[0]?.can_enable);
  conf("a Recepcionista não religa", (await set("recepcao", false)) === "recusado");
  conf("o Dentista não vê o pedido", Array.isArray(await comoPessoa(P.dentista, "select * from public.gateway_optout_status($1)", [cli])) && (await comoPessoa(P.dentista, "select * from public.gateway_optout_status($1)", [cli])).length === 0);
  conf("o Gerente religa", Array.isArray(await set("gerente", false, "pediu de volta")));
  const op = await um("select * from public.gateway_notification_optouts where cpf = $1", [cpf1]);
  conf("religar guarda quem, quando e o motivo", op.active === false && op.reactivated_by === P.gerente && op.reactivate_reason === "pediu de volta");
  conf("religado: volta a valer na fila", (await fila()).find((x) => x.customer_id === k1)?.mode === "on");
  conf("o Financeiro também desliga e religa", Array.isArray(await set("financeiro", true)) && Array.isArray(await set("financeiro", false, "pediu de volta")));
  const it6 = (await fila()).find((x) => x.customer_id === k1);
  await um("select public._gateway_regua_done($1, 'on', $2, true, $3, null)", [k1, it6.rules_version, it6.started_at]);

  // --- 7) o retrato da unidade --------------------------------------------------------------
  const pan = async (quem, u) => comoPessoa(P[quem], "select * from public.gateway_regua_unit_overview($1)", [u]);
  const pG = await pan("gerente", uA);
  conf("o Gerente vê o retrato da própria unidade", Array.isArray(pG) && pG[0]?.enabled === true && pG[0]?.can_edit === false);
  conf("o Gerente não vê outra unidade", (await pan("gerente", uB)) === "recusado");
  conf("o Franqueado vê a própria unidade", Array.isArray(await pan("franqueado", uA)));
  conf("a Recepcionista não vê o retrato", (await pan("recepcao", uA)) === "recusado");
  const pF = await pan("financeiro", uB);
  conf("o Financeiro vê qualquer unidade e pode editar", Array.isArray(pF) && pF[0]?.can_edit === true && pF[0]?.enabled === false);
  conf("o retrato conta os pagadores com a régua aplicada", Number(pG[0]?.payers_on) >= 1);

  // --- 8) desligar a unidade e desativar a conta -----------------------------------------------
  await comoPessoa(P.financeiro, "select public.gateway_regua_unit_set($1, false)", [uA]);
  const offU = (await fila()).find((x) => x.customer_id === k1);
  conf("unidade desligada: a fila manda desligar os avisos (o contato fica)", offU?.mode === "off");
  await um("select public._gateway_regua_done($1, 'off', $2, false, $3, null)", [k1, offU.rules_version, offU.started_at]);
  conf("depois de desligar, o contato continua marcado como enviado", (await est(k1)).regua_contact_sent === true);
  await c.query("update public.gateway_accounts set status = 'disabled' where id = $1", [contaA]);
  const clr = (await fila()).find((x) => x.customer_id === k1);
  conf("D6: conta desativada manda apagar o contato", clr?.mode === "clear");
  await um("select public._gateway_regua_done($1, 'clear', $2, false, $3, null)", [k1, clr.rules_version, clr.started_at]);
  const s9 = await est(k1);
  conf("contato apagado: registrado e não volta à fila", !!s9.regua_contact_cleared_at && !s9.regua_contact_sent && !s9.regua_pending_since);

  // --- 9) o histórico da aba ---------------------------------------------------------------------
  const hU = await comoPessoa(P.gerente, "select * from public.central_history('cobranca', $1)", [uA]);
  conf("o histórico da unidade mostra o liga/desliga", Array.isArray(hU) && hU.some((r) => r.table_name === "gateway_notification_units"));
  const hR = await comoPessoa(P.financeiro, "select * from public.central_history('cobranca', null)");
  conf("o histórico da rede mostra a régua e a declaração", Array.isArray(hR) && hR.some((r) => r.table_name === "gateway_notification_rules") && hR.some((r) => r.table_name === "gateway_notification_settings"));
  const hRec = await comoPessoa(P.recepcao, "select * from public.central_history('cobranca', $1)", [uA]);
  conf("a Recepcionista não vê o histórico da aba", Array.isArray(hRec) && hRec.length === 0);

  // --- 10) o comprovante ---------------------------------------------------------------------------
  await c.query("update public.gateway_accounts set status = 'active' where id = $1", [contaA]);
  const ch = await um("select id, asaas_payment_id, gateway_account_id from public.charges where asaas_payment_id is not null order by created_at desc limit 1");
  if (ch) {
    await c.query("update public.charges set receipt_url = null where id = $1", [ch.id]);
    const ev = (await um(
      `insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload, charge_id)
       values ($1, 'evt_ensaio_4007', 'PAYMENT_RECEIVED', $2::jsonb, $3) returning id`,
      [ch.gateway_account_id, JSON.stringify({ event: "PAYMENT_RECEIVED", payment: { id: ch.asaas_payment_id, transactionReceiptUrl: "https://sandbox.asaas.com/comprovantes/ensaio" } }), ch.id]
    )).id;
    await c.query("set local session_replication_role = replica");
    await c.query("set local session_replication_role = origin");
    await c.query("update public.gateway_webhook_events set processed_at = now() where id = $1", [ev]);
    conf("o aviso de pagamento grava o comprovante na cobrança", (await um("select receipt_url u from public.charges where id = $1", [ch.id])).u === "https://sandbox.asaas.com/comprovantes/ensaio");
  } else {
    falha.push("NÃO MEDI: não há cobrança emitida no treino para o comprovante");
  }

  // --- 11) as portas ---------------------------------------------------------------------------------
  const internas = [
    "_gateway_mobile(text)", "_gateway_email(text)", "_gateway_payer_of_client(uuid)", "_gateway_customer_contact(uuid)",
    "_gateway_regua_unit_on(uuid)", "_gateway_regua_enqueue(uuid[])", "_gateway_regua_enqueue_all()", "_gateway_regua_mode(uuid)",
    "_gateway_regua_rules_json()", "_gateway_regua_queue(integer)", "_gateway_regua_done(uuid, text, integer, boolean, timestamptz, text)",
    "_gateway_regua_for_customer(uuid)", "_gateway_regua_can_edit()", "_gateway_regua_can_see_unit(uuid)",
    "_gateway_optout_roles(uuid, boolean)", "_gateway_save_notification_fees(uuid, integer, integer, integer)",
    "_gateway_save_balance(uuid, bigint)", "_gateway_regua_balance_accounts()",
  ];
  let fechadas = 0;
  for (const fn of internas) {
    const r = await um(
      "select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n",
      [`public.${fn}`]
    );
    if (!r.a && !r.n) fechadas++;
    else console.log("    aberta:", fn);
  }
  conf(`as ${internas.length} funções internas respondem só à chave de serviço`, fechadas === internas.length);
  const portas = [
    "gateway_regua_read()", "gateway_regua_save(jsonb)", "gateway_regua_declare_privacy(text)", "gateway_regua_unit_set(uuid, boolean)",
    "gateway_regua_unit_overview(uuid)", "gateway_optout_status(uuid)", "gateway_optout_set(uuid, boolean, text)",
  ];
  let certas = 0;
  for (const fn of portas) {
    const r = await um(
      "select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n",
      [`public.${fn}`]
    );
    if (r.a && !r.n) certas++;
  }
  conf("as 7 portas da tela: abertas para quem entrou, fechadas para anônimo", certas === portas.length);
  await comoAnonimo();
  await c.query("savepoint a");
  let anon = [];
  try {
    anon = (await c.query("select * from public.gateway_notification_rules")).rows;
    await c.query("release savepoint a");
  } catch {
    await c.query("rollback to savepoint a");
  }
  await comoServidor();
  conf("anônimo não lê a régua direto (nenhuma linha)", anon.length === 0);
  await como(P.gerente);
  const direto = await todos("select * from public.gateway_notification_optouts");
  await comoServidor();
  conf("ninguém lê os pedidos de não receber direto na tabela (só pela porta)", direto.length === 0);
} catch (e) {
  falha.push(`o ensaio parou: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nEnsaio da 4007 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log("  FALHOU:", f);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
