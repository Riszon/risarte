// Ensaio da 1049 (quem paga os dependentes) — NO TREINO, numa transação
// DESFEITA. Nada fica gravado.
// Uso: node scripts/empresarial-ensaio-1049.mjs
//      QUEBRA=regra | QUEBRA=trava | QUEBRA=planilha  provam que reprova.
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

// CPFs válidos gerados na hora (dígitos conferidos) e um CNPJ válido.
function cpfDeTeste() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const n of [9, 10]) {
    const soma = d.reduce((s, x, i) => s + x * (n + 1 - i), 0);
    const r = (soma * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join("");
}
const CPF_A = cpfDeTeste();
const CPF_B = cpfDeTeste();
const CNPJ = "11222333000181";

await db.query("begin");
try {
  let sql = readFileSync("supabase/migrations/1049_pagador_dos_dependentes.sql", "utf8").replace(/\r\n/g, "\n");
  const quebrar = (de, para) => {
    const antes = sql;
    sql = sql.replace(de, () => para);
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  };
  if (process.env.QUEBRA === "regra") quebrar("dependents_payer <> 'OUTRO'\n    or (", "true\n    or (");
  if (process.env.QUEBRA === "trava")
    quebrar(
      "on empresarial.adhesion_billing (company_id, company_document_id, employee_id, reference_month)",
      "on empresarial.adhesion_billing (company_id, company_document_id, reference_month)"
    );
  if (process.env.QUEBRA === "planilha")
    quebrar("case when upper(coalesce(t.dependents_payer, '')) = 'TITULAR' then 'TITULAR' else 'EMPRESA' end", "'EMPRESA'");
  // QUEBRA=trava: a trava antiga recusaria a cobrança à parte já existente no
  // banco? Não há nenhuma; o efeito aparece na conferência abaixo.
  confere("a 1049 roda de novo sem erro (idempotente)", (await erroDe(sql)) === null, await erroDe(sql));

  const [emp] = await q(
    `select e.id, e.company_id from empresarial.employees e
      join empresarial.companies c on c.id = e.company_id
     where e.status = 'ACTIVE' limit 1`
  );
  if (!emp) throw new Error("NÃO MEDI: o treino não tem titular ativo");
  confere("titular que já existia ficou com a EMPRESA (padrão)",
    (await q("select count(*)::int n from empresarial.employees where dependents_payer <> 'EMPRESA'"))[0].n === 0);

  console.log("\nA escolha no titular:");
  const upd = (pagador, nome, doc) =>
    erroDe(
      "update empresarial.employees set dependents_payer = $2, dependents_payer_name = $3, dependents_payer_document = $4 where id = $1",
      [emp.id, pagador, nome, doc]
    );
  confere("TITULAR aceita", (await upd("TITULAR", null, null)) === null);
  confere("OUTRO com CPF aceita", (await upd("OUTRO", "Fulano Pagador", CPF_B)) === null);
  confere("OUTRO com CNPJ aceita", (await upd("OUTRO", "Pagadora Ltda", CNPJ)) === null);
  confere("OUTRO sem documento recusa", /employees_dependents_payer_check/.test((await upd("OUTRO", "Fulano", null)) ?? ""));
  confere("OUTRO sem nome recusa", /employees_dependents_payer_check/.test((await upd("OUTRO", "  ", CPF_B)) ?? ""));
  confere("OUTRO com documento formatado recusa (só números)",
    /employees_dependents_payer_check/.test((await upd("OUTRO", "Fulano", "111.444.777-35")) ?? ""));
  confere("valor fora da lista recusa", /employees_dependents_payer_check/.test((await upd("QUALQUER", null, null)) ?? ""));

  console.log("\nA cobrança à parte e a trava do mês:");
  const mes = "2099-01-01";
  const cobrar = (employeeId, nome, doc, status = "PENDING") =>
    erroDe(
      `insert into empresarial.adhesion_billing
         (company_id, billing_type, total_amount_cents, reference_month, employee_id, payer_name, payer_document, status)
       values ($1, 'MONTHLY', 1000, $2, $3, $4, $5, $6)`,
      [emp.company_id, mes, employeeId, nome, doc, status]
    );
  confere("a cobrança da empresa entra", (await cobrar(null, null, null)) === null);
  confere("a cobrança à parte do titular entra no mesmo mês", (await cobrar(emp.id, "Titular", CPF_A)) === null);
  confere("a 2ª cobrança à parte do mesmo titular no mês recusa",
    /adhesion_billing_mensalidade_unica/.test((await cobrar(emp.id, "Titular", CPF_A)) ?? ""));
  confere("a 2ª cobrança da empresa no mês continua recusada",
    /adhesion_billing_mensalidade_unica/.test((await cobrar(null, null, null)) ?? ""));
  confere("cancelada não conta (entra de novo)", (await cobrar(emp.id, "Titular", CPF_A, "CANCELLED")) === null);
  confere("cobrança à parte sem quem paga recusa",
    /adhesion_billing_payer_check/.test((await cobrar(emp.id, null, null)) ?? ""));
  confere("cobrança à parte com nome e sem documento recusa",
    /adhesion_billing_payer_check/.test((await cobrar(emp.id, "Titular", null)) ?? ""));
  const [idx] = await q(
    "select indexdef from pg_indexes where schemaname = 'empresarial' and indexname = 'adhesion_billing_mensalidade_unica'"
  );
  confere("a trava conta o pagador", /employee_id/.test(idx?.indexdef ?? ""), idx?.indexdef);

  console.log("\nA planilha de titulares:");
  // Sem teto de titulares nesta transação: o ensaio mede a coluna, não as vagas (1045).
  await q("update empresarial.companies set contracted_holders = null, max_adhesions = null where id = $1", [emp.company_id]);
  const cpfs = await q("select cpf from empresarial.employees where company_id = $1", [emp.company_id]);
  const livre = (c) => !cpfs.some((r) => String(r.cpf).replace(/\D/g, "") === c);
  if (!livre(CPF_A) || !livre(CPF_B)) throw new Error("NÃO MEDI: os CPFs de teste já existem nesta empresa");
  const fmt = (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  const r = await erroDe("select empresarial.importar_titulares($1, $2::jsonb, '[]'::jsonb)", [
    emp.company_id,
    JSON.stringify([
      { cpf: fmt(CPF_A), full_name: "Ensaio 1049 Titular (desfeito)", phone: "(43) 99999-0000", email: null, dependents_payer: "TITULAR" },
      { cpf: fmt(CPF_B), full_name: "Ensaio 1049 Empresa (desfeito)", phone: "(43) 99999-0001", email: null },
    ]),
  ]);
  confere("a importação roda", r === null, r);
  const novos = await q(
    "select cpf, dependents_payer from empresarial.employees where company_id = $1 and cpf = any($2::text[])",
    [emp.company_id, [fmt(CPF_A), fmt(CPF_B)]]
  );
  const de = (c) => novos.find((n) => n.cpf === fmt(c))?.dependents_payer;
  confere("Titular na planilha → TITULAR", de(CPF_A) === "TITULAR", JSON.stringify(novos));
  confere("em branco → EMPRESA", de(CPF_B) === "EMPRESA", JSON.stringify(novos));

  const inicio = sql.lastIndexOf("select\n  (select count(*) from information_schema.columns");
  if (inicio < 0) throw new Error("NÃO MEDI: a conferência da migração não foi achada");
  const [conf] = await q(sql.slice(inicio));
  confere("a conferência da migração bate (3 · 3 · 2 · true · true)",
    Number(conf?.colunas_no_titular) === 3 && Number(conf?.colunas_na_cobranca) === 3 && Number(conf?.regras) === 2 &&
      conf?.trava_com_o_pagador === true && conf?.planilha_com_o_pagador === true,
    JSON.stringify(conf));
} catch (e) {
  falhas++;
  console.log("  ✘ ERRO:", e.message);
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} certo(s), ${falhas} falha(s). Transação DESFEITA: nada ficou no treino.`);
if (falhas > 0 || ok === 0) process.exit(1);
