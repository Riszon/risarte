// ENSAIO DA 0407 (Levantamento de Dívidas, fase 4 — importação) no banco de
// TREINO, numa transação DESFEITA: nada fica.
// Uso: node scripts/dividas-ensaio-0407.mjs --confirmar [--quebrar]
//      (rede sem IPv6: RISARTE_TREINO_POOLER=1)
//
// Uma planilha INVENTADA (nunca a real, D0) passa pela conferência DE VERDADE
// (`src/lib/finance/dividas-importacao.ts`, carregado pelo jiti) e pelas
// portas do banco, como o Financeiro da Franqueadora de teste:
//   1. abrir o lote; gravar com "Verificar" pendente é recusado;
//   2. gravar: dívidas, credores e categorias novos, proposta (ativa e
//      expirada), negativação, protesto (da coluna, ligado pelo "#" e como
//      dívida nova), origem C vinculando o título que já existia, etiqueta,
//      títulos no Contas a Pagar e o evento "importada";
//   3. desfazer: recusado com pagamento; sem pagamento, exclui tudo, cancela
//      os títulos e solta o vinculado;
//   4. a fotografia mensal grava uma vez e não se refaz;
//   5. quem não é do Financeiro da Franqueadora não abre lote nem lê.
// `--quebrar`: a gravação "esquece" a proposta — o ensaio TEM de falhar.
// Só contagens e valores de teste na saída (LGPD).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { connect } from "./test-db.mjs";

if (!process.argv.includes("--confirmar")) {
  console.log("Grava no TREINO dentro de transação desfeita. Rode com --confirmar.");
  process.exit(2);
}
const jiti = createJiti(import.meta.url, { alias: { "@": resolve("src") } });
const lib = await jiti.import(resolve("src/lib/finance/dividas-importacao.ts"));

const c = await connect();
const um = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const todas = async (sql, p = []) => (await c.query(sql, p)).rows;
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
const falhas = [];
const ok = (nome, v) => { console.log(`  ${v ? "✓" : "✗"} ${nome}`); if (!v) falhas.push(nome); };
const j = (o) => JSON.stringify(o);
const dataDe = (x) => (x instanceof Date ? x.toISOString().slice(0, 10) : x == null ? null : String(x).slice(0, 10));

// O que a tela lê para conferir (o mesmo que `importar/dados.ts`).
async function contexto() {
  const dev = await todas("select id, name, legal_name, cnpj, type from public.clinics where is_active");
  const cre = await todas("select id, name, legal_name, document from public.suppliers");
  const cat = await todas("select id, parent_id, name, nature_code, active from public.debt_categories");
  const nat = await todas("select code, label from public.debt_natures where active");
  const div = await todas("select id, code, clinic_id, supplier_id, contract_number, due_date, coalesce(updated_cents, original_cents) v from public.debts where deleted_at is null");
  const tit = await todas("select id, clinic_id, supplier_id, description, amount_cents, due_date, document_number from public.payables where debt_id is null and status in ('aberta','parcial','aguardando_autorizacao')");
  return {
    devedores: dev.map((d) => ({ id: d.id, nome: d.name, razaoSocial: d.legal_name, cnpj: d.cnpj, franqueadora: d.type === "franchisor" })),
    credores: cre.map((s) => ({ id: s.id, nome: s.name, razaoSocial: s.legal_name, documento: s.document })),
    categorias: cat.map((x) => ({ id: x.id, parentId: x.parent_id, nome: x.name, natureza: x.nature_code, ativa: x.active })),
    naturezas: nat.map((n) => ({ code: n.code, label: n.label })),
    dividas: div.map((d) => ({ id: d.id, code: d.code, clinicId: d.clinic_id, supplierId: d.supplier_id, contrato: d.contract_number, vencimento: dataDe(d.due_date), valorCents: Number(d.v) })),
    titulosLivres: tit.map((t) => ({ id: t.id, clinicId: t.clinic_id, fornecedorId: t.supplier_id, descricao: t.description, valorCents: Number(t.amount_cents), vencimento: dataDe(t.due_date), documento: t.document_number })),
    hoje: dataDe((await um("select public.today_br() d")).d),
  };
}
const paraOBanco = (l) => ({
  sheet: l.aba, row_no: l.numero, source_key: l.chave, cells: l.celulas, overrides: l.ajustes, computed: l.dados,
  warnings: l.avisos, has_error: l.temErro, blocking: l.bloqueia, suggested: l.sugerida, decision: l.decisao,
});

let saida = 1;
try {
  await c.query("begin");
  const sql = readFileSync("supabase/migrations/0407_dividas_importacao.sql", "utf8");
  await c.query(sql);
  await c.query(sql);
  console.log("Migração aplicada duas vezes sem erro (idempotente).");

  const ids = {};
  for (const p of ["admin", "financeiro", "gerente"]) ids[p] = (await um("select id from auth.users where email = $1", [`${p}@example.com`])).id;
  const ldn = await um("select id, cnpj from public.clinics where code = 'LDN'");
  const cbe = await um("select id from public.clinics where code = 'CBE'");
  if (!ldn?.cnpj) throw new Error("NÃO MEDI: Londrina do treino sem CNPJ.");
  // Cambé no treino não tem CNPJ: a linha dela entra pelo devedor escolhido na correção.

  // Um título do Contas a Pagar que já existia (para a origem C).
  const sup = await um("select id, name, document from public.suppliers where active and document is not null order by name limit 1");
  const tC = (await um(`insert into public.payables (clinic_id, supplier_id, account_code, description, due_date, amount_cents, status)
    values ($1, $2, '3.3.05', 'Ensaio 0407 — título que já existia', '2026-09-15', 77700, 'aberta') returning id`, [ldn.id, sup.id])).id;

  if (process.argv.includes("--quebrar")) {
    const corpo = sql.slice(sql.indexOf("create or replace function public._debt_import_debt"), sql.indexOf("revoke execute on function public._debt_import_debt"));
    await c.query(corpo.replace("perform public.debt_save_proposal(v_prop || jsonb_build_object('debt_id', debt_id));", () => "null;"));
    console.log("⚠️ MODO QUEBRAR: a gravação esquece a proposta ativa (o ensaio tem de FALHAR).");
  }

  console.log("\n1. Conferência e lote");
  const L = (n, c2) => ({ aba: "dividas", numero: n, celulas: c2 });
  const P = (n, c2) => ({ aba: "protestos", numero: n, celulas: c2 });
  const entrada = [
    L(2, { chave: "1", devedor: "Risarte Londrina", devedor_cnpj: ldn.cnpj, credor: "Credor Ensaio 0407 A", credor_cnpj: "99887766",
      categoria: "Capital de giro / limite", subcategoria: "Limite da conta", natureza: "Financeira", situacao: "Dívida negativada",
      vencimento: "10/04/2025", valor_original: 1000, valor_atualizado: 1300.5, data_referencia: "22/10/2026",
      proposta: 600, proposta_validade: "30/12/2026", proposta_condicao: "à vista", protestada: "Sim", cartorio: "Cartório Ensaio 0407",
      custas: 55.1, origem: "A - Anterior à implantação", fonte: "Serasa Limpa Nome (22/10/2026)", observacoes: "Conferir o contrato" }),
    L(3, { chave: "2", devedor: "Risarte Cambé", credor: "Credor Ensaio 0407 B", categoria: "Categoria Ensaio 0407", subcategoria: "Sub Ensaio 0407",
      situacao: "Grupo de dívidas", quantidade: 3, vencimento: "01/02/2025", valor_atualizado: 2500, proposta: 900, proposta_validade: "01/01/2026",
      origem: "A" }),
    L(4, { chave: "3", devedor: "Risarte Londrina", devedor_cnpj: "28.375.429/0001-83", credor: "Credor Ensaio 0407 A", vencimento: "01/03/2025",
      valor_atualizado: 10, origem: "A" }),
    L(5, { chave: "4", devedor: "Risarte Londrina", devedor_cnpj: ldn.cnpj, credor: sup.name, credor_cnpj: sup.document, vencimento: "15/09/2026", valor_atualizado: 777,
      origem: "C - Já lançada no Contas a Pagar", categoria: "Outros" }),
    P(2, { devedor: "Risarte Londrina", credor: "Credor Ensaio 0407 A", quantidade: 1, valor: 400, cartorio: "Cartório Ensaio 0407",
      data: "05/03/2025", custas: 20, ja_esta: "Sim", vinculada: "1" }),
    P(3, { devedor: "Risarte Londrina", credor: "Credor Ensaio 0407 P", quantidade: 2, valor: 350, cartorio: "Outro Cartório Ensaio",
      data: "06/03/2025", custas: 30, ja_esta: "Não" }),
    P(4, { devedor: "Risarte Londrina", credor: "Credor Ensaio 0407 V", valor: 99, ja_esta: "Verificar" }),
  ];
  const ctx = await contexto();
  let conf = lib.conferirPlanilha(entrada, ctx);
  // Cambé sem CNPJ no treino: escolhida na correção; a linha 4 (CNPJ errado) fica de fora.
  const ajustes = new Map([["dividas:3", { ajustes: { clinicId: cbe.id } }], ["dividas:4", { decisao: "ignorar" }]]);
  const comAjustes = entrada.map((e) => ({ ...e, ...(ajustes.get(`${e.aba}:${e.numero}`) ?? {}) }));
  conf = lib.conferirPlanilha(comAjustes, ctx);
  const linha = (aba, n) => conf.linhas.find((l) => l.aba === aba && l.numero === n);
  if (process.env.ENSAIO_DETALHE) for (const l of conf.linhas) console.log("   ", l.aba, l.numero, l.sugerida, l.bloqueia ? "BLOQUEIA" : "", l.avisos.map((a) => a.nivel + ": " + a.texto).join(" | "));
  ok("conferência: CNPJ inválido é erro; C sugere vincular o título; 'Verificar' segura",
    linha("dividas", 4).temErro && linha("dividas", 5).sugerida === "vincular" && j(linha("dividas", 5).dados?.link_payable_ids) === j([tC])
      && linha("protestos", 4).bloqueia && conf.bloqueadas === 1);
  ok("3 credores novos e 2 categorias novas no resumo", conf.credoresNovos.length === 3 && conf.categoriasNovas.length === 2);

  const batch = await como(ids.financeiro, async () => (await um("select public.debt_import_stage($1::jsonb) v",
    [j({ file_name: "ensaio-0407.xlsx", file_hash: "abc", rows: conf.linhas.map(paraOBanco), totals: conf.totais })])).v);
  const nRows = (await um("select count(*)::int n from public.debt_import_rows where batch_id = $1", [batch])).n;
  const code = (await um("select code from public.debt_import_batches where id = $1", [batch])).code;
  ok(`lote ${code} aberto com as 7 linhas`, nRows === 7 && /^IMP-\d{5,}$/.test(code));
  const recusa = await como(ids.financeiro, () => erroDe("select public.debt_import_commit($1, true)", [batch]));
  ok(`gravar com "Verificar" pendente é recusado (${(recusa ?? "gravou").slice(0, 60)}…)`, /decisão pendente.*Protestos 4/.test(recusa ?? ""));

  // A pessoa decide "Ignorar" na linha 4 de Protestos: a conferência roda de novo e o banco guarda.
  conf = lib.conferirPlanilha(comAjustes.map((e) => (e.aba === "protestos" && e.numero === 4 ? { ...e, decisao: "ignorar" } : e)), ctx);
  const rowsDb = await todas("select id, sheet, row_no from public.debt_import_rows where batch_id = $1", [batch]);
  const idDe = new Map(rowsDb.map((r) => [`${r.sheet}:${r.row_no}`, r.id]));
  await como(ids.financeiro, () => c.query("select public.debt_import_update($1, $2::jsonb)", [batch, j({
    rows: conf.linhas.map((l) => ({ id: idDe.get(`${l.aba}:${l.numero}`), ...paraOBanco(l), ...(l.decisao ? { decision: l.decisao } : {}) })),
    totals: conf.totais,
  })]));
  const dec = await um("select decision from public.debt_import_rows where batch_id = $1 and sheet = 'protestos' and row_no = 4", [batch]);
  ok("a decisão ficou guardada no banco (sobrevive a recarregar)", dec.decision === "ignorar");

  console.log("\n2. Gravar o lote");
  const supAntes = (await um("select count(*)::int n from public.suppliers")).n;
  const res = await como(ids.financeiro, async () => (await um("select public.debt_import_commit($1, true) v", [batch])).v);
  ok(`resultado: 4 dívidas, 2 protestos da aba, 3 credores, 2 categorias, 3 títulos, nenhuma falha (${j(res)})`,
    res.debts === 4 && res.protests === 2 && res.suppliers_created === 3 && res.categories_created === 2 && res.titles === 3 && res.title_failures.length === 0);
  ok("3 fornecedores a mais no cadastro, valendo para a rede", (await um("select count(*)::int n from public.suppliers")).n === supAntes + 3
    && (await um("select count(*)::int n from public.suppliers where name like 'Credor Ensaio 0407%' and scope = 'rede'")).n === 3);
  const raiz = await um("select document from public.suppliers where name = 'Credor Ensaio 0407 A'");
  ok("credor só com a raiz do CNPJ ficou com os 8 dígitos (pendência D18)", raiz.document === "99887766");
  const dv = await todas(`select d.*, (select count(*) from public.debt_tag_links t where t.debt_id = d.id)::int etiquetas
    from public.debts d where import_batch_id = $1 order by code`, [batch]);
  const dA = dv.find((d) => d.clinic_id === ldn.id && d.origin === "A" && d.updated_cents === "130050");
  const dB = dv.find((d) => d.clinic_id === cbe.id);
  const dC = dv.find((d) => d.origin === "C");
  const dP = dv.find((d) => d.updated_cents === "35000");
  ok("dívida A: valor, vencimento, origem, negativada (Serasa, Limpa Nome), etiqueta, próxima ação",
    !!dA && dataDe(dA.due_date) === "2025-04-10" && dA.debt_type === "limite_de_conta" && dA.etiquetas === 1 && dA.next_action === "Conferir o contrato"
      && (await um("select count(*)::int n from public.debt_negativations where debt_id = $1 and bureau = 'serasa' and in_limpa_nome", [dA?.id])).n === 1);
  ok("proposta ativa na A; a vencida da B entrou como expirada",
    (await um("select count(*)::int n from public.debt_proposals where debt_id = $1 and status = 'ativa' and amount_cents = 60000", [dA?.id])).n === 1
      && (await um("select count(*)::int n from public.debt_proposals where debt_id = $1 and status = 'expirada'", [dB?.id])).n === 1);
  ok("grupo de dívidas (D11): uma dívida, desdobrar, reúne 3", dB?.needs_split === true && dB?.bundled_count === 3);
  ok("dívida A tem 2 protestos (o da coluna e o da aba Protestos ligado pelo #1), com o cartório reaproveitado",
    (await um("select count(*)::int n, count(distinct notary_office_id)::int c from public.debt_protests where debt_id = $1", [dA?.id])).n === 2
      && (await um("select count(*)::int n from public.debt_notary_offices where name = 'Cartório Ensaio 0407'")).n === 1);
  ok("o protesto 'Não' virou dívida nova (A, 2 títulos reunidos) com o protesto dela",
    !!dP && dP.origin === "A" && dP.bundled_count === 2
      && (await um("select count(*)::int n from public.debt_protests where debt_id = $1 and cancel_cost_cents = 3000", [dP?.id])).n === 1);
  const vinc = await um("select debt_id, debt_link from public.payables where id = $1", [tC]);
  ok("origem C: vinculou o título que já existia, sem criar outro", vinc.debt_id === dC?.id && vinc.debt_link === "vinculado"
    && (await um("select count(*)::int n from public.payables where debt_id = $1", [dC?.id])).n === 1);
  ok("títulos gerados para A (saldo de implantação) e nenhum para a C",
    (await um("select count(*)::int n from public.payables p join public.debts d on d.id = p.debt_id where d.import_batch_id = $1 and p.debt_link = 'gerado' and p.opening_balance", [batch])).n === 3);
  ok("cada dívida tem o evento 'importada' com o lote", (await um("select count(*)::int n from public.debt_events e join public.debts d on d.id = e.debt_id where d.import_batch_id = $1 and e.kind = 'importada' and e.data->>'batch_code' = $2", [batch, code])).n === 4);
  const st = await um("select status, committed_by from public.debt_import_batches where id = $1", [batch]);
  ok("lote marcado importado por quem gravou", st.status === "importado" && st.committed_by === ids.financeiro);
  ok("gravar de novo é recusado", /não está mais em conferência/.test((await como(ids.financeiro, () => erroDe("select public.debt_import_commit($1, true)", [batch]))) ?? ""));

  console.log("\n3. Desfazer");
  await c.query("savepoint pago");
  const tituloA = (await um("select id from public.payables where debt_id = $1 and debt_link = 'gerado'", [dA.id])).id;
  await como(ids.financeiro, () => c.query("select public.register_payable_payment(p_payable_id => $1, p_amount_cents => 1000, p_paid_at => '2026-11-13', p_payment_method => 'pix')", [tituloA]));
  const recusaPago = await como(ids.financeiro, () => erroDe("select public.debt_import_undo($1, 'Ensaio do desfazer')", [batch]));
  ok("com pagamento, desfazer é recusado", /Já há pagamento/.test(recusaPago ?? ""));
  await c.query("rollback to savepoint pago");
  const n = await como(ids.financeiro, async () => (await um("select public.debt_import_undo($1, 'Ensaio do desfazer') v", [batch])).v);
  ok(`sem pagamento: as 4 dívidas excluídas (${n})`, n === 4 && (await um("select count(*)::int n from public.debts where import_batch_id = $1 and deleted_at is null", [batch])).n === 0);
  ok("títulos gerados cancelados; o vinculado voltou a ser só do Contas a Pagar",
    (await um("select count(*)::int n from public.payables p join public.debts d on d.id = p.debt_id where d.import_batch_id = $1 and p.debt_link = 'gerado' and p.status <> 'cancelada'", [batch])).n === 0
      && (await um("select debt_id from public.payables where id = $1", [tC])).debt_id === null);
  ok("protestos e negativações do lote marcados como removidos",
    (await um("select count(*)::int n from public.debt_protests where removed_at is null and debt_id in (select id from public.debts where import_batch_id = $1)", [batch])).n === 0
      && (await um("select count(*)::int n from public.debt_negativations where removed_at is null and debt_id in (select id from public.debts where import_batch_id = $1)", [batch])).n === 0);
  ok("lote desfeito com o motivo", (await um("select status, undone_reason from public.debt_import_batches where id = $1", [batch])).undone_reason === "Ensaio do desfazer");

  console.log("\n4. Fotografia mensal");
  const mes = (await um("select date_trunc('month', public.today_br())::date::text m")).m;
  const f1 = (await um("select public._debt_snapshot_month($1::date) v", [mes])).v;
  const f2 = (await um("select public._debt_snapshot_month($1::date) v", [mes])).v;
  const vivas = (await um("select count(*)::int n from public.debts where deleted_at is null")).n;
  ok(`grava uma foto por dívida viva (${f1} de ${vivas}) e não refaz (${f2})`, f1 === vivas && f2 === 0);
  ok("dívida excluída no mês não entra na foto", (await um("select count(*)::int n from public.debt_month_positions where month = $1::date and debt_id = $2", [mes, dA.id])).n === 0);

  console.log("\n5. Quem pode");
  const batch2 = await como(ids.financeiro, async () => (await um("select public.debt_import_stage($1::jsonb) v", [j({ file_name: "x.xlsx", rows: [paraOBanco(linha("dividas", 2))] })])).v);
  ok("Gerente não abre lote", /permissão/.test((await como(ids.gerente, () => erroDe("select public.debt_import_stage($1::jsonb)", [j({ file_name: "x", rows: [paraOBanco(linha("dividas", 2))] })]))) ?? ""));
  ok("Gerente não lê lotes nem linhas", (await como(ids.gerente, async () => (await um("select (select count(*) from public.debt_import_batches)::int + (select count(*) from public.debt_import_rows)::int n")).n)) === 0);
  ok("Gerente não grava o lote de outro", /permissão/.test((await como(ids.gerente, () => erroDe("select public.debt_import_commit($1, false)", [batch2]))) ?? ""));
  ok("descartar lote em conferência", (await como(ids.financeiro, () => erroDe("select public.debt_import_discard($1)", [batch2]))) === null
    && (await um("select status from public.debt_import_batches where id = $1", [batch2])).status === "descartado");
  for (const fn of ["debt_import_stage('{}'::jsonb)", "debt_import_commit(gen_random_uuid(), true)", "_debt_import_supplier('{}'::jsonb)", "_debt_snapshot_month(current_date)"]) {
    const r = await (async () => { await c.query("savepoint an"); await c.query("set local role anon");
      try { await c.query(`select public.${fn}`); return "EXECUTOU"; } catch (e) { return e.code; } finally { await c.query("rollback to savepoint an"); } })();
    ok(`anônimo não executa ${fn.split("(")[0]} (veio ${r})`, r === "42501");
  }

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
