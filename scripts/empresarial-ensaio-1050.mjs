// Ensaio da 1050 (revisar contrato, a trava, R4 e R7) — NO TREINO, numa
// transação DESFEITA. Nada fica gravado.
// Uso: node scripts/empresarial-ensaio-1050.mjs
//      QUEBRA=trava | QUEBRA=documento | QUEBRA=gestor  provam que reprova.
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
async function como(id, role = "authenticated") {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(id ? { sub: id, role } : { role })]);
  await db.query(`set local role ${role}`);
}
async function superusuario() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', '', true)");
}

await db.query("begin");
try {
  let sql = readFileSync("supabase/migrations/1050_revisao_do_contrato.sql", "utf8").replace(/\r\n/g, "\n");
  const quebrar = (de, para) => {
    const antes = sql;
    sql = sql.split(de).join(para);
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  };
  if (process.env.QUEBRA === "trava") quebrar("  ) and not empresarial._termos_liberados(new.id) then", "  ) and false then");
  if (process.env.QUEBRA === "documento")
    quebrar("  if r.document_file_id is null then raise exception 'DOCUMENT_REQUIRED'; end if;\n", "");
  if (process.env.QUEBRA === "gestor")
    quebrar(
      "  if auth.uid() is null or not empresarial.is_program_manager() then\n    raise exception 'NOT_ALLOWED';\n  end if;\n  if r.status <> 'RASCUNHO' then raise exception 'REVISION_CLOSED'; end if;\n  if r.document_file_id",
      "  if auth.uid() is null then\n    raise exception 'NOT_ALLOWED';\n  end if;\n  if r.status <> 'RASCUNHO' then raise exception 'REVISION_CLOSED'; end if;\n  if r.document_file_id"
    );
  const rerun = await erroDe(sql);
  confere("a 1050 roda de novo sem erro (idempotente)", rerun === null, rerun);

  const adm = (await q("select id from public.profiles where is_admin_master and is_active limit 1"))[0]?.id;
  const dentista = (
    await q(
      `select p.id from public.profiles p where p.is_active and not p.is_admin_master
         and exists (select 1 from public.user_clinic_roles_all r where r.user_id = p.id and r.role = 'dentist')
         and not exists (select 1 from public.user_clinic_roles_all r where r.user_id = p.id and r.role <> 'dentist')
       limit 1`
    )
  )[0]?.id;
  // Uma empresa antiga (fora da janela de criação), com titular e dependente.
  const [emp] = await q(
    `select c.id, c.due_day from empresarial.companies c
      where c.created_at < now() - interval '1 day'
        and exists (select 1 from empresarial.employees e join empresarial.dependents d on d.employee_id = e.id
                     where e.company_id = c.id and e.status = 'ACTIVE' and d.status = 'ACTIVE')
      order by c.created_at limit 1`
  );
  if (!adm || !dentista || !emp) throw new Error("NÃO MEDI: faltam admin, dentista ou empresa com dependente no treino");
  const outroDia = emp.due_day === 10 ? 11 : 10;

  console.log("\nA trava (R1):");
  await como(adm);
  const t1 = await erroDe("update empresarial.companies set due_day = $2 where id = $1", [emp.id, outroDia]);
  confere("mudar o vencimento direto recusa", /CONTRACT_TERMS_LOCKED/.test(t1 ?? ""), t1);
  const t2 = await erroDe("update empresarial.companies set notes = coalesce(notes, '') || ' ' where id = $1", [emp.id]);
  confere("o que não é regra (observações) continua livre", t2 === null, t2);
  const t3 = await erroDe(
    `insert into empresarial.adhesion_pricing (company_id, holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents)
     values ($1, 1, 1, 1, 1)
     on conflict (company_id) do update set holder_fee_cents = 1`,
    [emp.id]
  );
  confere("o preço próprio da empresa recusa", /CONTRACT_TERMS_LOCKED/.test(t3 ?? ""), t3);
  const t4 = await erroDe("insert into empresarial.company_price_tiers (company_id, min_quantity, price_cents) values ($1, 999, 1)", [emp.id]);
  confere("faixa nova recusa", /CONTRACT_TERMS_LOCKED/.test(t4 ?? ""), t4);
  const t5 = await erroDe("update empresarial.adhesion_pricing set max_installments = max_installments where company_id is null");
  confere("o preço da REDE (Configurações) não trava", t5 === null, t5);
  await superusuario();

  console.log("\nA criação da empresa (os primeiros minutos):");
  const [nova] = await q(
    `insert into empresarial.companies (cnpj, legal_name, payment_model, due_day)
     values ('99000000105001', 'Ensaio 1050 (desfeito)', 'COMPANY_PAYS', 5) returning id`
  );
  const n1 = await erroDe(
    `insert into empresarial.adhesion_pricing (company_id, holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents)
     values ($1, 3000, 3000, 5000, 1500)`,
    [nova.id]
  );
  confere("empresa recém-criada recebe o preço", n1 === null, n1);
  const n2 = await erroDe("update empresarial.companies set due_day = 7 where id = $1", [nova.id]);
  confere("e ainda ajusta as regras", n2 === null, n2);

  console.log("\nA revisão:");
  await como(null, "anon");
  const sem = await erroDe("select empresarial.open_contract_revision($1, 'motivo de teste longo')", [emp.id]);
  confere("sem login recusa", /permission denied/.test(sem ?? ""), sem);
  await como(dentista);
  const den = await erroDe("select empresarial.open_contract_revision($1, 'motivo de teste longo')", [emp.id]);
  confere("o dentista não abre", /NOT_ALLOWED/.test(den ?? ""), den);
  await como(adm);
  const curto = await erroDe("select empresarial.open_contract_revision($1, 'curto')", [emp.id]);
  confere("motivo curto recusa", /REASON_REQUIRED/.test(curto ?? ""), curto);
  const [{ id: rev }] = await q("select empresarial.open_contract_revision($1, 'Ensaio: novo vencimento e preço') id", [emp.id]);
  const [r0] = await q("select code, status, terms_before = terms_after igual from empresarial.contract_revisions where id = $1", [rev]);
  confere("abre com código e a foto das regras", /^RV-\d{5}$/.test(r0.code) && r0.status === "RASCUNHO" && r0.igual, JSON.stringify(r0));
  const dup = await erroDe("select empresarial.open_contract_revision($1, 'outra revisão ao mesmo tempo')", [emp.id]);
  confere("uma revisão aberta por empresa", /REVISION_OPEN:RV-/.test(dup ?? ""), dup);

  const [{ termos }] = await q("select terms_before termos from empresarial.contract_revisions where id = $1", [rev]);
  const novos = structuredClone(termos);
  novos.empresa.due_day = outroDia;
  novos.empresa.implantation_status = "JA_PAGA";
  novos.empresa.implantation_prepaid_holders = 7;
  novos.empresa.min_term_months = 12;
  novos.empresa.early_exit_fee_cents = 50000;
  novos.preco = {
    holder_fee_cents: 2990,
    dependent_individual_fee_cents: 2990,
    dependent_family_fee_cents: 4990,
    dependent_family_extra_fee_cents: 1490,
    dependent_family_size: 4,
    dependent_mode: "FAMILY_PACKAGE",
    max_installments: 12,
  };
  novos.faixas = [{ min_quantity: 50, price_cents: 2790 }];
  const sv = await erroDe("select empresarial.save_contract_revision($1, $2::jsonb, 'Ensaio: novo vencimento e preço')", [rev, JSON.stringify(novos)]);
  confere("salva a proposta", sv === null, sv);
  const semDoc = await erroDe("select empresarial.apply_contract_revision($1)", [rev]);
  confere("aplicar sem o aditivo recusa (R2)", /DOCUMENT_REQUIRED/.test(semDoc ?? ""), semDoc);

  await superusuario();
  const [arq] = await q(
    "insert into empresarial.company_files (company_id, file_type, file_name, storage_path) values ($1, 'aditivo', 'aditivo.pdf', $2) returning id",
    [emp.id, `${emp.id}/ensaio-1050-aditivo.pdf`]
  );
  const [outro] = await q(
    "insert into empresarial.company_files (company_id, file_type, file_name, storage_path) values ($1, 'outro', 'x.pdf', $2) returning id",
    [emp.id, `${emp.id}/ensaio-1050-outro.pdf`]
  );
  await como(adm);
  const errado = await erroDe("select empresarial.attach_contract_revision_document($1, $2)", [rev, outro.id]);
  confere("arquivo que não é aditivo recusa", /INVALID_DOCUMENT/.test(errado ?? ""), errado);
  const anexa = await erroDe("select empresarial.attach_contract_revision_document($1, $2)", [rev, arq.id]);
  confere("anexa o aditivo", anexa === null, anexa);

  await como(dentista);
  const denAp = await erroDe("select empresarial.apply_contract_revision($1)", [rev]);
  confere("quem não é gestor não aplica (R6)", /NOT_ALLOWED/.test(denAp ?? ""), denAp);
  await como(adm);
  const ap = await erroDe("select empresarial.apply_contract_revision($1)", [rev]);
  confere("o gestor aplica", ap === null, ap);
  await superusuario();
  const [c] = await q(
    "select due_day, implantation_status, implantation_prepaid_holders, min_term_months, early_exit_fee_cents from empresarial.companies where id = $1",
    [emp.id]
  );
  confere(
    "as regras novas estão na empresa",
    c.due_day === outroDia && c.implantation_status === "JA_PAGA" && c.implantation_prepaid_holders === 7 &&
      c.min_term_months === 12 && Number(c.early_exit_fee_cents) === 50000,
    JSON.stringify(c)
  );
  const [p] = await q("select holder_fee_cents, dependent_family_size from empresarial.adhesion_pricing where company_id = $1", [emp.id]);
  confere("o preço novo", Number(p?.holder_fee_cents) === 2990 && p?.dependent_family_size === 4, JSON.stringify(p));
  const f = await q("select min_quantity, price_cents from empresarial.company_price_tiers where company_id = $1", [emp.id]);
  confere("as faixas novas (as antigas saíram)", f.length === 1 && f[0].min_quantity === 50, JSON.stringify(f));
  const [r1] = await q("select status, applied_by, applied_terms_before is not null tem_antes from empresarial.contract_revisions where id = $1", [rev]);
  confere("a revisão fica APLICADA, com quem e o antes", r1.status === "APLICADA" && r1.applied_by === adm && r1.tem_antes, JSON.stringify(r1));
  const [cob] = await q(
    `select count(*)::int n from empresarial.dependents_implantation_coverage where company_id = $1 and reason like 'Revisão ' || $2 || '%'`,
    [emp.id, r0.code]
  );
  confere("já paga antes do sistema cobre os dependentes de hoje (R4 + R7)", cob.n > 0, JSON.stringify(cob));

  await como(adm);
  const denovo = await erroDe("select empresarial.apply_contract_revision($1)", [rev]);
  confere("aplicar de novo recusa", /REVISION_CLOSED/.test(denovo ?? ""), denovo);
  const depois = await erroDe("update empresarial.companies set due_day = 3 where id = $1", [emp.id]);
  confere("depois de aplicar, a trava volta", /CONTRACT_TERMS_LOCKED/.test(depois ?? ""), depois);

  const [{ id: rev2 }] = await q("select empresarial.open_contract_revision($1, 'Ensaio: sem nada mudar') id", [emp.id]);
  await q("select empresarial.attach_contract_revision_document($1, $2)", [rev2, arq.id]);
  const nada = await erroDe("select empresarial.apply_contract_revision($1)", [rev2]);
  confere("sem nenhuma mudança não aplica", /NO_CHANGES/.test(nada ?? ""), nada);
  const canc = await erroDe("select empresarial.cancel_contract_revision($1, 'Ensaio: desisti da revisão')", [rev2]);
  confere("cancela com motivo", canc === null, canc);
  const apagar = await erroDe("delete from empresarial.company_files where id = $1", [arq.id]);
  await superusuario();
  confere("o aditivo de revisão aplicada não se apaga", apagar !== null, apagar);

  console.log("\nA cobertura dos dependentes (R7):");
  const [e1] = await q("select id from empresarial.employees where company_id = $1 and status = 'ACTIVE' limit 1", [emp.id]);
  await como(adm);
  const semMotivo = await erroDe(
    "insert into empresarial.dependents_implantation_coverage (company_id, employee_id, dependents_covered, created_by) values ($1, $2, 1, $3)",
    [emp.id, e1.id, adm]
  );
  confere("cobertura sem cobrança exige motivo", /dependents_implantation_coverage_reason/.test(semMotivo ?? ""), semMotivo);
  const comMotivo = await erroDe(
    "insert into empresarial.dependents_implantation_coverage (company_id, employee_id, dependents_covered, reason, created_by) values ($1, $2, 1, 'coberto pela estimativa', $3)",
    [emp.id, e1.id, adm]
  );
  confere("quem cobra registra a cobertura com motivo", comMotivo === null, comMotivo);
  await como(dentista);
  const denCob = await erroDe(
    "insert into empresarial.dependents_implantation_coverage (company_id, employee_id, dependents_covered, reason, created_by) values ($1, $2, 1, 'tentativa de quem não cobra', $3)",
    [emp.id, e1.id, dentista]
  );
  await superusuario();
  confere("o dentista não registra cobertura", /row-level security|permission denied/.test(denCob ?? ""), denCob);

  const [conf] = await q(sql.slice(sql.lastIndexOf("select\n  (select count(*) from information_schema.columns")));
  confere(
    "a conferência da migração bate (4 · 2 · 3 · 5)",
    Number(conf.colunas_na_empresa) === 4 && Number(conf.tabelas) === 2 && Number(conf.gatilhos_da_trava) === 3 && Number(conf.portas) === 5,
    JSON.stringify(conf)
  );
} catch (e) {
  falhas++;
  console.log("  ✘ ERRO:", e.message);
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} certo(s), ${falhas} falha(s). Transação DESFEITA: nada ficou no treino.`);
if (falhas > 0 || ok === 0) process.exit(1);
