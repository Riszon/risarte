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

  // ESVAZIAR DISPUTA TRAVA COM O APP. O `truncate` precisa travar as 21 tabelas
  // de uma vez, e o servidor do sistema ainda tem conexões vivas do teste que
  // acabou de rodar — cada lado segurando o que o outro quer. O Postgres
  // detecta e derruba um dos dois: "deadlock detected", que foi como a suíte
  // falhou entre um teste e outro.
  //
  // A saída é insistir: o impasse é momentâneo, e some assim que o app solta o
  // que estava fazendo. O `lock_timeout` evita esperar para sempre — falhar
  // rápido e tentar de novo é melhor que travar a suíte inteira.
  let ultimoErro;
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    try {
      await db.query("set lock_timeout = '5s'");
      await db.query(
        `truncate ${existentes.join(", ")} restart identity cascade`
      );
      return { esvaziadas: existentes.length, faltando, tentativas: tentativa };
    } catch (e) {
      const transitorio =
        e.code === "40P01" /* deadlock */ || e.code === "55P03"; /* lock_timeout */
      if (!transitorio) throw e;
      ultimoErro = e;
      await new Promise((r) => setTimeout(r, 1000 * tentativa));
    }
  }
  throw new Error(
    `não consegui esvaziar depois de 5 tentativas: ${ultimoErro.message}`
  );
}

async function main() {
  const env = testEnv();
  console.log(
    `Limpando o movimento de ${env.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "")}\n`
  );

  const db = await connect();
  // Mesma razão do `seed-test.mjs`: conexão aberta segura o processo vivo para
  // sempre, e um erro no meio deixaria um programa pendurado na máquina.
  try {
    await limpar(db);
  } finally {
    await db.end().catch(() => {});
  }
}

async function limpar(db) {
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
}

// SÓ RODA QUANDO CHAMADO DIRETO. Este arquivo também é IMPORTADO (pelos testes
// e pelo `global-setup`) para reaproveitar `limparMovimento` — e, sem esta
// guarda, o simples `import` executava a limpeza inteira de novo, no carregar
// do módulo. Trabalho dobrado e, pior, um efeito que ninguém pediu.
// Sem `import.meta`: o Playwright carrega este arquivo pelo compilador dele, e
// lá `import.meta` não existe — a versão anterior derrubava a suíte inteira
// antes do primeiro teste.
const chamadoDireto = Boolean(
  process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/reset-test.mjs")
);

if (chamadoDireto) {
  main().catch((e) => {
    console.error("Erro ao limpar:", e.message);
    process.exitCode = 1;
  });
}
