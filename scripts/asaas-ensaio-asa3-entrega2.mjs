// ENSAIO DA 4009 (ASA3, entrega 2 — a fila do split, o estorno, o saldo e o
// webhook) no banco de TREINO, numa transação DESFEITA (rollback): nada fica
// gravado. Uso: node scripts/asaas-ensaio-asa3-entrega2.mjs --confirmar
//
// Confere: cada gatilho põe na fila (taxa, campanha, destino, tarifa, split
// habilitado) e mudança que não altera a conta NÃO põe; a ordem (vencidas e
// vencimento mais próximo) e o limite por conta; o resultado (atualizado,
// igual, erro com nova tentativa, mudança no meio da rodada); todas as taxas em
// zero só com confirmação (U4); a tarifa absorvida (18.7.2); o estorno: quem
// pode (Admin, Franqueado, Gerente só liberado), as recusas, o pedido, o
// negado, o concluído com o razão estornado e a taxa de volta à conta a pagar
// (D13), o pedido parado; o saldo; o webhook e a prontidão; as portas e as
// funções internas fechadas. Percentuais de exemplo não redondos.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";
import { entradasDoSplit, tarifaParaOSplit } from "../src/lib/asaas/split.ts";

const ARQ = "supabase/migrations/4009_asa3_fila_do_split_e_estorno.sql";

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/asaas-ensaio-asa3-entrega2.mjs --confirmar",
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
async function comoServidor() {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', '', true)");
}
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
    return /NOT_ALLOWED|permission denied/.test(e.message) ? "recusado" : `erro: ${e.message}`;
  }
}

// As taxas de exemplo (18.5): diferentes e não redondas.
const TAXAS = { royalty: 6.37, fundo: 1.83, planejamento: 2.91, comercial: 5.44 };

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  const e2 = await recusa(sql);
  conf("a 4009 roda duas vezes sem erro", e2 === null);
  if (e2) console.log("   ", e2);

  // --- o cenário ------------------------------------------------------------------
  const pessoa = async (conta) => (await um("select id from public.profiles where email = $1", [`${conta}@example.com`]))?.id;
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "franqueado", "recepcao"]) {
    P[k] = await pessoa(k);
    if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  }
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const conta = await um("select * from public.gateway_accounts where clinic_id = $1 and status = 'active'", [ldn]);
  const raiz = await um("select * from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = $1 and wallet_id is not null order by created_at limit 1", [conta?.environment]);
  if (!ldn || !conta || !raiz) throw new Error("NÃO MEDI: falta Londrina com conta ou a conta raiz.");
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("gerente", ldn, "unit_manager");
  await papel("franqueado", ldn, "franchisee");
  await papel("recepcao", ldn, "receptionist");
  await papel("financeiro", franq, "finance_franchisor");
  for (const [fee, pct] of Object.entries(TAXAS)) {
    await c.query("update public.network_fees set percent = $2, active = true where clinic_id is null and fee = $1", [fee, pct]);
    await c.query("delete from public.network_fees where clinic_id = $1 and fee = $2", [ldn, fee]);
  }
  await c.query("update public.network_fee_types set active = true, split_account_id = null where key = any($1)", [Object.keys(TAXAS)]);
  await c.query("delete from public.network_fee_campaigns");
  await c.query("update public.gateway_accounts set split_enabled_declared_at = now() where id = $1", [conta.id]);
  await c.query("update public.gateway_accounts set refund_roles = array['franchisee']::public.user_role[] where id = $1", [conta.id]);
  // A fila começa vazia (o treino pode ter cobranças antigas).
  await c.query("update public.charges set split_pending_since = null, split_pending_reasons = null, split_zero_pending = false");

  const parcelas = await todos(
    `select i.id, i.amount_cents, i.client_id from public.payment_installments i
      where i.clinic_id = $1 and i.status = 'em_aberto' and i.amount_cents >= 5000 and i.client_id is not null
        and not exists (select 1 from public.charges ch where ch.payment_installment_id = i.id
                         and ch.status in ('emitindo','emitida','vencida','paga','liquidada','erro_emissao','externa'))
      order by i.amount_cents limit 6`,
    [ldn]
  );
  if (parcelas.length < 6) throw new Error("NÃO MEDI: faltam 6 parcelas livres em Londrina.");
  const hoje = (await um("select public.today_br()::text d")).d;
  let seq = 0;
  const evento = async (ev, payload) => {
    seq++;
    await c.query(
      "insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload) values ($1, $2, $3, $4::jsonb)",
      [conta.id, `evt_e4009_${seq}`, ev, JSON.stringify({ event: ev, ...payload })]
    );
    return (await um("select public._gateway_process_event(id) r from public.gateway_webhook_events where asaas_event_id = $1", [`evt_e4009_${seq}`])).r;
  };
  async function emitida(parc, diasVenc, status = "emitida") {
    seq++;
    const id = (
      await um(
        `insert into public.charges (clinic_id, gateway_account_id, source_type, payment_installment_id, client_id, payer_kind,
                                     billing_type, value_cents, discount_cents, fine_percent, fine_cents, interest_percent, due_date, status, description)
         values ($1, $2, 'installment', $3, $4, 'client', 'PIX', $5, 0, 0, 0, 0, ($6::date + $7::int), 'emitindo', 'Ensaio 4009') returning id`,
        [ldn, conta.id, parc.id, parc.client_id, parc.amount_cents, hoje, diasVenc]
      )
    ).id;
    const pl = (await um("select public._charge_split_plan($1) p", [id])).p;
    const t = tarifaParaOSplit(pl.tarifas, "PIX", hoje, pl.vencimento > hoje ? pl.vencimento : hoje);
    const ent = entradasDoSplit(pl.carteiras.map((w) => ({ walletId: w.walletId, percent: Number(w.percent) })), t).map((e) => {
      const w = pl.carteiras.find((x) => x.walletId === e.walletId);
      return { ...e, accountId: w.accountId, fees: w.fees, tariffPercent: t.a * 100, tariffFixedCents: t.bCents, asaasSplitId: `s_${seq}` };
    });
    await c.query("select public._charge_save_split($1, $2::jsonb)", [id, JSON.stringify(ent)]);
    await c.query("select public._charge_mark_issued($1, $2, null, 'https://x/i', null, 'pix', null)", [id, `pay_e4009_${seq}`]);
    if (status === "vencida") await c.query("update public.charges set status = 'vencida' where id = $1", [id]);
    return id;
  }
  async function pagarELiquidar(id, parc, faltaCentavosPorCarteira) {
    const pid = (await um("select asaas_payment_id p from public.charges where id = $1", [id])).p;
    await evento("PAYMENT_RECEIVED", {
      payment: { id: pid, externalReference: id, value: parc.amount_cents / 100, netValue: (parc.amount_cents - 99) / 100, billingType: "PIX", paymentDate: hoje, creditDate: hoje },
    });
    for (const w of await todos("select wallet_id, asaas_split_id from public.charge_splits where charge_id = $1", [id])) {
      const devido = (
        await um(
          "select coalesce(sum(sc.amount_cents),0)::int s from public.split_charges sc join public.charge_splits cs on cs.charge_id = sc.charge_id and cs.fees ? sc.fee where sc.charge_id = $1 and cs.wallet_id = $2",
          [id, w.wallet_id]
        )
      ).s;
      await evento("PAYMENT_SPLIT_DONE", {
        payment: { id: pid, externalReference: id, split: [{ id: w.asaas_split_id, walletId: w.wallet_id, totalValue: (devido - faltaCentavosPorCarteira) / 100 }] },
        additionalInfo: { splitId: w.asaas_split_id },
      });
    }
    return pid;
  }
  const naFila = async (id) => await um("select split_pending_since is not null p, split_pending_reasons r from public.charges where id = $1", [id]);
  const limpaFila = (ids) => c.query("update public.charges set split_pending_since = null, split_pending_reasons = null, split_inputs = public._charge_split_inputs(id) where id = any($1)", [ids]);

  // --- 1) a base guardada e o "sem mudança" ---------------------------------------
  const A = await emitida(parcelas[0], 10);
  const B = await emitida(parcelas[1], 3);
  const V = await emitida(parcelas[2], -2, "vencida");
  conf("a emissão guarda a base do split (taxas e tarifa)", !!(await um("select split_inputs from public.charges where id = $1", [A])).split_inputs?.carteiras);
  await c.query("update public.network_fees set note = 'só a observação' where clinic_id is null and fee = 'royalty'");
  conf("mudar só a observação da taxa NÃO põe na fila", !(await naFila(A)).p);
  await c.query("update public.network_fees set percent = 6.37 where clinic_id is null and fee = 'royalty'");
  conf("gravar a MESMA taxa NÃO põe na fila", !(await naFila(A)).p);
  // Passa pelo gatilho (tarifa da conta de Londrina), mas não muda a conta de
  // uma cobrança PIX: a COMPARAÇÃO da base não põe na fila.
  const acq0 = await um("select id from public.card_acquirers where gateway_account_id = $1", [conta.id]);
  await c.query(
    "insert into public.acquirer_rates (acquirer_id, modality, min_installments, max_installments, fee_percent, fixed_fee_cents, settlement_days, valid_from, valid_to, source, fee_charged_on) values ($1, 'credito_avista', 1, 1, 0.5, 1, 32, public.today_br(), null, 'gateway', 'pagamento')",
    [acq0.id]
  );
  conf("tarifa nova que não muda a conta (cartão, numa cobrança Pix) NÃO põe na fila", !(await naFila(A)).p);

  // --- 2) cada gatilho ------------------------------------------------------------
  await c.query("update public.network_fees set percent = 6.11 where clinic_id is null and fee = 'royalty'");
  let f = await naFila(A);
  conf("taxa da rede mudou: as cobranças em aberto entram na fila (motivo taxa)", f.p && (f.r ?? []).includes("taxa") && (await naFila(V)).p);
  await limpaFila([A, B, V]);
  await c.query(
    "insert into public.network_fee_campaigns (name, clinic_id, starts_on, ends_on, mode, percent, fees, active) values ('Ensaio', $1, public.today_br(), public.today_br() + 30, 'valor', 3.33, array['comercial'], true)",
    [ldn]
  );
  f = await naFila(A);
  conf("campanha da unidade: entra na fila (motivo campanha)", f.p && (f.r ?? []).includes("campanha"));
  await c.query("delete from public.network_fee_campaigns");
  await limpaFila([A, B, V]);
  const rec = await um(
    "insert into public.gateway_accounts (owner_type, label, environment, mode, status, wallet_id) values ('recipient', 'Fundo (ensaio 4009)', $1, 'linked', 'active', 'wallet-ensaio-4009') returning id",
    [conta.environment]
  );
  await c.query("update public.network_fee_types set split_account_id = $1 where key = 'fundo'", [rec.id]);
  f = await naFila(A);
  conf("destino de uma taxa mudou: entra na fila (motivo destino)", f.p && (f.r ?? []).includes("destino"));
  await c.query("update public.network_fee_types set split_account_id = null where key = 'fundo'");
  await limpaFila([A, B, V]);
  const acq = await um("select id from public.card_acquirers where gateway_account_id = $1", [conta.id]);
  await c.query(
    "insert into public.acquirer_rates (acquirer_id, modality, min_installments, max_installments, fee_percent, fixed_fee_cents, settlement_days, valid_from, valid_to, source, fee_charged_on) values ($1, 'pix', 1, 1, 0, 49, 0, public.today_br(), null, 'gateway', 'pagamento')",
    [acq.id]
  );
  f = await naFila(A);
  conf("tarifa nova do Asaas: entra na fila com motivo TARIFA (só a tarifa mudou)", f.p && (f.r ?? []).join() === "tarifa");

  // --- 3) a ordem e o limite ------------------------------------------------------
  await c.query("update public.charges set split_pending_since = now(), split_pending_reasons = array['taxa'], split_next_try_at = now() where id = any($1)", [[A, B, V]]);
  const fila2 = await todos("select charge_id from public._gateway_split_queue(2, $1)", [ldn]);
  conf("a fila respeita o limite por conta", fila2.length === 2);
  // O treino pode ter outras cobranças em aberto de Londrina na fila: a ordem é conferida entre as do ensaio.
  const ordem = (await todos("select charge_id from public._gateway_split_queue(150, $1)", [ldn])).map((x) => x.charge_id).filter((x) => [A, B, V].includes(x));
  conf("a VENCIDA vem primeiro, depois o vencimento mais próximo", ordem.join() === [V, B, A].join());

  // --- 4) o resultado -------------------------------------------------------------
  const item = (await todos("select * from public._gateway_split_queue(150, $1)", [ldn])).find((x) => x.charge_id === A);
  conf("o item da fila traz o plano e a base de hoje", !!item?.plan?.elegivel && !!item?.inputs?.carteiras);
  await c.query("select public._gateway_split_done($1, 'atualizado', '[]'::jsonb, null, $2, $3, 'timeout', null)", [A, item.reasons, item.started_at]);
  const erro = await um("select split_attempts, split_next_try_at > now() futura, split_pending_since is not null p from public.charges where id = $1", [A]);
  conf("erro no Asaas: continua na fila e só tenta de novo mais tarde", erro.split_attempts === 1 && erro.futura && erro.p);
  await c.query("update public.charges set split_pending_since = clock_timestamp() + interval '1 second' where id = $1", [A]);
  const ent = item.plan.carteiras.map((w) => ({ walletId: w.walletId, accountId: w.accountId, percent: w.percent, fees: w.fees, percentualValue: Number(w.percent), fixedCents: 5, tariffPercent: 0, tariffFixedCents: 49 }));
  await c.query("select public._gateway_split_done($1, 'atualizado', $2::jsonb, $3::jsonb, $4, $5, null, null)", [A, JSON.stringify(ent), JSON.stringify(item.inputs), item.reasons, item.started_at]);
  conf("mudou de novo no meio da rodada: continua na fila", (await naFila(A)).p);
  const hist = await um("select count(*)::int n, max(outcome) o from public.charge_split_updates where charge_id = $1", [A]);
  conf("o histórico da cobrança registra a atualização e o motivo", hist.n === 1 && hist.o === "atualizado");
  conf("o split gravado é o novo", (await um("select fixed_cents::int f from public.charge_splits where charge_id = $1 limit 1", [A])).f === 5);
  const itemB = (await todos("select * from public._gateway_split_queue(150, $1)", [ldn])).find((x) => x.charge_id === B);
  await c.query("select public._gateway_split_done($1, 'igual', '[]'::jsonb, $2::jsonb, $3, $4, null, null)", [B, JSON.stringify(itemB.inputs), itemB.reasons, itemB.started_at]);
  conf("'igual' (a conta deu o mesmo split): sai da fila sem histórico", !(await naFila(B)).p && (await um("select count(*)::int n from public.charge_split_updates where charge_id = $1", [B])).n === 0);

  // --- 5) U4: todas as taxas em zero ----------------------------------------------
  for (const fee of Object.keys(TAXAS)) await c.query("update public.network_fees set percent = 0 where clinic_id is null and fee = $1", [fee]);
  conf("U4: todas as taxas em zero NÃO tiram o split sozinhas (fica esperando confirmação)", (await um("select split_zero_pending z from public.charges where id = $1", [B])).z === true);
  conf("U4: sem confirmação, não vai para a fila de retirada", !(await todos("select * from public._gateway_split_queue(150, $1)", [ldn])).some((x) => x.mode === "remover"));
  conf("U4: o Gerente não confirma", (await comoPessoa(P.gerente, "select public.gateway_split_zero_confirm($1, 'isenção de teste')", [ldn])) === "recusado");
  const conf0 = await comoPessoa(P.financeiro, "select public.gateway_split_zero_confirm($1, 'isenção registrada de teste') n", [ldn]);
  conf("U4: o Financeiro confirma, com motivo", Array.isArray(conf0) && conf0[0].n >= 1);
  conf("U4: confirmado, a fila tira o split (modo remover)", (await todos("select * from public._gateway_split_queue(150, $1)", [ldn])).some((x) => x.charge_id === B && x.mode === "remover"));
  conf("U4: a confirmação fica na auditoria", (await um("select count(*)::int n from public.audit_logs where entity_type = 'gateway_split_zero' and clinic_id = $1", [ldn])).n === 1);
  for (const [fee, pct] of Object.entries(TAXAS)) await c.query("update public.network_fees set percent = $2 where clinic_id is null and fee = $1", [fee, pct]);
  await c.query("update public.charges set split_zero_pending = false, split_zero_confirmed_at = null where id = any($1)", [[A, B, V]]);
  await limpaFila([A, B, V]);

  // --- 6) a tarifa absorvida (18.7.2) ---------------------------------------------
  await c.query("update public.charges set split_pending_since = now(), split_pending_reasons = array['tarifa'] where id = $1", [B]);
  await pagarELiquidar(B, parcelas[1], 40);
  conf("paga enquanto esperava a fila só por tarifa: marcada para absorver", (await um("select split_absorb_tariff a from public.charges where id = $1", [B])).a === true);
  const retB = await todos("select amount_cents::int a, retained_cents::int r from public.split_charges where charge_id = $1", [B]);
  conf("tarifa absorvida: liquidando R$ 0,40 abaixo, a falta NÃO vira conta a pagar", retB.length === 4 && retB.every((x) => x.r === x.a));
  // Controle: a mesma falta com a fila pendente por TAXA vira conta a pagar.
  const D = await emitida(parcelas[4], 4);
  await c.query("update public.charges set split_pending_since = now(), split_pending_reasons = array['taxa'] where id = $1", [D]);
  await pagarELiquidar(D, parcelas[4], 40);
  const retD = await todos("select amount_cents::int a, retained_cents::int r from public.split_charges where charge_id = $1", [D]);
  conf("controle: a mesma falta com a fila por TAXA vira conta a pagar (S5)", retD.some((x) => x.r < x.a));

  // --- 7) o ESTORNO: quem pode ----------------------------------------------------
  const C = await emitida(parcelas[3], 5);
  const pidC = await pagarELiquidar(C, parcelas[3], 1);
  const chk = (who) => comoPessoa(P[who], "select * from public.charge_refund_check($1, 'motivo do ensaio')", [C]);
  conf("o Franqueado (padrão) pode pedir estorno", Array.isArray(await chk("franqueado")));
  conf("o Gerente NÃO pode, sem a liberação do Admin", (await chk("gerente")) === "recusado");
  conf("a Recepcionista nunca pode", (await chk("recepcao")) === "recusado");
  conf("só o Admin libera o Gerente", (await comoPessoa(P.financeiro, "select public.gateway_refund_roles_set($1, array['franchisee','unit_manager'])", [ldn])) === "recusado");
  await comoPessoa(P.admin, "select public.gateway_refund_roles_set($1, array['franchisee','unit_manager'])", [ldn]);
  conf("liberado pelo Admin, o Gerente pode", Array.isArray(await chk("gerente")));
  const semMotivo = await comoPessoa(P.franqueado, "select * from public.charge_refund_check($1, 'ok')", [C]);
  conf("o motivo é obrigatório", typeof semMotivo === "string" && /REASON_REQUIRED/.test(semMotivo));
  const emAberto = await comoPessoa(P.franqueado, "select * from public.charge_refund_check($1, 'motivo do ensaio')", [A]);
  conf("cobrança não paga não se estorna", typeof emAberto === "string" && /NOT_REFUNDABLE/.test(emAberto));

  // --- 8) o pedido, o negado e o concluído ----------------------------------------
  await c.query("select public._charge_refund_requested($1, $2, 'paciente desistiu do tratamento', 'pix', 'AWAITING_CRITICAL_ACTION_AUTHORIZATION', null)", [C, P.franqueado]);
  conf("o pedido deixa a cobrança 'aguardando autorização' (continua paga)", (await um("select refund_state from public.charges where id = $1", [C])).refund_state === "aguardando_autorizacao");
  conf("o pedido fica na auditoria", (await um("select count(*)::int n from public.audit_logs where entity_type = 'charge_refund' and entity_id = $1", [C])).n === 1);
  const dup = await comoPessoa(P.franqueado, "select * from public.charge_refund_check($1, 'motivo do ensaio')", [C]);
  conf("não deixa pedir de novo com um pedido pendente", typeof dup === "string" && /REFUND_PENDING/.test(dup));
  await c.query("update public.charge_refunds set requested_at = now() - interval '5 days' where charge_id = $1", [C]);
  const aberto = (await todos("select * from public._charge_refunds_open()")).find((x) => x.charge_id === C);
  conf("pedido parado há mais de 1 dia útil aparece como atrasado", aberto?.late === true);
  await c.query("select public._charge_refund_late($1)", [C]);
  await c.query("select public._charge_refund_late($1)", [C]);
  conf("o aviso do pedido parado vai a quem pediu, uma vez só", (await um("select count(*)::int n from public.notifications where user_id = $1 and title = 'Estorno parado no Asaas'", [P.franqueado])).n === 1);

  await evento("PAYMENT_REFUND_DENIED", { payment: { id: pidC, externalReference: C } });
  const neg = await um("select refund_state, status from public.charges where id = $1", [C]);
  conf("estorno negado: volta para 'Paga' (sem estorno pendente)", neg.refund_state === null && ["paga", "liquidada"].includes(neg.status));
  conf("estorno negado: avisa quem pediu", (await um("select count(*)::int n from public.notifications where user_id = $1 and title = 'Estorno negado pelo Asaas'", [P.franqueado])).n >= 1);

  // Cancelado no painel (a rotina diária descobre).
  await c.query("select public._charge_refund_requested($1, $2, 'segunda tentativa de teste', 'pix', 'AWAITING_CRITICAL_ACTION_AUTHORIZATION', null)", [C, P.franqueado]);
  await c.query("select public._charge_refund_closed($1, 'cancelado', 'cancelado no Asaas')", [C]);
  conf("pedido cancelado no Asaas: volta para 'Paga' e avisa quem pediu", (await um("select refund_state from public.charges where id = $1", [C])).refund_state === null && (await um("select count(*)::int n from public.notifications where user_id = $1 and title = 'Pedido de estorno cancelado'", [P.franqueado])).n >= 1);

  // Concluído (U6, D13).
  await c.query("select public._charge_refund_requested($1, $2, 'paciente desistiu de vez', 'pix', 'DONE', null)", [C, P.franqueado]);
  const per = (await um("select date_trunc('month', public.today_br())::date::text p")).p;
  const pagarAntes = (await um("select coalesce(sum(amount_cents),0)::int s from public.payables where clinic_id = $1 and fee_period = $2 and network_fee = any($3) and status <> 'cancelada'", [ldn, per, Object.keys(TAXAS)])).s;
  const retidoC = (await um("select coalesce(sum(retained_cents),0)::int s from public.split_charges where charge_id = $1", [C])).s;
  const rr = await evento("PAYMENT_REFUNDED", { payment: { id: pidC, externalReference: C, value: parcelas[3].amount_cents / 100 } });
  conf("o aviso de estorno concluído é processado sem erro", rr !== "erro");
  conf("U6: o split da cobrança fica 'estornado'", (await todos("select status from public.charge_splits where charge_id = $1", [C])).every((x) => x.status === "estornado"));
  conf("U6: nada mais retido nesta cobrança", (await um("select coalesce(sum(retained_cents),0)::int s from public.split_charges where charge_id = $1", [C])).s === 0);
  const contraps = await um("select count(*)::int n from public.financial_entries where source_type in ('split_retained_estorno','split_retained_revenue_estorno') and source_id in (select id from public.split_charges where charge_id = $1)", [C]);
  conf("U6: o razão liquidado ganha a contrapartida (unidade recebe de volta, franqueadora devolve)", contraps.n === 8);
  const pagarDepois = (await um("select coalesce(sum(amount_cents),0)::int s from public.payables where clinic_id = $1 and fee_period = $2 and network_fee = any($3) and status <> 'cancelada'", [ldn, per, Object.keys(TAXAS)])).s;
  conf("D13: a taxa volta a ser devida na conta a pagar da unidade", retidoC > 0 && pagarDepois - pagarAntes === retidoC);
  // (Na transação desfeita o relógio não anda: os pedidos têm o mesmo horário.)
  const fim = await um("select count(*) filter (where r.status = 'concluido')::int conc, count(*) filter (where r.status = 'pedido')::int ped, max(c.refund_state) st from public.charge_refunds r join public.charges c on c.id = r.charge_id where r.charge_id = $1", [C]);
  conf("o pedido fica 'concluído' e a cobrança sem estorno pendente", fim.conc === 1 && fim.ped === 0 && fim.st === null);

  // --- 8b) o ESTORNO DE BOLETO e o celular do pagador (18.7.7) ---------------------
  const E = await emitida(parcelas[5], 6);
  await c.query("update public.charges set billing_type = 'BOLETO' where id = $1", [E]);
  const cliE = (await um("select client_id, (select cpf from public.clients where id = client_id) cpf from public.charges where id = $1", [E]));
  const cusE = (await um("select public._gateway_customer_save($1, $2, 'cus_ensaio_4009', 'client', $3, null) id", [conta.id, String(cliE.cpf ?? "").replace(/D/g, "") || "12345678909", cliE.client_id])).id;
  await c.query("update public.charges set gateway_customer_id = $2, status = 'liquidada' where id = $1", [E, cusE]);
  await c.query("update public.clients set phone = '(43) 3333-4444' where id = $1", [cliE.client_id]);
  await c.query("update public.client_guardians set is_financial = false where client_id = $1", [cliE.client_id]).catch(() => {});
  await c.query("update public.gateway_notification_settings set privacy_declared_at = null where id");
  const semTermo = await comoPessoa(P.franqueado, "select * from public.charge_refund_check($1, 'estorno de boleto do ensaio')", [E]);
  conf("boleto: sem o termo declarado, o estorno não sai pelo riSZon", typeof semTermo === "string" && /PRIVACY_NOT_DECLARED/.test(semTermo));
  await c.query("update public.gateway_notification_settings set privacy_declared_at = now() where id");
  const semCel = await comoPessoa(P.franqueado, "select * from public.charge_refund_check($1, 'estorno de boleto do ensaio')", [E]);
  conf("boleto: sem celular válido na ficha (só fixo), o estorno não sai", typeof semCel === "string" && /NO_MOBILE/.test(semCel));
  const fichaSem = await comoPessoa(P.franqueado, "select public.charge_split_history($1) r", [E]);
  conf("boleto: a ficha mostra que falta o celular", Array.isArray(fichaSem) && fichaSem[0].r.boleto && fichaSem[0].r.boleto.celular === null);
  await c.query("update public.clients set phone = '(43) 99876-5432', email = null where id = $1", [cliE.client_id]);
  const semEmail = await comoPessoa(P.franqueado, "select * from public.charge_refund_check($1, 'estorno de boleto do ensaio')", [E]);
  conf("boleto: com celular e SEM e-mail, não sai (o Asaas exige os dois)", typeof semEmail === "string" && /NO_EMAIL/.test(semEmail));
  await c.query("update public.clients set email = 'pagador.ensaio@example.com' where id = $1", [cliE.client_id]);
  conf("boleto: com celular, e-mail e termo, o estorno pode sair", Array.isArray(await comoPessoa(P.franqueado, "select * from public.charge_refund_check($1, 'estorno de boleto do ensaio')", [E])));
  const fichaCom = await comoPessoa(P.franqueado, "select public.charge_split_history($1) r", [E]);
  conf("boleto: a ficha mostra o número e o e-mail que irão ao Asaas, antes de confirmar", Array.isArray(fichaCom) && fichaCom[0].r.boleto?.celular === "43998765432" && fichaCom[0].r.boleto?.email === "pagador.ensaio@example.com");
  conf("boleto: quem não pode pedir não recebe o número", (await comoPessoa(P.recepcao, "select public.charge_split_history($1) r", [E])) === "recusado" || (await comoPessoa(P.recepcao, "select public.charge_split_history($1) r", [E]))[0]?.r?.boleto == null);
  const pg = await um("select * from public._charge_refund_payer($1)", [E]);
  conf("o pagador é lido com os avisos como estão (desligados neste pagador)", pg.avisos_ligados === false && pg.asaas_customer_id === "cus_ensaio_4009");
  await c.query("select public._charge_refund_requested($1, $2, 'estorno de boleto do ensaio', 'boleto', 'AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION', 'https://sandbox.asaas.com/link')", [E, P.franqueado]);
  await c.query("select public._charge_refund_mobile_sent($1, $2)", [E, P.franqueado]);
  conf("boleto: a cobrança fica 'aguardando o pagador'", (await um("select refund_state from public.charges where id = $1", [E])).refund_state === "aguardando_pagador");
  const aud = await todos("select details::text d from public.audit_logs where entity_type = 'charge_refund_mobile' and entity_id = $1", [E]);
  conf("auditoria: registra que celular e e-mail foram enviados, por quem e quando — SEM o número e SEM o e-mail", aud.length === 1 && !aud[0].d.includes("99876") && !aud[0].d.includes("98765") && !aud[0].d.includes("pagador.ensaio"));
  // Régua da unidade LIGADA: o celular fica (não entra na limpeza).
  await c.query("insert into public.gateway_notification_units (clinic_id, enabled) values ($1, true) on conflict (clinic_id) do update set enabled = true", [ldn]);
  await c.query("select public._charge_refund_closed($1, 'negado', 'negado pelo Asaas (ensaio)')", [E]);
  conf("régua ligada: o celular fica no Asaas (sem limpeza)", !(await todos("select * from public._charge_refund_mobiles_to_clear()")).some((x) => x.asaas_customer_id === "cus_ensaio_4009"));
  // Régua DESLIGADA: entra na limpeza; apagado, fica na auditoria.
  await c.query("update public.gateway_notification_units set enabled = false where clinic_id = $1", [ldn]);
  await c.query("select public._charge_refund_requested($1, $2, 'segundo estorno de boleto do ensaio', 'boleto', 'AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION', 'https://sandbox.asaas.com/link2')", [E, P.franqueado]);
  await c.query("select public._charge_refund_mobile_sent($1, $2)", [E, P.franqueado]);
  await c.query("select public._charge_refund_closed($1, 'cancelado', 'cancelado no Asaas (ensaio)')", [E]);
  const limpar = (await todos("select * from public._charge_refund_mobiles_to_clear()")).find((x) => x.asaas_customer_id === "cus_ensaio_4009");
  conf("régua desligada: o celular entra na limpeza quando o estorno termina", !!limpar);
  await c.query("select public._charge_refund_mobile_cleared($1)", [limpar.refund_id]);
  conf("apagado: sai da limpeza e fica na auditoria (sem o número)", !(await todos("select * from public._charge_refund_mobiles_to_clear()")).some((x) => x.asaas_customer_id === "cus_ensaio_4009") && (await um("select count(*)::int n from public.audit_logs where entity_type = 'charge_refund_mobile' and entity_id = $1 and details::text like '%apagado%'", [E])).n === 1);

  // --- 9) saldo e webhook --------------------------------------------------------
  conf("a conta que recebeu o split entra na conferência de saldo", (await todos("select * from public._gateway_split_balance_accounts()")).some((x) => x.account_id === raiz.id));
  await c.query("update public.gateway_split_settings set min_balance_cents = 10000 where id");
  conf("o saldo mínimo da rede chega à conferência da franqueadora", Number((await todos("select * from public._gateway_split_balance_accounts()")).find((x) => x.account_id === raiz.id)?.min_balance_cents) === 10000);
  await c.query("update public.gateway_accounts set webhook_id = coalesce(webhook_id, 'wh_ensaio'), webhook_token_secret_id = coalesce(webhook_token_secret_id, gen_random_uuid()), webhook_events_version = 1, webhook_events_ok = true, webhook_events_checked_at = now() where id = $1", [conta.id]);
  conf("versão nova da lista de avisos: a conta entra na conferência do webhook", (await todos("select * from public._gateway_webhook_accounts(2)")).some((x) => x.account_id === conta.id));
  await c.query("select public._gateway_webhook_events_mark($1, false, 2)", [conta.id]);
  conf("webhook desatualizado derruba a prontidão da unidade", (await um("select ok from public._central_readiness_raw($1) where item = 'webhook_ativo'", [ldn])).ok === false);
  await c.query("select public._gateway_webhook_events_mark($1, true, 2)", [conta.id]);
  conf("corrigido: a prontidão volta e a conta sai da conferência", (await um("select ok from public._central_readiness_raw($1) where item = 'webhook_ativo'", [ldn])).ok === true && !(await todos("select * from public._gateway_webhook_accounts(2)")).some((x) => x.account_id === conta.id));

  // --- 10) as portas -------------------------------------------------------------
  const ger = await comoPessoa(P.gerente, "select public.gateway_split_unit_overview($1) r", [ldn]);
  conf("o Gerente vê o retrato do split da própria unidade", Array.isArray(ger) && typeof ger[0].r.naFila === "number");
  conf("a Recepcionista não vê o retrato", (await comoPessoa(P.recepcao, "select public.gateway_split_unit_overview($1)", [ldn])) === "recusado");
  conf("o Gerente não roda 'Atualizar agora'", (await comoPessoa(P.gerente, "select public.gateway_split_run_check($1)", [ldn])) === "recusado");
  conf("o Financeiro roda 'Atualizar agora'", Array.isArray(await comoPessoa(P.financeiro, "select public.gateway_split_run_check($1)", [ldn])));
  conf("o Gerente não muda o saldo mínimo", (await comoPessoa(P.gerente, "select public.gateway_split_min_balance_set(1)")) === "recusado");
  const histF = await comoPessoa(P.gerente, "select public.charge_split_history($1) r", [A]);
  conf("o histórico do split aparece na ficha para quem vê o financeiro", Array.isArray(histF) && histF[0].r.updates.length === 1);
  const internas = [
    "_gateway_split_enqueue(uuid,text)", "_gateway_split_queue(integer,uuid)", "_gateway_split_done(uuid,text,jsonb,jsonb,text[],timestamp with time zone,text,uuid)",
    "_charge_refund_requested(uuid,uuid,text,text,text,text)", "_charge_refund_closed(uuid,text,text)", "_gateway_split_refunded(uuid)",
    "_charge_refunds_open()", "_charge_refund_late(uuid)", "_gateway_split_balance_accounts()", "_gateway_webhook_accounts(integer)",
    "_gateway_webhook_events_mark(uuid,boolean,integer)", "_gateway_split_log_run(uuid,uuid,integer,integer)", "_charge_split_inputs(uuid)",
    "_charge_refund_payer(uuid)", "_charge_refund_mobile_sent(uuid,uuid)", "_charge_refund_mark_mobile_clear(uuid)",
    "_charge_refund_mobiles_to_clear()", "_charge_refund_mobile_cleared(uuid)",
  ];
  let fechadas = 0;
  for (const fn of internas) {
    const r = await um("select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n", [`public.${fn}`]);
    if (!r.a && !r.n) fechadas++;
    else console.log("   aberta:", fn);
  }
  conf(`as ${internas.length} funções internas estão fechadas`, fechadas === internas.length);
  const portas = ["gateway_split_unit_overview(uuid)", "gateway_split_run_check(uuid)", "gateway_split_zero_confirm(uuid,text)", "gateway_refund_roles_set(uuid,text[])", "gateway_split_min_balance_set(bigint)", "charge_split_history(uuid)", "charge_refund_check(uuid,text)"];
  let certas = 0;
  for (const fn of portas) {
    const r = await um("select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n", [`public.${fn}`]);
    if (r.a && !r.n) certas++;
  }
  conf("as 7 portas: abertas para quem entrou, fechadas para anônimo", certas === portas.length);
  const errosEv = await um("select count(*)::int n from public.gateway_webhook_events where asaas_event_id like 'evt_e4009_%' and (result = 'erro' or error is not null)");
  conf("nenhum aviso do ensaio terminou em erro", errosEv.n === 0);
  if (errosEv.n) console.log("   ", JSON.stringify(await todos("select event, error from public.gateway_webhook_events where asaas_event_id like 'evt_e4009_%' and error is not null")));
} catch (e) {
  falha.push(`o ensaio parou: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nEnsaio da 4009 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log("  FALHOU:", f);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
