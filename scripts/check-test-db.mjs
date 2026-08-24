// CONFERE SE O BANCO DE TESTE FICOU COMPLETO depois das migrações.
//
// "Rodou sem erro" não é o mesmo que "ficou igual". Migração pode ter um bloco
// `exception when others then null` (os do cron têm, de propósito) e passar
// batido; e semente que não entrou deixa o sistema montado e vazio, o que só
// aparece três telas adiante. Aqui a pergunta é outra: o que TEM de existir
// existe?

import { connect } from "./test-db.mjs";

const ESPERADO = [
  ["Plano de contas semeado", "select count(*) as n from chart_of_accounts", 20],
  // 15 é o número que bate com `USER_ROLES` em `src/lib/roles.ts`. Se um dia
  // divergir, é sinal de migração de papel que não chegou ao código (ou o
  // contrário) — e o sintoma seria papel que a tela oferece e o banco recusa.
  ["Papéis do enum", "select count(*) as n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'user_role'", 15],
  ["Buckets de arquivo", "select count(*) as n from storage.buckets", 6],
  ["Fases da jornada", "select count(*) as n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'journey_phase'", 7],
  ["Tipos de taxa da rede", "select count(*) as n from network_fee_types", 6],
  ["Políticas de RLS", "select count(*) as n from pg_policies where schemaname = 'public'", 200],
  ["Gatilhos", "select count(*) as n from pg_trigger where not tgisinternal", 30],
];

const client = await connect();

let falhas = 0;
for (const [nome, sql, minimo] of ESPERADO) {
  try {
    const { rows } = await client.query(sql);
    const n = Number(rows[0].n);
    const ok = n >= minimo;
    if (!ok) falhas++;
    console.log(
      `  ${ok ? "OK   " : "FALHA"}  ${nome.padEnd(24)} ${n}` +
        (ok ? "" : ` (esperado ao menos ${minimo})`)
    );
  } catch (e) {
    falhas++;
    console.log(`  FALHA  ${nome.padEnd(24)} ${e.message}`);
  }
}

// O plano de contas é a espinha do Financeiro: sem os seis grupos, DRE, fluxo
// de caixa e consolidado nascem vazios sem ninguém entender por quê.
const { rows: grupos } = await client.query(
  "select left(code, 1) as grupo, count(*) as n from chart_of_accounts group by 1 order by 1"
);
console.log(
  `\n  Grupos do plano de contas: ` +
    grupos.map((g) => `${g.grupo}(${g.n})`).join(" ")
);

const { rows: dados } = await client.query(`
  select
    (select count(*) from clinics) as clinicas,
    (select count(*) from profiles) as usuarios,
    (select count(*) from clients) as clientes,
    (select count(*) from financial_entries) as lancamentos
`);
console.log(
  `  Dados: ${dados[0].clinicas} clínicas, ${dados[0].usuarios} usuários, ` +
    `${dados[0].clientes} clientes, ${dados[0].lancamentos} lançamentos.`
);

// ---- o cenário semeado ------------------------------------------------------
// Estrutura sem cenário não encena nada: o teste ponta a ponta precisa de gente
// com papel, catálogo e kit. E o kit é o que faz a baixa automática existir —
// sem o vínculo com o procedimento, a sessão conclui e não consome nada.
const CENARIO = [
  ["Clínicas (1 rede + 2 unidades)", "select count(*) as n from clinics", 3],
  ["Uma unidade PRÓPRIA (consolidado)", "select count(*) as n from clinics where ownership = 'own' and type = 'franchise_unit'", 1],
  ["Papéis distintos com usuário", "select count(distinct role) as n from user_clinic_roles", 15],
  ["Ninguém acumula papel", "select case when count(*) = 0 then 1 else 0 end as n from (select user_id from user_clinic_roles group by user_id having count(distinct role) > 1) t", 1],
  ["Procedimentos no catálogo", "select count(*) as n from procedures", 7],
  ["Itens de estoque", "select count(*) as n from stock_items", 7],
  ["Kits", "select count(*) as n from stock_kits", 2],
  ["Kit ligado a procedimento", "select count(*) as n from procedure_kit_links", 1],
  ["Itens dentro dos kits", "select count(*) as n from stock_kit_items", 7],
  ["Fornecedores", "select count(*) as n from suppliers", 4],
];

if (Number(dados[0].clinicas) === 0) {
  console.log(
    "\n  Cenário ainda não semeado (rode `node scripts/seed-test.mjs`)."
  );
} else {
  console.log("");
  for (const [nome, sql, minimo] of CENARIO) {
    const { rows } = await client.query(sql);
    const n = Number(rows[0].n);
    const ok = n >= minimo;
    if (!ok) falhas++;
    console.log(
      `  ${ok ? "OK   " : "FALHA"}  ${nome.padEnd(34)} ${n}` +
        (ok ? "" : ` (esperado ao menos ${minimo})`)
    );
  }
}

console.log(falhas === 0 ? "\nEstrutura completa." : `\n${falhas} conferência(s) falharam.`);
await client.end();
process.exitCode = falhas === 0 ? 0 : 1;
