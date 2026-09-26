// AS ORIGENS DOS INDICADORES EXISTEM MESMO NO BANCO — POR INTEIRO?
//
// Cada indicador do portão de certificação (`src/lib/certificacao.ts`) diz de
// onde o número sai e QUANDO a ação aconteceu:
//
//   origem: "appointments.created_by + type=evaluation"
//   quando: "created_at"
//
// A contagem da Etapa 2 é `... where created_by = <pessoa>
// and type = 'evaluation' and created_at >= <clique que começou a missão>`.
// Este script pergunta ao BANCO se cada peça dessa frase existe.
//
// ⚠️ A PRIMEIRA VERSÃO DESTA RÉGUA MEDIA UM TERÇO DA FRASE (26/09/2026).
// Ela conferia só a coluna do autor. O indicador "planos enviados" apontava
// para `treatment_plan_status_events.changed_by + status=submitted` — a
// coluna `changed_by` existe, então a régua dizia OK. A coluna `status` NÃO
// existe (a tabela tem `from_stage`/`to_stage`, e guarda outra coisa). A
// contagem daria erro ou zero para sempre, com a régua verde do lado.
//
// Agora ela confere as TRÊS peças — autor, data e cada filtro — e, quando o
// filtro é uma lista fechada do banco (enum), confere também o VALOR: um
// `type=evalution` com erro de digitação casaria com nada, em silêncio.
//
// ⚠️ E A DATA TEM DE SER INSTANTE, NÃO DIA. O marco da missão é um instante
// (o clique às 14h07). Comparar com uma coluna só de data ("26/09") contaria
// o que a pessoa fez às 9h da manhã, ANTES de aceitar — exatamente o que a
// lei do marco proíbe.
//
// Roda contra o banco de TREINO, que é onde a contagem acontece. Só LÊ o
// catálogo do sistema (information_schema, pg_enum); não toca em dado nenhum.
//
// Uso:  npm run check:indicadores

import { readFileSync } from "node:fs";
import { connect } from "./test-db.mjs";

const ARQUIVO = "src/lib/certificacao.ts";
const fonte = readFileSync(ARQUIVO, "utf8");

const itens = [
  ...fonte.matchAll(
    /chave:\s*"([^"]+)"[\s\S]*?origem:\s*"([^"]+)",\s*\n\s*quando:\s*"([^"]+)"/g
  ),
].map((m) => ({ chave: m[1], origem: m[2], quando: m[3] }));

// ⚠️ RÉGUA VAZIA GRITA — e régua PARCIAL também. Se há mais chaves no arquivo
// do que itens lidos, algum indicador ficou sem `quando` (ou mudou de forma),
// e ele simplesmente não seria conferido.
const chaves = [...fonte.matchAll(/^\s*chave:\s*"([^"]+)"/gm)].length;
if (itens.length === 0 || itens.length !== chaves) {
  console.error(
    `RECUSADO: li ${itens.length} indicador(es) completos, mas o arquivo tem ${chaves} chave(s).\n` +
      "Algum indicador está sem `quando`, ou o formato do arquivo mudou.\n" +
      "Conferir só uma parte e dizer OK seria mentir sobre a outra parte."
  );
  process.exit(1);
}

/** "empresarial.lead_meetings.created_by + a=b" → partes. */
function ler(origem) {
  const [caminho, ...resto] = origem.split(" + ").map((x) => x.trim());
  const p = caminho.split(".");
  const schema = p.length === 3 ? p[0] : "public";
  const tabela = p.length === 3 ? p[1] : p[0];
  const coluna = p[p.length - 1];
  const filtros = resto.map((f) => {
    const [c, v] = f.split("=");
    return { coluna: c.trim(), valor: (v ?? "").trim() };
  });
  return { schema, tabela, coluna, filtros };
}

const db = await connect();

const { rows: colunas } = await db.query(
  `select table_schema s, table_name t, column_name c, data_type d, udt_name u
     from information_schema.columns
    where table_schema in ('public', 'empresarial')`
);
if (colunas.length === 0) {
  console.error("RECUSADO: o banco não devolveu coluna nenhuma. Não dá para conferir.");
  await db.end();
  process.exit(1);
}
const col = new Map(colunas.map((r) => [`${r.s}.${r.t}.${r.c}`, r]));

const { rows: rotulos } = await db.query(
  `select t.typname u, e.enumlabel v
     from pg_type t join pg_enum e on e.enumtypid = t.oid`
);
const enumDe = new Map();
for (const r of rotulos) {
  if (!enumDe.has(r.u)) enumDe.set(r.u, new Set());
  enumDe.get(r.u).add(r.v);
}

const problemas = [];
for (const { chave, origem, quando } of itens) {
  const o = ler(origem);
  const base = `${o.schema}.${o.tabela}`;

  if (!col.has(`${base}.${o.coluna}`)) {
    problemas.push({ chave, erro: `a coluna do AUTOR ${base}.${o.coluna} não existe` });
  }

  const q = col.get(`${base}.${quando}`);
  if (!q) {
    problemas.push({ chave, erro: `a coluna de DATA ${base}.${quando} não existe` });
  } else if (!q.d.startsWith("timestamp")) {
    problemas.push({
      chave,
      erro:
        `a coluna de DATA ${base}.${quando} é "${q.d}", não um instante — ` +
        `contaria o que foi feito ANTES do clique no mesmo dia`,
    });
  }

  for (const f of o.filtros) {
    const fc = col.get(`${base}.${f.coluna}`);
    if (!fc) {
      problemas.push({ chave, erro: `a coluna do FILTRO ${base}.${f.coluna} não existe` });
      continue;
    }
    if (!f.valor) {
      problemas.push({ chave, erro: `o filtro "${f.coluna}" está sem valor` });
      continue;
    }
    // Enum: o valor tem de ser um dos rótulos. Texto livre não tem como
    // conferir aqui — e está dito, em vez de fingir que foi conferido.
    const rot = enumDe.get(fc.u);
    if (fc.d === "USER-DEFINED" && rot && !rot.has(f.valor)) {
      problemas.push({
        chave,
        erro:
          `o valor "${f.valor}" não existe em ${fc.u} ` +
          `(valores: ${[...rot].join(", ")})`,
      });
    }
  }
}

console.log(`\nConferindo ${itens.length} indicador(es) contra o banco de treino.`);
console.log("Peças conferidas em cada um: autor, data (tem de ser instante) e filtros.\n");

if (problemas.length > 0) {
  console.error(`✗ ${problemas.length} problema(s):\n`);
  for (const p of problemas) console.error(`  ${p.chave.padEnd(32)} ${p.erro}`);
  console.error(
    "\nA contagem desses indicadores sairia errada ou SEMPRE ZERO, e quem\n" +
      "olhasse a tela concluiria que a pessoa não fez o trabalho.\n" +
      "Corrija em src/lib/certificacao.ts.\n"
  );
  await db.end();
  process.exit(1);
}

const comFiltro = itens.filter((i) => i.origem.includes(" + ")).length;
console.log(`✓ Todas as ${itens.length} origens existem por inteiro.`);
console.log(`  ${comFiltro} usam filtro; valores de enum conferidos, texto livre não.\n`);
await db.end();
