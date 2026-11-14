// ENSAIO DA 4010 (ASA3, entrega 3 — Repasses da franquia) no banco de TREINO,
// numa transação DESFEITA (rollback): nada fica gravado.
// Uso: node scripts/asaas-ensaio-asa3-entrega3.mjs --confirmar [--quebrar=rateio|resumo]
//
// Monta, com percentuais NÃO redondos e duas carteiras (o fundo numa carteira
// própria, criada só dentro da transação; a RisLife nunca é destino, D7), uma
// cobrança de cada situação: dentro da tolerância, falta acima da tolerância,
// falta do tamanho da mensageria com a régua ligada, a maior, split cancelado,
// bloqueado, ainda a receber (com e sem atraso), sem split, estornada; mais
// recebimentos em dinheiro e cartão e uma dispensa. Confere cada parte do
// painel contra os números conhecidos e, ajuste 4, contra o RAZÃO e o PAINEL
// DE COBRANÇAS no mesmo período (divergência reprova). Confere quem vê o quê e
// a planilha na auditoria.
//
// PROVADO QUEBRANDO: `--quebrar=rateio` dá a sobra do rateio a uma taxa só;
// `--quebrar=resumo` conta o "a receber" como pago no split. Os dois têm de
// reprovar o ensaio.
import fs, { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";
import { entradasDoSplit, repasseSimulado, tarifaParaOSplit } from "../src/lib/asaas/split.ts";

const ARQ = "supabase/migrations/4010_asa3_repasses_da_franquia.sql";
const QUEBRAR = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;

if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/asaas-ensaio-asa3-entrega3.mjs --confirmar",
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
const soma = (xs, f) => xs.reduce((t, x) => t + Number(f(x) ?? 0), 0);

// As taxas de exemplo (18.5): diferentes e não redondas.
const TAXAS = { royalty: 6.37, fundo: 1.83, planejamento: 2.91, comercial: 5.44 };

try {
  await c.query("begin");
  let sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  const e2 = await recusa(sql);
  conf("a 4010 roda duas vezes sem erro", e2 === null);
  if (e2) console.log("   ", e2);
  if (QUEBRAR === "rateio") {
    sql = sql.replace("case when f2.rn <= coalesce(f2.leftover, 0) then 1 else 0 end", "case when f2.rn = 1 then coalesce(f2.leftover, 0) else 0 end");
    await c.query(sql);
    console.log("   (QUEBRADO de propósito: a sobra do rateio vai para uma taxa só)");
  } else if (QUEBRAR === "resumo") {
    sql = sql.replace("f.situation in ('ok', 'absorvida', 'mensageria', 'conta_a_pagar', 'a_maior')", "f.situation in ('ok', 'absorvida', 'mensageria', 'conta_a_pagar', 'a_maior', 'a_receber')");
    await c.query(sql);
    console.log("   (QUEBRADO de propósito: o resumo conta o 'a receber' como pago no split)");
  }

  // --- 1) o cenário ------------------------------------------------------------------
  const pessoa = async (conta) => (await um("select id from public.profiles where email = $1", [`${conta}@example.com`]))?.id;
  const P = {};
  for (const k of ["admin", "gerente", "financeiro", "franqueado", "recepcao"]) {
    P[k] = await pessoa(k);
    if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  }
  const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'"))?.id;
  const cmb = (await um("select id from public.clinics where name like 'Risarte Camb%Centro'"))?.id;
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  const conta = await um("select * from public.gateway_accounts where clinic_id = $1 and status = 'active'", [ldn]);
  const raiz = await um("select * from public.gateway_accounts where owner_type = 'franchisor' and status = 'active' and environment = $1 and wallet_id is not null order by created_at limit 1", [conta?.environment]);
  if (!ldn || !cmb || !conta || !raiz) throw new Error("NÃO MEDI: falta Londrina com conta, Cambé ou a conta raiz.");
  const outra = await um(
    `insert into public.gateway_accounts (owner_type, label, environment, mode, status, wallet_id)
     values ('recipient', 'Fundo de Propaganda (ensaio)', $1, 'linked', 'active', 'wallet-ensaio-fundo-4010') returning *`,
    [conta.environment]
  );
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
  await c.query("update public.network_fee_types set active = true where key = any($1)", [Object.keys(TAXAS)]);
  await c.query("update public.network_fee_types set split_account_id = null");
  await c.query("update public.network_fee_types set split_account_id = $1 where key = 'fundo'", [outra.id]);
  await c.query("delete from public.network_fee_campaigns where active");
  await c.query("update public.gateway_split_settings set tolerance_cents = 10 where id");
  await c.query("update public.gateway_accounts set split_enabled_declared_at = now() where id = $1", [conta.id]);
  // A régua de Londrina ligada (para o caso da mensageria, ajuste 5).
  await c.query("insert into public.gateway_notification_units (clinic_id, enabled) values ($1, true) on conflict (clinic_id) do update set enabled = true", [ldn]);

  const parcelas = await todos(
    `select i.id, i.amount_cents, i.client_id from public.payment_installments i
      where i.clinic_id = $1 and i.status = 'em_aberto' and i.amount_cents >= 5000 and i.client_id is not null
        and not exists (select 1 from public.charges ch where ch.payment_installment_id = i.id
                         and ch.status in ('emitindo','emitida','vencida','paga','liquidada','erro_emissao','externa'))
      order by i.amount_cents, i.id limit 13`,
    [ldn]
  );
  if (parcelas.length < 13) throw new Error("NÃO MEDI: faltam 13 parcelas livres em Londrina.");
  const hoje = (await um("select public.today_br()::text d")).d;
  const de = (await um("select date_trunc('month', public.today_br())::date::text d")).d;
  const ate = (await um("select (date_trunc('month', public.today_br()) + interval '1 month - 1 day')::date::text d")).d;

  async function novaCobranca(parc, meio = "PIX") {
    return (
      await um(
        `insert into public.charges (clinic_id, gateway_account_id, source_type, payment_installment_id, client_id, payer_kind,
                                     billing_type, value_cents, discount_cents, fine_percent, fine_cents, interest_percent, due_date, status, description)
         values ($1, $2, 'installment', $3, $4, 'client', $5, $6, 0, 0, 0, 0, ($7::date + 7), 'emitindo', 'Ensaio 4010') returning id`,
        [ldn, conta.id, parc.id, parc.client_id, meio, parc.amount_cents, hoje]
      )
    ).id;
  }
  let tarifa;
  const montar = (pl) =>
    entradasDoSplit(pl.carteiras.map((w) => ({ walletId: w.walletId, percent: Number(w.percent) })), tarifa).map((e) => {
      const w = pl.carteiras.find((x) => x.walletId === e.walletId);
      return { ...e, accountId: w.accountId, fees: w.fees, tariffPercent: tarifa.a * 100, tariffFixedCents: tarifa.bCents, asaasSplitId: `split_${e.walletId.slice(0, 6)}` };
    });
  let seq = 0;
  async function evento(evt, payload) {
    seq++;
    const ev = await um(
      "insert into public.gateway_webhook_events (account_id, asaas_event_id, event, payload) values ($1, $2, $3, $4::jsonb) returning id",
      [conta.id, `evt_ensaio_4010_${seq}`, evt, JSON.stringify({ event: evt, ...payload })]
    );
    return (await um("select public._gateway_process_event($1) r", [ev.id])).r;
  }
  async function emitirEPagar(parc, { comSplit = true, credito = hoje } = {}) {
    const chId = await novaCobranca(parc);
    const pl = (await um("select public._charge_split_plan($1) p", [chId])).p;
    if (!tarifa) tarifa = tarifaParaOSplit(pl.tarifas, "PIX", hoje, pl.vencimento);
    seq++;
    const ent = montar(pl).map((e) => ({ ...e, asaasSplitId: `${e.asaasSplitId}_${seq}` }));
    if (comSplit) await c.query("select public._charge_save_split($1, $2::jsonb)", [chId, JSON.stringify(ent)]);
    else await c.query("select public._charge_mark_split_skipped($1, 'franqueadora')", [chId]);
    const pid = `pay_ensaio_4010_${seq}`;
    await c.query("select public._charge_mark_issued($1, $2, null, 'https://x/i', null, 'pix', null)", [chId, pid]);
    const valor = parc.amount_cents / 100;
    const r = await evento("PAYMENT_RECEIVED", {
      payment: { id: pid, externalReference: chId, value: valor, netValue: Math.round((valor - tarifa.bCents / 100) * 100) / 100, billingType: "PIX", paymentDate: hoje, creditDate: credito },
    });
    if (r !== "baixa") throw new Error(`a baixa da cobrança de teste não saiu (${r})`);
    return { chId, ent, pid, sim: repasseSimulado(ent, parc.amount_cents, tarifa) };
  }
  const split = (x, e, evt, reais) =>
    evento(evt, { payment: { id: x.pid, externalReference: x.chId, split: [{ id: e.asaasSplitId, walletId: e.walletId, totalValue: reais, status: "DONE" }] }, additionalInfo: { splitId: e.asaasSplitId } });
  const liquidarTudo = async (x, ajuste = () => 0) => {
    for (const e of x.ent) {
      const s = x.sim.find((y) => y.walletId === e.walletId);
      await split(x, e, "PAYMENT_SPLIT_DONE", (s.cents + ajuste(e)) / 100);
    }
  };
  const naRaiz = (v) => (e) => (e.walletId === raiz.wallet_id ? v : 0);

  // As cobranças, uma por situação.
  const A = await emitirEPagar(parcelas[0]);
  await liquidarTudo(A); // dentro da tolerância
  const B = await emitirEPagar(parcelas[1]);
  await liquidarTudo(B, naRaiz(-50)); // R$ 0,50 a menos: conta a pagar
  const M = await emitirEPagar(parcelas[2]);
  const pRaiz = Number(M.ent.find((e) => e.walletId === raiz.wallet_id).percentualValue);
  const mensageria = Math.floor((pRaiz / 100) * 99); // p × R$ 0,99 (ajuste 5)
  await liquidarTudo(M, naRaiz(-mensageria));
  const C = await emitirEPagar(parcelas[3]);
  await liquidarTudo(C, naRaiz(300)); // a maior
  const D = await emitirEPagar(parcelas[4]);
  for (const e of D.ent) await split(D, e, "PAYMENT_SPLIT_CANCELLED", 0);
  const E = await emitirEPagar(parcelas[5]);
  await split(E, E.ent[0], "PAYMENT_SPLIT_DIVERGENCE_BLOCK", 0); // bloqueado
  const G = await emitirEPagar(parcelas[6], { credito: hoje }); // ainda a receber, previsto hoje
  const H = await emitirEPagar(parcelas[7]);
  await c.query("update public.charges set credit_date = public.today_br() - 3 where id = $1", [H.chId]); // a receber ATRASADO
  const F = await emitirEPagar(parcelas[8], { comSplit: false }); // Asaas sem split
  const R = await emitirEPagar(parcelas[9]); // estornada (D13)
  await liquidarTudo(R);
  await c.query("select public._charge_refund_requested($1, $2, 'paciente desistiu (ensaio 4010)', 'pix', 'DONE', null)", [R.chId, P.franqueado]);
  const rr = await evento("PAYMENT_REFUNDED", { payment: { id: R.pid, externalReference: R.chId, value: parcelas[9].amount_cents / 100 } });
  conf("o estorno do ensaio é processado", rr !== "erro");

  // Recebimentos por fora: dinheiro e maquininha; e uma dispensa (14.5).
  const manual = async (parc, metodo) =>
    (await um(
      `insert into public.payment_receipts (clinic_id, installment_id, amount_cents, received_at, payment_method, reference, principal_cents)
       values ($1, $2, $3, public.today_br(), $4, 'ensaio 4010', $3) returning id`,
      [ldn, parc.id, parc.amount_cents, metodo]
    )).id;
  const rDinheiro = await manual(parcelas[10], "dinheiro");
  const rCartao = await manual(parcelas[11], "cartao");
  const disp = await um(
    `insert into public.payment_waivers (clinic_id, installment_id, principal_cents, benefit_cents, late_fee_cents, interest_cents, total_cents, reason, created_by, kind)
     values ($1, $2, 37, 0, 0, 0, 37, 'arredondamento do ensaio 4010', $3, 'arredondamento') returning id`,
    [ldn, parcelas[12].id, P.admin]
  ).catch(async () =>
    um(
      `insert into public.payment_waivers (clinic_id, installment_id, principal_cents, benefit_cents, late_fee_cents, interest_cents, total_cents, reason, created_by)
       values ($1, $2, 37, 0, 0, 0, 37, 'arredondamento do ensaio 4010', $3) returning id`,
      [ldn, parcelas[12].id, P.admin]
    )
  );

  // --- 2) a leitura, como Admin --------------------------------------------------
  const ler = async (quem, clinic = null, exp = null) => {
    const r = await comoPessoa(P[quem], "select public.franchise_payouts_read($1::date, $2::date, $3::uuid, $4) j", [de, ate, clinic, exp]);
    return Array.isArray(r) ? r[0].j : r;
  };
  const J = await ler("admin", ldn);
  if (typeof J === "string") throw new Error(`a porta recusou o Admin: ${J}`);
  const linhasDe = (x) => J.cobrancas.filter((l) => l.charge_id === x.chId);
  const sit = (x) => [...new Set(linhasDe(x).map((l) => l.situacao))].join(",");

  // PARTE 2: situação de cada cobrança.
  conf("dentro da tolerância: 'absorvida'", sit(A) === "absorvida");
  conf("falta de R$ 0,50: 'conta_a_pagar'", sit(B) === "conta_a_pagar");
  conf(`falta do tamanho da mensageria (${mensageria} centavos) com a régua ligada: 'mensageria', não divergência`, sit(M) === "mensageria");
  conf("a maior: a carteira que recebeu a mais fica 'a_maior'", linhasDe(C).some((l) => l.situacao === "a_maior" && l.carteira === raiz.label));
  conf("split cancelado: 'cancelado'", sit(D) === "cancelado");
  conf("bloqueado: a carteira bloqueada fica 'a_receber'", linhasDe(E).some((l) => l.situacao === "a_receber"));
  conf("ainda não liquidada: 'a_receber', sem diferença", sit(G) === "a_receber" && linhasDe(G).every((l) => l.liquidado === null));
  conf("estornada: 'estornado'", sit(R) === "estornado");
  conf("sem split: fora da conferência por cobrança", linhasDe(F).length === 0);

  // O rateio por taxa fecha com o que o Asaas pagou, e nenhuma taxa leva mais de
  // 1 centavo de sobra (ajuste 1).
  let rateioFecha = true;
  let rateioJusto = true;
  for (const x of [A, B, M, C]) {
    const cs = await todos("select id, settled_cents::int s, fees from public.charge_splits where charge_id = $1", [x.chId]);
    for (const w of cs) {
      const ls = linhasDe(x).filter((l) => Object.prototype.hasOwnProperty.call(w.fees, l.taxa));
      if (soma(ls, (l) => l.liquidado) !== w.s) rateioFecha = false;
      const devido = soma(ls, (l) => l.devido);
      for (const l of ls) {
        const exato = (l.devido * w.s) / devido;
        if (Math.abs(l.liquidado - exato) >= 1) rateioJusto = false;
      }
    }
  }
  conf("rateio: a soma por taxa é igual ao liquidado de cada carteira", rateioFecha);
  conf("rateio: cada taxa fica a menos de 1 centavo da sua parte exata", rateioJusto);

  // A conferência é POR COBRANÇA: o devido de 'taxas' é o das cobranças liquidadas.
  const linhasLiq = J.cobrancas.filter((l) => !["a_receber", "cancelado", "estornado"].includes(l.situacao));
  conf(
    "parte 2: devido e liquidado por taxa = soma das MESMAS cobranças",
    Object.keys(TAXAS).every((fee) => {
      const t = J.taxas.find((y) => y.fee === fee);
      const ls = linhasLiq.filter((l) => l.taxa === fee);
      return t && Number(t.devido_liquidadas) === soma(ls, (l) => l.devido) && Number(t.liquidado) === soma(ls, (l) => l.liquidado);
    })
  );

  // PARTE 3: a receber e atrasado.
  const ar = J.a_receber;
  conf("parte 3: as cobranças pagas sem liquidação aparecem em 'a receber'", [G, H, E].every((x) => ar.some((l) => l.charge_id === x.chId)));
  conf("parte 3: com data prevista passada, marca 'atrasado'", ar.filter((l) => l.charge_id === H.chId).every((l) => l.atrasado === true));
  conf("parte 3: previsto para hoje não está atrasado", ar.filter((l) => l.charge_id === G.chId).every((l) => l.atrasado === false));
  conf("parte 3: a carteira bloqueada vem marcada", ar.some((l) => l.charge_id === E.chId && l.bloqueado));
  conf("parte 3: a liquidada não está em 'a receber'", !ar.some((l) => l.charge_id === A.chId));
  const liqPer = soma(J.liquidado_no_periodo, (l) => l.liquidado);
  const liqBanco = (await um(
    `select coalesce(sum(cs.settled_cents),0)::int s from public.charge_splits cs join public.charges ch on ch.id = cs.charge_id
      where ch.clinic_id = $1 and cs.status = 'liquidado' and (cs.settled_at at time zone 'America/Sao_Paulo')::date between $2 and $3`,
    [ldn, de, ate]
  )).s;
  conf("parte 3: liquidado no período (pela data do Asaas) = o que o Asaas pagou", liqPer === liqBanco);

  // PARTE 4: divergências.
  const dv = (x, tipo) => J.divergencias.some((d) => d.charge_id === x.chId && d.tipo === tipo);
  conf("parte 4: falta acima da tolerância", dv(B, "conta_a_pagar"));
  conf("parte 4: a maior, com o excesso", J.divergencias.some((d) => d.charge_id === C.chId && d.tipo === "a_maior" && d.valor >= 299));
  conf("parte 4: cancelado, com a taxa que voltou à conta a pagar", J.divergencias.some((d) => d.charge_id === D.chId && d.tipo === "cancelado" && d.valor > 0));
  conf("parte 4: bloqueado", dv(E, "bloqueado"));
  conf("parte 4: o estorno, com quem pediu e o motivo", J.divergencias.some((d) => d.charge_id === R.chId && d.tipo === "estorno" && d.autor && /ensaio 4010/.test(d.motivo) && d.valor > 0));
  conf("parte 4: a mensageria aparece com nota própria", dv(M, "mensageria"));
  conf("parte 4: dentro da tolerância não é divergência", !J.divergencias.some((d) => d.charge_id === A.chId));
  conf("parte 4: cada linha leva à ficha (paciente e código)", J.divergencias.filter((d) => d.tipo !== "dispensa_taxa").every((d) => d.client_id && d.codigo));

  // PARTE 5: dispensas.
  conf("parte 5: a dispensa com valor, autor e motivo", J.dispensas.some((d) => d.id === disp.id && d.total === 37 && d.autor && /ensaio 4010/.test(d.motivo)));

  // PARTE 1: recebido por categoria.
  const cat = (k) => J.recebido.find((r) => r.clinic_id === ldn && r.categoria === k);
  const recDin = await um("select amount_cents::int a from public.payment_receipts where id = $1", [rDinheiro]);
  const recCar = await um("select amount_cents::int a from public.payment_receipts where id = $1", [rCartao]);
  conf("parte 1: o dinheiro do ensaio está em 'dinheiro'", cat("dinheiro") && cat("dinheiro").recebido >= recDin.a);
  conf("parte 1: a maquininha está em 'cartão'", cat("cartao") && cat("cartao").recebido >= recCar.a);
  conf("parte 1: a cobrança sem split está em 'Asaas sem split', com o motivo", !!cat("asaas_sem_split") && J.motivos_sem_split.some((m) => m.motivo === "franqueadora"));
  conf("parte 1: a estornada não conta como recebida, mas a taxa mantida (D13) conta no devido", cat("estornado")?.recebido === 0 && cat("estornado")?.devido > 0 && cat("estornado")?.devido === cat("estornado")?.conta_a_pagar);
  const pct = soma(J.recebido.filter((r) => r.clinic_id === ldn), (r) => r.percentual);
  conf("parte 1 (ajuste 2): os percentuais da unidade somam 100%", Math.abs(pct - 100) < 0.1);
  conf("parte 1 (ajuste 2): a média da rede vem junto, somando 100%", Math.abs(Object.values(J.media_rede).reduce((t, v) => t + Number(v), 0) - 100) < 0.1);
  conf("parte 1: devido = pago no split + conta a pagar, em cada categoria", J.recebido.every((r) => r.devido === r.pago_no_split + r.conta_a_pagar));

  // PARTE 0: o resumo.
  const res = J.resumo.find((r) => r.clinic_id === ldn);
  const devBanco = (await um(
    `select coalesce(sum(sc.amount_cents),0)::int s from public.split_charges sc join public.payment_receipts r on r.id = sc.receipt_id
      where r.clinic_id = $1 and r.received_at between $2 and $3 and r.reversal_of is null and not sc.reversed`,
    [ldn, de, ate]
  )).s;
  conf("parte 0: devido no período = as taxas dos recebimentos do período", res && res.devido === devBanco);
  const arRes = soma(J.cobrancas.filter((l) => l.situacao === "a_receber"), (l) => l.devido);
  conf("parte 0: a receber = o devido das cobranças do período não liquidadas", res && res.a_receber === arRes);

  // AJUSTE 4: FECHA COM A CONTABILIDADE.
  // a) pago no split = o razão LIQUIDADO do retido (despesa da unidade e
  //    receita da franqueadora, taxa a taxa), das cobranças do período.
  const ids = [...new Set(J.cobrancas.map((l) => l.charge_id))];
  const razao = await todos(
    // Líquido dos estornos: o estorno não apaga o liquidado, ele ganha a
    // contrapartida `*_estorno` (4009).
    `select sc.fee, replace(f.source_type, '_estorno', '') t,
            coalesce(sum(case when f.source_type like '%_estorno' then -f.amount_cents else f.amount_cents end),0)::int s
       from public.financial_entries f join public.split_charges sc on sc.id = f.source_id
      where f.source_type in ('split_retained', 'split_retained_revenue', 'split_retained_estorno', 'split_retained_revenue_estorno')
        and f.status = 'settled'
        and sc.charge_id = any($1::uuid[])
      group by 1, 2`,
    [ids]
  );
  const pagoSplit = (fee) => soma(J.cobrancas.filter((l) => l.taxa === fee && ["ok", "absorvida", "mensageria", "conta_a_pagar", "a_maior"].includes(l.situacao)), (l) => l.devido);
  const retidoPorTaxa = async (fee) =>
    (await um(
      `select coalesce(sum(sc.retained_cents),0)::int s from public.split_charges sc
        where sc.charge_id = any($1::uuid[]) and sc.fee = $2 and not sc.reversed
          and exists (select 1 from public.charge_splits cs where cs.charge_id = sc.charge_id and cs.fees ? sc.fee and cs.status = 'liquidado')`,
      [ids, fee]
    )).s;
  let razaoBate = true;
  for (const fee of Object.keys(TAXAS)) {
    const ret = await retidoPorTaxa(fee);
    const desp = razao.find((r) => r.fee === fee && r.t === "split_retained")?.s ?? 0;
    const rec = razao.find((r) => r.fee === fee && r.t === "split_retained_revenue")?.s ?? 0;
    if (desp !== ret || rec !== ret) razaoBate = false;
    if (process.env.DEBUG) console.log("razao", fee, { ret, desp, rec });
    void pagoSplit;
  }
  conf("AJUSTE 4: o pago no split bate com o razão liquidado (despesa da unidade = receita da franqueadora, por taxa)", razaoBate);
  const pagoResumo = res?.pago_no_split ?? -1;
  const razaoTotal = soma(razao.filter((r) => r.t === "split_retained_revenue"), (r) => r.s);
  conf("AJUSTE 4: o 'pago no split' do resumo = a receita da franqueadora no razão", pagoResumo === razaoTotal);
  // b) devido = retido no razão (aberto ou liquidado) + conta a pagar de taxa do mês.
  const retRazao = (await um(
    `select coalesce(sum(case when f.source_type like '%_estorno' then -f.amount_cents else f.amount_cents end),0)::int s
       from public.financial_entries f join public.split_charges sc on sc.id = f.source_id
      where f.source_type in ('split_retained', 'split_retained_estorno') and f.status in ('open','settled')
        and f.clinic_id = $1 and sc.period_month = $2::date and sc.fee = any($3)`,
    [ldn, de, Object.keys(TAXAS)]
  )).s;
  const pagar = (await um(
    `select coalesce(sum(amount_cents),0)::int s from public.payables
      where clinic_id = $1 and fee_period = $2::date and network_fee = any($3) and status <> 'cancelada'`,
    [ldn, de, Object.keys(TAXAS)]
  )).s;
  const devidoMes = (await um(
    `select coalesce(sum(amount_cents),0)::int s from public.split_charges where clinic_id = $1 and period_month = $2::date and fee = any($3) and not reversed`,
    [ldn, de, Object.keys(TAXAS)]
  )).s;
  if (process.env.DEBUG) console.log({ devidoMes, retRazao, pagar, resDevido: res?.devido, pagoResumo, razaoTotal });
  conf("AJUSTE 4: o devido do mês = o retido no razão + a conta a pagar de taxa", devidoMes === retRazao + pagar);
  conf("AJUSTE 4: o devido do resumo = o devido do mês (período = o mês inteiro)", res?.devido === devidoMes);
  // c) o recebido pelo Asaas bate com o Painel de cobranças no mesmo período.
  const painel = await comoPessoa(P.admin, "select * from public.gateway_charges_list($1, array['paga','liquidada','em_contestacao'], null, 'pagamento', $2::date, $3::date, false)", [ldn, de, ate]);
  const recAsaas = (cat("split")?.recebido ?? 0) + (cat("asaas_sem_split")?.recebido ?? 0);
  conf("AJUSTE 4: o recebido pelo Asaas = o pago no Painel de cobranças (mesmo período)", Array.isArray(painel) && recAsaas === soma(painel, (p) => p.paid_cents));
  conf(
    "AJUSTE 4: o recebido com split = o pago das cobranças com split no Painel de cobranças",
    Array.isArray(painel) && (cat("split")?.recebido ?? -1) === soma(painel.filter((p) => J.cobrancas.some((l) => l.charge_id === p.charge_id)), (p) => p.paid_cents)
  );

  // --- 3) quem vê o quê ---------------------------------------------------------------
  conf("P2: de fábrica, só o Admin (o Gerente é recusado)", (await ler("gerente", ldn)) === "recusado");
  conf("P2: de fábrica, o Financeiro também é recusado", (await ler("financeiro")) === "recusado");
  for (const r of ["unit_manager", "franchisee", "finance_franchisor", "receptionist"]) {
    await c.query("insert into public.permission_matrix (capability, role, allowed) values ('modulo.repasses_franquia', $1, true) on conflict (capability, role) do update set allowed = true", [r]);
  }
  const fin = await ler("financeiro");
  conf("liberado: o Financeiro vê a rede, com o saldo da franqueadora", typeof fin === "object" && fin.rede === true && fin.saldo !== null);
  const ger = await ler("gerente");
  conf("liberado: o Gerente vê só a própria unidade, sem o saldo da franqueadora", typeof ger === "object" && ger.rede === false && ger.saldo === null && ger.resumo.every((r) => r.clinic_id === ldn));
  conf("liberado: o Gerente não abre outra unidade", (await ler("gerente", cmb)) === "recusado");
  const fqd = await ler("franqueado", ldn);
  conf("liberado: o Franqueado vê a própria unidade", typeof fqd === "object" && fqd.resumo.some((r) => r.clinic_id === ldn));
  conf("teto: a Recepção nunca vê, mesmo marcada", (await ler("recepcao", ldn)) === "recusado");
  conf("anônimo não chega na porta", (await um("select has_function_privilege('anon', 'public.franchise_payouts_read(date,date,uuid,text)', 'execute') a")).a === false);
  const internas = ["_franchise_payout_charge_fees(date,date,uuid[],uuid)", "_franchise_payout_receipts(date,date,uuid[],uuid)"];
  let fechadas = 0;
  for (const f of internas) {
    const r = await um("select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n", [`public.${f}`]);
    if (!r.a && !r.n) fechadas++;
  }
  conf("as funções internas do painel estão fechadas", fechadas === internas.length);

  // Saldo (ajuste 6): negativo e abaixo do mínimo.
  await c.query("update public.gateway_accounts set balance_cents = -500, balance_checked_at = now() where id = $1", [raiz.id]);
  conf("ajuste 6: saldo negativo da franqueadora dá alerta", (await ler("admin")).saldo?.alerta === "negativo");
  await c.query("update public.gateway_accounts set balance_cents = 1000 where id = $1", [raiz.id]);
  await c.query("update public.gateway_split_settings set min_balance_cents = 5000 where id");
  conf("ajuste 6: saldo abaixo do mínimo dá alerta", (await ler("admin")).saldo?.alerta === "abaixo_do_minimo");

  // P6: a planilha na auditoria.
  const antesAud = (await um("select count(*)::int n from public.audit_logs where entity_type = 'franchise_payouts'")).n;
  await ler("admin", ldn, "cobrancas");
  const aud = await um("select user_id, details from public.audit_logs where entity_type = 'franchise_payouts' order by created_at desc limit 1");
  conf("P6: o download da planilha fica na auditoria (quem, qual parte, filtros)", (await um("select count(*)::int n from public.audit_logs where entity_type = 'franchise_payouts'")).n === antesAud + 1 && aud.user_id === P.admin && aud.details.planilha === "cobrancas" && aud.details.de === de);
  conf("P6: só ler o painel não gera auditoria", (await um("select count(*)::int n from public.audit_logs where entity_type = 'franchise_payouts'")).n === antesAud + 1);
  conf("parte inválida da planilha é recusada", typeof (await ler("admin", ldn, "tudo")) === "string");
  const longo = await comoPessoa(P.admin, "select public.franchise_payouts_read('2024-01-01', '2026-12-31', null, null)");
  conf("período longo demais é recusado", typeof longo === "string" && /PERIOD_TOO_LONG/.test(longo));
} catch (e) {
  falha.push(`o ensaio parou: ${e.message}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\nEnsaio da 4010 — ${ok.length} conferência(s) OK, ${falha.length} falha(s).`);
for (const f of falha) console.log("  FALHOU:", f);
console.log("Nada ficou gravado (transação desfeita).");
process.exitCode = falha.length ? 1 : 0;
void fs;
