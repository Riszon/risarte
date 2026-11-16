// Ensaio da 1048 (as permissões do Empresarial na matriz) — NO TREINO, numa
// transação DESFEITA. Nada fica gravado.
//
// A prova principal: com a matriz padrão, NINGUÉM ganha nem perde nada. Para
// cada papel, mede o que a pessoa pode ANTES e DEPOIS da 1048, na mesma
// transação, e compara. Depois prova que mexer na matriz muda de verdade.
//
// Uso: node scripts/empresarial-ensaio-1048.mjs
//      QUEBRA=gerir | QUEBRA=carteira  provam que reprova.
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
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
  await db.query("set local role authenticated");
}
async function superusuario() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', '', true)");
}

/** O que a pessoa pode, medido no banco com a sessão dela. */
async function retrato(id) {
  await como(id);
  const [r] = await q(`
    select empresarial.is_program_manager() gestor,
           empresarial.is_program_finance() financeiro,
           empresarial.can_manage_employees() titulares,
           (select count(*)::int from empresarial.accessible_company_ids()) alcance,
           (select count(*)::int from empresarial.companies) empresas,
           (select count(*)::int from empresarial.commercial_leads) leads,
           (select count(*)::int from empresarial.employees) titulares_vistos`);
  // O efeito, não só a marca: "levar à unidade" passa das guardas? (titular
  // que não existe: passar = EMPLOYEE_NOT_FOUND; barrar = NOT_ALLOWED).
  const e = await erroDe("select empresarial.complete_employee('00000000-0000-0000-0000-000000000000', null)");
  r.leva_a_unidade = /EMPLOYEE_NOT_FOUND/.test(e ?? "") ? true : /NOT_ALLOWED/.test(e ?? "") ? false : `?${e}`;
  await superusuario();
  return r;
}

const PAPEIS = [
  "franchisor_staff", "finance_franchisor", "rislife_consultant", "sdr", "receptionist",
  "unit_manager", "franchisee", "dentist", "clinical_coordinator", "commercial_consultant",
];

await db.query("begin");
try {
  let sql = readFileSync("supabase/migrations/1048_permissoes_do_empresarial_na_matriz.sql", "utf8");
  const quebrar = (de, para) => {
    const antes = sql;
    sql = sql.replace(de, () => para);
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  };
  if (process.env.QUEBRA === "gerir")
    quebrar("when 'acao.empresarial.gerir' then array['franchisor_staff']", "when 'acao.empresarial.gerir' then array['finance_franchisor']");
  if (process.env.QUEBRA === "carteira")
    quebrar("select (select auth.uid()) is not null\n     and empresarial.pode('acao.empresarial.carteira')", "select (select auth.uid()) is not null");

  // Uma pessoa por papel (a que tem SÓ aquele papel, quando há).
  const pessoas = [];
  for (const papel of PAPEIS) {
    const [p] = await q(
      `select r.user_id id from public.user_clinic_roles_all r
         join public.profiles pr on pr.id = r.user_id and pr.is_active and not pr.is_admin_master
        where r.role = $1
        group by r.user_id
        order by (select count(distinct r2.role) from public.user_clinic_roles_all r2 where r2.user_id = r.user_id)
        limit 1`,
      [papel]
    );
    if (p) pessoas.push({ papel, id: p.id });
  }
  if (pessoas.length < 6) throw new Error(`NÃO MEDI: só ${pessoas.length} papéis com gente no treino`);
  const adm = (await q("select id from public.profiles where is_admin_master and is_active limit 1"))[0]?.id;

  console.log("\nAntes e depois, com a matriz padrão (ninguém ganha nem perde nada):");
  const antes = new Map();
  for (const p of pessoas) antes.set(p.papel, await retrato(p.id));
  const antesAdm = await retrato(adm);

  confere("a 1048 roda sem erro", (await erroDe(sql)) === null);
  confere("e roda de novo sem erro (idempotente)", (await erroDe(sql)) === null);

  const semeadas = (await q("select count(distinct capability)::int n from public.permission_matrix where capability like 'acao.empresarial.%'"))[0].n;
  confere("as 5 permissões foram semeadas", semeadas === 5, String(semeadas));

  for (const p of pessoas) {
    const a = antes.get(p.papel);
    const d = await retrato(p.id);
    const mudou = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]));
    // ⚠️ A ÚNICA diferença esperada: a MARCA "cadastra titulares" do Consultor
    // RisLife. O app sempre deixou (canWorkOnCompanies) e a regra da tabela
    // também (is_my_company); só a função do banco dizia não. O EFEITO
    // (levar à unidade) continua barrado — conferido em leva_a_unidade.
    const esperado = p.papel === "rislife_consultant" && mudou.length === 1 && mudou[0] === "titulares" && d.leva_a_unidade === false;
    confere(
      `${p.papel}: igual antes e depois${esperado ? " (só a marca de titulares, alinhada ao app)" : ""}`,
      mudou.length === 0 || esperado,
      `mudou: ${mudou.join(", ")} · antes ${JSON.stringify(a)} depois ${JSON.stringify(d)}`
    );
  }
  confere("Admin Master: igual antes e depois", JSON.stringify(antesAdm) === JSON.stringify(await retrato(adm)));

  console.log("\nMexer na matriz muda de verdade:");
  const id = (papel) => pessoas.find((p) => p.papel === papel)?.id;
  const tira = (cap, papel) => q("delete from public.permission_matrix where capability = $1 and role = $2", [cap, papel]);
  const da = (cap, papel) => q("insert into public.permission_matrix (capability, role) values ($1, $2) on conflict do nothing", [cap, papel]);

  if (id("franchisor_staff")) {
    await tira("acao.empresarial.gerir", "franchisor_staff");
    const r = await retrato(id("franchisor_staff"));
    confere("tirar “Gerir” da Equipe da Franqueadora: deixa de ser gestor", r.gestor === false, JSON.stringify(r));
    await da("acao.empresarial.gerir", "franchisor_staff");
  }
  if (id("unit_manager")) {
    await da("acao.empresarial.gerir", "unit_manager");
    const r = await retrato(id("unit_manager"));
    confere("dar “Gerir” ao Gerente: passa a ver todas as empresas", r.gestor === true && r.empresas === Number((await q("select count(*) from empresarial.companies"))[0].count), JSON.stringify(r));
    await tira("acao.empresarial.gerir", "unit_manager");
  }
  if (id("dentist")) {
    await da("acao.empresarial.titulares", "dentist");
    const r = await retrato(id("dentist"));
    confere("dar “Titulares” ao Dentista: pode cadastrar titulares", r.titulares === true);
    await tira("acao.empresarial.titulares", "dentist");
  }
  if (id("receptionist")) {
    await tira("acao.empresarial.titulares", "receptionist");
    const r = await retrato(id("receptionist"));
    confere("tirar “Titulares” da Recepção: não cadastra mais", r.titulares === false);
    // E o banco recusa mesmo pela porta de inativar (security definer).
    const [e] = await q("select id from empresarial.employees limit 1");
    if (e) {
      await como(id("receptionist"));
      const err = await erroDe("select empresarial.set_employee_active($1, false, null)", [e.id]);
      await superusuario();
      confere("…e a porta de inativar titular recusa", /NOT_ALLOWED/.test(err ?? ""), err);
    }
    await da("acao.empresarial.titulares", "receptionist");
  }
  if (id("finance_franchisor")) {
    await tira("acao.empresarial.cobrancas", "finance_franchisor");
    const r = await retrato(id("finance_franchisor"));
    confere("tirar “Cobranças” do Financeiro da Franqueadora: perde as cobranças", r.financeiro === false);
    await da("acao.empresarial.cobrancas", "finance_franchisor");
  }
  if (id("unit_manager")) {
    await da("acao.empresarial.configurar", "unit_manager");
    await como(id("unit_manager"));
    const [r] = await q("select empresarial.can_configure_program() c");
    const gravar = await erroDe("update empresarial.funnel_settings set updated_at = updated_at");
    await superusuario();
    confere("dar “Configurações” ao Gerente: o banco deixa mexer na regra da rede", r.c === true && gravar === null, gravar);
    await tira("acao.empresarial.configurar", "unit_manager");
  }

  // A carteira: o consultor responsável só alcança o que é dele, e só com a permissão.
  const [lead] = await q("select id, consultant_id from empresarial.commercial_leads where consultant_id is not null limit 1");
  if (lead) {
    const temCarteira = (await q("select 1 from public.user_clinic_roles_all where user_id = $1 and role = 'rislife_consultant'", [lead.consultant_id])).length > 0;
    await como(lead.consultant_id);
    const [a] = await q("select empresarial.can_access_lead($1) v", [lead.id]);
    await superusuario();
    const papeisDele = (await q("select distinct role from public.user_clinic_roles_all where user_id = $1", [lead.consultant_id])).map((r) => r.role);
    for (const pp of papeisDele) await tira("acao.empresarial.carteira", pp);
    await como(lead.consultant_id);
    const [b] = await q("select empresarial.can_access_lead($1) v, empresarial.is_program_manager() g", [lead.id]);
    await superusuario();
    confere("tirar “Carteira”: o responsável perde o lead (se não for gestor)", b.g === true || b.v === false, JSON.stringify({ antes: a.v, depois: b.v, temCarteira }));
  } else {
    console.log("  (sem lead com consultor no treino: a carteira foi provada só pelo padrão)");
  }

  // E a empresa: o consultor responsável edita a dele só com a "carteira".
  const [emp] = await q("select id, assigned_consultant_id u from empresarial.companies where assigned_consultant_id is not null limit 1");
  if (emp) {
    const papeis = (await q("select distinct role from public.user_clinic_roles_all where user_id = $1", [emp.u])).map((r) => r.role);
    for (const pp of papeis) await da("acao.empresarial.carteira", pp);
    await como(emp.u);
    const [com] = await q("select empresarial.is_my_company($1) v", [emp.id]);
    await superusuario();
    for (const pp of papeis) await tira("acao.empresarial.carteira", pp);
    await como(emp.u);
    const [sem] = await q("select empresarial.is_my_company($1) v", [emp.id]);
    await superusuario();
    confere("a empresa do responsável: “sua” com a Carteira, não sem ela", com.v === true && sem.v === false, JSON.stringify({ com: com.v, sem: sem.v }));
  } else {
    throw new Error("NÃO MEDI: nenhuma empresa com consultor responsável no treino");
  }

  console.log("\nAs portas:");
  await como(null);
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
  await db.query("set local role anon");
  const anon = await erroDe("select empresarial.pode('acao.empresarial.gerir')");
  await superusuario();
  confere("sem login, a pergunta à matriz recusa", /permission denied/.test(anon ?? ""), anon);
} catch (e) {
  falhas++;
  console.log("  ✘ ERRO:", e.message);
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} certo(s), ${falhas} falha(s). Transação DESFEITA: nada ficou no treino.`);
if (falhas > 0 || ok === 0) process.exit(1);
