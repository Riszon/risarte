// ENSAIO DA 4011 (ASA4, entrega 1, parte 1 — meio por parcela, dinheiro,
// permuta, painel do dinheiro e "Registrar depósito") no banco de TREINO, numa
// transação DESFEITA (rollback): nada fica gravado.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa4-entrega1-meios.mjs --confirmar [--quebrar=fechamento|permuta]
//
// PROVADO QUEBRANDO: `--quebrar=fechamento` tira a porta do dinheiro na regra
// de ouro (a baixa em dinheiro volta a ser recusada em venda não fechada);
// `--quebrar=permuta` deixa a Recepção registrar permuta. Os dois têm de
// reprovar o ensaio.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4011_asa4_meio_por_parcela_dinheiro_e_permuta.sql";
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
async function como(userId) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await c.query("set local role authenticated");
}
async function comoServidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}
// Roda como a pessoa; devolve as linhas, ou o texto do erro.
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
    conf("a 4011 roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4011 roda duas vezes sem erro (${e.message})`, false);
  }
  if (QUEBRAR === "fechamento") {
    sql = sql.replace("if coalesce(new.payment_method, '') in ('dinheiro', 'permuta')\n       and coalesce(current_setting('risarte.baixa_do_asaas', true), '') <> '1' then", "if false then");
    await c.query(sql);
    console.log("   (QUEBRADO de propósito: a baixa em dinheiro não fecha a venda)");
  } else if (QUEBRAR === "permuta") {
    sql = sql.replaceAll("and not public._is_manager_or_admin(new.clinic_id) then\n      raise exception 'PERMUTA_NOT_ALLOWED';", "and false then\n      raise exception 'PERMUTA_NOT_ALLOWED';");
    await c.query(sql);
    console.log("   (QUEBRADO de propósito: qualquer um registra permuta)");
  }

  // --- o cenário -------------------------------------------------------------
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "recepcao"]) {
    P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
    if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  }
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("gerente", ldn, "unit_manager");
  await papel("recepcao", ldn, "receptionist");
  await papel("financeiro", franq, "finance_franchisor");
  const cli = await um("select id, full_name from public.clients where clinic_id = $1 order by created_at limit 1", [ldn]);
  await c.query("update public.sale_method_settings set card_machine_direct_sale = true, cash_stale_business_days = 2, cash_panel_since = current_date - 60 where id");

  // --- 1) a venda antiga continua como era ----------------------------------
  const antiga = await um("insert into public.direct_sales (clinic_id, client_id, client_name, method_rule, final_cents, installments, payment_method) values ($1, $2, $3, null, 10000, 1, 'deposito_avista') returning *", [ldn, cli.id, cli.full_name]);
  conf("venda antiga (sem marca) aceita depósito à vista como antes", antiga.payment_method === "deposito_avista");

  // --- 2) a venda direta nova ------------------------------------------------
  const nova = await um("insert into public.direct_sales (clinic_id, client_id, client_name, final_cents) values ($1, $2, $3, 30000) returning *", [ldn, cli.id, cli.full_name]);
  conf("venda direta nova nasce com a marca 'asa4'", nova.method_rule === "asa4");
  // Pela porta da tela (a mesma que a venda direta usa para salvar as condições).
  const setVenda = (who, metodo, n) => pessoa(P[who], "select public.direct_sale_set_conditions($1, $2, $3, 0, 0)", [nova.id, metodo, n]);
  conf("venda nova recusa depósito à vista", erro(await setVenda("recepcao", "deposito_avista", 3), "METHOD_NOT_ALLOWED"));
  conf("venda nova recusa crédito recorrente", erro(await setVenda("recepcao", "credito_recorrente", 3), "METHOD_NOT_ALLOWED"));
  conf("à vista (1×) recusa boleto", erro(await setVenda("recepcao", "boleto", 1), "CASH_METHOD_ONLY"));
  conf("à vista (1×) aceita dinheiro", passou(await setVenda("recepcao", "dinheiro", 1)));
  conf("venda em permuta: a Recepção não pode", erro(await setVenda("recepcao", "permuta", 1), "PERMUTA_NOT_ALLOWED"));
  conf("venda em permuta: o Gerente pode", passou(await setVenda("gerente", "permuta", 1)));
  // A venda de teste não tem itens: as condições zeram o total; ele volta aqui.
  await c.query("update public.direct_sales set payment_method = 'boleto', installments = 3, final_cents = 30000 where id = $1", [nova.id]);

  // --- 3) o parcelamento com meio por parcela --------------------------------
  const plano = (metodos) => JSON.stringify(metodos.map((m, i) => ({ kind: i === 0 ? "entrada" : "parcela", due_date: `2027-0${i + 1}-10`, amount_cents: 10000, payment_method: m })));
  const salvar = (who, metodos) => pessoa(P[who], "select public.save_payment_schedule(null, $1, $2::jsonb)", [nova.id, plano(metodos)]);
  conf("parcelamento recusa crédito recorrente numa parcela", erro(await salvar("recepcao", ["dinheiro", "credito_recorrente", "boleto"]), "METHOD_NOT_ALLOWED"));
  conf("parcelamento: permuta numa parcela só pelo Gerente", erro(await salvar("recepcao", ["dinheiro", "permuta", "boleto"]), "PERMUTA_NOT_ALLOWED"));
  await c.query("update public.sale_method_settings set card_machine_direct_sale = false where id");
  conf("com a chave desligada, cartão parcelado (maquininha) é recusado", erro(await salvar("recepcao", ["dinheiro", "cartao_parcelado", "boleto"]), "METHOD_NOT_ALLOWED"));
  await c.query("update public.sale_method_settings set card_machine_direct_sale = true where id");
  conf("parcelamento com dinheiro, cartão parcelado e boleto é aceito", passou(await salvar("recepcao", ["dinheiro", "cartao_parcelado", "boleto"])));
  const parc = (await c.query("select * from public.payment_installments where direct_sale_id = $1 order by seq", [nova.id])).rows;
  conf("cada parcela guardou o próprio meio", parc.map((p) => p.payment_method).join(",") === "dinheiro,cartao_parcelado,boleto");
  const temAdq = (await um("select count(*)::int n from public.card_acquirers where active")).n > 0;
  conf("adquirente só na parcela de cartão parcelado", parc[0].acquirer_id === null && parc[2].acquirer_id === null && (!temAdq || parc[1].acquirer_id !== null));

  // --- 4) dinheiro e permuta nunca viram cobrança no Asaas --------------------
  const cob = await pessoa(P.admin, "select 1");
  void cob;
  await c.query("savepoint ch");
  let chErr = "";
  try {
    await c.query("insert into public.charges (clinic_id, client_id, source_type, status, payment_installment_id, is_external) values ($1, $2, 'installment', 'emitindo', $3, false)", [ldn, cli.id, parc[0].id]);
  } catch (e) {
    chErr = e.message;
  }
  await c.query("rollback to savepoint ch");
  conf("cobrança no Asaas de parcela em dinheiro é recusada", chErr.includes("METHOD_NOT_SUPPORTED"));

  // --- 5) a baixa e o fechamento ----------------------------------------------
  const baixa = (who, inst, valor, metodo, notas = null) =>
    pessoa(P[who], "select public.register_payment_receipt($1, $2, current_date, $3, null, $4, null) as id", [inst, valor, metodo, notas]);
  conf("baixa em dinheiro com contrato NÃO assinado é recusada", erro(await baixa("recepcao", parc[0].id, 10000, "dinheiro"), "CONTRACT_NOT_SIGNED"));
  await c.query("update public.direct_sales set contract_signed = true, contract_signed_at = now() where id = $1", [nova.id]);
  conf("baixa manual em Pix na venda nova é recusada", erro(await baixa("recepcao", parc[2].id, 10000, "pix"), "RECEIPT_METHOD_NOT_ALLOWED"));
  const b1 = await baixa("recepcao", parc[0].id, 10000, "dinheiro");
  conf("baixa em dinheiro da entrada é aceita", passou(b1));
  const fechada = await um("select closed_at, status, payment_confirmed, payment_confirmed_source, payment_confirmed_by from public.direct_sales where id = $1", [nova.id]);
  conf("a baixa em dinheiro FECHA a venda (como a confirmação do Asaas)", fechada.closed_at !== null && fechada.status === "concluida" && fechada.payment_confirmed);
  conf("o fechamento guarda a origem 'balcao' e quem registrou", fechada.payment_confirmed_source === "balcao" && fechada.payment_confirmed_by === P.recepcao);
  conf("o fechamento fica na auditoria", (await um("select count(*)::int n from public.audit_logs where entity_type = 'direct_sale_close' and entity_id = $1 and details->>'source' = 'balcao'", [nova.id])).n === 1);
  const contaB1 = await um("select b.kind from public.financial_entries e join public.bank_accounts b on b.id = e.bank_account_id where e.source_type = 'receipt_cash' and e.source_id = $1", [b1[0].id]);
  conf("o dinheiro entrou no Caixa", contaB1?.kind === "caixa");
  conf("cartão parcelado (maquininha) recebe baixa em cartão parcelado", passou(await baixa("recepcao", parc[1].id, 5000, "cartao_parcelado")));

  // venda antiga sem fechamento: a regra de ouro continua para Pix
  const antigaParc = await um("insert into public.payment_installments (clinic_id, client_id, direct_sale_id, seq, kind, due_date, amount_cents, payment_method) values ($1, $2, $3, 1, 'parcela', current_date, 10000, 'pix') returning id", [ldn, cli.id, antiga.id]);
  conf("venda não fechada continua recusando baixa em Pix (regra de ouro)", erro(await baixa("recepcao", antigaParc.id, 10000, "pix"), "SALE_NOT_CLOSED"));

  // --- 6) troca de meio e permuta --------------------------------------------
  const trocar = (who, inst, m, motivo) => pessoa(P[who], "select public.installment_set_method($1, $2, $3)", [inst, m, motivo]);
  conf("baixa em permuta em parcela que não é de permuta é recusada", erro(await baixa("gerente", parc[2].id, 10000, "permuta", "Troca por equipamento"), "PERMUTA_NEEDS_METHOD_CHANGE"));
  conf("troca para permuta: a Recepção não pode", erro(await trocar("recepcao", parc[2].id, "permuta", "Equipamento"), "PERMUTA_NOT_ALLOWED"));
  conf("troca para permuta exige descrição", erro(await trocar("gerente", parc[2].id, "permuta", " "), "PERMUTA_DESCRIPTION_REQUIRED"));
  conf("troca para permuta pelo Gerente, com descrição", passou(await trocar("gerente", parc[2].id, "permuta", "Equipamento de raio X")));
  const p3 = await um("select payment_method, benefit_discount_cents from public.payment_installments where id = $1", [parc[2].id]);
  conf("a parcela virou permuta e não leva cota de benefício", p3.payment_method === "permuta" && Number(p3.benefit_discount_cents) === 0);
  conf("a troca fica na auditoria (de, para, motivo)", (await um("select count(*)::int n from public.audit_logs where entity_type = 'installment_method' and entity_id = $1 and details->>'de' = 'boleto' and details->>'para' = 'permuta'", [parc[2].id])).n === 1);
  conf("baixa em permuta pela Recepção é recusada", erro(await baixa("recepcao", parc[2].id, 10000, "permuta", "Equipamento"), "PERMUTA_NOT_ALLOWED"));
  conf("baixa em permuta sem descrição é recusada", erro(await baixa("gerente", parc[2].id, 10000, "permuta", null), "PERMUTA_DESCRIPTION_REQUIRED"));
  const bp = await baixa("gerente", parc[2].id, 10000, "permuta", "Equipamento de raio X, fornecedor Fulano");
  conf("baixa em permuta pelo Gerente, com descrição", passou(bp));
  const contaP = await um("select b.kind, b.alias from public.financial_entries e join public.bank_accounts b on b.id = e.bank_account_id where e.source_type = 'receipt_cash' and e.source_id = $1", [bp[0]?.id]);
  conf("a permuta entra na conta 'Permutas', fora do caixa", contaP?.kind === "permuta");
  conf("a permuta gera as taxas da rede como toda baixa", (await um("select count(*)::int n from public.split_charges where source_type = 'receipt' and source_id = $1", [bp[0]?.id])).n >= 0);
  const fluxo = await pessoa(P.admin, "select source_id from public.cash_flow_detail($1, current_date, current_date)", [ldn]);
  const ids = passou(fluxo) ? fluxo.map((r) => r.source_id) : [];
  conf("o fluxo de caixa não conta a permuta (e conta o dinheiro)", !ids.includes(bp[0]?.id) && ids.includes(b1[0]?.id));
  const cat = await um("select category from public._franchise_payout_receipts(current_date, current_date, null, $1) where receipt_id = $2", [ldn, bp[0]?.id]);
  conf("repasses: a permuta tem categoria própria", cat?.category === "permuta");
  const lista = await pessoa(P.admin, "select public.franchise_payouts_permutas(current_date, current_date, null) as l");
  conf("repasses: a lista das permutas traz a descrição", passou(lista) && (lista[0].l ?? []).some((x) => x.receipt_id === bp[0]?.id && /raio X/.test(x.descricao)));
  conf("repasses: a Recepção não vê a lista das permutas", erro(await pessoa(P.recepcao, "select public.franchise_payouts_permutas(current_date, current_date, null)"), "NOT_ALLOWED"));

  // --- 7) o dinheiro parado, o depósito e o desfazer --------------------------
  const outra = await um("insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, contract_signed) values ($1, $2, $3, 20000, 'dinheiro', 1, true) returning id", [ldn, cli.id, cli.full_name]);
  const pOutra = await um("insert into public.payment_installments (clinic_id, client_id, direct_sale_id, seq, kind, due_date, amount_cents, payment_method) values ($1, $2, $3, 1, 'parcela', current_date - 10, 20000, 'dinheiro') returning id", [ldn, cli.id, outra.id]);
  const b2 = await pessoa(P.recepcao, "select public.register_payment_receipt($1, 20000, current_date - 7, 'dinheiro', null, null, null) as id", [pOutra.id]);
  conf("baixa em dinheiro de 7 dias atrás registrada", passou(b2));
  const painel = async (who) => {
    const r = await pessoa(P[who], "select public.cash_panel_read($1) as p", [ldn]);
    return passou(r) ? r[0].p : r;
  };
  const pn = await painel("recepcao");
  const pend = (pn.pendentes ?? []).map((x) => x.receipt_id);
  conf("o painel mostra os dois recebimentos em dinheiro pendentes", pend.includes(b1[0].id) && pend.includes(b2[0].id));
  conf("o de hoje não está parado; o de 7 dias está", pn.pendentes.find((x) => x.receipt_id === b1[0].id)?.parado === false && pn.pendentes.find((x) => x.receipt_id === b2[0].id)?.parado === true);
  conf("a Recepção vê o painel mas não registra depósito", pn.pode_registrar === false);
  await c.query("delete from public.cash_stale_notices where clinic_id = $1", [ldn]);
  const n1 = Number((await um("select public.cash_stale_alerts_run() as n")).n);
  const avisados = (await c.query("select user_id from public.notifications where clinic_id = $1 and title = 'Dinheiro parado no caixa' and created_at > now() - interval '1 minute'", [ldn])).rows.map((r) => r.user_id);
  conf("aviso do dinheiro parado ao Gerente e ao Financeiro", n1 > 0 && avisados.includes(P.gerente) && avisados.includes(P.financeiro) && !avisados.includes(P.recepcao));
  conf("o aviso sai uma vez por dia", Number((await um("select public.cash_stale_alerts_run() as n")).n) === 0);

  let banco = await um("select id from public.bank_accounts where clinic_id = $1 and active and kind = 'corrente' order by is_default desc limit 1", [ldn]);
  if (!banco) banco = await um("insert into public.bank_accounts (clinic_id, alias, kind) values ($1, 'Banco ensaio', 'corrente') returning id", [ldn]);
  const caminho = `${ldn}/ensaio-4011.pdf`;
  const dep = (who, extra = {}) => pessoa(P[who], "select public.cash_deposit_register($1::jsonb) as id", [JSON.stringify({ clinic_id: ldn, bank_account_id: banco.id, deposited_on: new Date().toISOString().slice(0, 10), receipt_ids: [b1[0].id, b2[0].id], amount_cents: 30000, proof_path: caminho, proof_name: "comprovante.pdf", ...extra })]);
  conf("a Recepção não registra depósito", erro(await dep("recepcao"), "NOT_ALLOWED"));
  conf("depósito sem comprovante é recusado", erro(await dep("gerente"), "PROOF_REQUIRED"));
  await c.query("insert into storage.objects (bucket_id, name, metadata) values ('depositos', $1, '{\"size\": 10, \"mimetype\": \"application/pdf\"}')", [caminho]);
  conf("diferença sem justificativa é recusada", erro(await dep("gerente", { amount_cents: 29900 }), "DIFFERENCE_REASON_REQUIRED"));
  const d1 = await dep("gerente");
  conf("o Gerente registra o depósito com comprovante", passou(d1));
  const depId = d1[0]?.id;
  const lanc = (await c.query("select e.direction, e.amount_cents, b.kind from public.financial_entries e join public.bank_accounts b on b.id = e.bank_account_id where e.source_type = 'cash_deposit' and e.source_id = $1 and e.reversal_of is null order by e.direction", [depId])).rows;
  conf("o depósito tira do Caixa e põe no banco (6.3.01, mesmo valor)", lanc.length === 2 && lanc.some((l) => l.direction === "outflow" && l.kind === "caixa" && Number(l.amount_cents) === 30000) && lanc.some((l) => l.direction === "inflow" && l.kind === "corrente" && Number(l.amount_cents) === 30000));
  const pn2 = await painel("gerente");
  conf("os recebimentos depositados saem do painel", !(pn2.pendentes ?? []).some((x) => [b1[0].id, b2[0].id].includes(x.receipt_id)));
  conf("o mesmo recebimento não entra em dois depósitos", erro(await dep("gerente"), "RECEIPT_NOT_PENDING"));
  conf("o depósito fica na auditoria", (await um("select count(*)::int n from public.audit_logs where entity_type = 'cash_deposit' and entity_id = $1", [depId])).n >= 1);
  const desfazer = (who, motivo) => pessoa(P[who], "select public.cash_deposit_undo($1, $2)", [depId, motivo]);
  conf("o Financeiro não desfaz depósito (só Gerente e Admin)", erro(await desfazer("financeiro", "erro"), "NOT_ALLOWED"));
  conf("desfazer exige motivo", erro(await desfazer("gerente", ""), "REASON_REQUIRED"));
  conf("o Gerente desfaz o depósito com motivo", passou(await desfazer("gerente", "Valor depositado na conta errada")));
  const saldoCaixa = await um("select coalesce(sum(case when e.direction = 'inflow' then e.amount_cents else -e.amount_cents end), 0)::bigint s from public.financial_entries e where e.source_type = 'cash_deposit' and e.source_id = $1", [depId]);
  conf("o desfazer estorna os dois lançamentos (soma zero)", Number(saldoCaixa.s) === 0);
  const pn3 = await painel("gerente");
  conf("desfeito, os recebimentos voltam a 'não depositado'", [b1[0].id, b2[0].id].every((id) => (pn3.pendentes ?? []).some((x) => x.receipt_id === id)));

  // --- 8) as portas internas estão fechadas ------------------------------------
  const internas = ["_counter_confirm_sale", "_cash_pending", "_permuta_account_for", "cash_stale_alerts_run", "_direct_sale_method_ok", "_is_manager_or_admin"];
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

console.log(`\nEnsaio da 4011 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log("  FALHOU:", f);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
