// APLICA TODAS AS MIGRAÇÕES NUM BANCO VAZIO — e, de quebra, prova que elas
// reconstroem o sistema do zero.
//
// O banco de produção cresceu uma migração por vez, ao longo de meses, sempre
// em cima do estado anterior. NINGUÉM NUNCA PROVOU que a pasta inteira, rodada
// do começo, produz o mesmo sistema — e é exatamente isso que precisará
// acontecer no dia em que a rede montar a segunda instalação. Cada erro que
// aparecer aqui é um erro que já existia, escondido.
//
// Roda cada arquivo em UMA TRANSAÇÃO: ou a migração inteira entra, ou nada
// dela entra. Migração aplicada pela metade deixa o banco num estado que nem o
// arquivo nem o histórico explicam.
//
// Guarda o que já aplicou em `schema_migrations`, então rodar de novo continua
// de onde parou em vez de repetir tudo.
//
// Uso:  node scripts/apply-migrations.mjs [--ate 0243]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, testEnv } from "./test-db.mjs";

const DIR = "supabase/migrations";
const limite = process.argv.includes("--ate")
  ? process.argv[process.argv.indexOf("--ate") + 1]
  : null;

async function main() {
  const env = testEnv();
  console.log(
    `Banco de teste: ${env.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "")}\n`
  );

  const client = await connect();

  await client.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now(),
      ms integer
    )
  `);

  const { rows: aplicadas } = await client.query(
    "select filename from public.schema_migrations"
  );
  const feitas = new Set(aplicadas.map((r) => r.filename));

  const arquivos = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !limite || f.slice(0, 4) <= limite);

  console.log(
    `${arquivos.length} migrações na pasta, ${feitas.size} já aplicadas.\n`
  );

  let novas = 0;
  for (const arquivo of arquivos) {
    if (feitas.has(arquivo)) continue;

    const sql = readFileSync(join(DIR, arquivo), "utf8");
    const inicio = Date.now();
    process.stdout.write(`\r${arquivo}`.padEnd(60).slice(0, 60));

    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into public.schema_migrations (filename, ms) values ($1, $2)",
        [arquivo, Date.now() - inicio]
      );
      await client.query("commit");
      novas++;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      console.log(`\r${"".padEnd(60)}`);
      console.log(`PAROU em ${arquivo}\n`);
      console.log(`  ${e.message}`);
      if (e.hint) console.log(`  dica do Postgres: ${e.hint}`);
      if (e.where) console.log(`  onde: ${e.where.split("\n")[0]}`);
      if (e.position) {
        // O Postgres dá a posição em caracteres; mostrar o trecho é o que
        // transforma "erro de sintaxe" em "esta linha aqui".
        const antes = sql.slice(0, Number(e.position));
        const linha = antes.split("\n").length;
        console.log(`  linha ${linha} do arquivo:`);
        for (const l of sql.split("\n").slice(Math.max(0, linha - 3), linha + 1)) {
          console.log(`    ${l}`);
        }
      }
      console.log(
        `\n${novas} migração(ões) aplicada(s) nesta rodada. As anteriores ficaram ` +
          `gravadas: consertar e rodar de novo continua daqui.`
      );
      await client.end();
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\r${"".padEnd(60)}`);
  console.log(
    novas === 0
      ? "Nada a aplicar — o banco de teste já está em dia."
      : `${novas} migração(ões) aplicada(s) sem erro.`
  );

  const { rows: contagem } = await client.query(`
    select
      (select count(*) from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE') as tabelas,
      (select count(*) from information_schema.routines
        where routine_schema = 'public') as funcoes,
      (select count(*) from information_schema.tables
        where table_schema = 'empresarial') as empresarial
  `);
  const c = contagem[0];
  console.log(
    `\nO banco ficou com ${c.tabelas} tabelas e ${c.funcoes} funções no schema ` +
      `public, mais ${c.empresarial} no empresarial.`
  );

  await client.end();
}

main().catch((e) => {
  console.error("\nErro:", e.message);
  process.exitCode = 2;
});
