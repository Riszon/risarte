// ENSAIO DA 0405 (Levantamento de Dívidas, fase 2) no banco de TREINO, numa
// transação DESFEITA: nada fica.
// Uso: node scripts/dividas-ensaio-0405.mjs --confirmar [--quebrar]
//      (rede sem IPv6: RISARTE_TREINO_POOLER=1)
//
// Prova, com cada conta de teste agindo como ela mesma:
//   1. a migração roda duas vezes (idempotente);
//   2. restrições: negativação (sócio só com nome), protesto de dívida e de
//      grupo, cancelado exige data, ação judicial, notificação, remoção com
//      motivo (a linha fica);
//   3. propostas: só uma ativa, a nova substitui a anterior, o valor não muda
//      depois de gravado, recusa pede motivo, a rotina expira a vencida;
//   4. contatos: só crescem; "conferido" grava a data;
//   5. anexos: registra só arquivo que existe na pasta e é da dívida;
//   6. os outros 14 papéis não leem nada nem gravam (tabelas e pasta);
//      `--quebrar` abre a guarda e o ensaio TEM de falhar.
// Só contagens e códigos na saída (LGPD).
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQ = "supabase/migrations/0405_dividas_restricoes_propostas_anexos.sql";
if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO dentro de transação desfeita. Rode com --confirmar.");
  process.exit(2);
}

const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
let sp = 0;
async function como(uid, fn) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  try { return await fn(); } finally {
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claims', '', true)");
  }
}
async function erroDe(sql, p = []) {
  const nome = `s${++sp}`;
  await c.query(`savepoint ${nome}`);
  try { await c.query(sql, p); await c.query(`release savepoint ${nome}`); return null; }
  catch (e) { await c.query(`rollback to savepoint ${nome}`); return e.message; }
}

const PESSOAS = ["admin","financeiro","rede","gerente","franqueado","recepcao","coordenador","dentista","asb","tsb","sdr","planner","consultor","assistente","comprador","rislife"];
const falhas = [];
const ok = (nome, v) => { console.log(`  ${v ? "✓" : "✗"} ${nome}`); if (!v) falhas.push(nome); };

let saida = 1;
try {
  await c.query("begin");
  const sql = readFileSync(ARQ, "utf8");
  await c.query(sql);
  await c.query(sql);
  console.log("Migração aplicada duas vezes sem erro (idempotente).");
  if (process.argv.includes("--quebrar")) {
    await c.query("create or replace function public.debt_can(p_capability text, p_clinic_id uuid) returns boolean language sql stable security definer set search_path = '' as 'select (select auth.uid()) is not null'");
    console.log("⚠️ MODO QUEBRAR: debt_can deixa qualquer logado (o ensaio tem de FALHAR).");
  }

  const ids = {};
  for (const p of PESSOAS) ids[p] = (await um("select id from auth.users where email = $1", [`${p}@example.com`])).id;
  const fin = ids.financeiro;
  const ldn = (await um("select id from public.clinics where code = 'LDN'")).id;
  const sup = (await um("select id from public.suppliers where active order by name limit 1")).id;
  const hoje = (await um("select public.today_br() as d")).d;
  const dia = (n) => { const d = new Date(hoje); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const j = (o) => JSON.stringify(o);
  const val = async (uid, sqlf, p) => como(uid, async () => (await um(sqlf, p)).v);

  const novaDivida = (extra = {}) => val(fin, "select public.debt_save($1::jsonb) v",
    [j({ clinic_id: ldn, supplier_id: sup, original_cents: 100000, due_date: dia(-10), issue_date: "2025-01-10", origin: "A", ...extra })]);
  const d1 = await novaDivida();

  console.log("\n1. Estrutura");
  const est = await um(`select
      (select count(*) from pg_tables where schemaname = 'public' and tablename like 'debt%')::int as tabelas,
      (select stale_check_days from public.debt_settings where clinic_id is null) as prazo,
      (select not public from storage.buckets where id = 'dividas') as privada,
      (select count(*) from public.audit_missing_tables() t where t.table_name like 'debt%')::int as sem_auditoria`);
  console.log("  ", j(est));
  ok("18 tabelas debt*, prazo do selo 60, pasta privada, auditoria completa",
    est.tabelas === 18 && est.prazo === 60 && est.privada === true && est.sem_auditoria === 0);

  console.log("\n2. Restrições");
  const eSocio = await como(fin, () => erroDe("select public.debt_save_negativation($1::jsonb)", [j({ debt_id: d1, bureau: "serasa", target: "socio" })]));
  ok("negativação no sócio sem o nome: recusa", eSocio !== null && /sócio/.test(eSocio));
  const neg = await val(fin, "select public.debt_save_negativation($1::jsonb) v", [j({ debt_id: d1, bureau: "serasa", included_on: dia(-30), amount_cents: 100000, in_limpa_nome: true })]);
  ok("negativação gravada", !!neg);
  const eCancel = await como(fin, () => erroDe("select public.debt_save_protest($1::jsonb)", [j({ debt_id: d1, cancel_status: "cancelado" })]));
  ok("protesto cancelado sem data: recusa", eCancel !== null && /data do cancelamento/.test(eCancel));
  const cart = await val(fin, "select public.debt_save_notary_office($1::jsonb) v", [j({ name: "1º Tabelionato de Protesto (ensaio)", city: "Londrina", state: "pr" })]);
  const prot = await val(fin, "select public.debt_save_protest($1::jsonb) v", [j({ debt_id: d1, notary_office_id: cart, protested_on: dia(-20), amount_cents: 100000, cancel_cost_cents: 15000 })]);
  ok("protesto da dívida com cartório e custas", !!prot);
  const eDois = await como(fin, () => erroDe("select public.debt_save_protest($1::jsonb)", [j({ debt_id: d1, group_id: d1 })]));
  ok("protesto de dívida E grupo ao mesmo tempo: recusa", eDois !== null);
  const grupo = await val(fin, "select public.debt_save_group($1::jsonb) v", [j({ clinic_id: ldn, supplier_id: sup, label: "Boletos de ensaio" })]);
  const g1 = await novaDivida({ group_id: grupo }), g2 = await novaDivida({ group_id: grupo });
  await val(fin, "select public.debt_save_protest($1::jsonb) v", [j({ group_id: grupo, protested_on: dia(-5), cancel_cost_cents: 9000 })]);
  const evG = (await um("select count(*)::int n from public.debt_events where kind = 'protesto' and debt_id in ($1, $2)", [g1, g2])).n;
  ok("protesto do grupo aparece nas duas dívidas do grupo", evG === 2);
  const eProc = await como(fin, () => erroDe("select public.debt_save_lawsuit($1::jsonb)", [j({ debt_id: d1 })]));
  ok("ação judicial sem processo nem vara: recusa", eProc !== null);
  const acao = await val(fin, "select public.debt_save_lawsuit($1::jsonb) v", [j({ debt_id: d1, process_number: "0000000-00.2026.8.16.0014", has_freeze: true })]);
  const notif = await val(fin, "select public.debt_save_notice($1::jsonb) v", [j({ debt_id: d1, received_on: dia(-3) })]);
  ok("ação judicial e notificação gravadas", !!acao && !!notif);
  const eRem = await como(fin, () => erroDe("select public.debt_remove_record('negativacao', $1, '')", [neg]));
  ok("remover sem motivo: recusa", eRem !== null);
  await como(fin, () => c.query("select public.debt_remove_record('negativacao', $1, 'Lançada na dívida errada')", [neg]));
  const rem = await um("select removed_at is not null r, removed_reason from public.debt_negativations where id = $1", [neg]);
  ok("remoção lógica: a linha fica, com motivo", rem.r && rem.removed_reason === "Lançada na dívida errada");

  console.log("\n3. Propostas");
  const p1 = await val(fin, "select public.debt_save_proposal($1::jsonb) v", [j({ debt_id: d1, amount_cents: 60000, valid_until: dia(10), source: "serasa_limpa_nome" })]);
  const p2 = await val(fin, "select public.debt_save_proposal($1::jsonb) v", [j({ debt_id: d1, amount_cents: 55000, payment_kind: "parcelado", installments: 6, installment_cents: 9167, valid_until: dia(15) })]);
  const sts = await c.query("select id, status from public.debt_proposals where debt_id = $1", [d1]);
  const st = Object.fromEntries(sts.rows.map((r) => [r.id, r.status]));
  ok("a nova substitui a anterior (uma ativa só)", st[p1] === "substituida" && st[p2] === "ativa");
  const eMuda = await erroDe("update public.debt_proposals set amount_cents = 1 where id = $1", [p2]);
  ok("o valor proposto não muda (nem pelo superusuário)", eMuda !== null);
  const eApaga = await erroDe("delete from public.debt_proposals where id = $1", [p2]);
  ok("proposta não se apaga", eApaga !== null);
  const eVencida = await como(fin, () => erroDe("select public.debt_save_proposal($1::jsonb)", [j({ debt_id: d1, amount_cents: 1000, valid_until: dia(-1) })]));
  ok("validade já passada: recusa", eVencida !== null);
  const eParc = await como(fin, () => erroDe("select public.debt_save_proposal($1::jsonb)", [j({ debt_id: d1, amount_cents: 1000, payment_kind: "parcelado" })]));
  ok("parcelada sem número de parcelas: recusa", eParc !== null);
  const eRecusa = await como(fin, () => erroDe("select public.debt_set_proposal_status($1, 'recusada', '')", [p2]));
  ok("recusar sem motivo: recusa", eRecusa !== null);
  const pg = await val(fin, "select public.debt_save_proposal($1::jsonb) v", [j({ group_id: grupo, amount_cents: 120000 })]);
  ok("proposta do grupo", !!pg);
  // A rotina expira a vencida (inserida direto, porque a porta não aceita validade passada).
  const px = (await um("insert into public.debt_proposals (debt_id, proposed_on, amount_cents, valid_until, created_by) values ($1, $2, 1000, $3, $4) returning id", [g1, dia(-10), dia(-1), fin])).id;
  await c.query("select public.debt_daily_run()");
  const exp = await um("select status from public.debt_proposals where id = $1", [px]);
  const evExp = (await um("select count(*)::int n from public.debt_events where kind = 'proposta_expirada' and debt_id = $1", [g1])).n;
  ok("rotina diária expira a proposta vencida e registra", exp.status === "expirada" && evExp >= 1);

  console.log("\n4. Contatos e conferência");
  const ct = await val(fin, "select public.debt_log_contact($1::jsonb) v", [j({ debt_id: d1, channel: "whatsapp", summary: "Pedi boleto atualizado", mark_checked: true })]);
  const conf = await um("select last_checked_on from public.debts where id = $1", [d1]);
  ok("contato registrado e marca a conferência de hoje", !!ct && conf.last_checked_on !== null);
  const eCt = await erroDe("update public.debt_contacts set summary = 'x' where id = $1", [ct]);
  ok("contato não se altera", eCt !== null);
  const eFut = await como(fin, () => erroDe("select public.debt_mark_checked($1, $2)", [d1, dia(3)]));
  ok("conferência no futuro: recusa", eFut !== null);

  console.log("\n5. Anexos");
  const caminho = `${d1}/ensaio-0405.pdf`;
  await c.query("insert into storage.objects (bucket_id, name, metadata) values ('dividas', $1, $2::jsonb)", [caminho, j({ size: 1234, mimetype: "application/pdf" })]);
  const eFalta = await como(fin, () => erroDe("select public.debt_attach($1::jsonb)", [j({ debt_id: d1, path: `${d1}/nao-existe.pdf`, kind: "boleto" })]));
  ok("arquivo que não está na pasta: recusa", eFalta !== null && /não chegou/.test(eFalta));
  const eOutra = await como(fin, () => erroDe("select public.debt_attach($1::jsonb)", [j({ debt_id: g1, path: caminho, kind: "boleto" })]));
  ok("arquivo de outra dívida: recusa", eOutra !== null);
  const anx = await val(fin, "select public.debt_attach($1::jsonb) v", [j({ debt_id: d1, path: caminho, kind: "boleto", file_name: "boleto.pdf" })]);
  const anxR = await um("select size_bytes, mime_type from public.debt_attachments where id = $1", [anx]);
  ok("anexo registrado com tamanho e tipo da pasta", Number(anxR.size_bytes) === 1234 && anxR.mime_type === "application/pdf");
  const objFin = await como(fin, async () => (await um("select count(*)::int n from storage.objects where bucket_id = 'dividas' and name = $1", [caminho])).n);
  ok("o Financeiro enxerga o arquivo na pasta", objFin === 1);

  console.log("\n6. Histórico");
  const hist = await como(fin, async () => (await c.query("select source, table_name, event_kind from public.debt_history($1)", [d1])).rows);
  const tabs = new Set(hist.filter((h) => h.source === "trilha").map((h) => h.table_name));
  ok("histórico traz a trilha das restrições, do protesto, do anexo e das propostas",
    ["debts", "debt_negativations", "debt_protests", "debt_lawsuits", "debt_attachments", "debt_proposals"].every((t) => tabs.has(t)));
  ok("e os eventos (proposta, negativação, anexo, remoção)",
    ["proposta", "negativacao", "anexo", "registro_removido"].every((k) => hist.some((h) => h.event_kind === k)));

  console.log("\n7. Quem lê e quem grava");
  for (const p of PESSOAS) {
    const n = await como(ids[p], async () => (await um(`select
        (select count(*) from public.debt_negativations)::int + (select count(*) from public.debt_protests)::int +
        (select count(*) from public.debt_lawsuits)::int + (select count(*) from public.debt_extrajudicial_notices)::int +
        (select count(*) from public.debt_proposals)::int + (select count(*) from public.debt_contacts)::int +
        (select count(*) from public.debt_attachments)::int + (select count(*) from public.debt_notary_offices)::int +
        (select count(*) from storage.objects where bucket_id = 'dividas')::int as n`)).n);
    const grava = await como(ids[p], () => erroDe("select public.debt_save_proposal($1::jsonb)", [j({ debt_id: d1, amount_cents: 500 })]));
    const sobe = await como(ids[p], () => erroDe("insert into storage.objects (bucket_id, name) values ('dividas', $1)", [`${d1}/${p}.pdf`]));
    if (p === "admin" || p === "financeiro") ok(`${p} lê e grava`, n > 0 && grava === null && sobe === null);
    else ok(`${p} lê zero, não grava e não sobe arquivo`, n === 0 && grava !== null && sobe !== null);
  }
  const anon = await (async () => { await c.query("savepoint an"); await c.query("set local role anon");
    try { await c.query("select public.debt_save_proposal('{}'::jsonb)"); return "EXECUTOU"; }
    catch (e) { return e.code; } finally { await c.query("rollback to savepoint an"); } })();
  ok(`anônimo não executa debt_save_proposal (veio ${anon})`, anon === "42501");

  saida = falhas.length === 0 ? 0 : 1;
  console.log(saida === 0 ? "\nENSAIO OK." : `\nENSAIO FALHOU: ${falhas.length} conferência(s).`);
} catch (e) {
  console.error("ERRO NO ENSAIO (não medi):", e.message);
  saida = 1;
} finally {
  await c.query("rollback");
  await c.end();
  console.log("(transação desfeita — nada ficou no treino)");
}
process.exit(saida);
