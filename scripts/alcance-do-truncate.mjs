/**
 * O QUE O `truncate ... cascade` DA LIMPEZA REALMENTE ESVAZIA.
 *
 * ⚠️ ESCRITO DEPOIS DE ELE APAGAR OS DADOS DE TESTE DO DONO (11/09/2026). A
 * lista `MOVIMENTO` em `reset-test.mjs` tem 21 tabelas e o comentário ao lado
 * diz "nenhuma tabela de cadastro entra aqui". Isso é verdade sobre a LISTA e
 * falso sobre o EFEITO: `truncate ... cascade` esvazia também toda tabela que
 * aponta para as listadas — inclusive **em outro schema**.
 *
 * `public.clients` está na lista. `empresarial.employees.client_id` aponta para
 * ela. O cascade atravessou o schema e levou colaboradores, dependentes,
 * cobranças e contatos do Risarte Empresarial — dados que ninguém chamaria de
 * "movimento", e que o dono usava para testar.
 *
 * É a MESMA armadilha do §0 do CLAUDE.md, que em 28/08/2026 apagou 19 usuários e
 * levou junto as matrículas do Risarte Academy. Lá a lição foi "pergunte ao
 * BANCO o que existe, não às migrações". Aqui ela volta em outra roupa:
 * **pergunte ao BANCO o que o comando alcança, não à lista que você escreveu.**
 *
 * Este script responde isso ANTES de apagar qualquer coisa. Só leitura.
 *
 *   node scripts/alcance-do-truncate.mjs
 */
import { connect, testEnv } from "./test-db.mjs";

// A mesma lista de `reset-test.mjs`. Lida de lá para não virar uma segunda
// cópia que envelhece sozinha.
import { readFileSync } from "node:fs";

function listaDoMovimento() {
  const fonte = readFileSync("scripts/reset-test.mjs", "utf8");
  const bloco = /const MOVIMENTO = \[([\s\S]*?)\];/.exec(fonte);
  if (!bloco) {
    throw new Error(
      "RÉGUA VAZIA: não achei a lista MOVIMENTO em reset-test.mjs. " +
        "Sem ela eu não sei o que a limpeza apaga, e não posso dizer que é seguro."
    );
  }
  const nomes = [...bloco[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  if (nomes.length === 0) {
    throw new Error("RÉGUA VAZIA: a lista MOVIMENTO veio vazia.");
  }
  return nomes;
}

const env = testEnv();
console.log(
  `Banco: ${env.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "")}\n`
);

const db = await connect();
const listadas = listaDoMovimento();

/**
 * O fecho transitivo do cascade: toda tabela que aponta (direta ou
 * indiretamente) para alguma das listadas também é esvaziada.
 */
const { rows } = await db.query(
  `
  with recursive alvo as (
    select c.oid
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = any($1)
    union
    select con.conrelid
      from pg_constraint con
      join alvo a on a.oid = con.confrelid
     where con.contype = 'f'
  )
  select n.nspname as schema, c.relname as tabela,
         (select count(*) from pg_constraint x
           where x.conrelid = c.oid and x.contype = 'f') as saidas
    from alvo a
    join pg_class c on c.oid = a.oid
    join pg_namespace n on n.oid = c.relnamespace
   order by n.nspname, c.relname
  `,
  [listadas]
);

const naLista = new Set(listadas);
const arrastadas = rows.filter(
  (r) => !(r.schema === "public" && naLista.has(r.tabela))
);
const foraDoPublic = arrastadas.filter((r) => r.schema !== "public");

console.log(`Na lista MOVIMENTO: ${listadas.length} tabela(s).`);
console.log(`O cascade alcança: ${rows.length} tabela(s).`);
console.log(
  `ARRASTADAS SEM ESTAR NA LISTA: ${arrastadas.length} — e ${foraDoPublic.length} fora do schema public.\n`
);

// Quantas linhas cada arrastada tem HOJE — é o que se perderia agora.
let totalEmRisco = 0;
for (const r of arrastadas) {
  const { rows: c } = await db.query(
    `select count(*)::int as n from ${r.schema}.${r.tabela}`
  );
  totalEmRisco += c[0].n;
  if (c[0].n > 0) {
    console.log(
      `  ${(r.schema + "." + r.tabela).padEnd(42)} ${String(c[0].n).padStart(6)} linha(s) seriam apagadas`
    );
  }
}

console.log(
  `\nTotal em risco agora: ${totalEmRisco} linha(s) em tabelas que NÃO estão na lista.`
);
if (foraDoPublic.length > 0) {
  console.log(
    `\n⚠️ O cascade ATRAVESSA O SCHEMA: ${foraDoPublic
      .map((r) => `${r.schema}.${r.tabela}`)
      .join(", ")}.` +
      `\nEssas tabelas não são "movimento" — são cadastro de outro módulo.`
  );
}

await db.end();
