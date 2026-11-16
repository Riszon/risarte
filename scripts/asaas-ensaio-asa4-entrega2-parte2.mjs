// ENSAIO DA 4014 (ASA4, entrega 2, parte 2 — devolução por Pix, contestação com
// prazo, link vencido e o split na aprovação) no banco de TREINO, numa transação
// DESFEITA (rollback): nada fica gravado e o Asaas não é chamado.
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-asa4-entrega2-parte2.mjs --confirmar [--quebrar=termo|autoriza|aviso]
//
// PROVADO QUEBRANDO: `--quebrar=termo` aceita a devolução sem o termo assinado;
// `--quebrar=autoriza` deixa o Gerente autorizar a própria devolução;
// `--quebrar=aviso` faz o aviso repetir (sem a trava de um por vez). Os três
// têm de reprovar o ensaio.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ13 = "supabase/migrations/4013_asa4_cartao_parcelado_pelo_asaas.sql";
const ARQ = "supabase/migrations/4014_asa4_parcelado_devolucao_contestacao_e_avisos.sql";
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
const erro = (r, codigo) => typeof r === "string" && r.includes(codigo);
const passou = (r) => Array.isArray(r);
const iso = (d) => d.toISOString().slice(0, 10);
const mesesDepois = (s, k) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + k, d)));
};

try {
  await c.query("begin");
  // As migrações antigas, rodadas de novo aqui, não conhecem as origens novas de
  // cobrança (4017 e 4018): dentro desta transação desfeita, elas ficam sem origem.
  await c.query("update public.charges set auto_origin = null where auto_origin not in ('assinatura', 'venda_direta', 'rotina', 'rodar_agora', 'restante')");
  await c.query(readFileSync(ARQ13, "utf8"));
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query("savepoint dup");
  try {
    await c.query(sql);
    await c.query("release savepoint dup");
    conf("a 4014 roda duas vezes sem erro", true);
  } catch (e) {
    await c.query("rollback to savepoint dup");
    conf(`a 4014 roda duas vezes sem erro (${e.message})`, false);
  }
  // As migrações seguintes redefinem parte desta: o ensaio roda por cima delas,
  // como o banco está de verdade (rodar só esta de novo deixaria as funções antigas).
  for (const depois of ["4015_asa4_forma2_todos_os_boletos_agora.sql", "4015a_asa4_recusa_cancelar_venda_com_acordo_aberto.sql", "4017_asa4_renegociacao_assinada.sql", "4017a_asa4_excecao_cancelar_venda_com_acordo.sql", "4018_asa4_mensalidades_pelo_asaas.sql"]) await c.query(readFileSync(`supabase/migrations/${depois}`, "utf8"));
  if (QUEBRAR === "termo") {
    const f = await um("select pg_get_functiondef('public.card_block_return_request(jsonb)'::regprocedure) d");
    await c.query(f.d.replace("raise exception 'TERM_REQUIRED';", "null;"));
    console.log("   (QUEBRADO de propósito: a devolução passa sem o termo)");
  } else if (QUEBRAR === "autoriza") {
    const f = await um("select pg_get_functiondef('public.card_block_return_decide(uuid, boolean, text)'::regprocedure) d");
    await c.query(f.d.replace("if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;", ""));
    console.log("   (QUEBRADO de propósito: qualquer um autoriza)");
  } else if (QUEBRAR === "aviso") {
    await c.query("alter table public.routine_notices drop constraint if exists routine_notices_pkey");
    await c.query("alter table public.routine_notices drop constraint if exists routine_notices_kind_key_key");
    console.log("   (QUEBRADO de propósito: o aviso pode repetir)");
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
  const cli = await um(
    `select c.id, c.full_name from public.clients c
      where c.clinic_id = $1 and public._cpf_ok(c.cpf) and c.birth_date < current_date - interval '19 years'
        and not exists (select 1 from public.client_guardians g where g.client_id = c.id and g.is_financial)
      order by c.created_at limit 1`, [ldn]);
  if (!cli) throw new Error("NÃO MEDI: nenhum cliente de Londrina com CPF válido.");
  const raiz = await um("select id, wallet_id from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = 'sandbox' and wallet_id is not null order by created_at limit 1");
  const taxas = (await todos("select key from public.network_fee_types where kind = 'percent' and active")).map((r) => r.key);
  await c.query("insert into public.gateway_auto_charge_units (clinic_id, enabled, enabled_from) values ($1, true, now() - interval '1 minute') on conflict (clinic_id) do update set enabled = true, enabled_from = now() - interval '1 minute'", [ldn]);

  let primeiro = iso(new Date(Date.now() + 5 * 86400000));
  if (Number(primeiro.slice(8, 10)) > 28) primeiro = primeiro.slice(0, 8) + "05";
  // Uma venda direta nova, 3× no cartão pelo Asaas, assinada, com o parcelamento criado e emitido.
  const bloco = async (pagar) => {
    const v = (await um("insert into public.direct_sales (clinic_id, client_id, client_name, final_cents, payment_method, installments, created_by) values ($1, $2, $3, 30001, 'cartao_parcelado_asaas', 3, $4) returning id", [ldn, cli.id, cli.full_name, P.recepcao])).id;
    const linhas = [10000, 10000, 10001].map((x, k) => ({ kind: "parcela", due_date: mesesDepois(primeiro, k), amount_cents: x, payment_method: "cartao_parcelado_asaas" }));
    const s = await pessoa(P.recepcao, "select public.save_payment_schedule(null, $1, $2::jsonb)", [v, JSON.stringify(linhas)]);
    if (!passou(s)) throw new Error(`parcelamento: ${s}`);
    await c.query("update public.direct_sales set contract_signed = true where id = $1", [v]);
    const b = (await um("select public._card_block_prepare_system(null, $1, 'venda_direta') as b", [v])).b;
    const cs = await todos("select id, value_cents from public.charges where installment_block = $1 order by installment_number", [b]);
    for (const [k, x] of cs.entries()) {
      await um("select public._charge_mark_issued($1, $2, null, $3, null, null, null)", [x.id, `pay_e2_${b.slice(0, 6)}_${k}`, `https://sandbox.asaas.com/i/e2${k}`]);
      await um("select public._charge_save_split($1, $2::jsonb)", [x.id, JSON.stringify([{ accountId: raiz.id, walletId: raiz.wallet_id, percent: 17, percentualValue: 17.4341, fixedCents: 2, fees: Object.fromEntries(taxas.map((t) => [t, 17 / taxas.length])), tariffPercent: 2.49, tariffFixedCents: 16, asaasSplitId: `s_${k}` }])]);
    }
    await um("select public._card_block_save_installment($1, $2)", [b, `inst_${b.slice(0, 6)}`]);
    if (pagar) {
      for (const [k, x] of cs.entries()) {
        await um("select public._gateway_on_paid($1, 'PAYMENT_CONFIRMED', $2::jsonb)", [x.id, JSON.stringify({ id: `pay_e2_${b.slice(0, 6)}_${k}`, value: Number(x.value_cents) / 100, netValue: (Number(x.value_cents) - 265) / 100, confirmedDate: iso(new Date()), estimatedCreditDate: mesesDepois(primeiro, k + 1) })]);
      }
    }
    return { venda: v, bloco: b, cs };
  };

  // --- 1) a devolução por Pix (1a) -------------------------------------------------
  const pago = await bloco(true);
  const req = (j) => pessoa(P.gerente, "select public.card_block_return_request($1::jsonb) id", [JSON.stringify(j)]);
  const base = { block: pago.bloco, amount_cents: 15000, reason: "desistência no meio do tratamento" };
  conf("sem o termo assinado anexado, a devolução não é registrada", erro(await req({ ...base, term_path: `${ldn}/${pago.bloco}/nao-existe.pdf` }), "TERM_REQUIRED"));
  const termo = `${ldn}/${pago.bloco}/termo-ensaio.pdf`;
  await c.query("insert into storage.objects (bucket_id, name) values ('devolucoes', $1)", [termo]);
  conf("termo de OUTRA unidade é recusado", erro(await req({ ...base, term_path: `${franq}/${pago.bloco}/termo-ensaio.pdf` }), "TERM_REQUIRED"));
  conf("valor acima do pago é recusado", erro(await req({ ...base, amount_cents: 30002, term_path: termo }), "AMOUNT_OVER_BALANCE"));
  conf("a Recepção não pede devolução", erro(await pessoa(P.recepcao, "select public.card_block_return_request($1::jsonb)", [JSON.stringify({ ...base, term_path: termo })]), "NOT_ALLOWED"));
  const r1 = await req({ ...base, term_path: termo, term_name: "termo.pdf" });
  const dev = passou(r1) ? r1[0].id : null;
  conf("o Gerente pede, com o termo: fica esperando a autorização", Boolean(dev) && (await um("select status from public.card_block_returns where id = $1", [dev])).status === "pedida");
  conf("o pedido avisa o Financeiro da Franqueadora e o Admin Master", (await um("select count(*)::int n from public.notifications where title = 'Devolução por Pix para autorizar' and user_id = $1", [P.financeiro])).n >= 1);
  conf("o Gerente NÃO autoriza a própria devolução", erro(await pessoa(P.gerente, "select public.card_block_return_decide($1, true, null)", [dev]), "NOT_ALLOWED"));
  conf("um 2º pedido acima do que sobra é recusado", erro(await req({ ...base, amount_cents: 15002, term_path: termo }), "AMOUNT_OVER_BALANCE"));
  const dec = await pessoa(P.financeiro, "select public.card_block_return_decide($1, true, 'conferido') p", [dev]);
  const payable = passou(dec) ? dec[0].p : null;
  const pay = payable ? await um("select account_code, amount_cents, status from public.payables where id = $1", [payable]) : null;
  conf("o Financeiro autoriza: vira conta a pagar da unidade (1.9.03), aberta, no valor", pay?.account_code === "1.9.03" && Number(pay?.amount_cents) === 15000 && pay?.status === "aberta");
  const depois = await todos("select ch.status, sc.retained_cents, sc.amount_cents from public.charges ch join public.split_charges sc on sc.receipt_id = ch.receipt_id where ch.installment_block = $1", [pago.bloco]);
  conf("o parcelamento continua pago e a taxa da rede continua devida (retida)", depois.length > 0 && depois.every((x) => x.status === "paga" && Number(x.retained_cents) === Number(x.amount_cents)));
  conf("decidir de novo é recusado", erro(await pessoa(P.financeiro, "select public.card_block_return_decide($1, false, 'outra vez')", [dev]), "RETURN_ALREADY_DECIDED"));
  const r2 = await req({ ...base, amount_cents: 5000, term_path: termo });
  conf("negar exige o motivo", erro(await pessoa(P.admin, "select public.card_block_return_decide($1, false, null)", [r2[0]?.id]), "REASON_REQUIRED"));
  conf("negada com motivo: sem conta a pagar", passou(await pessoa(P.admin, "select public.card_block_return_decide($1, false, 'sem o distrato do paciente')", [r2[0]?.id])) && !(await um("select payable_id from public.card_block_returns where id = $1", [r2[0]?.id])).payable_id);
  const resumo = (await um("select public._card_block_summary(null, $1) r", [pago.venda])).r;
  conf("as Cobranças da venda mostram as devoluções e a unidade (para a pasta do termo)", resumo?.devolucoes?.length === 2 && resumo?.clinic === ldn && Number(resumo?.pago_cents) === 30001);

  // --- 2) a contestação com prazo ----------------------------------------------------
  await c.query("update public.charges set status = 'em_contestacao' where installment_block = $1", [pago.bloco]);
  const lista = await todos("select * from public._chargebacks_to_check(50) where charge_id = any($1)", [pago.cs.map((x) => x.id)]);
  conf("o servidor recebe a lista das contestações sem prazo", lista.length === 3);
  // O prazo conta do dia de HOJE no Brasil (depois das 21h, o UTC já é amanhã).
  const prazo = iso(new Date(Date.parse(String((await um("select public.today_br()::text d")).d)) + 2 * 86400000));
  for (const x of pago.cs) await um("select public._chargeback_save($1, $2, 'REQUESTED')", [x.id, prazo]);
  conf("com o prazo lido, ela sai da lista", (await todos("select * from public._chargebacks_to_check(50) where charge_id = any($1)", [pago.cs.map((x) => x.id)])).length === 0);
  await um("select public.chargeback_alerts_run()");
  const avisoG = (await um("select count(*)::int n from public.notifications where title = 'Contestação no cartão pelo titular' and user_id = $1", [P.gerente])).n;
  conf("o aviso da contestação vai para o Gerente (um para o parcelamento, não um por parcela)", avisoG === 1);
  conf("…e para o Financeiro da Franqueadora", (await um("select count(*)::int n from public.notifications where title = 'Contestação no cartão pelo titular' and user_id = $1", [P.financeiro])).n === 1);
  conf("…e para quem fechou a venda", (await um("select count(*)::int n from public.notifications where title = 'Contestação no cartão pelo titular' and user_id = $1", [P.recepcao])).n === 1);
  conf("o aviso do prazo (2 dias úteis ou menos)", (await um("select count(*)::int n from public.notifications where title = 'Contestação: o prazo dos documentos está acabando' and user_id = $1", [P.gerente])).n === 1);
  await um("select public.chargeback_alerts_run()");
  conf("rodar de novo não repete o aviso", (await um("select count(*)::int n from public.notifications where title = 'Contestação no cartão pelo titular' and user_id = $1", [P.gerente])).n === 1);

  // --- 3) o link vencido, de 7 em 7 dias ---------------------------------------------
  const aberto = await bloco(false);
  const venc = iso(new Date(Date.now() - 12 * 86400000));
  await c.query("update public.charges set due_date = $2 where installment_block = $1 and installment_number = 1", [aberto.bloco, venc]);
  await um("select public.card_block_overdue_alerts_run()");
  const nv = async () => (await um("select count(*)::int n from public.notifications where title = 'Cartão parcelado vencido sem pagamento' and user_id = $1 and body like '%' || $2 || '%'", [P.gerente, `${venc.slice(8, 10)}/${venc.slice(5, 7)}/${venc.slice(0, 4)}`])).n;
  conf("vencido sem pagamento: aviso para o Gerente", (await nv()) === 1);
  conf("…e para quem fechou a venda", (await um("select count(*)::int n from public.notifications where title = 'Cartão parcelado vencido sem pagamento' and user_id = $1", [P.recepcao])).n >= 1);
  await um("select public.card_block_overdue_alerts_run()");
  conf("no mesmo ciclo de 7 dias, não repete", (await nv()) === 1);
  conf("o pago não entra no aviso de vencido", !(await um("select 1 x from public.routine_notices where kind = 'parcelado_vencido' and key like $1 || '%'", [pago.bloco])));

  // --- 4) o split na aprovação ------------------------------------------------------
  const outro = await bloco(true);
  const naLista = async () => (await todos("select * from public._card_blocks_split_to_check(50) where installment_block = $1", [outro.bloco])).length;
  conf("o parcelamento aprovado entra na conferência do split", (await naLista()) === 1);
  await um("select public._card_block_split_checked($1)", [outro.bloco]);
  conf("conferido, sai da lista", (await naLista()) === 0);
  const outro2 = await bloco(true);
  await c.query("update public.charge_splits set status = 'liquidado', settled_cents = 1743, settled_at = now() where charge_id = $1", [outro2.cs[0].id]);
  conf("com uma parcela já liquidada, não entra (o Asaas não muda mais)", (await todos("select * from public._card_blocks_split_to_check(50) where installment_block = $1", [outro2.bloco])).length === 0);

  // --- 5) as portas internas estão fechadas -----------------------------------
  const internas = ["_card_block_return_can_request", "_chargebacks_to_check", "_chargeback_save", "chargeback_alerts_run", "card_block_overdue_alerts_run", "_card_blocks_split_to_check", "_card_block_split_checked"];
  let fechadas = 0;
  for (const f of internas) {
    const r = await um("select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [f]);
    if (r.x === false) fechadas++;
  }
  conf("as funções internas estão fechadas para quem está logado", fechadas === internas.length);
  conf("a pasta dos termos é privada", (await um("select not public as x from storage.buckets where id = 'devolucoes'")).x === true);
} catch (e) {
  falha.push(`o ensaio parou: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nEnsaio da 4014 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log("  FALHOU:", f);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
