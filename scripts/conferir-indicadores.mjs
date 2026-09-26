// AS ORIGENS DOS INDICADORES EXISTEM MESMO NO BANCO?
//
// Cada indicador do portão de certificação (`src/lib/certificacao.ts`) declara
// de onde o número sai: `clients.created_by`, `appointments.created_by +
// type=evaluation`, e assim por diante. Este script pergunta ao BANCO se cada
// tabela e cada coluna existem.
//
// ⚠️ POR QUE ELE EXISTE. A contagem da Etapa 2 vai ser escrita a partir dessas
// origens. Se alguém renomear uma coluna numa migração futura, nada quebra: a
// tela continua mostrando "0 de 5" para todo mundo, para sempre, e a conclusão
// natural de quem olha é "a pessoa não fez", não "a régua parou de medir".
// É exatamente a armadilha catalogada no §0d do CLAUDE.md — régua que não acha
// nada tem de GRITAR, nunca responder "não".
//
// Roda contra o banco de TREINO, que é onde a contagem vai acontecer.
// Só LÊ o catálogo do sistema (information_schema); não toca em dado nenhum.
//
// Uso:  npm run check:indicadores

import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQUIVO = "src/lib/certificacao.ts";

// Lê as origens do próprio catálogo. Regex e não `import` porque o catálogo é
// TypeScript e este script é Node puro — mesma escolha do check-migrations.
const fonte = readFileSync(ARQUIVO, "utf8");
const origens = [...fonte.matchAll(/chave:\s*"([^"]+)"[\s\S]*?origem:\s*"([^"]+)"/g)].map(
  (m) => ({ chave: m[1], origem: m[2] })
);

// ⚠️ RÉGUA VAZIA GRITA: zero origens significa que o formato do arquivo mudou e
// a varredura deixou de medir — não que está tudo certo.
if (origens.length === 0) {
  console.error(
    `RECUSADO: não achei nenhuma origem em ${ARQUIVO}.\n` +
      "Ou o arquivo mudou de formato, ou a busca quebrou. De qualquer modo,\n" +
      "esta conferência não está medindo nada — e um OK aqui seria mentira."
  );
  process.exit(1);
}

const db = await connect();

const { rows: colunas } = await db.query(
  `select table_schema as schema, table_name as tabela, column_name as coluna
     from information_schema.columns
    where table_schema in ('public', 'empresarial')`
);

if (colunas.length === 0) {
  console.error("RECUSADO: o banco não devolveu coluna nenhuma. Não dá para conferir.");
  await db.end();
  process.exit(1);
}

const existe = new Set(
  colunas.map((c) => `${c.schema}.${c.tabela}.${c.coluna}`)
);

const problemas = [];
console.log(`\nConferindo ${origens.length} indicador(es) contra o banco de treino.\n`);

for (const { chave, origem } of origens) {
  // "tabela.coluna + filtro" ou "schema.tabela.coluna + filtro".
  const caminho = origem.split(" + ")[0].trim();
  const partes = caminho.split(".");
  const chaveCompleta =
    partes.length === 3 ? caminho : `public.${caminho}`;

  if (!existe.has(chaveCompleta)) {
    problemas.push({ chave, origem, procurado: chaveCompleta });
  }
}

if (problemas.length > 0) {
  console.error(`✗ ${problemas.length} indicador(es) apontam para coluna que NÃO existe:\n`);
  for (const p of problemas) {
    console.error(`  ${p.chave.padEnd(28)} ${p.origem}`);
    console.error(`  ${"".padEnd(28)} procurei por: ${p.procurado}\n`);
  }
  console.error(
    "A contagem do portão sairia SEMPRE ZERO nesses indicadores, e quem\n" +
      "olhasse a tela concluiria que a pessoa não fez o trabalho.\n" +
      "Corrija a origem em src/lib/certificacao.ts ou o nome da coluna.\n"
  );
  await db.end();
  process.exit(1);
}

console.log(`✓ Todas as ${origens.length} origens existem no banco.`);
console.log("  A contagem da Etapa 2 pode ser escrita a partir delas.\n");

await db.end();
