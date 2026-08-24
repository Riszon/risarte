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
    `${dados[0].clientes} clientes, ${dados[0].lancamentos} lançamentos ` +
    `(banco novo começa zerado — é o esperado).`
);

console.log(falhas === 0 ? "\nEstrutura completa." : `\n${falhas} conferência(s) falharam.`);
await client.end();
process.exitCode = falhas === 0 ? 0 : 1;
