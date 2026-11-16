// Ensaio da 1047 (importar empresas por planilha) — NO TREINO, numa
// transação DESFEITA. Nada fica gravado.
// Uso: node scripts/empresarial-ensaio-1047.mjs
//      QUEBRA=existe | QUEBRA=unidades  provam que reprova.
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

const empresa = (cnpj, extra = {}) => ({
  cnpj,
  legal_name: `Ensaio 1047 ${cnpj} (desfeito)`,
  trade_name: null,
  state_registration: null,
  category: "empresa_privada",
  status: "ACTIVE",
  contract_started_at: "2026-03-01",
  contracted_holders: 40,
  contracted_dependents: null,
  employee_count: null,
  main_clinic_id: null,
  payment_model: "COMPANY_PAYS",
  company_subsidy_type: null,
  company_subsidy_value: null,
  billing_basis: "PER_EMPLOYEE",
  fixed_monthly_cents: null,
  billing_model: "unico",
  due_day: 10,
  payment_methods: ["BOLETO", "PIX"],
  default_max_installments: 12,
  grace_period_days: 30,
  employee_grace_period_days: 0,
  responsible_name: null,
  responsible_role: null,
  responsible_cpf: null,
  responsible_email: null,
  responsible_phone: null,
  address: { city: "Londrina", state: "PR" },
  assigned_consultant_id: null,
  notes: "ensaio",
  ...extra,
});

await db.query("begin");
try {
  let sql = readFileSync("supabase/migrations/1047_importar_empresas.sql", "utf8");
  const quebrar = (de, para) => {
    const antes = sql;
    sql = sql.replace(de, () => para);
    if (sql === antes) throw new Error("NÃO MEDI: a quebra não achou o trecho");
  };
  if (process.env.QUEBRA === "existe") quebrar("raise exception 'DOCUMENT_EXISTS:%', v_doc;", "null;");
  if (process.env.QUEBRA === "unidades")
    quebrar("from jsonb_array_elements_text(coalesce(v_e -> 'unidades', '[]'::jsonb)) u;", "from jsonb_array_elements_text('[]'::jsonb) u;");
  confere("a 1047 roda de novo sem erro (idempotente)", (await erroDe(sql)) === null);

  const adm = (await q("select id from public.profiles where is_admin_master and is_active limit 1"))[0]?.id;
  const dentista = (
    await q(
      `select p.id from public.profiles p where p.is_active and not p.is_admin_master
         and exists (select 1 from public.user_clinic_roles_all r where r.user_id = p.id and r.role = 'dentist')
         and not exists (select 1 from public.user_clinic_roles_all r where r.user_id = p.id and r.role <> 'dentist')
       limit 1`
    )
  )[0]?.id;
  const unidades = (await q("select id from public.clinics where type = 'franchise_unit' and is_active order by name limit 2")).map((r) => r.id);
  if (!adm || !dentista || unidades.length < 2) throw new Error("NÃO MEDI: faltam admin, dentista ou 2 unidades no treino");

  const payload = [
    {
      empresa: empresa("99000000000101", { main_clinic_id: unidades[0] }),
      documentos: [
        { doc_type: "CNPJ", doc_number: "99000000000101", holder_cpf: null, is_primary: true, nickname: "Matriz" },
        { doc_type: "CNPJ", doc_number: "99000000000202", holder_cpf: null, is_primary: false, nickname: "Filial" },
      ],
      unidades: [unidades[0], unidades[1]],
      precos: {
        holder_fee_cents: 3500,
        dependent_individual_fee_cents: 3990,
        dependent_family_fee_cents: 5990,
        dependent_family_extra_fee_cents: 1990,
        dependent_mode: "PER_DEPENDENT",
      },
    },
    {
      empresa: empresa("99000000000303", {
        payment_model: "COMPANY_PARTIAL",
        company_subsidy_type: "PERCENT",
        company_subsidy_value: 50,
        billing_basis: "FIXED_PER_COMPANY",
        fixed_monthly_cents: 150050,
        billing_model: "por_cnpj",
        address: null,
      }),
      documentos: [{ doc_type: "CNPJ", doc_number: "99000000000303", holder_cpf: null, is_primary: true, nickname: "Matriz" }],
      unidades: [],
      precos: null,
    },
  ];

  console.log("\nO gestor importa:");
  await como(adm);
  const n = (await q("select empresarial.importar_empresas($1::jsonb) n", [JSON.stringify(payload)]))[0]?.n;
  await superusuario();
  confere("devolve 2 importadas", n === 2, String(n));
  const [a] = await q("select * from empresarial.companies where cnpj = '99000000000101'");
  confere("a empresa nasceu com o contrato e a cobrança da planilha",
    a && a.contract_started_at.toISOString().slice(0, 10) === "2026-03-01" && a.contracted_holders === 40 &&
    a.due_day === 10 && a.payment_methods.join(",") === "BOLETO,PIX" && a.default_max_installments === 12 &&
    a.grace_period_days === 30 && a.main_clinic_id === unidades[0] && a.address?.city === "Londrina",
    JSON.stringify(a && { inicio: a.contract_started_at, venc: a.due_day, formas: a.payment_methods }));
  const docs = await q("select doc_number, is_primary, nickname from empresarial.company_documents where company_id = $1 order by is_primary desc", [a.id]);
  confere("os 2 documentos, o principal marcado", docs.length === 2 && docs[0].is_primary && docs[0].doc_number === "99000000000101" && docs[1].nickname === "Filial");
  const uni = await q("select clinic_id from empresarial.company_clinics where company_id = $1", [a.id]);
  confere("as 2 unidades da parceria", uni.length === 2);
  const [preco] = await q("select * from empresarial.adhesion_pricing where company_id = $1", [a.id]);
  confere("os preços combinados (por dependente)", Number(preco?.holder_fee_cents) === 3500 && preco?.dependent_mode === "PER_DEPENDENT", JSON.stringify(preco && { t: preco.holder_fee_cents, m: preco.dependent_mode }));
  const [b] = await q("select * from empresarial.companies where cnpj = '99000000000303'");
  confere("2ª empresa: parcial 50% e valor fixo", b?.payment_model === "COMPANY_PARTIAL" && Number(b?.company_subsidy_value) === 50 && Number(b?.fixed_monthly_cents) === 150050 && b?.billing_basis === "FIXED_PER_COMPANY");
  confere("2ª empresa: sem preço próprio (vale o da rede)", (await q("select 1 from empresarial.adhesion_pricing where company_id = $1", [b.id])).length === 0);
  confere("nenhuma cobrança de implantação foi gerada",
    (await q("select 1 from empresarial.adhesion_billing where company_id = any($1::uuid[])", [[a.id, b.id]])).length === 0);

  console.log("\nTudo ou nada:");
  const antes = Number((await q("select count(*) from empresarial.companies"))[0].count);
  await como(adm);
  const dup = await erroDe("select empresarial.importar_empresas($1::jsonb)", [
    JSON.stringify([
      { ...payload[1], empresa: empresa("99000000000404"), documentos: [{ doc_type: "CNPJ", doc_number: "99000000000404", holder_cpf: null, is_primary: true, nickname: null }] },
      payload[0], // já existe
    ]),
  ]);
  await superusuario();
  confere("documento que já existe recusa com DOCUMENT_EXISTS", /DOCUMENT_EXISTS:99000000000101/.test(dup ?? ""), dup);
  confere("e a empresa nova do mesmo lote também não entrou", Number((await q("select count(*) from empresarial.companies"))[0].count) === antes);

  console.log("\nQuem não pode:");
  await como(dentista);
  const den = await erroDe("select empresarial.importar_empresas($1::jsonb)", [
    JSON.stringify([{ ...payload[1], empresa: empresa("99000000000505"), documentos: [{ doc_type: "CNPJ", doc_number: "99000000000505", holder_cpf: null, is_primary: true, nickname: null }] }]),
  ]);
  await superusuario();
  confere("o dentista é barrado pelas regras da tabela", /row-level security|permission denied/.test(den ?? ""), den);
  await como(null, "anon");
  const anon = await erroDe("select empresarial.importar_empresas('[]'::jsonb)");
  await superusuario();
  confere("sem login recusa", /permission denied/.test(anon ?? ""), anon);
} catch (e) {
  falhas++;
  console.log("  ✘ ERRO:", e.message);
} finally {
  await db.query("rollback");
  await db.end();
}
console.log(`\n${ok} certo(s), ${falhas} falha(s). Transação DESFEITA: nada ficou no treino.`);
if (falhas > 0 || ok === 0) process.exit(1);
