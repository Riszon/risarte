// CÓPIA DE SEGURANÇA COMPLETA DO BANCO DE PRODUÇÃO.
//
// Grava uma pasta com um arquivo por tabela (JSON) e todos os arquivos do
// armazenamento (mídia clínica, XML de nota). É a rede de proteção antes de
// qualquer operação que apaga dado de verdade.
//
// ⚠️ A CÓPIA SAI FORA DO REPOSITÓRIO, de propósito e por verificação explícita.
// Ela contém dado de paciente — nome, CPF, prontuário, mídia clínica. Um backup
// dentro da pasta do projeto entraria no Git no primeiro `git add -A`, e dado de
// saúde publicado num repositório não se desfaz pedindo desculpa.
//
// O que ele IMPRIME é só nome de tabela e quantidade (LGPD). O conteúdo vai
// para os arquivos, e os arquivos ficam na máquina do dono.
//
// Uso:  npm run backup:producao

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Pasta irmã do repositório, carimbada com a data e a hora: duas cópias no
// mesmo dia não podem se sobrescrever — a segunda seria feita justamente
// depois de alguma coisa ter mudado.
const carimbo = new Date()
  .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" })
  .replace(/[: ]/g, "-");
const destino = resolve("..", `backup-producao-${carimbo}`);

// A verificação que faz a regra valer: se o destino cair dentro do repositório,
// o programa para. Comentário não impede acidente; conferência impede.
if (destino.startsWith(resolve("."))) {
  throw new Error("RECUSADO: a cópia não pode ficar dentro do repositório.");
}

/**
 * PERGUNTA AO BANCO quais tabelas existem — não deduz das nossas migrações.
 *
 * ⚠️ A LIÇÃO QUE CUSTOU CARO (28/08/2026). A primeira versão listava as tabelas
 * lendo `supabase/migrations/` deste repositório, e o resultado foi anunciado
 * como "cópia completa". Não era: **o mesmo banco Supabase é usado por TRÊS
 * sistemas** — o riSZon (`public`), o Risarte Empresarial (`empresarial`) e o
 * **Risarte Academy** (`treinamento`), que mora em outro repositório e
 * compartilha os logins pelo `auth.users`.
 *
 * O Academy ficou fora de três cópias seguidas, e ninguém percebeu — até a
 * limpeza dos dados de teste apagar usuários e levar junto, por cascata, as
 * matrículas e os certificados dele. Backup que se acha completo é pior que
 * backup declaradamente parcial: ele impede a pergunta.
 *
 * Agora a lista de TABELAS vem do próprio banco, pelo catálogo que o PostgREST
 * publica em cada schema. O que ainda é uma lista escrita à mão são os
 * SCHEMAS — a API só enxerga os que estão em "Exposed schemas" no painel do
 * Supabase. Ao criar um schema novo, acrescente aqui.
 */
const SCHEMAS = ["public", "empresarial", "treinamento"];

async function tabelasDoBanco() {
  const nomes = new Set();
  const semAcesso = [];

  for (const schema of SCHEMAS) {
    const resposta = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Accept-Profile": schema,
      },
    });
    if (!resposta.ok) {
      semAcesso.push(`${schema} (${resposta.status})`);
      continue;
    }
    const doc = await resposta.json();
    // O catálogo lista cada tabela como um caminho "/nome".
    for (const caminho of Object.keys(doc.paths ?? {})) {
      const nome = caminho.replace(/^\//, "");
      if (nome && !nome.startsWith("rpc/")) nomes.add(`${schema}.${nome}`);
    }
  }

  if (semAcesso.length > 0) {
    console.log(`  ATENÇÃO — schema(s) sem acesso pela API: ${semAcesso.join(", ")}`);
    console.log("  Confira 'Exposed schemas' no painel do Supabase.\n");
  }
  return [...nomes].sort();
}

/**
 * Lê a tabela inteira, em páginas.
 *
 * ORDENADA SEMPRE que possível: sem ordem definida, o Postgres não promete a
 * mesma sequência entre duas consultas, e a paginação passaria a repetir uma
 * linha e pular outra — um backup com buraco, que só se descobre na hora de
 * restaurar.
 */
async function lerTudo(qualificada) {
  const [schema, tabela] = qualificada.split(".");
  const origem = schema === "public" ? db : db.schema(schema);
  let ultimoErro = null;
  // `id` na maioria; `created_at` nas tabelas de ligação que não têm chave
  // própria; sem ordem nenhuma como último recurso — nesse caso a tabela quase
  // sempre cabe numa página só, e o risco desaparece.
  for (const coluna of ["id", "created_at", null]) {
    const linhas = [];
    let falhou = false;
    for (let pagina = 0; ; pagina++) {
      let consulta = origem
        .from(tabela)
        .select("*")
        .range(pagina * 1000, pagina * 1000 + 999);
      if (coluna) consulta = consulta.order(coluna);
      const { data, error } = await consulta;
      if (error) {
        ultimoErro = error;
        falhou = true;
        break;
      }
      linhas.push(...data);
      if (data.length < 1000) return { linhas, erro: null };
    }
    if (!falhou) return { linhas, erro: null };
    // 42703 = coluna não existe: só nesse caso vale tentar outra ordenação.
    if (ultimoErro.code !== "42703") return { linhas: [], erro: ultimoErro };
  }
  return { linhas: [], erro: ultimoErro };
}

async function main() {
  mkdirSync(destino, { recursive: true });
  mkdirSync(`${destino}/tabelas`, { recursive: true });
  console.log(
    `Cópia de ${env.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "").slice(0, 12)}…`
  );
  console.log(`Destino: ${destino}\n`);

  const resumo = {};
  const problemas = [];
  const tabelas = await tabelasDoBanco();
  console.log(`  ${tabelas.length} tabelas encontradas no banco.\n`);
  for (const t of tabelas) {
    const { linhas, erro } = await lerTudo(t);
    if (erro) {
      problemas.push(`${t}: ${erro.message}`);
      continue;
    }
    writeFileSync(
      `${destino}/tabelas/${t}.json`,
      JSON.stringify(linhas, null, 2),
      "utf8"
    );
    resumo[t] = linhas.length;
    if (linhas.length > 0) console.log(`  ${t.padEnd(38)} ${String(linhas.length).padStart(7)}`);
  }

  // ---- armazenamento (mídia clínica, XML de nota) --------------------------
  // Apagar a linha do banco não apaga o arquivo. Sem esta parte, a "cópia
  // completa" seria completa só do lado que dá menos trabalho.
  const arquivos = {};
  const { data: baldes, error: erroBaldes } = await db.storage.listBuckets();
  if (erroBaldes) {
    problemas.push(`armazenamento: ${erroBaldes.message}`);
  } else {
    for (const balde of baldes) {
      const caminhos = await listarBalde(balde.name, "");
      arquivos[balde.name] = caminhos.length;
      console.log(`\n  arquivo(s) em ${balde.name}: ${caminhos.length}`);
      for (const caminho of caminhos) {
        const { data, error } = await db.storage.from(balde.name).download(caminho);
        if (error) {
          problemas.push(`${balde.name}/${caminho}: ${error.message}`);
          continue;
        }
        const destinoArquivo = `${destino}/arquivos/${balde.name}/${caminho}`;
        mkdirSync(destinoArquivo.split("/").slice(0, -1).join("/"), {
          recursive: true,
        });
        writeFileSync(destinoArquivo, Buffer.from(await data.arrayBuffer()));
      }
    }
  }

  writeFileSync(
    `${destino}/_resumo.json`,
    JSON.stringify(
      {
        projeto: env.NEXT_PUBLIC_SUPABASE_URL,
        quando: new Date().toISOString(),
        tabelas: resumo,
        arquivos,
        problemas,
      },
      null,
      2
    ),
    "utf8"
  );

  const total = Object.values(resumo).reduce((a, b) => a + b, 0);
  console.log(`\n  ${Object.keys(resumo).length} tabelas, ${total} linhas.`);
  if (problemas.length > 0) {
    console.log(`\n  ATENÇÃO — ${problemas.length} problema(s):`);
    for (const p of problemas.slice(0, 20)) console.log(`    ${p}`);
  }
  console.log(`\n  Cópia em: ${destino}`);
}

/** Lista todos os caminhos de um balde, entrando nas subpastas. */
async function listarBalde(balde, prefixo) {
  const saida = [];
  const { data, error } = await db.storage
    .from(balde)
    .list(prefixo, { limit: 1000 });
  if (error || !data) return saida;
  for (const item of data) {
    const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
    // Pasta não tem `id`; arquivo tem. É como a API do Supabase os separa.
    if (item.id === null) saida.push(...(await listarBalde(balde, caminho)));
    else saida.push(caminho);
  }
  return saida;
}

main().catch((e) => {
  console.error("Erro na cópia:", e.message);
  process.exitCode = 1;
});
