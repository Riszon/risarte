// LIMPA O MOVIMENTO DO BANCO DE TESTE, mantendo o cenário.
//
// Some: pacientes, planos, negociações, vendas, cobranças, razão contábil,
// movimento de estoque, compras e avisos.
// Fica: clínicas, usuários e papéis, catálogo de procedimentos, itens de
// estoque, kits, fornecedores e o plano de contas.
//
// POR QUE EXISTE: a cada execução dos testes nasce um paciente novo, e a
// recepção acumula avisos de "agende a apresentação" que cobrem a tela. Depois
// de algumas rodadas o sistema fica lento e o teste passa a brigar com o
// próprio lixo que produziu, em vez de com o sistema.
//
// ⚠️ NUNCA roda contra a produção — a trava está em `test-db.mjs`, e é
// checada antes de qualquer comando.
//
// Uso:  node scripts/reset-test.mjs

import { connect, testEnv } from "./test-db.mjs";

// Em ordem NÃO importa: um `truncate ... cascade` só destas tabelas resolve as
// dependências entre elas. O que importa é a LISTA — nenhuma tabela de cadastro
// entra aqui, e é isso que separa "limpar o movimento" de "esvaziar o banco".
const MOVIMENTO = [
  "clients",
  "financial_entries",
  "payment_installments",
  "payment_receipts",
  "payables",
  "payable_payments",
  "commercial_sales",
  "plan_negotiations",
  "treatment_plans",
  "appointments",
  "notifications",
  "audit_logs",
  "stock_movements",
  "stock_balances",
  "stock_counts",
  "purchase_requests",
  "purchase_rounds",
  "purchase_orders",
  "purchase_receipts",
  "split_charges",
  "finance_alerts",
];

/**
 * Esvazia as tabelas de movimento. Exportada porque a camada 3 chama isto no
 * começo de CADA execução: a suíte inteira criava paciente atrás de paciente e
 * o último teste passava a esperar telas cheias de avisos — dez minutos contra
 * três, sem nada de errado no sistema.
 */
export async function limparMovimento(db) {
  // Só trunca o que existe: tabela renomeada em migração futura não pode
  // derrubar a limpeza inteira e deixar metade do lixo para trás.
  const { rows } = await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1)`,
    [MOVIMENTO]
  );
  const existentes = rows.map((r) => `public.${r.table_name}`);
  const faltando = MOVIMENTO.filter(
    (t) => !rows.some((r) => r.table_name === t)
  );
  await db.query(`truncate ${existentes.join(", ")} restart identity cascade`);
  return { esvaziadas: existentes.length, faltando };
}

async function main() {
  const env = testEnv();
  console.log(
    `Limpando o movimento de ${env.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "")}\n`
  );

  const db = await connect();
  const { esvaziadas, faltando } = await limparMovimento(db);

  console.log(`  ${esvaziadas} tabelas de movimento esvaziadas.`);
  if (faltando.length > 0) {
    console.log(
      `  ATENÇÃO: não existem no banco (nome mudou?): ${faltando.join(", ")}`
    );
  }

  const { rows: sobrou } = await db.query(`
    select
      (select count(*) from clinics) as clinicas,
      (select count(*) from profiles) as usuarios,
      (select count(*) from procedures) as procedimentos,
      (select count(*) from stock_items) as itens,
      (select count(*) from clients) as clientes
  `);
  const s = sobrou[0];
  console.log(
    `  Cenário intacto: ${s.clinicas} clínicas, ${s.usuarios} usuários, ` +
      `${s.procedimentos} procedimentos, ${s.itens} itens. ` +
      `Pacientes: ${s.clientes}.`
  );

  await db.end();
}

main().catch((e) => {
  console.error("Erro ao limpar:", e.message);
  process.exitCode = 1;
});
