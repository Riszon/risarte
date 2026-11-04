// Ensaio da 0367 (relato → backlog) — NO TREINO, numa transação DESFEITA.
// Uso: node scripts/backlog-ensaio-0367.mjs   (QUEBRA=guarda prova que reprova)
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { connect } from "./test-db.mjs";

const db = await connect();
let ok = 0;
let falhas = 0;
const confere = (nome, cond, extra = "") => {
  if (cond) {
    ok++;
    console.log(`  ✔ ${nome}`);
  } else {
    falhas++;
    console.log(`  ✘ ${nome} ${extra ?? ""}`);
  }
};
async function comoQuem(papel, sub) {
  await db.query("reset role");
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role: papel } : { role: papel })]);
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
  let sql = readFileSync("supabase/migrations/0367_backlog_relatos_ligados.sql", "utf8");
  if (process.env.QUEBRA === "guarda") {
    const antes = sql;
    sql = sql.replace("  if not public._backlog_can_write() then\n    raise exception 'NOT_ALLOWED';\n  end if;\n  if p_ambiente", () => "  if p_ambiente");
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  }
  confere("a 0367 roda de novo sem erro", (await erroDe(sql)) === null);

  const adm = (await db.query("select id from public.profiles where is_admin_master and is_active limit 1")).rows[0]?.id;
  const comum = (await db.query("select id from public.profiles where not is_admin_master and is_active limit 1")).rows[0]?.id;
  const relato = (await db.query("select id, code from public.system_reports limit 1")).rows[0];
  if (!adm || !comum || !relato) throw new Error("NÃO MEDI: faltam perfis ou relato no treino");

  await comoQuem("authenticated", adm);
  const code = (await db.query("select public.backlog_create_item('Ensaio 0367','d','Defeito', p_origin => 'relato') as c")).rows[0].c;

  await comoQuem("anon");
  let e = await erroDe("select public.backlog_link_report($1,'sistema',$2,$3)", [code, relato.id, relato.code]);
  confere("sem login: ligar recusa", /permission denied/.test(e ?? ""), e);

  await comoQuem("authenticated", comum);
  e = await erroDe("select public.backlog_link_report($1,'sistema',$2,$3)", [code, relato.id, relato.code]);
  confere("logado comum: ligar recusa (NOT_ALLOWED)", /NOT_ALLOWED/.test(e ?? ""), e);

  await comoQuem("authenticated", adm);
  const r1 = (await db.query("select public.backlog_link_report($1,'sistema',$2,$3,'Título do relato') as n", [code, relato.id, relato.code])).rows[0].n;
  const r2 = (await db.query("select public.backlog_link_report($1,'sistema',$2,$3,'Título do relato') as n", [code, relato.id, relato.code])).rows[0].n;
  confere("Admin Master: liga o relato", r1 === true);
  confere("ligar de novo não duplica", r2 === false);
  const idTreino = randomUUID();
  const r3 = (await db.query("select public.backlog_link_report($1,'treino',$2,'OC-99999','Do treino') as n", [code, idTreino])).rows[0].n;
  confere("relato do treino (id que não existe aqui) também liga", r3 === true);
  const lig = (await db.query("select ambiente, report_code, report_title, linked_by from public.backlog_item_reports r join public.backlog_items i on i.id = r.item_id where i.code = $1 order by ambiente", [code])).rows;
  confere("a ligação guarda ambiente, código, título e quem ligou", lig.length === 2 && lig[0].report_title === "Título do relato" && lig[1].report_code === "OC-99999" && lig.every((l) => l.linked_by === adm), JSON.stringify(lig));
  const ev = (await db.query("select to_value from public.backlog_item_events e join public.backlog_items i on i.id = e.item_id where i.code = $1 and kind = 'relato' order by e.id", [code])).rows.map((r) => r.to_value);
  confere("linha do tempo: um evento por relato ligado", ev.length === 2 && ev[1] === "OC-99999 (treino)", JSON.stringify(ev));
  e = await erroDe("select public.backlog_link_report($1,'outro',$2,'X')", [code, relato.id]);
  confere("ambiente inválido recusa", /AMBIENTE_INVALIDO/.test(e ?? ""), e);
  e = await erroDe("select public.backlog_link_report('AP999999','sistema',$1,$2)", [relato.id, relato.code]);
  confere("item inexistente recusa", /ITEM_NOT_FOUND/.test(e ?? ""), e);
  e = await erroDe("select public.backlog_link_report($1,'sistema',$2,'')", [code, relato.id]);
  confere("sem código do relato recusa", /REPORT_REQUIRED/.test(e ?? ""), e);
  e = await erroDe("insert into public.backlog_item_reports (item_id, report_id, report_code) select id, gen_random_uuid(), 'X' from public.backlog_items where code = $1", [code]);
  confere("gravar direto na tabela recusa", e !== null, e);

  await comoQuem("service_role");
  const r4 = (await db.query("select public.backlog_link_report($1,'treino',$2,'OC-88888') as n", [code, randomUUID()])).rows[0].n;
  confere("chave de serviço (o comando) também liga", r4 === true);
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} de ${ok + falhas} conferências passaram.`);
if (falhas || ok === 0) process.exit(1);
