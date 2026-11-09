// Ensaio da 0371 (fornecedores: ficha, tipo configurável, abrangência e
// histórico) — NO TREINO, numa transação DESFEITA. Nada fica gravado.
// Uso: node scripts/fornecedores-ensaio-0371.mjs
//      QUEBRA=gerente  → tira a trava do Gerente (tem de reprovar)
//      QUEBRA=visao    → todo mundo vê todo fornecedor (tem de reprovar)
import { readFileSync } from "node:fs";
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
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
async function erroDe(sql, p = []) {
  await db.query("savepoint s");
  try {
    await db.query(sql, p);
    await db.query("release savepoint s");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint s");
    return e.message;
  }
}
async function como(id) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify(id ? { sub: id, role: "authenticated" } : { role: "anon" }),
  ]);
  await db.query(id ? "set local role authenticated" : "set local role anon");
}
const salvar = (p) => q("select public.save_supplier($1::jsonb) as id", [JSON.stringify(p)]);
const base = (extra) => ({
  name: "Fornecedor de ensaio",
  kind: "dental",
  document: "11.222.333/0001-81",
  phone: "(43) 9995-40246",
  ...extra,
});

await db.query("begin");
try {
  let sql = readFileSync("supabase/migrations/0371_fornecedores_ficha_abrangencia_historico.sql", "utf8");
  if (process.env.QUEBRA === "gerente") {
    const antes = sql;
    sql = sql.replace("  if not v_full then\n    if v_scope <> 'unidades' then", () => "  if false then\n    if v_scope <> 'unidades' then");
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  }
  if (process.env.QUEBRA === "visao") {
    const antes = sql;
    sql = sql.replace("  select (select auth.uid()) is not null and (\n    public.is_admin_master()", () => "  select (select auth.uid()) is not null and (\n    true");
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  }
  confere("a 0371 roda de novo sem erro", (await erroDe(sql)) === null);

  // Personagens: um Gerente que só gerencia UMA unidade (A); outra unidade (B)
  // onde ele não tem função; uma Coord. ou ASB de B; o Financeiro da Franqueadora.
  const ger = (await q(`
    select r.user_id, r.clinic_id from public.user_clinic_roles_all r
      join public.clinics c on c.id = r.clinic_id and c.type = 'franchise_unit'
      join public.profiles p on p.id = r.user_id and p.is_active and not p.is_admin_master
     where r.role = 'unit_manager'
       and not exists (select 1 from public.user_clinic_roles_all o where o.user_id = r.user_id and o.role in ('finance_franchisor','purchaser'))
       and (select count(*) from public.user_clinic_roles_all o where o.user_id = r.user_id and o.role = 'unit_manager') = 1
     limit 1`))[0];
  const fin = (await q(`
    select r.user_id from public.user_clinic_roles_all r
      join public.profiles p on p.id = r.user_id and p.is_active and not p.is_admin_master
     where r.role = 'finance_franchisor' limit 1`))[0];
  if (!ger || !fin) throw new Error("NÃO MEDI: faltam Gerente de uma unidade só e Financeiro da Franqueadora no treino");
  const A = ger.clinic_id;
  const asb = (await q(`
    select r.user_id, r.clinic_id from public.user_clinic_roles_all r
      join public.clinics c on c.id = r.clinic_id and c.type = 'franchise_unit'
      join public.profiles p on p.id = r.user_id and p.is_active and not p.is_admin_master
     where r.role in ('asb', 'clinical_coordinator') and r.clinic_id <> $1
       and not exists (select 1 from public.user_clinic_roles_all o where o.user_id = r.user_id and o.clinic_id = $1)
       and not exists (select 1 from public.user_clinic_roles_all o where o.user_id = r.user_id and o.role in ('finance_franchisor','purchaser','unit_manager','franchisee'))
     limit 1`, [A]))[0];
  if (!asb) throw new Error("NÃO MEDI: falta uma ASB ou Coordenador de outra unidade no treino");
  const B = asb.clinic_id;
  const franq = (await q("select id from public.clinics where type = 'franchisor' order by created_at limit 1"))[0].id;

  confere("19 tipos semeados", (await q("select count(*)::int n from public.supplier_kinds"))[0].n >= 19);
  confere("nenhum fornecedor ficou sem abrangência coerente",
    (await q(`select count(*)::int n from public.suppliers s
               where s.scope = 'unidades' and not exists (select 1 from public.supplier_clinics x where x.supplier_id = s.id)`))[0].n === 0);

  // --- Sem login
  await como(null);
  confere("sem login: gravar recusa", (await erroDe("select public.save_supplier('{}'::jsonb)")) !== null);
  confere("sem login: lista da unidade recusa", (await erroDe("select * from public.suppliers_for_clinic($1)", [A])) !== null);
  confere("sem login: histórico recusa", (await erroDe("select * from public.supplier_history(gen_random_uuid())")) !== null);

  // --- Financeiro da Franqueadora cadastra um da REDE e um só de B
  await como(fin.user_id);
  const rede = (await salvar(base({ name: "Ensaio rede", scope: "rede", owner_clinic_id: franq })))[0].id;
  const soB = (await salvar(base({ name: "Ensaio só B", scope: "unidades", clinic_ids: [B], document: "52998224725" })))[0].id;
  const soFranq = (await salvar(base({ name: "Ensaio só Franqueadora", scope: "franqueadora", owner_clinic_id: franq })))[0].id;
  confere("Financeiro grava fornecedor da rede", !!rede);
  confere("telefone gravado só com dígitos",
    (await q("select phone from public.suppliers where id = $1", [rede]))[0].phone === "43999540246");
  confere("tipo inexistente recusa",
    /tipo/i.test((await erroDe("select public.save_supplier($1::jsonb)", [JSON.stringify(base({ scope: "rede", kind: "nao_existe" }))])) ?? ""));
  confere("sem CNPJ/CPF recusa",
    /CNPJ/.test((await erroDe("select public.save_supplier($1::jsonb)", [JSON.stringify(base({ scope: "rede", document: "" }))])) ?? ""));
  confere("documento com 10 dígitos recusa",
    /CNPJ/.test((await erroDe("select public.save_supplier($1::jsonb)", [JSON.stringify(base({ scope: "rede", document: "1234567890" }))])) ?? ""));
  confere("'unidades' sem unidade recusa",
    /unidade/i.test((await erroDe("select public.save_supplier($1::jsonb)", [JSON.stringify(base({ scope: "unidades", clinic_ids: [] }))])) ?? ""));
  confere("Financeiro edita tipos", (await erroDe("insert into public.supplier_kinds (code, label) values ('ensaio_x', 'Ensaio')")) === null);
  confere("aviso de CNPJ repetido acha o outro",
    (await q("select count(*)::int n from public.supplier_same_document('11222333000181', $1)", [rede]))[0].n >= 2);

  // --- Gerente de A
  await como(ger.user_id);
  const lista = (await q("select id from public.suppliers_for_clinic($1)", [A])).map((r) => r.id);
  confere("Gerente de A vê o da rede na lista de A", lista.includes(rede));
  confere("Gerente de A NÃO vê o só de B", !(await q("select 1 from public.suppliers where id = $1", [soB])).length);
  confere("Gerente de A NÃO vê o só da Franqueadora", !(await q("select 1 from public.suppliers where id = $1", [soFranq])).length);
  const meu = (await salvar(base({ name: "Ensaio do Gerente", scope: "unidades", clinic_ids: [A], owner_clinic_id: A })))[0].id;
  confere("Gerente grava fornecedor da própria unidade", !!meu);
  confere("Gerente NÃO grava fornecedor da rede",
    (await erroDe("select public.save_supplier($1::jsonb)", [JSON.stringify(base({ scope: "rede" }))])) !== null);
  confere("Gerente NÃO põe unidade que não gerencia",
    (await erroDe("select public.save_supplier($1::jsonb)", [JSON.stringify(base({ scope: "unidades", clinic_ids: [A, B] }))])) !== null);
  confere("Gerente NÃO altera o da rede pela porta",
    (await erroDe("select public.save_supplier($1::jsonb)", [JSON.stringify(base({ id: rede, scope: "unidades", clinic_ids: [A] }))])) !== null);
  await db.query("savepoint d");
  const direto = await db.query("update public.suppliers set name = 'mexido' where id = $1", [rede]);
  await db.query("rollback to savepoint d");
  confere("Gerente NÃO altera o da rede direto na tabela", direto.rowCount === 0);
  confere("Gerente NÃO cria direto na tabela",
    (await erroDe("insert into public.suppliers (clinic_id, name, kind) values ($1, 'x', 'outros')", [A])) !== null);
  confere("Gerente NÃO edita tipos",
    (await erroDe("insert into public.supplier_kinds (code, label) values ('ensaio_y', 'Y')")) !== null);
  await salvar(base({ id: meu, name: "Ensaio do Gerente", scope: "unidades", clinic_ids: [A], phone: "4333334444" }));
  const hist = await q("select op, table_name, user_name, changes from public.supplier_history($1)", [meu]);
  confere("histórico mostra a inclusão", hist.some((h) => h.op === "I" && h.table_name === "suppliers"));
  confere("histórico mostra a unidade incluída", hist.some((h) => h.table_name === "supplier_clinics"));
  confere("histórico mostra a alteração do telefone",
    hist.some((h) => h.op === "U" && h.changes?.phone?.depois === "4333334444"));
  confere("histórico traz o nome de quem fez", hist.every((h) => h.user_name));

  // --- Coord. ou ASB de B (antes não via fornecedor nenhum)
  await como(asb.user_id);
  const listaB = (await q("select id from public.suppliers_for_clinic($1)", [B])).map((r) => r.id);
  confere("Coord. ou ASB de B vê o da rede e o só de B", listaB.includes(rede) && listaB.includes(soB));
  confere("Coord. ou ASB de B NÃO vê o do Gerente de A", !(await q("select 1 from public.suppliers where id = $1", [meu])).length);
  confere("Coord. ou ASB de B NÃO lê o histórico do de A", (await q("select 1 from public.supplier_history($1)", [meu])).length === 0);
  confere("Coord. ou ASB NÃO grava", (await erroDe("select public.save_supplier($1::jsonb)", [JSON.stringify(base({ scope: "unidades", clinic_ids: [B] }))])) !== null);

  // --- Financeiro troca o só de B para A+B: a unidade que entra aparece no histórico
  await como(fin.user_id);
  await salvar(base({ id: soB, name: "Ensaio só B", scope: "unidades", clinic_ids: [A, B], document: "52998224725" }));
  confere("unidade nova entra na lista",
    (await q("select count(*)::int n from public.supplier_clinics where supplier_id = $1", [soB]))[0].n === 2);
  await salvar(base({ id: soB, name: "Ensaio só B", scope: "rede", document: "52998224725" }));
  confere("virar 'rede' tira as unidades listadas",
    (await q("select count(*)::int n from public.supplier_clinics where supplier_id = $1", [soB]))[0].n === 0);
} catch (e) {
  falhas++;
  console.log(`  ✘ ERRO: ${e.message}`);
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} ok, ${falhas} falha(s). Transação desfeita — nada gravado.`);
process.exit(falhas ? 1 : 0);
