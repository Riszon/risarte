// ENSAIO DA 4022 (ASA7 — as peças que preparam o piloto) no banco de TREINO,
// numa transação DESFEITA (rollback). O Asaas não é chamado.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4022-pecas-do-piloto.mjs --confirmar [--quebrar=interruptor|prontidao|fecha|copia]
//
// PROVADO QUEBRANDO: `interruptor` = liga sem a prontidão da rede; `prontidao` =
// a unidade fica pronta sem o débito e o levantamento; `fecha` = a conciliação
// fecha divergências que não conferiu; `copia` = a cópia leva também as taxas.
import { readFileSync } from "node:fs";
import { connect, testEnv } from "./test-db.mjs";

const ARQ = "supabase/migrations/4022_asa7_pecas_do_piloto.sql";
const Q = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
// A TRAVA DO TREINO. Este ensaio desliga gatilhos (session_replication_role)
// para fazer de uma conta de sandbox uma de produção. Isso só pode acontecer no
// TREINO: a lista é de quem PODE (o treino), não de quem não pode.
//  1) os dois endereços (o da API e o do banco) são do projeto de treino;
//  2) o banco confirma por dentro: os perfis de teste do treino existem, e
//     nenhuma conta Asaas de produção existe nele.
const TREINO_REF = "bsnptybalszjjbhxeejo";
{
  const env = testEnv();
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "TEST_DB_URL"]) {
    if (!String(env[k] ?? "").includes(TREINO_REF)) {
      console.log(`RECUSADO: ${k} não é o banco de treino. Este ensaio só roda no treino.`);
      process.exit(3);
    }
  }
}
const c = await connect();
{
  const t = (await c.query(`select
      (select count(*)::int from public.profiles where email in ('admin@example.com', 'gerente@example.com', 'financeiro@example.com', 'recepcao@example.com')) perfis,
      (select count(*)::int from public.gateway_accounts where environment = 'production') producao`)).rows[0];
  if (t.perfis !== 4 || t.producao !== 0) {
    console.log(`RECUSADO: o banco não se parece com o treino (perfis de teste ${t.perfis}/4, contas de produção ${t.producao}). Nada foi feito.`);
    await c.end();
    process.exit(3);
  }
}
const ok = [];
const falha = [];
const conf = (nome, v) => (v ? ok : falha).push(nome);
const um = async (s, p = []) => (await c.query(s, p)).rows[0];
const todos = async (s, p = []) => (await c.query(s, p)).rows;
async function servidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}
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
    await servidor();
  }
}
const erro = (r, k) => typeof r === "string" && r.includes(k);
const passou = (r) => Array.isArray(r);

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  const conferencia = [].concat(await c.query(sql)).at(-1).rows[0];
  conf("a 4022 roda e a conferência mostra 3 tabelas, produção desligada, nenhuma migração faltando e 11 itens",
    Number(conferencia.tabelas_novas) === 3 && conferencia.producao_ligada === false && Number(conferencia.migracoes_faltando) === 0 && Number(conferencia.itens_da_prontidao) === 11);
  await c.query("savepoint dup");
  try { await c.query(sql); await c.query("release savepoint dup"); conf("a 4022 roda duas vezes sem erro", true); }
  catch (e) { await c.query("rollback to savepoint dup"); conf(`a 4022 roda duas vezes sem erro (${e.message})`, false); }

  const trocar = async (sig, de, para) => {
    const f = (await um(`select pg_get_functiondef('${sig}'::regprocedure) d`)).d;
    if (!f.includes(de)) throw new Error(`QUEBRA: trecho não achado em ${sig}`);
    await c.query(f.replace(de, para));
  };
  if (Q === "interruptor") await trocar("public.gateway_production_switch(boolean, text)", "  if p_on then", "  if false then");
  if (Q === "prontidao") await trocar("public._central_readiness_raw(uuid)", "(v_acc.owner_type = 'franchisor' or v_acc.debit_disabled_declared_at is not null)", "true");
  if (Q === "fecha") await trocar("public._gateway_charge_recon_save(uuid, text, jsonb, jsonb, integer)",
    "     and ((i.asaas_payment_id is not null and i.asaas_payment_id = any (v_asaas))\n          or (i.charge_id is not null and i.charge_id = any (v_charges)));", ";");
  if (Q === "copia") await trocar("public.central_copy_apply(uuid, uuid, text[])", "    v_done := v_done || 'financeiro'::text;",
    "    v_done := v_done || 'financeiro'::text;\n    delete from public.network_fees where clinic_id = p_target;");
  if (Q) console.log(`   (QUEBRADO de propósito: ${Q})`);

  // --- as pessoas -------------------------------------------------------------------------
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "recepcao", "consultor"]) P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'")).id;
  const cmb = (await um("select id from public.clinics where name = 'Risarte Cambé - Centro'")).id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("gerente", ldn, "unit_manager");
  await papel("financeiro", franq, "finance_franchisor");
  await papel("recepcao", ldn, "receptionist");
  const contaLdn = (await um("select id from public.gateway_accounts where clinic_id = $1 and status = 'active'", [ldn])).id;
  const contaCmb = (await um("select id from public.gateway_accounts where clinic_id = $1 and status = 'active'", [cmb])).id;

  // --- 1) a prontidão da rede e o interruptor ---------------------------------------------------
  await c.query("update public.gateway_settings set production_enabled = false, asaas_confirmation_path = null where id");
  await c.query("update public.gateway_split_settings set min_balance_cents = null where id");
  await c.query("update public.gateway_notification_settings set privacy_declared_at = null where id");
  await c.query("delete from public.permission_matrix where capability in ('acao.cobranca.ver', 'acao.cobranca.emitir', 'acao.cobranca.cancelar')");
  conf("o Gerente não lê o interruptor", erro(await pessoa(P.gerente, "select public.gateway_production_read()"), "NOT_ALLOWED"));
  const lidoR = await pessoa(P.financeiro, "select public.gateway_production_read() j");
  if (!Array.isArray(lidoR)) throw new Error(`Financeiro lendo o interruptor: ${lidoR}`);
  const lido = lidoR[0].j;
  conf("o Financeiro lê, mas não pode mudar", lido.pode_mudar === false && lido.ligada === false);
  conf("a prontidão da rede tem os 5 itens, e só as migrações estão ok", lido.prontidao.length === 5 &&
    lido.prontidao.filter((x) => x.ok).map((x) => x.item).join() === "migracoes");
  conf("as migrações do Asaas: 28 conferidas pela marca, todas neste banco", lido.migracoes.length === 28 && lido.migracoes.every((m) => m.na_producao));
  conf("o Financeiro não liga", erro(await pessoa(P.financeiro, "select public.gateway_production_switch(true, 'motivo do ensaio')"), "NOT_ALLOWED"));
  conf("ligar sem motivo é recusado", erro(await pessoa(P.admin, "select public.gateway_production_switch(true, 'x')"), "REASON_REQUIRED"));
  const semRede = await pessoa(P.admin, "select public.gateway_production_switch(true, 'motivo do ensaio')");
  conf("ligar sem a prontidão da rede é recusado, dizendo o que falta", erro(semRede, "NETWORK_NOT_READY") && erro(semRede, "confirmacao_asaas"));
  conf("…e a produção continua desligada", (await um("select production_enabled from public.gateway_settings where id")).production_enabled === false);
  // completa a rede
  conf("o documento do Asaas sem arquivo na pasta é recusado", erro(await pessoa(P.admin, "select public.gateway_asaas_confirmation_save('nao-existe.pdf', 'x.pdf')"), "PROOF_REQUIRED"));
  await c.query("insert into storage.objects (bucket_id, name, metadata) values ('asaas-rede', 'ensaio/confirmacao.pdf', '{\"size\": 10, \"mimetype\": \"application/pdf\"}')");
  conf("o Admin Master anexa a confirmação do Asaas", passou(await pessoa(P.admin, "select public.gateway_asaas_confirmation_save('ensaio/confirmacao.pdf', 'confirmacao.pdf')")));
  await c.query("update public.gateway_split_settings set min_balance_cents = 50000 where id");
  await c.query("update public.gateway_notification_settings set privacy_declared_at = now() where id");
  // As cinco marcas (decisão de 18/11): ver, emitir e cancelar para o Gerente;
  // ver e emitir para a Recepção. Cancelar para a Recepção não entra na conta.
  const marca = (cap, role) => c.query("insert into public.permission_matrix (capability, role, allowed) values ($1, $2, true) on conflict do nothing", [cap, role]);
  for (const cap of ["acao.cobranca.ver", "acao.cobranca.emitir", "acao.cobranca.cancelar"]) await marca(cap, "unit_manager");
  await marca("acao.cobranca.ver", "receptionist");
  const quase = (await pessoa(P.admin, "select public.gateway_production_read() j"))[0].j;
  const perm = quase.prontidao.find((x) => x.item === "permissoes_cobranca");
  conf("falta só emitir para a Recepção: a prontidão diz exatamente isso", !perm.ok && JSON.stringify(perm.detalhe.faltam) === JSON.stringify(["acao.cobranca.emitir · Recepção"]));
  await marca("acao.cobranca.emitir", "receptionist");
  const cinco = (await pessoa(P.admin, "select public.gateway_production_read() j"))[0].j.prontidao.find((x) => x.item === "permissoes_cobranca");
  conf("com as cinco marcas (sem cancelar para a Recepção), o item fica ok", cinco.ok === true &&
    !(await um("select 1 x from public.permission_matrix where capability = 'acao.cobranca.cancelar' and role = 'receptionist' and allowed")));
  await c.query("delete from public.permission_matrix where capability = 'acao.cobranca.cancelar' and role = 'unit_manager'");
  const semGerente = (await pessoa(P.admin, "select public.gateway_production_read() j"))[0].j.prontidao.find((x) => x.item === "permissoes_cobranca");
  conf("sem cancelar para o Gerente, o item falta", !semGerente.ok && JSON.stringify(semGerente.detalhe.faltam) === JSON.stringify(["acao.cobranca.cancelar · Gerente"]));
  await marca("acao.cobranca.cancelar", "unit_manager");
  // uma migração faltando derruba a rede
  await c.query("savepoint mig");
  await c.query("alter function public._split_charges_after_born() rename to _split_charges_after_born_x");
  const semMig = await pessoa(P.admin, "select public.gateway_production_switch(true, 'motivo do ensaio')");
  conf("com uma migração do Asaas faltando (a 4018c), ligar é recusado", erro(semMig, "NETWORK_NOT_READY") && erro(semMig, "migracoes"));
  await c.query("rollback to savepoint mig");
  conf("com a rede pronta, o Admin Master liga, com motivo", passou(await pessoa(P.admin, "select public.gateway_production_switch(true, 'Piloto de Londrina aprovado pelo dono')")) &&
    (await um("select production_enabled, production_reason from public.gateway_settings where id")).production_enabled === true);
  conf("ligar fica na auditoria", Number((await um("select count(*)::int n from public.audit_logs where entity_type = 'production_switch'")).n) >= 1);
  conf("ligar não liga nenhuma unidade (as contas continuam no sandbox)", Number((await um("select count(*)::int n from public.gateway_accounts where environment = 'production'")).n) === 0);

  // --- 2) a prontidão da unidade ------------------------------------------------------------------
  await c.query("update public.gateway_accounts set debit_disabled_declared_at = null, key_min_perm_declared_at = null, key_perm_probe_ok = null where id = any($1)", [[contaLdn, contaCmb]]);
  await c.query("delete from public.gateway_account_surveys where account_id = any($1)", [[contaLdn, contaCmb]]);
  const item = async (clinic, it) => (await um("select ok from public._central_readiness_raw($1) where item = $2", [clinic, it]))?.ok;
  conf("sem a marca do débito, o item falta", (await item(ldn, "debito_desabilitado")) === false);
  conf("sem o levantamento, o item falta", (await item(ldn, "levantamento_feito")) === false);
  conf("…e a unidade não está pronta para cobrar", (await um("select public.central_is_ready($1) r", [ldn])).r === false);
  conf("a conta do sandbox não precisa da chave restrita", (await item(ldn, "chave_permissoes_minimas")) === true);
  conf("o Gerente não marca o débito", erro(await pessoa(P.gerente, "select public.gateway_declare_debit_disabled($1)", [contaLdn]), "NOT_ALLOWED"));
  conf("o Admin Master marca o débito", passou(await pessoa(P.admin, "select public.gateway_declare_debit_disabled($1)", [contaLdn])) && (await item(ldn, "debito_desabilitado")) === true);
  await c.query("select public._gateway_survey_save($1, $2, '{\"ok\": false, \"error\": \"falhou\"}'::jsonb)", [contaLdn, P.admin]);
  conf("um levantamento que falhou não conta", (await item(ldn, "levantamento_feito")) === false);
  await c.query("select public._gateway_survey_save($1, $2, '{\"ok\": true, \"open_payments\": 3, \"open_payments_cents\": 45000, \"installments\": 1, \"subscriptions\": 2, \"sample\": []}'::jsonb)", [contaLdn, P.admin]);
  conf("o levantamento feito conta", (await item(ldn, "levantamento_feito")) === true);
  const lev = (await pessoa(P.financeiro, "select public.gateway_surveys_read($1) j", [contaLdn]))[0].j;
  conf("o Financeiro lê o levantamento (3 cobranças, 1 parcelamento, 2 assinaturas)", lev[0].ok === true && lev[0].cobrancas === 3 && lev[0].parcelamentos === 1 && lev[0].assinaturas === 2);
  conf("o Gerente não lê o levantamento", erro(await pessoa(P.gerente, "select public.gateway_surveys_read($1)", [contaLdn]), "NOT_ALLOWED"));
  // a conta de produção (com o interruptor ligado nesta transação)
  // O ambiente é imutável (gatilho); só no ensaio, e desfeito no fim, a conta vira de produção.
  await c.query("set local session_replication_role = replica");
  await c.query("update public.gateway_accounts set environment = 'production' where id = $1", [contaCmb]);
  await c.query("set local session_replication_role = origin");
  conf("na produção, sem a marca e a sonda, a chave falta", (await item(cmb, "chave_permissoes_minimas")) === false);
  await pessoa(P.admin, "select public.gateway_declare_key_permissions($1)", [contaCmb]);
  conf("só a marca não basta (falta a sonda)", (await item(cmb, "chave_permissoes_minimas")) === false);
  await c.query("select public._gateway_key_probe_save($1, false, '{\"/transfers\": \"respondeu\"}'::jsonb)", [contaCmb]);
  conf("a sonda que acha permissão demais derruba o item e avisa o Admin Master", (await item(cmb, "chave_permissoes_minimas")) === false &&
    Number((await um("select count(*)::int n from public.notifications where title = 'Chave do Asaas com permissão demais' and user_id = $1", [P.admin])).n) >= 1);
  await c.query("select public._gateway_key_probe_save($1, true, '{\"/transfers\": \"recusada\", \"/pix/transactions\": \"recusada\", \"/bill\": \"recusada\"}'::jsonb)", [contaCmb]);
  conf("com a marca e as três leituras recusadas, o item fica ok", (await item(cmb, "chave_permissoes_minimas")) === true);

  // --- 3) a conciliação das cobranças -------------------------------------------------------------------
  await c.query("delete from public.gateway_charge_issues");
  await c.query("delete from public.gateway_notices where kind = 'conciliacao_cobrancas'");
  const ch = (await um("select id, asaas_payment_id from public.charges where gateway_account_id = $1 and asaas_payment_id is not null order by created_at desc limit 1", [contaLdn]));
  const achadas = [
    { kind: "paga_no_asaas", charge_id: ch.id, asaas_payment_id: ch.asaas_payment_id, amount_cents: 10000, detail: { asaas: "RECEIVED", riszon: "emitida" } },
    { kind: "fora_do_riszon", charge_id: null, asaas_payment_id: "pay_fora_ensaio", amount_cents: 7000, detail: {} },
  ];
  const salvar = (found, checked) => um("select public._gateway_charge_recon_save($1, 'diaria', $2::jsonb, $3::jsonb, 4) j", [contaLdn, JSON.stringify(found), JSON.stringify(checked)]);
  const r1 = (await salvar(achadas, { asaas: [ch.asaas_payment_id, "pay_fora_ensaio"], charges: [ch.id] })).j;
  conf("a conciliação grava as divergências achadas (2 novas)", r1.novas === 2 && r1.abertas === 2);
  conf("o resumo do dia vai ao Financeiro", Number((await um("select count(*)::int n from public.notifications where user_id = $1 and title = 'Divergências com o Asaas'", [P.financeiro])).n) >= 1);
  const r2 = (await salvar(achadas, { asaas: [ch.asaas_payment_id, "pay_fora_ensaio"], charges: [ch.id] })).j;
  conf("a mesma divergência não se repete", r2.novas === 0 && r2.abertas === 2);
  const lidoG = (await pessoa(P.gerente, "select public.gateway_charge_issues_read(null) j"))[0].j;
  conf("o Gerente vê as divergências da sua unidade, sem ignorar", lidoG.pode_ignorar === false && lidoG.divergencias.length === 2 && lidoG.rodadas.length === 0);
  conf("o Gerente não lê as de Cambé", erro(await pessoa(P.gerente, "select public.gateway_charge_issues_read($1)", [cmb]), "NOT_ALLOWED"));
  const idFora = (await um("select id from public.gateway_charge_issues where kind = 'fora_do_riszon'")).id;
  conf("o Gerente não ignora", erro(await pessoa(P.gerente, "select public.gateway_charge_issue_ignore($1, 'motivo qualquer')", [idFora]), "NOT_ALLOWED"));
  conf("ignorar exige motivo", erro(await pessoa(P.financeiro, "select public.gateway_charge_issue_ignore($1, 'x')", [idFora]), "REASON_REQUIRED"));
  conf("o Financeiro ignora, com motivo", passou(await pessoa(P.financeiro, "select public.gateway_charge_issue_ignore($1, 'Cobrança de teste do painel')", [idFora])));
  await salvar([achadas[0], { ...achadas[1], amount_cents: 9000 }], { asaas: [ch.asaas_payment_id, "pay_fora_ensaio"], charges: [ch.id] });
  conf("o valor mudou: a ignorada reabre", (await um("select status from public.gateway_charge_issues where id = $1", [idFora])).status === "aberta");
  // conferida e sem divergência: fecha; não conferida: fica
  const r3 = (await salvar([], { asaas: [ch.asaas_payment_id], charges: [ch.id] })).j;
  conf("o que foi conferido e não voltou divergente fecha sozinho", (await um("select status from public.gateway_charge_issues where kind = 'paga_no_asaas'")).status === "resolvida" && r3.fechadas >= 1);
  conf("o que não foi conferido nesta rodada continua aberto", (await um("select status from public.gateway_charge_issues where id = $1", [idFora])).status === "aberta");
  conf("as rodadas ficam registradas, com as chamadas", Number((await um("select count(*)::int n from public.gateway_charge_recon_runs where account_id = $1 and calls = 4", [contaLdn])).n) >= 4);

  // --- 4) copiar de outra unidade ----------------------------------------------------------------------------
  await c.query("delete from public.commercial_rules where clinic_id = any($1)", [[ldn, cmb]]);
  await c.query("delete from public.finance_settings where clinic_id = any($1)", [[ldn, cmb]]);
  await c.query("insert into public.commercial_rules (clinic_id, max_discount_percent, max_installments) values ($1, 7, 9)", [ldn]);
  await c.query("insert into public.finance_settings (clinic_id, late_fee_percent, monthly_interest_percent, grace_days) values ($1, 2, 1, 0)", [ldn]);
  await c.query("insert into public.finance_settings (clinic_id, late_fee_percent, monthly_interest_percent, grace_days) values ($1, 1.5, 0.5, 0)", [cmb]);
  const taxasAntes = (await um("select count(*)::int n, coalesce(sum(coalesce(percent,0)),0)::text s from public.network_fees where clinic_id = $1", [cmb]));
  const contaAntes = (await um("select md5(row(a.*)::text) h from public.gateway_accounts a where id = $1", [contaCmb])).h;
  conf("o Gerente não copia", erro(await pessoa(P.gerente, "select public.central_copy_apply($1, $2, array['comercial'])", [cmb, ldn]), "NOT_ALLOWED"));
  const pv = (await pessoa(P.admin, "select public.central_copy_preview($1, $2) j", [cmb, ldn]))[0].j;
  conf("a prévia mostra o de cada lado (Londrina 7%/9x; Cambé no padrão)", pv.comercial.regras_origem.max_discount_percent == 7 && pv.comercial.regras_destino === null && pv.financeiro.destino.late_fee_percent == 1.5);
  conf("copiar só blocos conhecidos", erro(await pessoa(P.admin, "select public.central_copy_apply($1, $2, array['taxas'])", [cmb, ldn]), "INVALID_BLOCKS"));
  const copiou = await pessoa(P.admin, "select public.central_copy_apply($1, $2, array['comercial','financeiro'])", [cmb, ldn]);
  if (!passou(copiou)) console.log("   cópia:", copiou);
  conf("o Admin Master copia Comercial e Financeiro de Londrina para Cambé", passou(copiou));
  const depois = await um("select (select max_discount_percent::text from public.commercial_rules where clinic_id = $1) d, (select late_fee_percent::text || '/' || monthly_interest_percent::text || '/' || grace_days from public.finance_settings where clinic_id = $1) f", [cmb]);
  conf("Cambé ficou igual a Londrina nos dois blocos", Number(depois.d) === 7 && depois.f.replace(/\.0+/g, "").startsWith("2") && depois.f.split("/")[1].replace(/.0+$/, "") === "1");
  const taxasDepois = (await um("select count(*)::int n, coalesce(sum(coalesce(percent,0)),0)::text s from public.network_fees where clinic_id = $1", [cmb]));
  conf("a cópia não mexe nas taxas da franquia", taxasDepois.n === taxasAntes.n && taxasDepois.s === taxasAntes.s);
  conf("a cópia não mexe na conta Asaas", (await um("select md5(row(a.*)::text) h from public.gateway_accounts a where id = $1", [contaCmb])).h === contaAntes);
  conf("a cópia fica na auditoria, com a origem", Number((await um("select count(*)::int n from public.audit_logs where entity_type = 'central_copy' and details->>'copiado_de' = 'Risarte Londrina - Centro'")).n) === 1);
  await c.query("delete from public.commercial_rules where clinic_id = $1", [ldn]);
  await pessoa(P.admin, "select public.central_copy_apply($1, $2, array['comercial'])", [cmb, ldn]);
  conf("origem no padrão da rede: o destino volta ao padrão", !(await um("select 1 x from public.commercial_rules where clinic_id = $1", [cmb])));

  // --- 4b) a Recepção: não cancela à mão; "Recebeu no balcão" continua (4004) ----------------
  const ativa = await um(`select c.id, c.payment_installment_id from public.charges c where c.clinic_id = $1 and c.status in ('emitida', 'vencida')
                            and not c.is_external and c.installment_block is null and c.payment_installment_id is not null limit 1`, [ldn]);
  if (!ativa) throw new Error("O treino não tem cobrança emitida de Londrina para a prova do balcão.");
  conf("a Recepção não passa no cancelar à mão (o banco recusa)", erro(await pessoa(P.recepcao, "select * from public.charge_cancel_check($1, 'cancel')", [ativa.id]), "NOT_ALLOWED"));
  conf("a Recepção passa no \"Recebeu no balcão\" (cancela o boleto e libera a baixa em dinheiro)", passou(await pessoa(P.recepcao, "select * from public.charge_cancel_check($1, 'counter')", [ativa.id])));
  conf("o Gerente passa no cancelar à mão", passou(await pessoa(P.gerente, "select * from public.charge_cancel_check($1, 'cancel')", [ativa.id])));
  conf("com o boleto ativo, a baixa manual é barrada pela trava da 4004", erro(await pessoa(P.recepcao,
    "insert into public.payment_receipts (clinic_id, installment_id, amount_cents, payment_method) values ($1, $2, 100, 'dinheiro')", [ldn, ativa.payment_installment_id]), "CHARGE_IN_GATEWAY"));

  // --- 5) quem não está logado ------------------------------------------------------------------------------
  await c.query("set local role anon");
  let anonBarrado = true;
  for (const f of ["select public.gateway_production_read()", "select public.gateway_charge_issues_read(null)", `select public.gateway_production_switch(true, 'motivo anon')`]) {
    await c.query("savepoint a");
    try { await c.query(f); anonBarrado = false; } catch { /* barrado */ }
    await c.query("rollback to savepoint a");
  }
  await c.query("reset role");
  conf("quem não está logado não chama as portas novas", anonBarrado);

  console.log(`Ensaio da 4022 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
  for (const f of falha) console.log(`  FALHOU: ${f}`);
} catch (e) {
  falha.push(`o ensaio parou: ${e.message}`);
  console.log(`Ensaio da 4022 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
  for (const f of falha) console.log(`  FALHOU: ${f}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
  console.log("Nada ficou gravado (transação desfeita).");
}
process.exitCode = falha.length ? 1 : 0;
