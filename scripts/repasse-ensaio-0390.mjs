// ENSAIO DA 0390 no banco de TREINO, numa transação DESFEITA (rollback): nada fica.
// Uso: node scripts/repasse-ensaio-0390.mjs --confirmar
//
// Prova a Etapa 2 do repasse (o relatório): gerar, não duplicar, excluir com
// motivo (adiar / não pagar), devolver, cancelar, reverter o "não pagar", e
// as travas — um procedimento em um relatório por vez, o fechamento antigo
// não leva o que está em relatório, ninguém grava pela API.
// Só contagens e valores na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0390_repasse_relatorio.sql";

// O ensaio tenta GRAVAR direto nas tabelas para provar que o banco recusa.
// Tudo corre numa transação desfeita, mas pede autorização como os outros
// ensaios que escrevem (OC-00088).
if (!process.argv.includes("--confirmar") && !process.env.CI) {
  console.log(
    [
      "Este ensaio grava no banco de TREINO dentro de uma transação desfeita",
      "(nada fica gravado). Para rodar:",
      "  node scripts/repasse-ensaio-0390.mjs --confirmar",
    ].join("\n")
  );
  process.exit(2);
}

const c = await connect();
const ok = [];
const falha = [];
const conf = (n, v) => (v ? ok : falha).push(n);

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
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];

try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  const again = await c.query(sql);
  conf("aplicar duas vezes sem erro (idempotente)", true);
  const cf = (Array.isArray(again) ? again[again.length - 1] : again).rows[0];
  conf(
    "conferência 3·10·1·0·1·1",
    Number(cf.tabelas) === 3 && Number(cf.funcoes) === 10 &&
      Number(cf.trava_um_relatorio_por_vez) === 1 && Number(cf.regras_de_escrita) === 0 &&
      Number(cf.permissao) === 1 && Number(cf.nao_pagar_no_repasse) === 1
  );

  const FUNCOES = [
    "payout_report_generate(uuid,date,uuid)", "payout_report_exclude_item(uuid,text,text)",
    "payout_report_restore_item(uuid)", "payout_report_cancel(uuid,text)",
    "payout_release_withheld(uuid,text)", "payout_report_candidates(uuid,date)",
    "payout_report_list(uuid,uuid)", "payout_report_items_detail(uuid)",
    "payout_report_history(uuid)", "payout_withheld_list(uuid)",
    "close_payout_month(uuid,date,numeric)",
  ];
  let privs = true;
  for (const f of FUNCOES) {
    const r = await um(
      `select has_function_privilege('anon','public.${f}','execute') a,
              has_function_privilege('authenticated','public.${f}','execute') u`
    );
    if (r.a || !r.u) { privs = false; falha.push(`privilégio errado em ${f}`); }
  }
  conf("as 11 funções: sem login não, logado sim", privs);
  for (const f of ["_payout_report_refresh(uuid)", "_payout_report_event(uuid,uuid,uuid,text,text)"]) {
    const r = await um(`select has_function_privilege('authenticated','public.${f}','execute') u`);
    conf(`${f} é interna (logado não chama)`, !r.u);
  }
  const aud = await um(
    `select count(*)::int n from pg_trigger t
      where not t.tgisinternal and t.tgname = 'audit_capture_trg'
        and t.tgrelid in ('public.payout_reports'::regclass, 'public.payout_report_items'::regclass)`
  );
  conf("relatório e itens entram na auditoria", aud.n === 2);

  const adm = (await um("select id from public.profiles where is_admin_master and is_active order by created_at limit 1"))?.id;
  // A unidade do ensaio: a que tem mais repasses ainda fora de fechamento.
  // (Chama-se `lon` por história: o primeiro ensaio usava Londrina.)
  const lon = (await um(
    `select p.clinic_id id from public.provider_payouts p
      where p.closing_id is null and p.session_id is not null
      group by p.clinic_id having count(*) >= 3 order by count(*) desc limit 1`
  ))?.id;
  if (!adm || !lon) throw new Error("NÃO MEDI: falta Admin Master ou uma unidade com 3 repasses abertos no treino");
  const mes = (await um("select date_trunc('month', public.today_br())::date::text d")).d;

  // Prepara o cenário (desfeito no fim): todos os repasses abertos da unidade
  // ganham valor, menos UM, que fica zerado para provar que zerado não entra.
  const zerado = (await um(
    "select id from public.provider_payouts where clinic_id=$1 and closing_id is null and session_id is not null order by id limit 1", [lon]
  )).id;
  await c.query(
    "update public.provider_payouts set amount_cents = 10000, no_payout = false where clinic_id=$1 and closing_id is null and id <> $2", [lon, zerado]);
  await c.query("update public.provider_payouts set amount_cents = 0, no_payout = false where id=$1", [zerado]);
  await como(adm);
  const cand = (await c.query("select * from public.payout_report_candidates($1,$2)", [lon, mes])).rows;
  await voltar();
  const prontos = cand.filter((r) => r.ready_count > 0);
  console.log("candidatos na unidade do ensaio:", cand.map((r) => ({ prontos: r.ready_count, cents: Number(r.ready_cents), zerados: r.zero_count })));
  if (prontos.length === 0) throw new Error("NÃO MEDI: nenhum repasse com valor na unidade do ensaio");
  const alvo = prontos[0];
  conf("candidatos mostram quem tem o que entrar", alvo.ready_count >= 1 && Number(alvo.ready_cents) > 0 && alvo.draft_id === null);

  // -- 1) Gerar -------------------------------------------------------------
  await como(adm);
  const g1 = Number((await um("select public.payout_report_generate($1,$2,null) n", [lon, mes])).n);
  const lista = (await c.query("select * from public.payout_report_list($1,null)", [lon])).rows;
  await voltar();
  conf("gerar todos cria um relatório por dentista com valor", g1 === prontos.length && lista.length === prontos.length);
  const rel = lista.find((r) => r.provider_id === alvo.provider_id);
  conf("relatório nasce rascunho, numerado, com o total dos candidatos",
    rel.status === "rascunho" && /^RP-\d{6}$/.test(rel.code) &&
      rel.item_count === alvo.ready_count && Number(rel.total_cents) === Number(alvo.ready_cents));
  conf("relatório guarda quem gerou", rel.created_by_name !== null);

  await como(adm);
  const g2 = Number((await um("select public.payout_report_generate($1,$2,null) n", [lon, mes])).n);
  const itens = (await c.query("select * from public.payout_report_items_detail($1)", [rel.id])).rows;
  await voltar();
  conf("gerar de novo não duplica nada", g2 === 0 && itens.length === rel.item_count);
  conf("o detalhe traz data, procedimento, cliente e valor",
    itens.every((i) => i.finished_on && i.procedure_name && Number(i.amount_cents) > 0) &&
      itens.filter((i) => i.origin === "sessao").every((i) => i.client_id && i.client_name && i.session_id));

  // -- 2) A trava: um procedimento em um relatório por vez -------------------
  const outro = (await um(
    `insert into public.payout_reports (clinic_id, provider_id, period_month, status)
     values ($1, $2, $3, 'cancelado') returning id`, [lon, alvo.provider_id, mes]
  )).id;
  const dup = await recusa(
    `insert into public.payout_report_items (report_id, clinic_id, payout_id, finished_on, amount_cents)
     values ($1,$2,$3, current_date, 1)`, [outro, lon, itens[0].payout_id]
  );
  conf("o mesmo procedimento não entra em dois relatórios (índice único)", !!dup && dup.startsWith("23505"));
  const rasc2 = await recusa(
    `insert into public.payout_reports (clinic_id, provider_id, period_month) values ($1,$2,$3)`,
    [lon, alvo.provider_id, mes]
  );
  conf("um rascunho por dentista e unidade", !!rasc2 && rasc2.startsWith("23505"));

  // -- 3) Excluir com motivo --------------------------------------------------
  const it = itens[0];
  await como(adm);
  const e1 = await recusa("select public.payout_report_exclude_item($1,'adiar','  ')", [it.item_id]);
  const e2 = await recusa("select public.payout_report_exclude_item($1,'sumir','motivo qualquer')", [it.item_id]);
  await c.query("select public.payout_report_exclude_item($1,'adiar','aguardando conferência do laboratório')", [it.item_id]);
  const e3 = await recusa("select public.payout_report_exclude_item($1,'adiar','de novo, com motivo')", [it.item_id]);
  const g3 = Number((await um("select public.payout_report_generate($1,$2,null) n", [lon, mes])).n);
  const rel2 = (await c.query("select * from public.payout_report_list(null,$1)", [rel.id])).rows[0];
  await voltar();
  conf("excluir sem motivo é recusado", !!e1 && e1.includes("REASON_REQUIRED"));
  conf("tipo de exclusão inventado é recusado", !!e2 && e2.includes("INVALID_KIND"));
  conf("excluir duas vezes é recusado", !!e3 && e3.includes("ALREADY_EXCLUDED"));
  conf("adiar tira do total e conta como excluído",
    Number(rel2.total_cents) === Number(rel.total_cents) - Number(it.amount_cents) &&
      rel2.item_count === rel.item_count - 1 && rel2.excluded_count === 1);
  conf("o adiado não volta para o MESMO rascunho", g3 === 0);

  await como(adm);
  await c.query("select public.payout_report_restore_item($1)", [it.item_id]);
  const rel3 = (await c.query("select * from public.payout_report_list(null,$1)", [rel.id])).rows[0];
  await c.query("select public.payout_report_exclude_item($1,'nao_pagar','refação por falha do dentista')", [it.item_id]);
  const wl = (await c.query("select * from public.payout_withheld_list($1)", [lon])).rows;
  await voltar();
  conf("devolver põe de volta no total", Number(rel3.total_cents) === Number(rel.total_cents) && rel3.excluded_count === 0);
  const pw = await um("select withheld, withheld_reason, withheld_by from public.provider_payouts where id=$1", [it.payout_id]);
  conf("'não pagar' marca o procedimento com motivo e quem", pw.withheld === true && pw.withheld_by === adm && !!pw.withheld_reason);
  conf("'não pagar' aparece na lista da unidade", wl.length === 1 && wl[0].payout_id === it.payout_id);

  // -- 4) O fechamento antigo não leva o que está em relatório ---------------
  const preso = itens.length > 1 ? itens[1] : null;
  if (preso) {
    const fech = (await um(
      `insert into public.payout_closings (clinic_id, period_month, status, closed_at)
       values ($1, '2020-01-01', 'fechado', now()) returning id`, [lon]
    )).id;
    const e4 = await recusa("update public.provider_payouts set closing_id=$1 where id=$2", [fech, preso.payout_id]);
    conf("linha em relatório não entra em fechamento (PAYOUT_IN_REPORT)", !!e4 && e4.includes("PAYOUT_IN_REPORT"));
    const e5 = await recusa("update public.provider_payouts set closing_id=$1 where id=$2", [fech, it.payout_id]);
    conf("linha em 'não pagar' não entra em fechamento", !!e5 && e5.includes("PAYOUT_IN_REPORT"));
  } else console.log("(relatório com um item só — trava do fechamento medida só pelo NOTHING_TO_CLOSE)");
  await como(adm);
  const e6 = await recusa("select public.close_payout_month($1,$2,0)", [lon, mes]);
  await voltar();
  const abertosForaDeRelatorio = Number((await um(
    `select count(*)::int n from public.provider_payouts p
      where p.clinic_id=$1 and p.closing_id is null and p.amount_cents > 0 and not p.withheld
        and p.accrual_date >= $2::date and p.accrual_date < ($2::date + interval '1 month')
        and not exists (select 1 from public.payout_report_items i where i.payout_id=p.id and i.active)`, [lon, mes]
  )).n);
  if (abertosForaDeRelatorio === 0) {
    conf("'Fechar o mês' antigo não acha nada: está tudo em relatório", !!e6 && e6.includes("NOTHING_TO_CLOSE"));
  } else console.log("(há linha do mês fora de relatório — NOTHING_TO_CLOSE não medido)");

  // -- 5) Cancelar e gerar de novo --------------------------------------------
  await como(adm);
  const e7 = await recusa("select public.payout_report_cancel($1,'')", [rel.id]);
  await c.query("select public.payout_report_cancel($1,'gerado na unidade errada')", [rel.id]);
  const e8 = await recusa("select public.payout_report_exclude_item($1,'adiar','depois de cancelado')", [itens.at(-1).item_id]);
  const g4 = Number((await um("select public.payout_report_generate($1,$2,$3) n", [lon, mes, alvo.provider_id])).n);
  const novo = (await c.query("select * from public.payout_report_list($1,null)", [lon])).rows
    .find((r) => r.provider_id === alvo.provider_id && r.status === "rascunho");
  await voltar();
  conf("cancelar sem motivo é recusado", !!e7 && e7.includes("REASON_REQUIRED"));
  conf("relatório cancelado não aceita mais ajuste", !!e8 && e8.includes("REPORT_NOT_DRAFT"));
  conf("cancelado solta os procedimentos: o novo relatório pega todos, menos o 'não pagar'",
    g4 === 1 && novo && novo.id !== rel.id && novo.item_count === rel.item_count - 1);

  // -- 6) Reverter o "não pagar" ----------------------------------------------
  await como(adm);
  const e9 = await recusa("select public.payout_release_withheld($1,'ok')", [it.payout_id]);
  await c.query("select public.payout_release_withheld($1,'decisão revista pela diretoria')", [it.payout_id]);
  const g5 = Number((await um("select public.payout_report_generate($1,$2,$3) n", [lon, mes, alvo.provider_id])).n);
  const novo2 = (await c.query("select * from public.payout_report_list(null,$1)", [novo.id])).rows[0];
  const hist = (await c.query("select action from public.payout_report_history($1)", [novo.id])).rows.map((r) => r.action);
  const histAntigo = (await c.query("select action from public.payout_report_history($1)", [rel.id])).rows.map((r) => r.action);
  await voltar();
  conf("reverter sem motivo é recusado", !!e9 && e9.includes("REASON_REQUIRED"));
  conf("revertido, o procedimento entra no rascunho aberto",
    g5 === 1 && novo2.item_count === rel.item_count && Number(novo2.total_cents) === Number(rel.total_cents));
  conf("a linha do tempo conta a história",
    hist.includes("gerado") && hist.includes("itens_adicionados") &&
      ["gerado", "item_adiado", "item_devolvido", "item_nao_pagar", "cancelado", "nao_pagar_revertido"].every((a) => histAntigo.includes(a)));

  // -- 7) Zerado fica de fora; mês futuro não gera -----------------------------
  const zz = await um(
    "select (select count(*) from public.payout_report_items where payout_id=$1)::int n", [zerado]);
  conf("procedimento com R$ 0,00 não entra em relatório (e a tela sabe quantos ficaram de fora)",
    zz.n === 0 && cand.reduce((t, r) => t + r.zero_count, 0) >= 1);
  await como(adm);
  const e10 = await recusa("select public.payout_report_generate($1, (date_trunc('month', public.today_br()) + interval '1 month')::date, null)", [lon]);
  await voltar();
  conf("mês futuro não gera relatório", !!e10 && e10.includes("FUTURE_MONTH"));

  // -- 8) Quem pode ------------------------------------------------------------
  const estranho = "00000000-0000-0000-0000-000000000001";
  await como(estranho);
  const s1 = await recusa("select public.payout_report_generate($1,$2,null)", [lon, mes]);
  const s2 = await recusa("select * from public.payout_report_candidates($1,$2)", [lon, mes]);
  const s3 = await recusa("select * from public.payout_report_items_detail($1)", [novo.id]);
  const s4 = await recusa("select * from public.payout_report_history($1)", [novo.id]);
  const s5 = await recusa("select * from public.payout_withheld_list($1)", [lon]);
  const s6 = (await c.query("select count(*)::int n from public.payout_report_list($1,null)", [lon])).rows[0].n;
  const s7 = (await c.query("select count(*)::int n from public.payout_reports")).rows[0].n;
  await voltar();
  conf("estranho não gera, não lê candidatos, detalhe, histórico nem 'não pagar'",
    [s1, s2, s3, s4, s5].every((e) => !!e && e.includes("NOT_ALLOWED")));
  conf("estranho não vê relatório nenhum (função e tabela)", s6 === 0 && s7 === 0);

  const gerente = await um(
    `select u.user_id, u.clinic_id from public.user_clinic_roles_all u
      join public.profiles p on p.id = u.user_id and p.is_active and not p.is_admin_master
     where u.role = 'unit_manager'
       and not exists (select 1 from public.user_clinic_roles_all x
                        where x.user_id = u.user_id and x.role = 'finance_franchisor')
     limit 1`
  );
  if (!gerente) console.log("(sem Gerente no treino — leitura do Gerente não medida)");
  else {
    await como(gerente.user_id);
    const m1 = await recusa("select public.payout_report_generate($1,$2,null)", [gerente.clinic_id, mes]);
    const m2 = await recusa("select count(*) from public.payout_report_list($1,null)", [gerente.clinic_id]);
    await voltar();
    conf("Gerente não gera relatório (decisão 1), mas lê os da unidade dele",
      !!m1 && m1.includes("NOT_ALLOWED") && m2 === null);
  }

  // -- 9) Ninguém grava pela API ----------------------------------------------
  await como(adm);
  const u1 = await c.query("update public.payout_reports set total_cents = 1 where id=$1", [novo.id]);
  const u2 = await c.query("update public.payout_report_items set amount_cents = 1 where report_id=$1", [novo.id]);
  const u3 = await recusa(
    "insert into public.payout_report_events (report_id, clinic_id, action) values ($1,$2,'inventado')", [novo.id, lon]);
  await voltar();
  conf("Admin logado não altera relatório nem item direto", u1.rowCount === 0 && u2.rowCount === 0);
  conf("Admin logado não inventa linha do tempo", !!u3);
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
