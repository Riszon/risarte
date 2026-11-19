// ENSAIO DA 4023 (ASA5 — o Risarte Empresarial pelo Asaas) no banco de TREINO,
// numa transação DESFEITA (rollback). O Asaas não é chamado: os avisos são
// simulados direto na fila do webhook.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4023-empresarial.mjs --confirmar [--quebrar=split|trava|pagador|data]
//
// PROVADO QUEBRANDO: `split` = a baixa pelo aviso não liga o split na origem (a
// parte da RisLife viraria conta a pagar); `trava` = a linha com cobrança viva
// aceita a baixa à mão; `pagador` = o CAEPF vai como pagador (sem a matriz);
// `data` = a linha gerada antes da data de início sai sozinha no Asaas.
import { readFileSync } from "node:fs";
import { connect, testEnv } from "./test-db.mjs";

const ARQ = "supabase/migrations/4023_asa5_empresarial_pelo_asaas.sql";
const Q = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
// A TRAVA DO TREINO (a mesma da 4022): os dois endereços são do treino, e o banco
// confirma por dentro (os perfis de teste existem; nenhuma conta de produção).
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
async function comoServidor(sql, params = []) {
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
const cnpjValido = () => {
  const b = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]);
  const dv = (n) => { const w = n.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const r = n.reduce((a, d, i) => a + d * w[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  b.push(dv(b)); b.push(dv(b)); return b.join("");
};
const CNPJ = cnpjValido();
const erro = (r, k) => typeof r === "string" && r.includes(k);
const passou = (r) => Array.isArray(r);

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  const conferencia = [].concat(await c.query(sql)).at(-1).rows[0];
  conf("a 4023 roda e a conferência mostra 3 tabelas, desligado, o ramo do aviso, o legado fora e a implantação em 100",
    Number(conferencia.tabelas_novas) === 3 && conferencia.desligado === true && conferencia.ramo_do_aviso === true &&
    conferencia.legado_fora === true && Number(conferencia.implantacao_fora_de_100) === 0);
  await c.query("savepoint dup");
  try { await c.query(sql); await c.query("release savepoint dup"); conf("a 4023 roda duas vezes sem erro", true); }
  catch (e) { await c.query("rollback to savepoint dup"); conf(`a 4023 roda duas vezes sem erro (${e.message})`, false); }

  const trocar = async (sig, de, para) => {
    const f = (await um(`select pg_get_functiondef('${sig}'::regprocedure) d`)).d;
    if (!f.includes(de)) throw new Error(`QUEBRA: trecho não achado em ${sig}`);
    await c.query(f.replace(de, para));
  };
  if (Q === "split") await trocar("public._corporate_event(uuid, text, jsonb)",
    "      update empresarial.adhesion_billing set split_at_source = true where id = b.id;", "      null;");
  if (Q === "trava") await trocar("public._corporate_billing_lock()", "  if v_live then\n", "  if false then\n");
  if (Q === "pagador") await trocar("public._corporate_payer_of(uuid)", "  if d.id is null or d.doc_type in ('CNPJ', 'CPF') then", "  if true then");
  if (Q === "data") await trocar("public.corporate_charge_prepare(uuid, boolean)",
    "  if not p_manual and (b.created_at at time zone 'America/Sao_Paulo')::date < s.enabled_from then", "  if false then");
  if (Q) console.log(`   (QUEBRADO de propósito: ${Q})`);

  // --- as pessoas e a empresa -----------------------------------------------------------------
  const P = {};
  for (const k of ["admin", "gerente", "financeiro"]) P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'")).id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("gerente", ldn, "unit_manager");
  await papel("financeiro", franq, "finance_franchisor");
  const raiz = (await um("select id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' order by created_at limit 1")).id;
  const rislife = (await um("select id, wallet_id from public.gateway_accounts where label = 'RisLife Teste'"));
  const fundo = (await um("select id from public.gateway_accounts where label = 'Fundo de Propaganda Teste'")).id;
  // A empresa do ensaio: uma cópia limpa (com o CNPJ da matriz e o contato do responsável).
  const base = (await um("select id from empresarial.companies where status = 'ACTIVE' and responsible_email is not null and responsible_phone is not null order by created_at limit 1")).id;
  const emp = (await um(`insert into empresarial.companies
      select (jsonb_populate_record(null::empresarial.companies, to_jsonb(x) || jsonb_build_object(
        'id', gen_random_uuid(), 'cnpj', $2::text, 'legal_name', 'Empresa do Ensaio 4023 LTDA', 'trade_name', 'Ensaio 4023',
        'responsible_cpf', '529.982.247-25', 'origin_lead_id', null))).*
        from empresarial.companies x where x.id = $1
      returning id`, [base, CNPJ])).id;
  const docCnpj = (await um(`insert into empresarial.company_documents (company_id, doc_type, doc_number, doc_formatted, is_primary)
      values ($1, 'CNPJ', $2, $2, true) returning id`, [emp, CNPJ])).id;
  await c.query("delete from empresarial.split_rules where company_id = $1", [emp]);
  const linha = async (tipo, extra = {}) => (await um(`insert into empresarial.adhesion_billing
      (company_id, company_document_id, billing_type, reference_month, total_amount_cents, status, due_date, description, employee_id, payer_name, payer_document, created_at)
      values ($1, $2, $3, $4, $5, 'PENDING', public.today_br() + 5, $6, $7, $8, $9, coalesce($10::timestamptz, now())) returning id`,
    [emp, extra.doc === undefined ? docCnpj : extra.doc, tipo, tipo === "MONTHLY" ? (extra.mes ?? "2026-11-01") : null, extra.valor ?? 10000,
     extra.desc ?? (tipo === "MONTHLY" ? "Mensalidade 11/2026 — Ensaio" : "Implantação — Ensaio"),
     extra.employee ?? null, extra.payerName ?? null, extra.payerDoc ?? null, extra.criada ?? null])).id;

  // --- 1) quem faz e o desligado ----------------------------------------------------------------
  await c.query("update public.corporate_gateway_settings set enabled_from = null, rislife_account_id = null where id");
  const m0 = await linha("MONTHLY", { mes: "2026-09-01" });
  conf("o Gerente da unidade não prepara cobrança do Empresarial", erro(await pessoa(P.gerente, "select public.corporate_charge_prepare($1) j", [m0]), "NOT_ALLOWED"));
  const desl = await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [m0]);
  conf("desligado, a geração segue sem Asaas (motivo 'desligado', sem cobrança)", passou(desl) && desl[0].j.motivo === "desligado" &&
    Number((await um("select count(*) n from public.charges where source_id = $1", [m0])).n) === 0);
  conf("o Gerente não lê nem liga a aba Empresarial da Central",
    erro(await pessoa(P.gerente, "select public.corporate_settings_read()"), "NOT_ALLOWED") &&
    erro(await pessoa(P.gerente, "select public.corporate_settings_save(public.today_br(), $1)", [rislife.id]), "NOT_ALLOWED"));
  conf("ligar com uma carteira sem webhook (o Fundo) é recusado",
    erro(await pessoa(P.financeiro, "select public.corporate_settings_save(public.today_br(), $1)", [fundo]), "RISLIFE_ACCOUNT_NOT_READY"));
  conf("ligar sem a conta da RisLife é recusado",
    erro(await pessoa(P.financeiro, "select public.corporate_settings_save(public.today_br(), null)"), "RISLIFE_ACCOUNT_REQUIRED"));
  conf("o Financeiro da Franqueadora liga a rede com a data de hoje e a RisLife Teste",
    passou(await pessoa(P.financeiro, "select public.corporate_settings_save(public.today_br(), $1)", [rislife.id])));
  const lido = (await pessoa(P.financeiro, "select public.corporate_settings_read() j"))[0].j;
  conf("a Central lê: ligado, a RisLife pronta, a regra 100 / 50", lido.ligado === true && lido.rislife_pronta === true &&
    Number(lido.regra.implantacao_rislife) === 100 && Number(lido.regra.mensalidade_rislife) === 50);

  // --- 2) a emissão da mensalidade (conta raiz, split de 50% para a RisLife) -----------------
  const m1 = await linha("MONTHLY");
  const p1 = (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [m1]));
  const ch1 = passou(p1) ? p1[0].j.charge_id : null;
  const r1 = ch1 ? await um("select c.gateway_account_id, c.status, c.value_cents, c.payer_kind, c.source_type, cc.* from public.charges c join public.corporate_charges cc on cc.charge_id = c.id where c.id = $1", [ch1]) : {};
  conf("a mensalidade sai pela conta raiz, 'emitindo', com o pagador empresa (o CNPJ da matriz)",
    r1.gateway_account_id === raiz && r1.status === "emitindo" && r1.payer_kind === "company" && r1.source_type === "corporate_monthly" &&
    r1.payer_document === CNPJ && r1.payer_source === "documento");
  const sp1 = (await um("select public._corporate_split_plan($1) j", [ch1])).j;
  conf("o split da mensalidade: 50% (percentual, sobre o líquido) para a carteira da RisLife",
    sp1.length === 1 && sp1[0].walletId === rislife.wallet_id && Number(sp1[0].percentualValue) === 50);
  const dup = await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [m1]);
  conf("preparar de novo não duplica (motivo 'ja_tem_cobranca')", passou(dup) && dup[0].j.motivo === "ja_tem_cobranca");
  const vf = await pessoa(P.financeiro, "select id from public.charges where id = $1", [ch1]);
  const vg = await pessoa(P.gerente, "select id from public.charges where id = $1", [ch1]);
  conf(`o Financeiro vê a cobrança; o Gerente não (a leitura da tabela) [${JSON.stringify(vf)} / ${JSON.stringify(vg)}]`,
    Array.isArray(vf) && vf.length === 1 && Array.isArray(vg) && vg.length === 0);

  // --- 3) a implantação (conta da RisLife, sem split) ------------------------------------------
  const i1 = await linha("IMPLANTATION");
  const pi = (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [i1]))[0].j;
  const ri = await um("select c.gateway_account_id, cc.kind, cc.rislife_pct from public.charges c join public.corporate_charges cc on cc.charge_id = c.id where c.id = $1", [pi.charge_id]);
  conf("a implantação sai pela conta da RisLife, sem split", ri.gateway_account_id === rislife.id && ri.kind === "implantacao" && ri.rislife_pct === null &&
    (await um("select public._corporate_split_plan($1) j", [pi.charge_id])).j.length === 0);

  // --- 4) a data de início (decisão 7b) --------------------------------------------------------
  const antiga = await linha("MONTHLY", { mes: "2026-10-01", criada: new Date(Date.now() - 3 * 86400e3).toISOString() });
  await c.query("update public.corporate_gateway_settings set enabled_from = public.today_br() - 1 where id");
  const abertasAntes = Number((await pessoa(P.financeiro, "select public.corporate_settings_read() j"))[0].j.abertas_antes_da_data);
  const pa = (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [antiga]))[0].j;
  conf("a linha gerada antes da data de início não sai sozinha", pa.motivo === "gerada_antes_da_data");
  const pam = (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1, true) j", [antiga]))[0].j;
  conf("…e sai pelo botão 'Emitir no Asaas'", Boolean(pam.charge_id));
  conf("a Central conta as abertas de antes da data sem cobrança",
    Number((await pessoa(P.financeiro, "select public.corporate_settings_read() j"))[0].j.abertas_antes_da_data) === abertasAntes - 1);

  // --- 5) o pagador (decisões 4 e 12) ---------------------------------------------------------
  const docCaepf = (await um(`insert into empresarial.company_documents (company_id, doc_type, doc_number, doc_formatted, is_primary, holder_cpf)
      values ($1, 'CAEPF', '12345678901234', '123.456.789/012-34', false, '86288366757') returning id`, [emp])).id;
  const mc = await linha("MONTHLY", { doc: docCaepf, mes: "2026-12-01" });
  const pc = (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [mc]))[0].j;
  const rc = pc.charge_id ? await um("select cc.payer_document, cc.payer_source, c.description from public.corporate_charges cc join public.charges c on c.id = cc.charge_id where cc.charge_id = $1", [pc.charge_id]) : {};
  conf("CAEPF: a cobrança sai no CNPJ da matriz, com a descrição citando o CAEPF",
    rc.payer_document === CNPJ && rc.payer_source === "matriz" && String(rc.description).includes("referente ao CAEPF"));
  await c.query("update empresarial.company_documents set is_primary = false where id = $1", [docCnpj]);
  const mc2 = await linha("MONTHLY", { doc: docCaepf, mes: "2027-01-01" });
  const pc2 = (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [mc2]))[0].j;
  const rc2 = pc2.charge_id ? await um("select payer_document, payer_source from public.corporate_charges where charge_id = $1", [pc2.charge_id]) : {};
  conf("CAEPF sem matriz: sai no CPF do responsável", rc2.payer_document === "52998224725" && rc2.payer_source === "responsavel");
  await c.query("update empresarial.companies set responsible_cpf = null where id = $1", [emp]);
  const mc3 = await linha("MONTHLY", { doc: docCaepf, mes: "2027-02-01" });
  conf("CAEPF sem matriz e sem CPF do responsável: não sai (motivo 'sem_documento_aceito')",
    (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [mc3]))[0].j.motivo === "sem_documento_aceito");
  const pend = (await pessoa(P.financeiro, "select public.corporate_settings_read() j"))[0].j.pendencias;
  conf("…e a empresa aparece na lista de pendências antes de ligar", pend.some((x) => x.company_id === emp && x.problema === "sem_documento_aceito"));
  await c.query("update empresarial.companies set responsible_cpf = '529.982.247-25' where id = $1", [emp]);
  await c.query("update empresarial.company_documents set is_primary = true where id = $1", [docCnpj]);

  // Os dependentes pagos por outro (1049 + decisão 12a).
  const tit = (await um(`insert into empresarial.employees (company_id, cpf, full_name, phone, status, dependent_plan, dependents_payer, dependents_payer_name, dependents_payer_document, dependents_payer_email)
      values ($1, '86288366757', 'Titular do Ensaio', '43999990000', 'ACTIVE', 'FAMILY', 'OUTRO', 'Outro Pagador', '52998224725', 'outro@example.com') returning id`, [emp]).catch((e) => ({ id: null, e })));
  conf("o titular com outro pagador grava com o e-mail do outro pagador", Boolean(tit?.id));
  const semContato = await comoServidor("update empresarial.employees set dependents_payer_email = null, dependents_payer_phone = null where id = $1", [tit?.id]);
  conf("outro pagador sem e-mail e sem celular é recusado (decisão 12a)", erro(semContato, "employees_dependents_payer_contact_check"));
  const md = await linha("MONTHLY", { doc: null, employee: tit?.id, payerName: "Outro Pagador", payerDoc: "52998224725", mes: "2026-11-01" });
  const pd = (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [md]))[0].j;
  const rd = pd.charge_id ? await um("select payer_document, payer_source, payer_email from public.corporate_charges where charge_id = $1", [pd.charge_id]) : {};
  conf("a cobrança à parte dos dependentes sai no CPF de quem paga, com o contato dele",
    rd.payer_document === "52998224725" && rd.payer_source === "dependentes" && rd.payer_email === "outro@example.com");

  // --- 6) as travas -----------------------------------------------------------------------------
  conf("com cobrança viva: mudar o valor é recusado", erro(await comoServidor("update empresarial.adhesion_billing set total_amount_cents = 9000 where id = $1", [m1]), "CHARGE_IN_GATEWAY"));
  conf("…a baixa à mão é recusada", erro(await pessoa(P.financeiro, "select empresarial.settle_billing($1, now())", [m1]), "CHARGE_IN_GATEWAY"));
  conf("…cancelar é recusado", erro(await pessoa(P.financeiro, "select empresarial.cancel_billing($1, 'motivo do ensaio')", [m1]), "CHARGE_IN_GATEWAY"));
  conf("…excluir é recusado", erro(await pessoa(P.admin, "select empresarial.delete_billing($1)", [m1]), "CHARGE_IN_GATEWAY"));
  conf("…marcar em atraso passa (a rotina do Empresarial)", passou(await comoServidor("update empresarial.adhesion_billing set status = 'OVERDUE' where id = $1", [m1])));
  await c.query("update empresarial.adhesion_billing set status = 'PENDING' where id = $1", [m1]);
  const live = (await pessoa(P.financeiro, "select public.corporate_live_charge($1) j", [m1]))[0].j;
  conf("a cobrança viva é achada para cancelar no Asaas antes", live?.charge_id === ch1);

  // --- 7) a baixa pelo aviso (mensalidade) ------------------------------------------------------
  const emitir = (ch, pid) => c.query("select public._charge_mark_issued($1, $2, null, 'https://sandbox.asaas.com/i/x', null, null, null)", [ch, pid]);
  await emitir(ch1, "pay_ensaio_m1");
  const aviso = async (conta, ch, evento, pagamento) => {
    const ev = (await um(`insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload)
        values ($1, 'evt_' || gen_random_uuid(), $2, $3) returning id`, [conta, evento, JSON.stringify({ event: evento, payment: { externalReference: ch, ...pagamento } })])).id;
    return (await um("select public._gateway_apply_event($1) r", [ev])).r;
  };
  const rb = await aviso(raiz, ch1, "PAYMENT_RECEIVED", { id: "pay_ensaio_m1", value: 100, netValue: 98.01, paymentDate: "2026-11-18",
    split: [{ walletId: rislife.wallet_id, percentualValue: 50, totalValue: 49 }] });
  const b1 = await um("select status, split_at_source, split_rislife_cents, split_risarte_cents from empresarial.adhesion_billing where id = $1", [m1]);
  conf("o aviso de pago dá a baixa da mensalidade, com o split na origem", rb === "baixa" && b1.status === "PAID" && b1.split_at_source === true);
  conf("a parte da RisLife é a que o Asaas repassou (R$ 49,00 de 50% do líquido), não 50% do total",
    Number(b1.split_rislife_cents) === 4900 && Number(b1.split_risarte_cents) === 5100);
  const raz = await todos("select source_type, amount_cents, status, account_code from public.financial_entries where source_id = $1 or source_id = $2 order by source_type", [m1, ch1]);
  const tem = (t, v) => raz.some((x) => x.source_type === t && Number(x.amount_cents) === v);
  conf("o razão: receita de R$ 100,00, a comissão RisLife de R$ 49,00 quitada e a tarifa de R$ 1,99",
    tem("emp_billing", 10000) && raz.some((x) => x.source_type === "emp_rislife" && Number(x.amount_cents) === 4900 && x.status === "settled") && tem("gateway_fee_charge", 199));
  conf("…e não nasce conta a pagar à RisLife", Number((await um("select count(*) n from public.payables where empresarial_billing_id = $1", [m1])).n) === 0);
  conf("o aviso repetido não baixa duas vezes", (await aviso(raiz, ch1, "PAYMENT_RECEIVED", { id: "pay_ensaio_m1", value: 100, netValue: 98.01 })) === "ja_baixada");

  // Sem o split no aviso: 50% do líquido, para baixo.
  await emitir(pd.charge_id, "pay_ensaio_md");
  await aviso(raiz, pd.charge_id, "PAYMENT_RECEIVED", { id: "pay_ensaio_md", value: 100, netValue: 98.01, paymentDate: "2026-11-18" });
  conf("sem o split no aviso, a parte da RisLife é 50% do líquido arredondado para baixo (R$ 49,00)",
    Number((await um("select split_rislife_cents from empresarial.adhesion_billing where id = $1", [md])).split_rislife_cents) === 4900);

  // O estorno: só pelo Asaas.
  conf("paga pelo Asaas, desfazer a baixa à mão é recusado", erro(await pessoa(P.financeiro, "select empresarial.reverse_billing($1, 'motivo do ensaio')", [m1]), "CHARGE_PAID_IN_GATEWAY"));
  conf("…excluir a paga também", erro(await pessoa(P.admin, "select empresarial.delete_billing($1)", [m1]), "CHARGE_IN_GATEWAY"));
  const rf = (await pessoa(P.financeiro, "select public.corporate_refund_check($1) j", [m1]))[0].j;
  conf("o estorno confere a conta raiz e a parte da RisLife", rf.account_id === raiz && rf.rislife_account_id === rislife.id && Number(rf.rislife_cents) === 4900);
  await c.query("select public._corporate_mark_refunded($1)", [ch1]);
  conf("estornada no Asaas, o Empresarial desfaz a baixa pela porta dele", passou(await pessoa(P.financeiro, "select empresarial.reverse_billing($1, 'motivo do ensaio')", [m1])));

  // --- 8) a baixa da implantação (conta da RisLife) --------------------------------------------
  await emitir(pi.charge_id, "pay_ensaio_i1");
  const ri2 = await aviso(rislife.id, pi.charge_id, "PAYMENT_CONFIRMED", { id: "pay_ensaio_i1", value: 100, netValue: 98.01, paymentDate: "2026-11-18" });
  const bi = await um("select status, split_rislife_cents, split_at_source from empresarial.adhesion_billing where id = $1", [i1]);
  conf("a implantação paga na conta da RisLife dá a baixa, 100% RisLife", ri2 === "baixa" && bi.status === "PAID" && Number(bi.split_rislife_cents) === 10000);
  conf("…e fica fora do razão da franqueadora (nem receita, nem tarifa)",
    Number((await um("select count(*) n from public.financial_entries where source_id = $1 or source_id = $2", [i1, pi.charge_id])).n) === 0);
  conf("o aviso da conta errada não acha a cobrança", (await aviso(raiz, pi.charge_id, "PAYMENT_RECEIVED", { id: "pay_ensaio_i1", value: 100 })) === "ignorado_fora_do_riszon");

  // --- 9) pago a menor, vencida, apagada --------------------------------------------------------
  const mm = await linha("MONTHLY", { mes: "2027-03-01" });
  const pm = (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [mm]))[0].j;
  await emitir(pm.charge_id, "pay_ensaio_mm");
  conf("pago a menor não dá a baixa", (await aviso(raiz, pm.charge_id, "PAYMENT_RECEIVED", { id: "pay_ensaio_mm", value: 50, netValue: 49 })) === "paga_a_menor" &&
    (await um("select status from empresarial.adhesion_billing where id = $1", [mm])).status === "PENDING");
  const mv = await linha("MONTHLY", { mes: "2027-04-01" });
  const pv = (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1) j", [mv]))[0].j;
  await emitir(pv.charge_id, "pay_ensaio_mv");
  conf("o aviso de vencida só marca a cobrança (a linha do Empresarial não muda)",
    (await aviso(raiz, pv.charge_id, "PAYMENT_OVERDUE", { id: "pay_ensaio_mv" })) === "vencida" &&
    (await um("select status from empresarial.adhesion_billing where id = $1", [mv])).status === "PENDING");
  await c.query("update public.charges set due_date = public.today_br() - 5 where id = $1", [pv.charge_id]);
  const div = (await pessoa(P.financeiro, "select public.corporate_settings_read() j"))[0].j.divergencias_de_atraso;
  conf("a divergência de atraso aparece na Central (vencida no Asaas, em aberto no Empresarial)", div.some((x) => x.billing_id === mv));
  conf("o aviso de apagada cancela a cobrança e a linha continua em aberto",
    (await aviso(raiz, pv.charge_id, "PAYMENT_DELETED", { id: "pay_ensaio_mv" })) === "cancelada_no_asaas" &&
    (await um("select status from empresarial.adhesion_billing where id = $1", [mv])).status === "PENDING");
  const pv2 = (await pessoa(P.financeiro, "select public.corporate_charge_prepare($1, true) j", [mv]))[0].j;
  conf("…e pode ser emitida de novo pelo botão", Boolean(pv2.charge_id) && pv2.charge_id !== pv.charge_id);
  await c.query("select public._charge_mark_cancelled($1, $2, 'cancelada no ensaio')", [pv2.charge_id, P.financeiro]);
  conf("cancelada no Asaas primeiro, o Empresarial cancela a linha", passou(await pessoa(P.financeiro, "select empresarial.cancel_billing($1, 'motivo do ensaio')", [mv])));

  // --- 10) o relatório do mês, a regra da implantação e o legado -------------------------------
  const rep = (await um("select public._corporate_report_save($1, $2, $3) j", [m1, JSON.stringify({ empresa: "Ensaio 4023", titulares: 3 }), P.financeiro])).j;
  const lidoRep = (await um("select public._corporate_report_by_code($1) j", [rep.code])).j;
  conf("o relatório do mês é guardado e lido pelo código (64 caracteres)", rep.code.length === 64 && lidoRep?.data?.titulares === 3);
  conf("um código errado não lê nada", (await um("select public._corporate_report_by_code($1) j", ["x".repeat(64)])).j === null);
  conf("o relatório não é lido por quem está logado (só pelo servidor)", erro(await pessoa(P.financeiro, "select public._corporate_report_by_code($1)", [rep.code]), "permission denied"));
  conf("a implantação não aceita menos de 100% para a RisLife (decisão 9b)",
    erro(await comoServidor("insert into empresarial.split_rules (company_id, first_payment_risarte_pct, first_payment_rislife_pct, recurring_risarte_pct, recurring_rislife_pct) values ($1, 10, 90, 50, 50)", [emp]), "split_rules_implantacao_rislife_check"));
  conf("o legado saiu (a tabela e a coluna antigas)",
    (await um("select to_regclass('empresarial.asaas_webhook_events') is null t")).t === true &&
    Number((await um("select count(*) n from information_schema.columns where table_schema = 'empresarial' and table_name = 'adhesion_billing' and column_name = 'asaas_billing_id'")).n) === 0);
  const migs = (await um("select count(*) n, bool_and(applied) a from public.gateway_asaas_migrations()"));
  conf("a lista das migrações do Asaas tem 29, com a 4023", Number(migs.n) === 29 && migs.a === true);
  conf("as funções internas não são chamadas por quem está logado",
    erro(await pessoa(P.financeiro, "select public._corporate_event(gen_random_uuid(), 'PAYMENT_RECEIVED', '{}'::jsonb)"), "permission denied") &&
    erro(await pessoa(P.financeiro, "select public._corporate_payer(gen_random_uuid())"), "permission denied"));
} catch (e) {
  falha.push(`ERRO INESPERADO: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

for (const n of ok) console.log(`  ✓ ${n}`);
for (const n of falha) console.log(`  ✗ ${n}`);
console.log(`\n${ok.length}/${ok.length + falha.length} conferências ${falha.length ? "COM FALHA" : "ok"} (tudo desfeito).`);
process.exit(falha.length ? 1 : 0);
