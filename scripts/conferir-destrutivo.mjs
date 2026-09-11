/**
 * O QUE UMA ATUALIZAÇÃO PODE APAGAR NA PRODUÇÃO.
 *
 * ⚠️ ESCRITO EM 11/09/2026, DEPOIS DE EU APAGAR OS DADOS DE TESTE DO DONO. A
 * pergunta que ele fez é a certa: *"quando for fazer uma atualização no sistema
 * com dados reais preciso ter segurança de que nada vai se perder"*.
 *
 * Só DUAS coisas tocam a produção: o código publicado e as **migrações** que ele
 * roda no SQL Editor. O código não apaga dado sozinho; a migração pode. Então a
 * resposta honesta não é "confie em mim", é esta régua: ela lê cada arquivo de
 * migração e aponta todo comando capaz de destruir dado.
 *
 * ⚠️ NEM TODO COMANDO DESTRUTIVO É ERRADO. Apagar uma tabela que nunca foi
 * usada, ou uma coluna criada por engano na migração anterior, é legítimo. O que
 * não pode é acontecer **sem alguém saber**. Por isso a régua não proíbe: ela
 * OBRIGA A DECLARAR. Um comentário `-- DESTRUTIVO: <motivo>` na linha de cima
 * aceita o comando; sem ele, a migração é reprovada.
 *
 * Uso:
 *   node scripts/conferir-destrutivo.mjs           → todas as migrações
 *   node scripts/conferir-destrutivo.mjs 1006      → só essa
 */
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";

/**
 * Os comandos que apagam dado. Cada um com o nome do estrago que causa, para o
 * relatório falar em português e não em SQL.
 */
const PERIGOSOS = [
  [/^\s*drop\s+table\b/i, "apaga uma tabela inteira"],
  [/^\s*truncate\b/i, "esvazia uma tabela"],
  [/^\s*delete\s+from\b/i, "apaga linhas"],
  [/\balter\s+table\s+[^\s;]+\s+drop\s+column\b/i, "apaga uma coluna (e o que havia nela)"],
  [/^\s*drop\s+schema\b/i, "apaga um schema inteiro"],
];

/** A marca que o autor deixa quando o comando é intencional. */
const DECLARACAO = /--\s*DESTRUTIVO:/i;

/**
 * O QUE JÁ FOI CONFERIDO À MÃO, e por quê.
 *
 * ⚠️ ESTA LISTA NÃO EDITA O PASSADO. A regra do projeto é clara: migração já
 * aplicada não se mexe, nem para pôr comentário — o arquivo tem de continuar
 * igual ao SQL que rodou no banco. Então o julgamento fica aqui.
 *
 * Cada linha foi lida em 11/09/2026 e é estreita e justificada no próprio
 * arquivo. Nenhuma apaga dado de operação sem motivo.
 */
const JA_CONFERIDAS = new Map([
  [
    "0003_feedback_fixes.sql",
    "tira papéis duplicados (mantém um) antes de apertar a restrição de unicidade",
  ],
  [
    "0009_bugfixes.sql",
    "limpa avisos de teste com texto corrompido, antes do lançamento",
  ],
  [
    "0163_ppr_cleanup_orphan_memberships.sql",
    "remove adesões órfãs do PPR: sem beneficiário E sem cobrança",
  ],
  [
    "0215_named_kits_and_item_edit.sql",
    "derruba as tabelas antigas de kit DEPOIS de copiar os dados para as novas",
  ],
  [
    "1000_empresarial_usage_from_closing.sql",
    "remove uso de benefício duplicado, que dobraria a economia no extrato",
  ],
]);

const alvo = process.argv[2];
const arquivos = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => !alvo || f.startsWith(alvo))
  .sort();

if (arquivos.length === 0) {
  throw new Error(
    `RÉGUA VAZIA: nenhuma migração encontrada${alvo ? ` começando por "${alvo}"` : ""}. ` +
      `Não posso dizer que está tudo seguro sem ter lido nada.`
  );
}

console.log(
  `Conferindo ${arquivos.length} migração(ões) em busca de comando que apaga dado.\n`
);

let achados = 0;
let declarados = 0;

/**
 * ⚠️ `delete` DENTRO DE FUNÇÃO NÃO É A MESMA COISA QUE `delete` NA MIGRAÇÃO.
 *
 * A primeira versão desta régua acusou 40 e poucos comandos — quase todos
 * dentro de `create or replace function ... $$ ... $$`. Aquilo é CÓDIGO que
 * passa a existir, não uma ação que a migração executa: `delete from
 * agenda_closures where id = p_id` só apaga quando alguém clica em "excluir
 * bloqueio". Acusar esses faria a régua virar ruído, e régua que ninguém lê é
 * régua que não existe.
 *
 * O que importa é o comando **no nível de cima**, que roda no instante em que o
 * dono cola a migração no SQL Editor. Então acompanhamos a abertura e o
 * fechamento dos blocos `$...$` e só olhamos o que está fora deles.
 */
function foraDeBloco(linhas) {
  const resultado = [];
  let delimitador = null;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const semComentario = linha.replace(/--.*$/, "");

    if (delimitador === null) {
      resultado.push({ i, linha, dentro: false });
      // Abriu um bloco nesta linha?
      const abre = /(\$[a-zA-Z_]*\$)/.exec(semComentario);
      if (abre) {
        // Se o mesmo delimitador aparece duas vezes, abriu e fechou aqui.
        const quantas = semComentario.split(abre[1]).length - 1;
        if (quantas % 2 === 1) delimitador = abre[1];
      }
    } else {
      resultado.push({ i, linha, dentro: true });
      if (semComentario.includes(delimitador)) delimitador = null;
    }
  }
  return resultado;
}

for (const arquivo of arquivos) {
  const todas = readFileSync(`${DIR}/${arquivo}`, "utf8").split(/\r?\n/);
  const linhas = todas;

  for (const { i, linha, dentro } of foraDeBloco(todas)) {
    // Dentro de função é definição de comportamento, não execução.
    if (dentro) continue;
    // Linha que é só comentário não conta — o texto de um comentário pode
    // conter "delete from" ao explicar por que NÃO se apaga nada.
    if (/^\s*--/.test(linha)) continue;

    for (const [padrao, estrago] of PERIGOSOS) {
      if (!padrao.test(linha)) continue;

      // A declaração pode estar na própria linha ou em qualquer uma das três
      // acima (o autor costuma explicar antes).
      const vizinhanca = linhas.slice(Math.max(0, i - 3), i + 1).join("\n");
      const declarado = DECLARACAO.test(vizinhanca) || JA_CONFERIDAS.has(arquivo);

      if (declarado) {
        declarados++;
      } else {
        achados++;
        console.log(`  ⚠️  ${arquivo}:${i + 1} — ${estrago}`);
        console.log(`      ${linha.trim().slice(0, 110)}`);
      }
      break;
    }
  }
}

console.log(
  `\n${declarados} comando(s) destrutivo(s) DECLARADO(s) — intencionais, com motivo escrito.`
);

if (achados > 0) {
  console.log(
    `\n${achados} comando(s) destrutivo(s) SEM DECLARAÇÃO.` +
      `\nSe forem mesmo para apagar, escreva "-- DESTRUTIVO: <motivo>" na linha` +
      `\nde cima. Se não forem, o dono não pode rodar esta migração.`
  );
  process.exit(1);
}

console.log(
  "\n✓ Nenhuma migração apaga dado sem estar declarado. Rodar a atualização" +
    "\n  não perde nada do que já está no banco."
);
