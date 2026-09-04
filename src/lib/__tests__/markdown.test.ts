import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  apelido,
  normalizar,
  parseMarkdown,
  parseTrechos,
  secoesDoManual,
  textoPlano,
} from "@/lib/markdown";

// O leitor do manual é o único caminho entre o texto que escrevemos e o que a
// equipe lê na tela. Um bloco lido errado não dá erro nenhum: ele some, ou
// aparece grudado no anterior — e o manual passa a mentir em silêncio.
describe("texto em linha", () => {
  it("reconhece negrito, itálico, código e link", () => {
    const t = parseTrechos("**forte** e *fraco* com `codigo` e [rótulo](/x)");
    expect(t.map((x) => x.t)).toEqual([
      "negrito",
      "texto",
      "italico",
      "texto",
      "codigo",
      "texto",
      "link",
    ]);
    expect(textoPlano(t)).toBe("forte e fraco com codigo e rótulo");
  });

  it("negrito dentro de negrito não perde o texto", () => {
    expect(textoPlano(parseTrechos("**Cuidado: `saldo` negativo**"))).toBe(
      "Cuidado: saldo negativo"
    );
  });

  it("texto sem marcação nenhuma continua inteiro", () => {
    expect(textoPlano(parseTrechos("uma frase simples"))).toBe("uma frase simples");
  });
});

describe("blocos", () => {
  it("título vira título com nível e âncora", () => {
    const [b] = parseMarkdown("## 5. Matriz de permissões");
    expect(b.tipo).toBe("titulo");
    if (b.tipo !== "titulo") return;
    expect(b.nivel).toBe(2);
    expect(b.id).toBe("5-matriz-de-permissoes");
  });

  it("linhas seguidas viram UM parágrafo", () => {
    // O manual quebra linha em 80 colunas. Sem juntar, cada linha viraria um
    // parágrafo e o texto sairia picotado na tela.
    const b = parseMarkdown("uma frase que\ncontinua na linha seguinte");
    expect(b).toHaveLength(1);
    expect(b[0].tipo).toBe("paragrafo");
  });

  it("item de lista com continuação indentada não se parte", () => {
    const b = parseMarkdown("- **Fase:** onde o paciente está.\n  Sempre uma só.");
    expect(b[0].tipo).toBe("lista");
    if (b[0].tipo !== "lista") return;
    expect(b[0].itens).toHaveLength(1);
    expect(textoPlano(b[0].itens[0])).toContain("Sempre uma só");
  });

  it("lista numerada é reconhecida como ordenada", () => {
    const b = parseMarkdown("1. primeiro\n2. segundo");
    expect(b[0].tipo).toBe("lista");
    if (b[0].tipo !== "lista") return;
    expect(b[0].ordenada).toBe(true);
    expect(b[0].itens).toHaveLength(2);
  });

  it("tabela separa cabeçalho e linhas", () => {
    const b = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
    expect(b[0].tipo).toBe("tabela");
    if (b[0].tipo !== "tabela") return;
    expect(b[0].cabecalho).toHaveLength(2);
    expect(b[0].linhas).toHaveLength(2);
    expect(textoPlano(b[0].linhas[1][0])).toBe("3");
  });

  it("citação vira aviso, com os blocos de dentro", () => {
    const b = parseMarkdown("> **Cuidado:** isto não se desfaz.\n> Confira antes.");
    expect(b[0].tipo).toBe("aviso");
    if (b[0].tipo !== "aviso") return;
    expect(b[0].blocos[0].tipo).toBe("paragrafo");
  });

  it("bloco de código guarda as linhas como estão", () => {
    const b = parseMarkdown("```\nlinha 1\n  linha 2\n```");
    expect(b[0].tipo).toBe("codigo");
    if (b[0].tipo !== "codigo") return;
    expect(b[0].linhas).toEqual(["linha 1", "  linha 2"]);
  });

  it("cada ☐ vira um item separado", () => {
    // No Markdown as linhas de conferência são um parágrafo só; grudadas na
    // tela, a lista de checagem deixaria de ser uma lista.
    const b = parseMarkdown("☐ Consegui entrar\n☐ Sei minha unidade\n☐ Sei sair");
    expect(b[0].tipo).toBe("checklist");
    if (b[0].tipo !== "checklist") return;
    expect(b[0].itens).toHaveLength(3);
    expect(textoPlano(b[0].itens[1])).toBe("Sei minha unidade");
  });
});

describe("seções", () => {
  const md = [
    "# Manual",
    "",
    "> Nota de abertura.",
    "",
    "## 1. Primeira",
    "",
    "Texto da primeira, falando de anamnese.",
    "",
    "## 2. Segunda",
    "",
    "Texto da segunda.",
  ].join("\n");

  it("quebra pelo título de nível 2", () => {
    const s = secoesDoManual(parseMarkdown(md));
    expect(s.map((x) => x.titulo)).toEqual(["Apresentação", "1. Primeira", "2. Segunda"]);
  });

  it("o que vem antes da primeira seção não se perde", () => {
    // É onde mora a declaração de limites do documento — jogar fora seria
    // apagar justamente a parte que diz o que o manual NÃO garante.
    const s = secoesDoManual(parseMarkdown(md));
    expect(s[0].blocos[0].tipo).toBe("aviso");
  });

  it("a busca acha sem acento e sem maiúscula", () => {
    const s = secoesDoManual(parseMarkdown(md));
    expect(s[1].busca).toContain("anamnese");
    expect(s.find((x) => x.busca.includes("primeira"))?.titulo).toBe("1. Primeira");
  });
});

// ⚠️ O TESTE SOBRE O MANUAL DE VERDADE.
//
// Os testes acima provam o leitor com exemplos pequenos, que é onde se enxerga
// a regra. Este prova o ARQUIVO que a equipe abre — e é o que pega a classe de
// defeito que exemplo nenhum pega: uma seção que some porque alguém trocou o
// nível do título, uma tabela que deixa de ser tabela por uma barra a menos.
// Nada disso dá erro: o texto simplesmente não aparece, e ninguém descobre até
// alguém procurar por ele no meio de um atendimento.
describe("o manual de verdade", () => {
  const bruto = fs.readFileSync(
    "docs/treinamento/manual-treinamento-riSZon.md",
    "utf8"
  );
  const secoes = secoesDoManual(parseMarkdown(bruto));
  const titulos = secoes.map((s) => s.titulo);

  it("abre em pelo menos 15 seções", () => {
    expect(secoes.length).toBeGreaterThanOrEqual(15);
  });

  it("as seções que a equipe procura estão lá", () => {
    expect(titulos).toContain("1. Resumo executivo");
    expect(titulos).toContain("9. Erros, falhas e mau funcionamento");
    expect(titulos).toContain("15. Novidades, problemas e alertas");
  });

  it("nenhuma seção fica vazia", () => {
    for (const s of secoes) {
      expect(s.blocos.length, s.titulo).toBeGreaterThan(0);
    }
  });

  it("as âncoras não se repetem", () => {
    // Âncora repetida faz o índice lateral levar para a seção errada.
    expect(new Set(secoes.map((s) => s.id)).size).toBe(secoes.length);
  });

  it("as tabelas continuam sendo tabelas", () => {
    const tabelas = secoes
      .flatMap((s) => s.blocos)
      .filter((b) => b.tipo === "tabela");
    expect(tabelas.length).toBeGreaterThan(10);
  });

  it("a busca encontra o que a equipe digitaria", () => {
    for (const termo of ["anamnese", "desconto", "permissao", "cpf"]) {
      expect(
        secoes.some((s) => s.busca.includes(termo)),
        termo
      ).toBe(true);
    }
  });
});

describe("apoio", () => {
  it("normalizar tira acento e caixa", () => {
    expect(normalizar("Avaliação CLÍNICA")).toBe("avaliacao clinica");
  });

  it("apelido vira âncora estável", () => {
    expect(apelido("9.2. Antes de chamar o suporte — 6 verificações")).toBe(
      "9-2-antes-de-chamar-o-suporte-6-verificacoes"
    );
  });

  it("apelido nunca sai vazio", () => {
    expect(apelido("———")).toBe("secao");
  });
});
