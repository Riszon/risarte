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
  // ⚠️ ACRESCENTADAS EM 11/09/2026, quando `public.clients` passou do TRUNCATE
  // para o DELETE. Estas apontam para `clients` com chave RESTRITIVA (sem
  // `on delete cascade`): o truncate as apagava à força, o delete é barrado por
  // elas. São todas movimento — evento de funil, venda, negociação, adesão do
  // PPR — e precisam sair antes. A lista veio do BANCO, não de memória:
  // `npm run check:alcance` e a consulta de chaves que bloqueiam.
  "commercial_card_events",
  "commercial_followup_attempts",
  "direct_sales",
  "payment_renegotiations",
  "plan_cancellations",
  "ppr_beneficiaries",
  "ppr_benefit_usages",
  "ppr_memberships",
  "ppr_social_points",
];

/**
 * Esvazia as tabelas de movimento. Exportada porque a camada 3 chama isto no
 * começo de CADA execução: a suíte inteira criava paciente atrás de paciente e
 * o último teste passava a esperar telas cheias de avisos — dez minutos contra
 * três, sem nada de errado no sistema.
 */
/**
 * O QUE O CASCADE ALCANÇA ALÉM DA LISTA — perguntado ao BANCO, antes de apagar.
 *
 * ⚠️ ESCRITO DEPOIS DE APAGAR OS DADOS DE TESTE DO DONO (11/09/2026). A lista
 * `MOVIMENTO` tem 21 tabelas e o comentário acima dela dizia "nenhuma tabela de
 * cadastro entra aqui". Era verdade sobre a LISTA e falso sobre o EFEITO: o
 * `truncate ... cascade` alcançava **87 tabelas**, sete delas no schema
 * `empresarial` — colaboradores, dependentes, uso de benefício. O cascade
 * atravessa schema, e ninguém tinha medido isso.
 *
 * É a terceira aparição da mesma armadilha neste projeto (§0 do CLAUDE.md: o
 * truncate que levou junto o Risarte Academy). A lição de lá era "pergunte ao
 * BANCO o que existe, não às migrações". Aqui ela volta em outra roupa:
 * **pergunte ao BANCO o que o comando alcança, não à lista que você escreveu.**
 *
 * `PERMITIDAS_FORA_DA_LISTA` é a declaração explícita do que se aceita perder
 * junto. Tabela que aparecer e não estiver aqui DERRUBA a limpeza — quem mexer
 * na estrutura amanhã precisa decidir de propósito, não descobrir depois.
 */
const PERMITIDAS_FORA_DA_LISTA = new Set([
  // ⚠️ CADA LINHA AQUI É UMA DECISÃO, não uma exceção para calar o aviso.
  // Gerar a lista com `node scripts/alcance-do-truncate.mjs` e conferir uma a
  // uma: o que entra aqui É APAGADO a cada execução da suíte.
  //
  // `benefit_usage` é MOVIMENTO de verdade: cada linha registra um benefício
  // consumido num atendimento. Os atendimentos são apagados na limpeza, e um
  // registro de uso apontando para um atendimento que não existe mais não é
  // dado — é lixo que faria o painel de economia mentir.
  "empresarial.benefit_usage",
]);

/**
 * ⚠️ `public.clients` SAI DO TRUNCATE E VAI PARA UM `delete`.
 *
 * Esta é a correção de fundo do estrago de 11/09/2026, e a razão é uma só:
 *
 *   - `TRUNCATE ... CASCADE` **ignora** a regra da chave estrangeira e esvazia
 *     toda tabela que aponta para a truncada. `empresarial.employees.client_id`
 *     é `on delete set null` — e mesmo assim os colaboradores eram apagados.
 *   - `DELETE` **respeita** a regra: quem é `on delete cascade` cai junto (é o
 *     que se quer do movimento), e quem é `on delete set null` apenas perde o
 *     vínculo e **continua existindo**.
 *
 * Com isso, limpar o movimento deixa de apagar o cadastro do Risarte
 * Empresarial. É mais lento que truncar — e essa é a troca certa: a velocidade
 * da limpeza de teste não vale o cadastro de ninguém.
 */
const POR_DELETE = [
  // A ORDEM IMPORTA: `clients` aponta para `ppr_memberships`, então os
  // pacientes saem primeiro.
  "clients",
  // ⚠️ `ppr_memberships` VEIO PARAR AQUI PELA TRAVA, e isso é a trava fazendo o
  // trabalho dela. Eu tinha acabado de pô-la no TRUNCATE (ela bloqueia o delete
  // de `clients`), sem perceber que **`clients` aponta de volta para ela**
  // (`clients_ppr_membership_id_fkey`): truncá-la arrastaria os pacientes e,
  // por eles, o cadastro inteiro do Empresarial — o mesmo estrago, por outro
  // caminho. A trava recusou antes de apagar nada.
  "ppr_memberships",
];

async function conferirAlcance(db, listadas) {
  const { rows } = await db.query(
    `
    with recursive alvo as (
      select c.oid from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1)
      union
      select con.conrelid from pg_constraint con
        join alvo a on a.oid = con.confrelid
       where con.contype = 'f'
    )
    select n.nspname as schema, c.relname as tabela
      from alvo a
      join pg_class c on c.oid = a.oid
      join pg_namespace n on n.oid = c.relnamespace
    `,
    [listadas]
  );

  // ⚠️ RÉGUA VAZIA GRITA: sem nenhuma tabela alcançada, algo está errado com a
  // consulta — e seguir seria apagar às cegas.
  if (rows.length === 0) {
    throw new Error(
      "não consegui medir o alcance do cascade; a limpeza não roda às cegas"
    );
  }

  const naLista = new Set(listadas);
  const foraDoPublic = rows
    .filter((r) => r.schema !== "public")
    .map((r) => `${r.schema}.${r.tabela}`)
    .filter((nome) => !PERMITIDAS_FORA_DA_LISTA.has(nome));

  if (foraDoPublic.length > 0) {
    throw new Error(
      `RECUSADO: o cascade sairia do schema public e apagaria ${foraDoPublic.length} ` +
        `tabela(s) de OUTRO módulo: ${foraDoPublic.join(", ")}.\n` +
        `Isso já apagou dados de teste em 11/09/2026. Se for mesmo para apagar, ` +
        `declare cada uma em PERMITIDAS_FORA_DA_LISTA — de propósito, não por descuido.`
    );
  }

  return {
    alcancadas: rows.length,
    arrastadas: rows.filter(
      (r) => !(r.schema === "public" && naLista.has(r.tabela))
    ).length,
  };
}

export async function limparMovimento(db) {
  // Só trunca o que existe: tabela renomeada em migração futura não pode
  // derrubar a limpeza inteira e deixar metade do lixo para trás.
  const { rows } = await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1)`,
    [MOVIMENTO]
  );
  const nomes = rows.map((r) => r.table_name);
  const paraTruncar = nomes.filter((t) => !POR_DELETE.includes(t));
  const paraDeletar = nomes.filter((t) => POR_DELETE.includes(t));
  const existentes = paraTruncar.map((t) => `public.${t}`);
  const faltando = MOVIMENTO.filter((t) => !nomes.includes(t));

  // ⚠️ ANTES DE APAGAR, MEDIR O QUE VAI CAIR JUNTO. Sem isto, a limpeza fazia
  // exatamente o que dizia não fazer. A conferência é sobre o que vai ao
  // TRUNCATE — o `delete` respeita as regras e não arrasta ninguém.
  const alcance = await conferirAlcance(db, paraTruncar);

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
      // Depois do truncate: o `delete` que respeita `on delete set null` e
      // deixa o cadastro do Empresarial de pé. Vem por último porque as filhas
      // pesadas já foram embora — sobra pouco para o Postgres percorrer.
      for (const t of paraDeletar) {
        await db.query(`delete from public.${t}`);
      }
      return {
        esvaziadas: existentes.length + paraDeletar.length,
        faltando,
        tentativas: tentativa,
        alcance,
      };
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
