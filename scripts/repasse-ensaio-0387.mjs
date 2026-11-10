// ENSAIO DA 0387 no banco de TREINO, numa transação DESFEITA (rollback): nada fica.
// Uso: node scripts/repasse-ensaio-0387.mjs --confirmar
//
// Prova, com os dados que o dono deixou no treino em 10/11/2026 (Londrina:
// limpeza e restauração apuradas com R$ 0,00; facetas com 1 de 3 sessões;
// itens antigos sem procedimento do catálogo), que a Etapa 1 do repasse:
// recalcula o zerado, mostra as pendências com o motivo, marca "sem repasse"
// e trava a linha fechada. Só contagens e valores na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0387_repasse_destravar_e_proteger.sql";

// O ensaio tenta ALTERAR e APAGAR linhas para provar que o banco recusa. Tudo
// corre numa transação desfeita, mas script que manda apagar pede autorização
// (OC-00088, régua `apagar-com-autorizacao.test.ts`).
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio executa UPDATE e DELETE no banco de TREINO dentro de uma",
      "transação desfeita (nada fica gravado). Para rodar:",
      "  node scripts/repasse-ensaio-0387.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}
const c = await connect();
const ok = [];
const falha = [];
const conf = (n, v) => (v ? ok : falha).push(n);

/** Roda algo que DEVE falhar e devolve a mensagem (ou null se passou). */
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
const como = async (uid) => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
};
const voltar = () => c.query("reset role");

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  const again = await c.query(sql);
  conf("aplicar duas vezes sem erro (idempotente)", true);
  const cf = (Array.isArray(again) ? again[again.length - 1] : again).rows[0];
  conf(
    "conferência 1·4·3·3·0·1",
    Number(cf.sem_repasse_no_cadastro) === 1 && Number(cf.colunas_novas_no_repasse) === 4 &&
      Number(cf.funcoes) === 3 && Number(cf.gatilhos) === 3 &&
      Number(cf.regra_de_escrita_livre) === 0 && Number(cf.sessao_restrita) === 1
  );

  for (const f of ["payout_recalculate(uuid)", "payout_recalculate_zeros(uuid)", "payout_watchlist(uuid)"]) {
    const r = await c.query(
      `select has_function_privilege('anon','public.${f}','execute') a,
              has_function_privilege('authenticated','public.${f}','execute') u`
    );
    conf(`${f}: sem login não, logado sim`, !r.rows[0].a && r.rows[0].u);
  }

  const adm = (await c.query(
    "select id from public.profiles where is_admin_master and is_active order by created_at limit 1"
  )).rows[0]?.id;
  const lon = (await c.query(
    "select id from public.clinics where name ilike 'Risarte Londrina%' limit 1"
  )).rows[0]?.id;
  if (!adm || !lon) throw new Error("NÃO MEDI: falta Admin Master ou a unidade de Londrina no treino");

  // -- 1) As pendências, com o motivo --------------------------------------
  await como(adm);
  const w = (await c.query("select * from public.payout_watchlist($1)", [lon])).rows;
  await voltar();
  const por = (k) => w.filter((r) => r.kind === k);
  console.log("pendências em Londrina:", {
    zerado: por("zerado").length,
    recalculavel: por("zerado").filter((r) => r.reason === "recalculavel").length,
    em_andamento: por("em_andamento").length,
    sem_procedimento: por("sem_procedimento").length,
    sem_profissional: por("sem_profissional").length,
  });
  const recalc = por("zerado").filter((r) => r.reason === "recalculavel");
  conf("há repasse zerado que a tabela de hoje já pagaria", recalc.length >= 1);
  conf("o zerado mostra quanto pagaria", recalc.every((r) => Number(r.would_pay_cents) > 0));
  conf("procedimento em andamento aparece com feitas/total",
    por("em_andamento").length >= 1 &&
      por("em_andamento").every((r) => r.done_count > 0 && r.done_count < r.total_count));
  conf("sessão concluída sem procedimento do catálogo aparece", por("sem_procedimento").length >= 1);

  // -- 2) Recalcular --------------------------------------------------------
  const alvo = recalc[0];
  await como(adm);
  const novo = Number((await c.query("select public.payout_recalculate($1) v", [alvo.payout_id])).rows[0].v);
  await voltar();
  const linha = (await c.query(
    "select amount_cents, units, recalculated_by, recalculated_at from public.provider_payouts where id=$1",
    [alvo.payout_id]
  )).rows[0];
  conf("recalcular grava o valor que a tela prometeu",
    novo > 0 && novo === Number(alvo.would_pay_cents) && Number(linha.amount_cents) === novo);
  conf("recalcular grava QUEM e QUANDO", linha.recalculated_by === adm && linha.recalculated_at !== null);
  const aud = await c.query(
    "select count(*)::int n from public.audit_logs where entity_type='provider_payout' and entity_id=$1",
    [alvo.payout_id]
  );
  conf("recalcular deixa registro na auditoria", aud.rows[0].n === 1);

  await como(adm);
  const e1 = await recusa("select public.payout_recalculate($1)", [alvo.payout_id]);
  await voltar();
  conf("valor diferente de zero fica congelado (PAYOUT_NOT_ZERO)", !!e1 && e1.includes("PAYOUT_NOT_ZERO"));

  await como(adm);
  const n = Number((await c.query("select public.payout_recalculate_zeros($1) n", [lon])).rows[0].n);
  const w2 = (await c.query("select * from public.payout_watchlist($1)", [lon])).rows;
  await voltar();
  conf("recalcular todos conserta o resto", n === recalc.length - 1);
  conf("depois, nenhum zerado 'recalculável' sobra",
    w2.filter((r) => r.kind === "zerado" && r.reason === "recalculavel").length === 0);

  // O bloco único (quantidade 2 numa sessão só) paga a quantidade toda.
  const unico = (await c.query(
    `select p.amount_cents, p.units,
            (select r.amount_cents from public.payout_rate_for(p.procedure_id, p.provider_id, p.clinic_id, p.accrual_date) r) rate
       from public.provider_payouts p where p.clinic_id=$1 and p.units > 1 limit 1`, [lon]
  )).rows[0];
  if (unico) conf("bloco único: valor = tabela × quantidade",
    Number(unico.amount_cents) === Number(unico.rate) * unico.units);
  else console.log("(sem linha de bloco único no treino — não medido)");

  // -- 3) Quem não é do financeiro da unidade --------------------------------
  const estranho = "00000000-0000-0000-0000-000000000001";
  await como(estranho);
  const e2 = await recusa("select * from public.payout_watchlist($1)", [lon]);
  const e3 = await recusa("select public.payout_recalculate_zeros($1)", [lon]);
  const e4 = await recusa("select public.payout_recalculate($1)", [alvo.payout_id]);
  await voltar();
  conf("estranho não lê as pendências", !!e2 && e2.includes("NOT_ALLOWED"));
  conf("estranho não recalcula", !!e3 && e3.includes("NOT_ALLOWED") && !!e4 && e4.includes("NOT_ALLOWED"));

  // -- 4) Ninguém grava direto pela API --------------------------------------
  await como(adm);
  const up = await c.query("update public.provider_payouts set amount_cents = 999999 where id=$1", [alvo.payout_id]);
  const del = await c.query("delete from public.provider_payouts where id=$1", [alvo.payout_id]);
  const ins = await recusa(
    `insert into public.provider_payouts (clinic_id, provider_id, session_id, accrual_date, amount_cents)
     select clinic_id, provider_id, session_id, accrual_date, 1 from public.provider_payouts where id=$1`,
    [alvo.payout_id]
  );
  await voltar();
  conf("Admin logado não altera a linha direto", up.rowCount === 0);
  conf("Admin logado não apaga a linha direto", del.rowCount === 0);
  conf("Admin logado não insere linha direto", !!ins);

  // -- 5) Linha em fechamento não muda nem some ------------------------------
  const fech = (await c.query(
    `insert into public.payout_closings (clinic_id, period_month, status, closed_at)
     values ($1, '2020-01-01', 'fechado', now()) returning id`, [lon]
  )).rows[0].id;
  await c.query("update public.provider_payouts set closing_id=$1 where id=$2", [fech, alvo.payout_id]);
  const e5 = await recusa("update public.provider_payouts set amount_cents=1 where id=$1", [alvo.payout_id]);
  const e6 = await recusa("delete from public.provider_payouts where id=$1", [alvo.payout_id]);
  conf("linha fechada não é alterada (PAYOUT_LOCKED)", !!e5 && e5.includes("PAYOUT_LOCKED"));
  conf("linha fechada não é apagada (PAYOUT_LOCKED)", !!e6 && e6.includes("PAYOUT_LOCKED"));
  await como(adm);
  const e7 = await recusa("select public.payout_recalculate($1)", [alvo.payout_id]);
  await voltar();
  conf("linha fechada não é recalculada", !!e7 && e7.includes("PAYOUT_LOCKED"));

  // -- 6) Apagar a sessão não apaga o repasse --------------------------------
  const aberta = (await c.query(
    "select session_id from public.provider_payouts where session_id is not null and closing_id is null limit 1"
  )).rows[0];
  const e8 = await recusa("delete from public.treatment_sessions where id=$1", [aberta.session_id]);
  conf("apagar a sessão com repasse é recusado", !!e8 && e8.startsWith("23503"));

  // -- 7) A regra da 0352 continua, e a linha guarda `units` ------------------
  const item = (await c.query(
    `select s.item_id, count(*)::int total, count(*) filter (where s.status='done')::int feitas
       from public.treatment_sessions s
       join public.treatment_plan_option_items i on i.id = s.item_id
      where s.clinic_id=$1 and s.procedure_id is not null and i.quantity = 1
        and s.redo_kind is distinct from 'revisao'
        and not exists (select 1 from public.provider_payouts p
                         where p.session_id in (select id from public.treatment_sessions t where t.item_id = s.item_id))
      group by s.item_id having count(*) > 1 and count(*) filter (where s.status='done') between 1 and count(*) - 1
      limit 1`, [lon]
  )).rows[0];
  if (!item) console.log("(sem procedimento em andamento no treino — regra da 0352 não medida aqui)");
  else {
    const quem = (await c.query(
      "select coalesce(executed_by, planner_provider_id) p from public.treatment_sessions where item_id=$1 and status='done' limit 1",
      [item.item_id]
    )).rows[0].p;
    const faltam = (await c.query(
      "select id from public.treatment_sessions where item_id=$1 and status<>'done' order by session_index", [item.item_id]
    )).rows.map((r) => r.id);
    const conta = async () => (await c.query(
      "select count(*)::int n, coalesce(max(units),0)::int u from public.provider_payouts where session_id in (select id from public.treatment_sessions where item_id=$1)",
      [item.item_id]
    )).rows[0];
    for (const id of faltam.slice(0, -1)) {
      await c.query("update public.treatment_sessions set status='done', done_at=now(), executed_by=$2 where id=$1", [id, quem]);
    }
    conf("falta sessão: ainda não lança", (await conta()).n === 0);
    await c.query("update public.treatment_sessions set status='done', done_at=now(), executed_by=$2 where id=$1", [faltam.at(-1), quem]);
    const d = await conta();
    conf("última sessão concluída: lança UMA vez, com units = 1", d.n === 1 && d.u === 1);
    // Refação: reabre e conclui de novo.
    await c.query("update public.treatment_sessions set status='pending', redo_kind='refacao' where id=$1", [faltam.at(-1)]);
    await c.query("update public.treatment_sessions set status='done', done_at=now() where id=$1", [faltam.at(-1)]);
    conf("refação concluída de novo não paga outra vez", (await conta()).n === 1);
  }

  // -- 8) "Sem repasse" no cadastro ------------------------------------------
  const pago = (await c.query(
    "select procedure_id, provider_id, clinic_id, accrual_date from public.provider_payouts where id=$1", [alvo.payout_id]
  )).rows[0];
  const antes = (await c.query(
    "select count(*)::int n from public.payout_rate_for($1,$2,$3,$4)",
    [pago.procedure_id, pago.provider_id, pago.clinic_id, pago.accrual_date]
  )).rows[0].n;
  await c.query("update public.procedure_commissions set no_payout=true where procedure_id=$1", [pago.procedure_id]);
  const depois = (await c.query(
    "select count(*)::int n from public.payout_rate_for($1,$2,$3,$4)",
    [pago.procedure_id, pago.provider_id, pago.clinic_id, pago.accrual_date]
  )).rows[0].n;
  conf("procedimento 'sem repasse' deixa de ter valor na tabela", antes === 1 && depois === 0);

  const z = (await c.query(
    `select p.id, p.procedure_id, p.clinic_id from public.provider_payouts p
      where p.closing_id is null and p.amount_cents = 0 and p.procedure_id is not null
        and p.procedure_id <> $1 limit 1`, [pago.procedure_id]
  )).rows[0];
  if (!z) console.log("(sem outro repasse zerado no treino — marca 'sem repasse' nas pendências não medida)");
  else {
    await como(adm);
    const a = (await c.query("select count(*)::int n from public.payout_watchlist($1) where payout_id=$2", [z.clinic_id, z.id])).rows[0].n;
    await voltar();
    await c.query("update public.procedure_commissions set no_payout=true where procedure_id=$1", [z.procedure_id]);
    await como(adm);
    const b = (await c.query("select count(*)::int n from public.payout_watchlist($1) where payout_id=$2", [z.clinic_id, z.id])).rows[0].n;
    await voltar();
    conf("marcado 'sem repasse', o zerado sai das pendências", a === 1 && b === 0);

    // A linha nova de um procedimento "sem repasse" nasce marcada e com zero.
    const livre = (await c.query(
      `select s.id, s.clinic_id, coalesce(s.executed_by, s.planner_provider_id) prov
         from public.treatment_sessions s
        where s.status='done' and coalesce(s.executed_by, s.planner_provider_id) is not null
          and not exists (select 1 from public.provider_payouts p where p.session_id = s.id) limit 1`
    )).rows[0];
    if (livre) {
      const nova = (await c.query(
        `insert into public.provider_payouts (clinic_id, provider_id, session_id, procedure_id, accrual_date, amount_cents)
         values ($1,$2,$3,$4, current_date, 12345) returning amount_cents, no_payout`,
        [livre.clinic_id, livre.prov, livre.id, z.procedure_id]
      )).rows[0];
      conf("linha de procedimento 'sem repasse' nasce marcada e com R$ 0,00",
        nova.no_payout === true && Number(nova.amount_cents) === 0);
    }
  }
} catch (e) {
  falha.push("ERRO: " + e.message);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(`OK ${ok.length}:`, ok.join(" | "));
console.log(`FALHA ${falha.length}:`, falha.join(" | "));
if (ok.length === 0) { console.log("NÃO MEDI NADA"); process.exit(2); }
process.exit(falha.length ? 1 : 0);
