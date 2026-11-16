// ENSAIO DA 4015a (correção: venda com parcelas num acordo em aberto não é
// cancelada) no banco de TREINO, numa transação DESFEITA (rollback).
// Uso: RISARTE_TREINO_POOLER=1 node scripts/asaas-ensaio-4015a.mjs --confirmar [--quebrar=trava]
//
// PROVADO QUEBRANDO: `--quebrar=trava` tira os três gatilhos — o ensaio tem de
// reprovar (o cancelamento passa com o acordo em aberto).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/4015a_asa4_recusa_cancelar_venda_com_acordo_aberto.sql";
const QUEBRAR = (process.argv.find((a) => a.startsWith("--quebrar=")) ?? "").split("=")[1] ?? null;
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log("Grava no TREINO numa transação desfeita. Rode com --confirmar.");
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (nome, valor) => (valor ? ok : falha).push(nome);
const um = async (sql, params = []) => (await c.query(sql, params)).rows[0];
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
async function servidor(sql, params = []) {
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
const recusou = (r) => typeof r === "string" && r.includes("RENEGOTIATED_OPEN");
const passou = (r) => Array.isArray(r);

try {
  await c.query("begin");
  // As migrações antigas, rodadas de novo aqui, não conhecem as origens novas de
  // cobrança (4017 e 4018): dentro desta transação desfeita, elas ficam sem origem.
  await c.query("update public.charges set auto_origin = null where auto_origin not in ('assinatura', 'venda_direta', 'rotina', 'rodar_agora', 'restante')");
  await c.query(readFileSync(ARQ, "utf8"));
  if (QUEBRAR === "trava") {
    await c.query("drop trigger plan_cancellations_open_agreement on public.plan_cancellations");
    await c.query("drop trigger commercial_sales_open_agreement on public.commercial_sales");
    await c.query("drop trigger direct_sales_open_agreement on public.direct_sales");
    console.log("   (QUEBRADO de propósito: sem os gatilhos)");
  }

  const P = {};
  for (const k of ["admin", "gerente", "financeiro"]) {
    P[k] = (await um("select id from public.profiles where email = $1", [`${k}@example.com`]))?.id;
    if (!P[k]) throw new Error(`NÃO MEDI: falta a conta de teste ${k}.`);
  }
  // Duas vendas de plano fechadas, não canceladas, com ao menos 2 parcelas em
  // aberto sem cobrança viva (a trava da 4004 não interfere).
  const livres = `select cs.negotiation_id, n.clinic_id, n.client_id
      from public.commercial_sales cs join public.plan_negotiations n on n.id = cs.negotiation_id
     where cs.closed_at is not null and cs.cancelled_at is null and n.status <> 'cancelada'
       and not exists (select 1 from public.plan_cancellations pc where pc.negotiation_id = cs.negotiation_id and pc.status in ('rascunho','assinado'))
       and (select count(*) from public.payment_installments i
             where i.negotiation_id = cs.negotiation_id and i.status = 'em_aberto'
               and not public._installment_has_active_charge(i.id, false)) >= 2
       and public._sale_open_agreements(cs.negotiation_id, null) = '{}'
     order by cs.closed_at desc limit 2`;
  const vendas = (await c.query(livres)).rows;
  if (vendas.length < 2) throw new Error("NÃO MEDI: o treino não tem 2 vendas de plano com parcelas livres.");
  const [A, B] = vendas;
  const papel = async (k, clinic, role) => {
    await c.query("delete from public.user_clinic_roles_all where user_id = $1", [P[k]]);
    await c.query("insert into public.user_clinic_roles_all (user_id, clinic_id, role) values ($1, $2, $3)", [P[k], clinic, role]);
  };
  await papel("gerente", A.clinic_id, "unit_manager");
  const franq = (await um("select id from public.clinics where type = 'franchisor' order by created_at limit 1")).id;
  await papel("financeiro", franq, "finance_franchisor");
  const parcelas = async (neg) => (await c.query(
    `select i.id, i.amount_cents from public.payment_installments i
      where i.negotiation_id = $1 and i.status = 'em_aberto' and not public._installment_has_active_charge(i.id, false)
      order by i.due_date, i.seq limit 2`, [neg])).rows;
  const hoje = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  // 4017: salvar deixa o acordo "aguardando assinatura"; o servidor aplica na
  // assinatura. Aqui o ensaio assina (como o servidor), salvo quando espera autorização.
  const renegociar = async (quem, clientId, ids, total) => {
    const r = await pessoa(quem, "select public.save_renegotiation($1, $2::uuid[], $3::jsonb, 'ensaio 4015a', 0) id",
      [clientId, ids, JSON.stringify([{ kind: "parcela", due_date: hoje, amount_cents: total, payment_method: "pix" }])]);
    if (Array.isArray(r) && (await um("select status from public.payment_renegotiations where id = $1", [r[0].id])).status === "aguardando_assinatura") {
      await servidor("select public.renegotiation_apply_signed($1, 'zapsign', null)", [r[0].id]);
    }
    return r;
  };
  const abrir = (neg) => pessoa(P.gerente, "select public.open_plan_cancellation($1, 'ensaio 4015a', 'reevaluation', null, null) id", [neg]);

  // 1) Controle: sem acordo, o cancelamento abre.
  await papel("gerente", B.clinic_id, "unit_manager");
  const ctrl = await abrir(B.negotiation_id);
  await papel("gerente", A.clinic_id, "unit_manager");
  if (!passou(ctrl)) console.log("   controle:", ctrl);
  conf("sem acordo, o termo de cancelamento abre", passou(ctrl));
  if (passou(ctrl)) await c.query("delete from public.plan_cancellations where id = $1", [ctrl[0].id]);

  // 2) Acordo aplicado com parcela nova em aberto: recusa ao abrir.
  const pa = await parcelas(A.negotiation_id);
  const r1 = await renegociar(P.gerente, A.client_id, pa.map((x) => x.id), pa.reduce((s, x) => s + Number(x.amount_cents), 0));
  if (!passou(r1)) throw new Error(`NÃO MEDI: a renegociação não salvou: ${r1}`);
  const rid = r1[0].id;
  const st = await um("select status, code from public.payment_renegotiations where id = $1", [rid]);
  conf("o acordo foi aplicado (cenário)", st.status === "aplicada");
  const r2 = await abrir(A.negotiation_id);
  conf("acordo em aberto: abrir o termo é recusado (RENEGOTIATED_OPEN)", recusou(r2));
  conf("a recusa diz o código do acordo", typeof r2 === "string" && (!st.code || r2.includes(st.code)));

  // 3) Efetivar por qualquer caminho (termo aberto antes da correção): recusa.
  const r3 = await servidor("update public.commercial_sales set cancelled_at = now() where negotiation_id = $1 returning 1", [A.negotiation_id]);
  conf("efetivar (cancelled_at) com acordo em aberto é recusado", recusou(r3));

  // 4) A porta de exceção (a 19.28.12 vai usá-la): com a marca, passa.
  await c.query("savepoint x");
  await c.query("select set_config('risarte.cancelar_com_acordo', '1', true)");
  const r4 = await servidor("update public.commercial_sales set cancelled_at = now() where negotiation_id = $1 returning 1", [A.negotiation_id]);
  conf("com a marca da porta de exceção, passa", passou(r4));
  await c.query("rollback to savepoint x");
  await c.query("select set_config('risarte.cancelar_com_acordo', '', true)");

  // 5) Cadeia: o acordo é renegociado de novo; a venda continua travada.
  const novas = (await c.query("select id, amount_cents from public.payment_installments where renegotiation_id = $1", [rid])).rows;
  const r5 = await renegociar(P.gerente, A.client_id, novas.map((x) => x.id), novas.reduce((s, x) => s + Number(x.amount_cents), 0));
  conf("acordo de acordo (cenário)", passou(r5));
  conf("acordo de acordo: a venda de origem continua travada", recusou(await abrir(A.negotiation_id)));

  // 6) Tudo pago no acordo final: a trava sai.
  if (passou(r5)) {
    await c.query("update public.payment_installments set status = 'paga' where renegotiation_id = $1", [r5[0].id]);
  }
  const r6 = await abrir(A.negotiation_id);
  conf("acordo quitado: o termo de cancelamento abre", passou(r6));

  // 7) Renegociação esperando autorização (desconto dado pelo Financeiro): recusa.
  const pb = await parcelas(B.negotiation_id);
  await papel("gerente", B.clinic_id, "unit_manager");
  const r7 = await renegociar(P.financeiro, B.client_id, pb.map((x) => x.id), Math.max(1, pb.reduce((s, x) => s + Number(x.amount_cents), 0) - 100));
  const st7 = passou(r7) ? await um("select status from public.payment_renegotiations where id = $1", [r7[0].id]) : null;
  conf("renegociação com desconto do Financeiro espera autorização (cenário)", st7?.status === "aguardando_autorizacao");
  conf("renegociação esperando autorização: abrir o termo é recusado", recusou(await abrir(B.negotiation_id)));

  // 8) Venda direta não fechada com parcela renegociada: cancelar é recusado.
  const dv = await um(
    `select s.id, s.client_id, s.clinic_id from public.direct_sales s
      where s.closed_at is null and not coalesce(s.cancelled, false)
        and exists (select 1 from public.payment_installments i where i.direct_sale_id = s.id and i.status = 'em_aberto'
                     and not public._installment_has_active_charge(i.id, false))
      order by s.created_at desc limit 1`);
  if (dv) {
    await papel("gerente", dv.clinic_id, "unit_manager");
    // 4017 (19.28.12 B): só entra parcela de venda com o contrato assinado.
    await c.query("update public.direct_sales set contract_signed = true where id = $1", [dv.id]);
    const di = (await c.query("select id, amount_cents from public.payment_installments where direct_sale_id = $1 and status = 'em_aberto' and not public._installment_has_active_charge(id, false) limit 1", [dv.id])).rows;
    const r8 = await renegociar(P.gerente, dv.client_id, di.map((x) => x.id), Number(di[0].amount_cents));
    conf("venda direta assinada, ainda não fechada, renegociada (cenário)", passou(r8));
    conf("venda direta com acordo em aberto: cancelar é recusado", recusou(await pessoa(P.gerente, "select public.cancel_direct_sale($1)", [dv.id])));
  } else {
    console.log("   (sem venda direta aberta no treino: caso 8 não medido)");
  }

  await c.query("rollback");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
for (const n of ok) console.log("  ok  ", n);
for (const n of falha) console.log("  FALHA", n);
console.log(`\n${ok.length}/${ok.length + falha.length}${QUEBRAR ? ` (quebrado: ${QUEBRAR})` : ""}`);
if (falha.length) process.exitCode = 1;
