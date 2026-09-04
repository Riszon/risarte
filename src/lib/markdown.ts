/**
 * Um leitor de Markdown pequeno, só para o manual de treinamento.
 *
 * POR QUE NÃO UMA BIBLIOTECA. O manual é UM arquivo, escrito por nós, com um
 * conjunto fechado de recursos (títulos, listas, tabelas, avisos, código). Uma
 * biblioteca de Markdown traz o dialeto inteiro — HTML embutido inclusive — e
 * com ele a necessidade de higienizar a saída. Aqui o texto nunca vira HTML: o
 * resultado é uma árvore de objetos que a tela desenha como React, então não
 * existe caminho para uma tag entrar por engano.
 *
 * O mesmo desenho já é usado pelo gerador do Word (`scripts/gerar-manual-docx.cjs`).
 * Os dois leem a MESMA fonte, então o que a equipe lê na tela e o que ela lê no
 * arquivo impresso não podem divergir.
 *
 * As funções aqui são puras — `markdown.test.ts` prende o comportamento.
 */

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------

export type Trecho =
  | { t: "texto"; v: string }
  | { t: "negrito"; filhos: Trecho[] }
  | { t: "italico"; filhos: Trecho[] }
  | { t: "codigo"; v: string }
  | { t: "link"; href: string; filhos: Trecho[] };

export type Bloco =
  | { tipo: "titulo"; nivel: number; id: string; texto: Trecho[] }
  | { tipo: "paragrafo"; texto: Trecho[] }
  | { tipo: "lista"; ordenada: boolean; itens: Trecho[][] }
  | { tipo: "checklist"; itens: Trecho[][] }
  | { tipo: "tabela"; cabecalho: Trecho[][]; linhas: Trecho[][][] }
  | { tipo: "codigo"; linhas: string[] }
  | { tipo: "aviso"; blocos: Bloco[] }
  | { tipo: "regua" };

export type Secao = {
  id: string;
  titulo: string;
  blocos: Bloco[];
  /** Texto puro da seção inteira, minúsculo e sem acento — é o que a busca lê. */
  busca: string;
};

// -----------------------------------------------------------------------------
// Texto em linha
// -----------------------------------------------------------------------------

// ⚠️ A EXPRESSÃO NASCE DENTRO DA FUNÇÃO, e isso não é desperdício.
//
// Uma expressão com `g` guarda o ponto onde parou (`lastIndex`) DENTRO dela.
// Como esta função se chama recursivamente (negrito com código dentro, link com
// negrito dentro), uma expressão compartilhada teria o índice remexido pela
// chamada de dentro e a de fora recomeçaria do lugar errado — casando o mesmo
// trecho para sempre. O sintoma não é texto errado na tela: é o processo
// consumindo memória até morrer, o que já aconteceu ao escrever este arquivo.
function expressaoEmLinha() {
  return /(`[^`]+`)|(\*\*[\s\S]+?\*\*)|(\[[^\]]*\]\([^)]*\))|(\*[^*\n]+\*)/g;
}

export function parseTrechos(texto: string): Trecho[] {
  const saida: Trecho[] = [];
  const emLinha = expressaoEmLinha();
  let ultimo = 0;
  let m: RegExpExecArray | null;

  while ((m = emLinha.exec(texto)) !== null) {
    if (m.index > ultimo) {
      saida.push({ t: "texto", v: texto.slice(ultimo, m.index) });
    }
    const tok = m[0];
    if (tok.startsWith("`")) {
      saida.push({ t: "codigo", v: tok.slice(1, -1) });
    } else if (tok.startsWith("**")) {
      saida.push({ t: "negrito", filhos: parseTrechos(tok.slice(2, -2)) });
    } else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(tok);
      // Link sempre tem rótulo e destino aqui; o `?? ""` é só para o TypeScript.
      saida.push({
        t: "link",
        href: mm?.[2] ?? "",
        filhos: parseTrechos(mm?.[1] ?? ""),
      });
    } else {
      saida.push({ t: "italico", filhos: parseTrechos(tok.slice(1, -1)) });
    }
    ultimo = emLinha.lastIndex;
  }
  if (ultimo < texto.length) saida.push({ t: "texto", v: texto.slice(ultimo) });
  return saida;
}

/** O texto sem marcação — usado no índice, na busca e no título da aba. */
export function textoPlano(trechos: Trecho[]): string {
  return trechos
    .map((t) => {
      switch (t.t) {
        case "texto":
          return t.v;
        case "codigo":
          return t.v;
        default:
          return textoPlano(t.filhos);
      }
    })
    .join("");
}

// Os sinais que se combinam com a letra anterior (o "´" de "é" depois do NFD).
// Montado a partir de uma string, e não escrito direto na expressão: colados
// literalmente no arquivo eles se grudam ao colchete, e qualquer ferramenta que
// reescreva o arquivo pode transformá-los em outra coisa sem ninguém ver.
const SINAIS_DE_ACENTO = new RegExp("[\\u0300-\\u036f]", "g");

/** Sem acento e em minúsculas — para a busca não exigir acentuação correta. */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(SINAIS_DE_ACENTO, "").toLowerCase();
}

/** Âncora estável para o índice lateral. */
export function apelido(texto: string): string {
  return (
    normalizar(texto)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "secao"
  );
}

// -----------------------------------------------------------------------------
// Blocos
// -----------------------------------------------------------------------------

const ehLinhaDeTabela = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const ehSeparadorDeTabela = (l: string) =>
  /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes("-");
const ehMarcada = (l: string) => /^[-*]\s+/.test(l);
const ehNumerada = (l: string) => /^\d+\.\s+/.test(l);
const ehTitulo = (l: string) => /^#{1,6}\s+/.test(l);
const ehRegua = (l: string) => /^(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
const ehCitacao = (l: string) => /^>\s?/.test(l);
const ehCerca = (l: string) => /^```/.test(l);

const abreBloco = (l: string) =>
  ehTitulo(l) ||
  ehRegua(l) ||
  ehCitacao(l) ||
  ehCerca(l) ||
  ehMarcada(l) ||
  ehNumerada(l) ||
  ehLinhaDeTabela(l);

const celulas = (l: string) =>
  l
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export function parseMarkdown(md: string): Bloco[] {
  return parseLinhas(md.replace(/\r\n/g, "\n").split("\n"));
}

function parseLinhas(linhas: string[]): Bloco[] {
  const blocos: Bloco[] = [];
  let i = 0;

  while (i < linhas.length) {
    const linha = linhas[i];

    if (!linha.trim()) {
      i++;
      continue;
    }

    if (ehCerca(linha)) {
      const codigo: string[] = [];
      i++;
      while (i < linhas.length && !ehCerca(linhas[i])) codigo.push(linhas[i++]);
      i++;
      blocos.push({ tipo: "codigo", linhas: codigo });
      continue;
    }

    if (ehTitulo(linha)) {
      const m = /^(#{1,6})\s+(.*)$/.exec(linha)!;
      const texto = parseTrechos(m[2].trim());
      blocos.push({
        tipo: "titulo",
        nivel: m[1].length,
        id: apelido(textoPlano(texto)),
        texto,
      });
      i++;
      continue;
    }

    if (ehRegua(linha)) {
      blocos.push({ tipo: "regua" });
      i++;
      continue;
    }

    if (ehCitacao(linha)) {
      const dentro: string[] = [];
      while (i < linhas.length && ehCitacao(linhas[i])) {
        dentro.push(linhas[i].replace(/^>\s?/, ""));
        i++;
      }
      blocos.push({ tipo: "aviso", blocos: parseLinhas(dentro) });
      continue;
    }

    if (
      ehLinhaDeTabela(linha) &&
      i + 1 < linhas.length &&
      ehSeparadorDeTabela(linhas[i + 1])
    ) {
      const cabecalho = celulas(linhas[i]).map(parseTrechos);
      i += 2;
      const corpo: Trecho[][][] = [];
      while (i < linhas.length && ehLinhaDeTabela(linhas[i])) {
        corpo.push(celulas(linhas[i++]).map(parseTrechos));
      }
      blocos.push({ tipo: "tabela", cabecalho, linhas: corpo });
      continue;
    }

    if (ehMarcada(linha) || ehNumerada(linha)) {
      const ordenada = ehNumerada(linha);
      const itens: string[] = [];
      let atual: string | null = null;
      while (i < linhas.length) {
        const l = linhas[i];
        if (!l.trim()) {
          // Linha em branco só continua a lista se o que vem depois ainda é um
          // item do mesmo tipo. Senão a lista acabou.
          let j = i;
          while (j < linhas.length && !linhas[j].trim()) j++;
          const continua =
            j < linhas.length &&
            ((ordenada && ehNumerada(linhas[j])) ||
              (!ordenada && ehMarcada(linhas[j])));
          if (!continua) break;
          i = j;
          continue;
        }
        if ((ordenada && ehNumerada(l)) || (!ordenada && ehMarcada(l))) {
          if (atual !== null) itens.push(atual);
          atual = l.replace(/^(\d+\.|[-*])\s+/, "").trim();
        } else if (/^\s{2,}\S/.test(l) && atual !== null) {
          atual += " " + l.trim();
        } else {
          break;
        }
        i++;
      }
      if (atual !== null) itens.push(atual);
      blocos.push({ tipo: "lista", ordenada, itens: itens.map(parseTrechos) });
      continue;
    }

    const paragrafo: string[] = [];
    while (i < linhas.length && linhas[i].trim() && !abreBloco(linhas[i])) {
      paragrafo.push(linhas[i].trim());
      i++;
    }
    if (paragrafo.length === 0) {
      i++;
      continue;
    }
    // As listas de conferência do manual são linhas soltas começando com ☐ —
    // no Markdown viram um parágrafo só, e sem isto sairiam grudadas.
    if (paragrafo.every((l) => l.startsWith("☐"))) {
      blocos.push({
        tipo: "checklist",
        itens: paragrafo.map((l) => parseTrechos(l.replace(/^☐\s*/, ""))),
      });
    } else {
      blocos.push({ tipo: "paragrafo", texto: parseTrechos(paragrafo.join(" ")) });
    }
  }

  return blocos;
}

// -----------------------------------------------------------------------------
// Seções
// -----------------------------------------------------------------------------

function textoDoBloco(b: Bloco): string {
  switch (b.tipo) {
    case "titulo":
    case "paragrafo":
      return textoPlano(b.texto);
    case "lista":
    case "checklist":
      return b.itens.map(textoPlano).join(" ");
    case "tabela":
      return [b.cabecalho, ...b.linhas].flat().map(textoPlano).join(" ");
    case "codigo":
      return b.linhas.join(" ");
    case "aviso":
      return b.blocos.map(textoDoBloco).join(" ");
    case "regua":
      return "";
  }
}

/**
 * Quebra o manual em seções pelo título de nível 2 — é por elas que o índice
 * lateral navega e a busca filtra.
 *
 * O que vem ANTES da primeira seção (o título do documento e a nota de como o
 * material foi produzido) entra numa seção de abertura: jogar fora seria
 * esconder justamente a declaração de limites do documento.
 */
export function secoesDoManual(blocos: Bloco[], tituloAbertura = "Apresentação"): Secao[] {
  const secoes: Secao[] = [];
  let atual: { id: string; titulo: string; blocos: Bloco[] } | null = null;

  const fechar = () => {
    if (!atual) return;
    const busca = normalizar(
      atual.titulo + " " + atual.blocos.map(textoDoBloco).join(" ")
    );
    secoes.push({ ...atual, busca });
    atual = null;
  };

  for (const b of blocos) {
    if (b.tipo === "titulo" && b.nivel === 2) {
      fechar();
      atual = { id: b.id, titulo: textoPlano(b.texto), blocos: [] };
      continue;
    }
    // O título do documento não se repete dentro da tela: o cabeçalho já o diz.
    if (b.tipo === "titulo" && b.nivel === 1) continue;
    if (b.tipo === "regua") continue;
    if (!atual) atual = { id: apelido(tituloAbertura), titulo: tituloAbertura, blocos: [] };
    atual.blocos.push(b);
  }
  fechar();

  return secoes.filter((s) => s.blocos.length > 0);
}
