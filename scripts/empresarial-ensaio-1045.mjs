// Ensaio da 1045 (as vagas do contrato conferidas pelo banco) — NO TREINO,
// numa transação DESFEITA. Nada fica gravado.
// Uso: node scripts/empresarial-ensaio-1045.mjs
//      QUEBRA=titular | QUEBRA=dependente | QUEBRA=termo  provam que reprova.
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

let n = 0;
const cpf = () => {
  n++;
  const s = String(90000000000 + n);
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
};
async function empresa(extra = {}) {
  const cols = ["cnpj", "legal_name", ...Object.keys(extra)];
  const vals = [`999999990001${String(10 + n++).padStart(2, "0")}`, "Ensaio 1045 (desfeito)", ...Object.values(extra)];
  const ph = vals.map((_, i) => `$${i + 1}`).join(", ");
  return (await q(`insert into empresarial.companies (${cols.join(", ")}) values (${ph}) returning id`, vals))[0].id;
}
const titular = async (company, status = "ACTIVE") =>
  (
    await q(
      `insert into empresarial.employees (company_id, cpf, full_name, phone, status, dependent_plan)
       values ($1, $2, 'Titular ensaio', '(43) 99999-0000', $3, 'NONE') returning id`,
      [company, cpf(), status]
    )
  )[0].id;
const insTitular = (company, status = "ACTIVE") =>
  erroDe(
    `insert into empresarial.employees (company_id, cpf, full_name, phone, status, dependent_plan)
     values ($1, $2, 'Titular ensaio', '(43) 99999-0000', $3, 'NONE')`,
    [company, cpf(), status]
  );
const insDependente = (employee, status = "ACTIVE") =>
  erroDe(
    `insert into empresarial.dependents (employee_id, cpf, relationship, status) values ($1, $2, 'CHILD', $3)`,
    [employee, cpf(), status]
  );

await db.query("begin");
try {
  let sql = readFileSync("supabase/migrations/1045_vagas_do_contrato_no_banco.sql", "utf8");
  const quebrar = (de, para) => {
    const antes = sql;
    sql = sql.replace(de, () => para);
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  };
  if (process.env.QUEBRA === "titular") quebrar("v_ativos > v_limite then\n      raise exception 'VAGAS_TITULARES", "v_ativos > v_limite + 1 then\n      raise exception 'VAGAS_TITULARES");
  if (process.env.QUEBRA === "dependente") quebrar("if tg_op = 'UPDATE' and old.status = 'ACTIVE' then return null; end if;\n\n  select e.company_id", "if tg_op = 'UPDATE' then return null; end if;\n\n  select e.company_id");
  if (process.env.QUEBRA === "termo") quebrar("and t.status = 'ACEITO'\n    ), 0)\n  end::integer\n  from empresarial.companies c\n  where c.id = p_company_id;\n$$;\n\ncreate or replace function empresarial._limite_de_dependentes_raw", "and t.status = 'NENHUM'\n    ), 0)\n  end::integer\n  from empresarial.companies c\n  where c.id = p_company_id;\n$$;\n\ncreate or replace function empresarial._limite_de_dependentes_raw");
  confere("a 1045 roda de novo sem erro (idempotente)", (await erroDe(sql)) === null);

  console.log("\nTitulares (contrato com 2):");
  const c1 = await empresa({ contracted_holders: 2 });
  await titular(c1);
  const t2 = await titular(c1);
  const e3 = await insTitular(c1);
  confere("o 3º titular ativo é recusado", /VAGAS_TITULARES:LIMIT:2:2/.test(e3 ?? ""), e3);
  confere("o 3º entra como INATIVO", (await insTitular(c1, "INACTIVE")) === null);
  const t3 = (await q("select id from empresarial.employees where company_id = $1 and status = 'INACTIVE'", [c1]))[0].id;
  const r1 = await erroDe("update empresarial.employees set status = 'ACTIVE' where id = $1", [t3]);
  confere("reativar o 3º (update direto) é recusado", /VAGAS_TITULARES:LIMIT:2:2/.test(r1 ?? ""), r1);
  const r2 = await erroDe("select empresarial.set_employee_active($1, true, null)", [t3]);
  confere("reativar o 3º pela função é recusado", /VAGAS_TITULARES:LIMIT:2:2/.test(r2 ?? ""), r2);
  confere("mudar o nome de um titular ativo passa", (await erroDe("update empresarial.employees set full_name = 'Outro nome' where id = $1", [t2])) === null);
  confere("salvar o mesmo status ATIVO passa", (await erroDe("update empresarial.employees set status = 'ACTIVE' where id = $1", [t2])) === null);

  await q(
    `insert into empresarial.company_inclusion_terms (company_id, code, holders, status) values ($1, 'TI-ENSAIO-1', 1, 'RASCUNHO')`,
    [c1]
  );
  confere("termo em RASCUNHO não libera", /VAGAS_TITULARES/.test((await erroDe("update empresarial.employees set status = 'ACTIVE' where id = $1", [t3])) ?? ""));
  await q("update empresarial.company_inclusion_terms set status = 'ACEITO' where company_id = $1", [c1]);
  confere("termo de inclusão ACEITO libera a reativação", (await erroDe("update empresarial.employees set status = 'ACTIVE' where id = $1", [t3])) === null);
  confere("depois do termo, o 4º é recusado (limite 3)", /VAGAS_TITULARES:LIMIT:3:3/.test((await insTitular(c1)) ?? ""));
  await q("update empresarial.employees set status = 'INACTIVE' where id = $1", [t2]);
  confere("quem sai devolve a vaga: o novo entra", (await insTitular(c1)) === null);

  console.log("\nMáximo da proposta:");
  const c2 = await empresa({ max_adhesions: 1, adhesion_limit_target: "HOLDERS" });
  const h2 = await titular(c2);
  confere("sem quantidade e máximo 1 (titulares): o 2º é recusado", /VAGAS_TITULARES:MAX:1:1/.test((await insTitular(c2)) ?? ""));
  confere("o máximo só de titulares não trava dependente", (await insDependente(h2)) === null && (await insDependente(h2)) === null);
  const c3 = await empresa({ max_adhesions: 1, adhesion_limit_target: "DEPENDENTS" });
  await titular(c3);
  confere("o máximo só de dependentes não trava titular", (await insTitular(c3)) === null);
  const c4 = await empresa({});
  for (let i = 0; i < 4; i++) await titular(c4);
  confere("contrato sem quantidade: sem trava", (await insTitular(c4)) === null);

  console.log("\nDependentes (contrato com 1):");
  const c5 = await empresa({ contracted_dependents: 1 });
  const a = await titular(c5);
  confere("o 1º dependente entra", (await insDependente(a)) === null);
  const d2 = await insDependente(a);
  confere("o 2º dependente é recusado", /VAGAS_DEPENDENTES:LIMIT:1:1/.test(d2 ?? ""), d2);
  confere("o 2º entra como INATIVO", (await insDependente(a, "INACTIVE")) === null);
  const dInativo = (await q("select id from empresarial.dependents where employee_id = $1 and status = 'INACTIVE'", [a]))[0].id;
  const d3 = await erroDe("update empresarial.dependents set status = 'ACTIVE' where id = $1", [dInativo]);
  confere("reativar o dependente é recusado", /VAGAS_DEPENDENTES:LIMIT:1:1/.test(d3 ?? ""), d3);
  const b = await titular(c5, "INACTIVE");
  confere("dependente de titular INATIVO não ocupa vaga (entra)", (await insDependente(b)) === null);
  const d4 = await erroDe("update empresarial.employees set status = 'ACTIVE' where id = $1", [b]);
  confere("o titular que volta com dependente ativo passa do teto: recusado", /VAGAS_DEPENDENTES:LIMIT:1:1/.test(d4 ?? ""), d4);
  await q(
    `insert into empresarial.company_inclusion_terms (company_id, code, dependents, status) values ($1, 'TI-ENSAIO-2', 1, 'ACEITO')`,
    [c5]
  );
  confere("com o termo aceito (+1 dependente), ele volta", (await erroDe("update empresarial.employees set status = 'ACTIVE' where id = $1", [b])) === null);

  console.log("\nA planilha (importar_titulares):");
  const c6 = await empresa({ contracted_dependents: 1 });
  const titCpf = cpf();
  const imp = await erroDe("select empresarial.importar_titulares($1, $2::jsonb, $3::jsonb)", [
    c6,
    JSON.stringify([{ cpf: titCpf, full_name: "Titular ensaio", phone: "(43) 99999-0000", email: null }]),
    JSON.stringify([
      { holder_cpf: titCpf, cpf: cpf(), full_name: "Dep 1", phone: null, relationship: "CHILD" },
      { holder_cpf: titCpf, cpf: cpf(), full_name: "Dep 2", phone: null, relationship: "CHILD" },
    ]),
  ]);
  confere("planilha que passa do teto de dependentes é recusada", /VAGAS_DEPENDENTES|DEPENDENT_LIMIT/.test(imp ?? ""), imp);
  confere("e nada fica gravado", Number((await q("select count(*) from empresarial.employees where company_id = $1", [c6]))[0].count) === 0);

  console.log("\nAs portas continuam com a guarda:");
  const t = (await q("select empresarial._limite_de_titulares_raw($1) l", [c1]))[0].l;
  confere("a conta interna soma contratado + termo aceito (2 + 1)", t === 3, String(t));
  const priv = await q(
    `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') logado, has_function_privilege('anon', p.oid, 'execute') anon
     from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'empresarial' and p.proname in ('_limite_de_titulares_raw','_limite_de_dependentes_raw','_dependentes_ativos_raw','_conferir_vagas_de_dependentes','vagas_do_titular','vagas_do_dependente','limite_de_titulares','limite_de_dependentes','dependentes_ativos')`
  );
  confere("as 6 internas fechadas a logados e anônimos", priv.filter((p) => p.proname.startsWith("_") || p.proname.startsWith("vagas")).every((p) => !p.logado && !p.anon));
  confere("as 3 portas abertas a logados, fechadas a anônimos", priv.filter((p) => !p.proname.startsWith("_") && !p.proname.startsWith("vagas")).every((p) => p.logado && !p.anon));
  const semLogin = await erroDe("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true); set local role anon; select empresarial.limite_de_titulares('" + c1 + "')");
  confere("sem login a porta recusa", /permission denied/.test(semLogin ?? ""), semLogin);
} catch (e) {
  falhas++;
  console.log("  ✘ ERRO:", e.message);
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} certo(s), ${falhas} falha(s). Transação DESFEITA: nada ficou no treino.`);
if (falhas > 0 || ok === 0) process.exit(1);
