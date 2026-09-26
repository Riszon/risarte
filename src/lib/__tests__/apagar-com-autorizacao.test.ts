import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ⚠️ NENHUM SCRIPT APAGA DADO SEM ALGUÉM PEDIR (ordem do dono, 25/09/2026).
//
// Relato OC-00088: *"sumiu todos os prontuários que foram cadastrados, sumiu
// planejamentos, agendamentos"*. A causa não foi o sistema — foi a suíte de
// testes, rodada por mim: o preparo dela esvaziava o movimento do banco de
// TREINO, que é onde a equipe trabalha. A trava contra a PRODUÇÃO sempre
// existiu e funcionou; o que não existia era trava contra apagar o treino.
//
// Depois de consertar aquele script, o dono pediu a garantia inteira: *"você
// deve garantir que nenhum dado será apagado, a não ser quando solicitado"*.
// Garantia que depende de alguém lembrar não é garantia — é intenção. Esta
// régua é a garantia: script novo que apague sem pedir **não passa no portão
// de entrega**.
//
// O que conta como PEDIR:
//   - `RISARTE_APAGAR_TREINO=sim` (a limpeza do treino);
//   - `--confirmar` na linha de comando (a limpeza de arquivos);
//   - `process.env.CI` (integração contínua, onde o banco é descartável).

const SCRIPTS = join(process.cwd(), "scripts");

/** Comentário não é código: o texto que explica o defeito não pode acusá-lo. */
function semComentarios(fonte: string): string {
  return fonte
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

/**
 * Só EXECUÇÃO conta. `conferir-destrutivo.mjs` guarda a palavra "truncate"
 * dentro de uma expressão regular — ele PROCURA apagamento, não apaga. Uma
 * régua que não distinguisse os dois acusaria justamente a ferramenta que
 * existe para evitar o problema.
 */
const FORMAS_DE_APAGAR = [
  {
    nome: "SQL destrutivo executado",
    padrao: /\.query\(\s*[`"'][^`"']*\b(truncate|delete\s+from)\b/i,
  },
  {
    nome: "apagamento pela API do banco",
    padrao: /\.from\([^)]*\)\s*\n?\s*\.delete\(\)/,
  },
  { nome: "remoção de arquivo do armazenamento", padrao: /\.remove\(/ },
];

/**
 * ⚠️ A MARCA TEM DE ESTAR NO PAPEL DE LEITURA, não solta no arquivo.
 *
 * A primeira versão desta régua procurava só a palavra `RISARTE_APAGAR_TREINO`.
 * Ela passou verde com a trava do `reset-test.mjs` ARRANCADA, porque a palavra
 * continuava lá — dentro do TEXTO da mensagem de erro, ensinando como
 * autorizar. A régua media a presença da string; o que importa é se o script
 * PERGUNTA pela autorização.
 *
 * É o mesmo erro do `--pat-branco` (§0d do CLAUDE.md), em roupa nova: a string
 * existia como uso e como definição, e olhar só a presença pulou o trabalho.
 * Por isso cada padrão abaixo exige `process.env` ou `process.argv` junto.
 */
const MARCAS_DE_AUTORIZACAO = [
  /process\.env\.RISARTE_APAGAR_TREINO/,
  /process\.argv[^;\n]*confirmar/,
  /process\.env\.CI\b/,
];

function scriptsQueApagam() {
  const achados: { arquivo: string; formas: string[]; autorizado: boolean }[] =
    [];
  for (const nome of readdirSync(SCRIPTS)) {
    if (!nome.endsWith(".mjs")) continue;
    const fonte = semComentarios(readFileSync(join(SCRIPTS, nome), "utf8"));
    const formas = FORMAS_DE_APAGAR.filter((f) => f.padrao.test(fonte)).map(
      (f) => f.nome
    );
    if (formas.length === 0) continue;
    achados.push({
      arquivo: nome,
      formas,
      autorizado: MARCAS_DE_AUTORIZACAO.some((m) => m.test(fonte)),
    });
  }
  return achados;
}

describe("nenhum script apaga dado sem ser pedido (OC-00088)", () => {
  it("a régua está medindo alguma coisa", () => {
    // Régua vazia GRITA: se nenhum script apaga, ou a varredura quebrou ou o
    // projeto mudou de forma — e as duas merecem olho humano, não um verde.
    const apagam = scriptsQueApagam();
    expect(
      apagam.length,
      "nenhum script de apagamento encontrado — a varredura deixou de medir"
    ).toBeGreaterThan(0);
  });

  it("todo script que apaga exige autorização", () => {
    const semTrava = scriptsQueApagam()
      .filter((s) => !s.autorizado)
      .map((s) => `${s.arquivo} (${s.formas.join(", ")})`);

    expect(
      semTrava,
      "Script que apaga tem de exigir autorização — RISARTE_APAGAR_TREINO, " +
        "--confirmar ou CI. Ver OC-00088:\n" +
        semTrava.join("\n")
    ).toEqual([]);
  });

  it("a régua separa QUEM APAGA de quem só procura apagamento", () => {
    // Executa: acusa.
    expect(
      FORMAS_DE_APAGAR[0].padrao.test('await db.query(`truncate public.clients`)')
    ).toBe(true);
    expect(
      FORMAS_DE_APAGAR[1].padrao.test('await db.from("clients").delete()')
    ).toBe(true);

    // Só procura: não acusa. É o caso do `conferir-destrutivo.mjs`, que guarda
    // a palavra numa expressão regular para reprovar migração destrutiva.
    expect(FORMAS_DE_APAGAR[0].padrao.test('[/^\s*truncate\b/i, "esvazia"]')).toBe(
      false
    );
    expect(FORMAS_DE_APAGAR[0].padrao.test('const AVISO = "delete from";')).toBe(
      false
    );
  });

  it("a régua reconhece as três formas de PEDIR", () => {
    for (const marca of [
      'if (process.env.RISARTE_APAGAR_TREINO !== "sim") throw new Error("x");',
      'const confirmado = process.argv.includes("--confirmar");',
      'if (process.env.CI === "true") { /* pode */ }',
    ]) {
      expect(MARCAS_DE_AUTORIZACAO.some((m) => m.test(marca))).toBe(true);
    }
    // E não confunde qualquer menção com autorização.
    expect(
      MARCAS_DE_AUTORIZACAO.some((m) => m.test("const apagar = true;"))
    ).toBe(false);
  });

  it("⚠️ a marca no TEXTO de uma mensagem não vale como trava", () => {
    // ESTE É O CASO QUE A PRIMEIRA VERSÃO DESTA RÉGUA DEIXOU PASSAR. Arranquei
    // a trava do `reset-test.mjs` de propósito para conferir se o portão
    // reprovava — e ele ficou verde, porque a frase abaixo continuava no
    // arquivo. Ensinar como autorizar não é exigir autorização.
    const soEnsina =
      'throw new Error("Se for mesmo para apagar:\n RISARTE_APAGAR_TREINO=sim npm run test:e2e");';
    expect(MARCAS_DE_AUTORIZACAO.some((m) => m.test(soEnsina))).toBe(false);

    // O mesmo para a linha de comando: o texto de ajuda não é a conferência.
    const ajuda = 'console.log("  Para apagar de verdade:  npm run limpar -- --confirmar");';
    expect(MARCAS_DE_AUTORIZACAO.some((m) => m.test(ajuda))).toBe(false);
  });
});
