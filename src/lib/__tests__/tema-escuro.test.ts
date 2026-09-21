import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// ⚠️ O TESTE QUE PRENDE O DEFEITO DE 21/09/2026 (relatos OC-00053 e OC-00061).
//
// Dois relatos no mesmo dia, mesma família: **cor escolhida para um tema,
// aplicada no outro**. Na agenda, o cartão pintava uma mancha clara
// (`bg-sky-50`, feita para papel branco) e o texto NÃO declarava cor — ele
// herda a do tema, que no escuro é quase branca. Branco sobre quase-branco: a
// agenda ficou ilegível justamente para quem passa o dia nela.
//
// A régua separa DEFEITO de INCÔMODO, e essa distinção é o coração do teste:
//
// - mancha clara + letra escura declarada (`text-emerald-700`) = legível no
//   escuro, só mais clara do que o resto. São **226 lugares** assim, e todos
//   funcionam. Acusá-los seria mandar arrumar o que está certo — o erro que o
//   `CLAUDE.md` §0d registra como "régua que erra é pior que régua nenhuma".
// - mancha clara + letra herdada = texto invisível. É o que este teste proíbe.
//
// Comentário não é interface: linha de comentário é ignorada, senão o próprio
// texto que explica o defeito faria o teste cair.

const RAIZ = join(process.cwd(), "src");

/** Tons 50 e 100 do Tailwind: manchas feitas para fundo branco. */
const MANCHA_CLARA =
  /\bbg-(sky|emerald|zinc|red|orange|amber|violet|slate|gray|blue|green|yellow|rose|teal|indigo|purple|lime|neutral|stone|cyan|fuchsia|pink)-(50|100)\b/;
/** Letra escura declarada: aí a mancha clara continua legível no escuro. */
const LETRA_ESCURA = /\btext-[a-z]+-(600|700|800|900)\b/;
const COMENTARIO = /^\s*(\/\/|\/\*|\*)/;
/**
 * A EXCEÇÃO DECLARADA NA PRÓPRIA LINHA, com o motivo junto.
 *
 * Existe para o caso da CAIXA cujo texto todo declara a própria cor: ela fica
 * clara no escuro, mas legível — e silenciar o arquivo inteiro por causa dela
 * esconderia os defeitos de verdade que aparecerem ali depois. Escrever
 * `{/* tema-ok: <motivo> *​/}` na linha de cima resolve só aquele ponto, e
 * deixa o motivo onde quem for mexer vai ler.
 */
const ACEITO = /tema-ok:/;

/**
 * DECLARADAS, uma a uma, com o motivo — nunca uma pasta inteira.
 * Documento que vai para a impressora sai em papel branco: ali a mancha clara
 * é a escolha certa, e um par escuro gastaria tinta sem ajudar ninguém.
 */
const PAPEL_BRANCO = [
  "app/renegociacoes/[id]/acordo/print-button.tsx",
  "app/cancelamentos/[id]/termo/print-button.tsx",
  "app/documentos/[id]/imprimir/print-button.tsx",
];

function arquivosDaInterface(): string[] {
  const achados: string[] = [];
  (function varrer(pasta: string) {
    for (const nome of readdirSync(pasta)) {
      const caminho = join(pasta, nome);
      if (statSync(caminho).isDirectory()) varrer(caminho);
      else if (nome.endsWith(".tsx") || nome.endsWith(".ts")) {
        if (!caminho.includes("__tests__")) achados.push(caminho);
      }
    }
  })(RAIZ);
  return achados;
}

function manchasSemParEscuro(): string[] {
  const problemas: string[] = [];
  for (const caminho of arquivosDaInterface()) {
    const relativo = relative(RAIZ, caminho).split("\\").join("/");
    if (PAPEL_BRANCO.includes(relativo)) continue;
    const linhas = readFileSync(caminho, "utf8").split("\n");
    linhas.forEach((linha, i) => {
      if (COMENTARIO.test(linha)) return;
      if (!MANCHA_CLARA.test(linha)) return;
      // ⚠️ A VIZINHA SÓ VALE SE FOR CONTINUAÇÃO DA MESMA CLASSE.
      //
      // A primeira versão desta régua olhava as linhas de cima e de baixo sem
      // essa condição — e num mapa de estilos a vizinha é OUTRO status, que
      // tem o `dark:` dela. Resultado: quebrei a agenda de propósito para
      // testar a régua, e ela passou dizendo que estava tudo bem. Régua que
      // não dispara no defeito que a gerou não prova nada.
      //
      // Linha vizinha que tem mancha própria é irmã, não continuação.
      const continuacao = (l: string | undefined) =>
        l !== undefined && !MANCHA_CLARA.test(l) ? l : "";
      const trecho = [continuacao(linhas[i - 1]), linha, continuacao(linhas[i + 1])].join(" ");
      if (ACEITO.test(linhas[i - 1] ?? "") || ACEITO.test(linha)) return;
      if (/\bdark:/.test(trecho)) return;
      if (LETRA_ESCURA.test(trecho)) return;
      problemas.push(`${relativo}:${i + 1} — ${linha.trim().slice(0, 80)}`);
    });
  }
  return problemas;
}

describe("modo escuro: mancha clara sem letra declarada", () => {
  it("a régua está medindo alguma coisa", () => {
    // Zero resultados é ausência de medição, não medição de ausência: se a
    // varredura não achar nem os 226 casos legítimos, ela quebrou e passaria
    // dizendo que está tudo bem.
    const arquivos = arquivosDaInterface();
    expect(arquivos.length).toBeGreaterThan(300);
    const comMancha = arquivos.filter((c) => MANCHA_CLARA.test(readFileSync(c, "utf8")));
    expect(comMancha.length).toBeGreaterThan(20);
  });

  it("nenhuma tela pinta fundo claro deixando a letra herdar o tema", () => {
    const problemas = manchasSemParEscuro();
    expect(
      problemas,
      `No modo escuro a letra fica quase branca; sobre estas manchas claras ela some.\n` +
        `Conserto: acrescente o par escuro (ex.: \`dark:bg-amber-500/15\`) ou declare\n` +
        `uma letra escura (ex.: \`text-amber-800\`).\n\n${problemas.join("\n")}`
    ).toEqual([]);
  });
});
