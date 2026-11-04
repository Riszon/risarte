// Ensaio da 0366 (backlog no banco) — NO TREINO, numa transação DESFEITA.
// Uso: node scripts/backlog-ensaio-0366.mjs
// Não deixa rastro: tudo roda entre BEGIN e ROLLBACK.
import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const db = await connect();
let ok = 0;
let falhas = 0;
function confere(nome, cond, extra = "") {
  if (cond) {
    ok++;
    console.log(`  ✔ ${nome}`);
  } else {
    falhas++;
    console.log(`  ✘ ${nome} ${extra}`);
  }
}

async function comoQuem(papel, sub) {
  await db.query("reset role");
  const claims = JSON.stringify(sub ? { sub, role: papel } : { role: papel });
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
  await db.query(`set local role ${papel}`);
}

async function erroDe(sql, params = []) {
  await db.query("savepoint s");
  try {
    await db.query(sql, params);
    await db.query("release savepoint s");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint s");
    return e.message;
  }
}

await db.query("begin");
try {
  // 0. Idempotente: a migração inteira de novo.
  let sql = readFileSync("supabase/migrations/0366_backlog_no_banco.sql", "utf8");
  // QUEBRA=guarda: prova de que o ensaio pega a guarda aberta (deve reprovar).
  if (process.env.QUEBRA === "guarda") {
    const antes = sql;
    sql = sql.replace("select coalesce(public.is_admin_master(), false)", () => "select true");
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  }
  confere("a 0366 roda de novo sem erro", (await erroDe(sql)) === null);

  const cats = await db.query("select count(*)::int n from public.backlog_categories");
  confere("as 8 categorias estão lá (sem duplicar)", cats.rows[0].n === 8, `(${cats.rows[0].n})`);

  const adm = await db.query(
    "select id from public.profiles where is_admin_master and is_active limit 1"
  );
  const comum = await db.query(
    "select id from public.profiles where not is_admin_master and is_active limit 1"
  );
  if (!adm.rows.length || !comum.rows.length) throw new Error("NÃO MEDI: faltam perfis no treino");
  const ADM = adm.rows[0].id;
  const COMUM = comum.rows[0].id;
  const antes = (await db.query("select count(*)::int n from public.backlog_items")).rows[0].n;

  // 1. Sem login.
  await comoQuem("anon");
  let e = await erroDe("select public.backlog_create_item('x','x','Defeito')");
  confere("sem login: abrir item recusa", /permission denied/.test(e ?? ""), e);
  e = await erroDe("select count(*) from public.backlog_items");
  confere("sem login: a tabela não abre", /permission denied/.test(e ?? "") || e === null, e);
  if (e === null) {
    const r = await db.query("select count(*)::int n from public.backlog_items");
    confere("sem login: nenhuma linha visível", r.rows[0].n === 0);
  }
  e = await erroDe("select public._backlog_can_write()");
  confere("sem login: a regra interna não responde", /permission denied/.test(e ?? ""), e);

  // 2. Logado, não Admin Master.
  await comoQuem("authenticated", COMUM);
  e = await erroDe("select public.backlog_create_item('x','x','Defeito')");
  confere("logado comum: abrir item recusa (NOT_ALLOWED)", /NOT_ALLOWED/.test(e ?? ""), e);
  e = await erroDe("select public.backlog_import_item('AP9999','x','x','Defeito','media','aberto',null,null,null,null,null)");
  confere("logado comum: importar recusa", /NOT_ALLOWED|permission denied/.test(e ?? ""), e);
  const vistos = (await db.query("select count(*)::int n from public.backlog_items")).rows[0].n;
  confere("logado comum: não vê nenhum item", vistos === 0, `(${vistos})`);
  e = await erroDe("insert into public.backlog_categories (name) values ('Pirata')");
  confere("logado comum: gravar direto na tabela recusa", e !== null, e);

  // 3. Admin Master pela tela.
  await comoQuem("authenticated", ADM);
  e = await erroDe("select public.backlog_import_item('AP9999','x','x','Defeito','media','aberto',null,null,null,null,null)");
  confere("Admin Master: importar é só da chave de serviço", /NOT_ALLOWED|permission denied/.test(e ?? ""), e);
  const c1 = await db.query(
    "select public.backlog_create_item('Ensaio A','detalhe','Defeito','alta','agenda') as code"
  );
  const codeA = c1.rows[0].code;
  confere("Admin Master: abre item com código AP", /^AP\d+$/.test(codeA), codeA);
  const vistosAdm = (await db.query("select count(*)::int n from public.backlog_items")).rows[0].n;
  confere("Admin Master: vê os itens", vistosAdm === antes + 1, `(${vistosAdm})`);
  e = await erroDe("select public.backlog_create_item('x','x','Categoria que não existe')");
  confere("categoria inexistente recusa", /CATEGORY_NOT_FOUND/.test(e ?? ""), e);
  e = await erroDe("select public.backlog_create_item('x','x','Defeito','altíssima')");
  confere("prioridade fora da régua recusa", /backlog_items_priority_ok/.test(e ?? ""), e);
  e = await erroDe("select public.backlog_create_item('x','x','Defeito','media',null,'resolvido')");
  confere("item novo não nasce resolvido", /STATUS_NOT_FOR_NEW_ITEM/.test(e ?? ""), e);

  await db.query("select public.backlog_update_item($1, p_priority => 'urgente', p_category => 'Segurança e LGPD', p_note => 'nota do ensaio')", [codeA]);
  await db.query("select public.backlog_update_item($1, p_status => 'resolvido', p_resolved_version => '0.399.0', p_resolution => 'feito')", [codeA]);
  const itA = (await db.query("select * from public.backlog_items where code = $1", [codeA])).rows[0];
  confere("mudar: prioridade gravada", itA.priority === "urgente");
  confere("resolver: data, versão e como", itA.resolved_at && itA.resolved_version === "0.399.0" && itA.resolution === "feito");
  const ev = await db.query(
    "select kind, from_value, to_value, author_id from public.backlog_item_events e join public.backlog_items i on i.id = e.item_id where i.code = $1 order by e.id",
    [codeA]
  );
  const kinds = ev.rows.map((r) => r.kind).join(",");
  confere("linha do tempo: criado, categoria, prioridade, nota, situação", kinds === "criado,categoria,prioridade,nota,situacao", kinds);
  confere("linha do tempo: autor é o Admin Master", ev.rows.every((r) => r.author_id === ADM));
  await db.query("select public.backlog_update_item($1, p_status => 'aberto')", [codeA]);
  const reaberto = (await db.query("select resolved_at, resolved_version from public.backlog_items where code = $1", [codeA])).rows[0];
  confere("reabrir limpa data e versão", reaberto.resolved_at === null && reaberto.resolved_version === null);
  e = await erroDe("select public.backlog_update_item('AP999999', p_priority => 'baixa')");
  confere("item inexistente recusa", /ITEM_NOT_FOUND/.test(e ?? ""), e);
  e = await erroDe("select public.backlog_save_category(null, 'defeito')");
  confere("categoria repetida (sem diferenciar maiúscula) recusa", /CATEGORY_EXISTS/.test(e ?? ""), e);
  const nova = (await db.query("select public.backlog_save_category(null, 'Ensaio cat', 5) as id")).rows[0].id;
  await db.query("select public.backlog_save_category($1, 'Ensaio cat 2', null, false)", [nova]);
  const cat = (await db.query("select name, active, sort_order from public.backlog_categories where id = $1", [nova])).rows[0];
  confere("categoria: cria, renomeia e desativa", cat.name === "Ensaio cat 2" && cat.active === false && cat.sort_order === 5);

  // 4. Chave de serviço (o comando das sessões e a importação).
  await comoQuem("service_role");
  const imp = await db.query(
    "select public.backlog_import_item('AP5000','Importado','texto','Melhoria','baixa','resolvido','agenda','2026-09-25','2026-09-26','0.283.0','ok') as ok"
  );
  confere("importar grava", imp.rows[0].ok === true);
  const imp2 = await db.query(
    "select public.backlog_import_item('AP5000','Outro','texto','Melhoria','baixa','aberto',null,null,null,null,null) as ok"
  );
  confere("importar de novo não duplica nem sobrescreve", imp2.rows[0].ok === false);
  const it5 = (await db.query("select title, status, origin, found_on::text f, (resolved_at at time zone 'America/Sao_Paulo')::date::text r from public.backlog_items where code='AP5000'")).rows[0];
  confere("importado: mantém título, situação, origem e datas", it5.title === "Importado" && it5.status === "resolvido" && it5.origin === "backlog_md" && it5.f === "2026-09-25" && it5.r === "2026-09-26", JSON.stringify(it5));
  const c2 = (await db.query("select public.backlog_create_item('Pela sessão','d','Melhoria', p_author_label => 'Sessão de ensaio') as code")).rows[0].code;
  confere("número novo = o maior + 1", c2 === "AP5001", c2);
  const ev2 = (await db.query("select author_id, author_label from public.backlog_item_events e join public.backlog_items i on i.id=e.item_id where i.code='AP5001'")).rows[0];
  confere("pela chave de serviço: a sessão assina o evento", ev2.author_id === null && ev2.author_label === "Sessão de ensaio");

  // 5. A linha do tempo só cresce.
  await db.query("reset role");
  e = await erroDe("update public.backlog_item_events set note = 'x' where true");
  confere("linha do tempo: alterar recusa (até para o dono do banco)", /BACKLOG_EVENTS_APPEND_ONLY/.test(e ?? ""), e);
  e = await erroDe("delete from public.backlog_item_events where true");
  confere("linha do tempo: apagar recusa", /BACKLOG_EVENTS_APPEND_ONLY/.test(e ?? ""), e);
  e = await erroDe("update public.backlog_items set status = 'resolvido' where code = 'AP5001'");
  confere("resolvido sem data não passa", /backlog_items_closed_ok/.test(e ?? ""), e);
  e = await erroDe("delete from public.backlog_categories where name = 'Melhoria'");
  confere("categoria com item não se apaga", /foreign key|violates/.test(e ?? ""), e);
  const aud = await db.query(
    "select count(*)::int n from pg_trigger where tgname = 'audit_capture_trg' and tgrelid in ('public.backlog_items'::regclass, 'public.backlog_categories'::regclass, 'public.backlog_item_reports'::regclass)"
  );
  confere("auditoria presa nas 3 tabelas de cadastro", aud.rows[0].n === 3, `(${aud.rows[0].n})`);
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} de ${ok + falhas} conferências passaram.`);
if (falhas || ok === 0) process.exit(1);
