import { describe, expect, it } from "vitest";
import {
  celulaEmTexto,
  celulaParaPlanilha,
  formatoDaColuna,
  letraDaColuna,
  totaisDoRelatorio,
  type RelatorioPronto,
} from "@/lib/finance/relatorio";

const dinheiro = (c: number) =>
  (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string) => iso.split("-").reverse().join("/");

function relatorio(linhas: RelatorioPronto["linhas"]): RelatorioPronto {
  return {
    titulo: "Teste",
    subtitulo: null,
    metadados: [],
    resumo: [],
    situacao: null,
    colunas: [
      { chave: "nome", titulo: "Nome", tipo: "texto" },
      { chave: "valor", titulo: "Valor", tipo: "dinheiro", somar: true },
      { chave: "qtd", titulo: "Qtd", tipo: "numero", somar: true },
      { chave: "obs", titulo: "Obs", tipo: "texto" },
    ],
    linhas,
    notas: [],
    nomeDoArquivo: "teste",
  };
}

describe("totais do rodapé", () => {
  it("soma só as colunas marcadas", () => {
    const t = totaisDoRelatorio(
      relatorio([
        { nome: "A", valor: 10_000, qtd: 2, obs: "x" },
        { nome: "B", valor: 5_000, qtd: 3, obs: "y" },
      ])
    );
    expect(t).toEqual({ valor: 15_000, qtd: 5 });
    expect(t.nome).toBeUndefined();
  });

  it("célula vazia não estraga a soma", () => {
    const t = totaisDoRelatorio(
      relatorio([
        { nome: "A", valor: 10_000, qtd: null, obs: null },
        { nome: "B", valor: null, qtd: 3, obs: null },
      ])
    );
    expect(t.valor).toBe(10_000);
    expect(t.qtd).toBe(3);
  });

  it("relatório sem linha nenhuma soma zero, não quebra", () => {
    expect(totaisDoRelatorio(relatorio([]))).toEqual({ valor: 0, qtd: 0 });
  });

  it("SOMA O QUE ESTÁ NO RELATÓRIO, não o que ficou de fora", () => {
    // Com filtro de período o total é o do recorte. Ele tem de bater com as
    // linhas logo acima — quem avisa que é recorte é a nota de rodapé.
    const t = totaisDoRelatorio(relatorio([{ nome: "A", valor: 777, qtd: 1 }]));
    expect(t.valor).toBe(777);
  });
});

describe("célula no papel", () => {
  it("dinheiro sai em reais", () => {
    expect(celulaEmTexto(123_456, "dinheiro", dinheiro, data)).toContain("1.234,56");
  });

  it("VAZIO É TRAÇO, nunca R$ 0,00", () => {
    // Zero numa coluna que não se aplica seria uma afirmação sobre dinheiro
    // que ninguém fez.
    expect(celulaEmTexto(null, "dinheiro", dinheiro, data)).toBe("—");
    expect(celulaEmTexto("", "texto", dinheiro, data)).toBe("—");
  });

  it("zero DE VERDADE continua sendo zero", () => {
    expect(celulaEmTexto(0, "dinheiro", dinheiro, data)).toContain("0,00");
    expect(celulaEmTexto(0, "numero", dinheiro, data)).toBe("0");
  });

  it("data sai formatada", () => {
    expect(celulaEmTexto("2026-03-15", "data", dinheiro, data)).toBe("15/03/2026");
  });
});

describe("célula na planilha", () => {
  it("DINHEIRO VIRA NÚMERO EM REAIS — texto não soma", () => {
    // Foi o defeito da primeira entrega: a planilha saía com texto.
    expect(celulaParaPlanilha(123_456, "dinheiro")).toBe(1234.56);
  });

  it("centavo quebrado não se perde", () => {
    expect(celulaParaPlanilha(1, "dinheiro")).toBe(0.01);
    expect(celulaParaPlanilha(999, "dinheiro")).toBe(9.99);
  });

  it("vazio vira célula vazia, não zero", () => {
    expect(celulaParaPlanilha(null, "dinheiro")).toBeNull();
    expect(celulaParaPlanilha("", "texto")).toBeNull();
  });

  it("número e texto passam inteiros", () => {
    expect(celulaParaPlanilha(7, "numero")).toBe(7);
    expect(celulaParaPlanilha("Maria", "texto")).toBe("Maria");
  });

  // ⚠️ A DATA SAÍA COMO TEXTO "2026-09-11" — o formato do banco no meio de um
  // relatório em português, e uma coluna que ordena como palavra.
  it("data vira data de verdade, em UTC", () => {
    const v = celulaParaPlanilha("2026-09-11", "data");
    expect(v).toBeInstanceOf(Date);
    expect((v as Date).toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("o dia não anda para trás com o fuso do servidor", () => {
    const v = celulaParaPlanilha("2026-01-01", "data") as Date;
    expect(v.getUTCDate()).toBe(1);
    expect(v.getUTCMonth()).toBe(0);
    expect(v.getUTCFullYear()).toBe(2026);
  });

  it("texto que não é data volta como texto, sem inventar dia", () => {
    expect(celulaParaPlanilha("nunca contatado", "data")).toBe(
      "nunca contatado"
    );
  });
});

describe("formato de número da planilha", () => {
  it("dinheiro leva o formato de moeda", () => {
    expect(formatoDaColuna("dinheiro")).toBe("R$ #,##0.00");
  });

  it("data leva o formato brasileiro", () => {
    expect(formatoDaColuna("data")).toBe("dd/mm/yyyy");
  });

  it("texto não leva formato", () => {
    expect(formatoDaColuna("texto")).toBeUndefined();
  });
});

describe("letra da coluna do Excel", () => {
  it("as primeiras", () => {
    expect(letraDaColuna(1)).toBe("A");
    expect(letraDaColuna(26)).toBe("Z");
  });

  it("vira duas letras depois do Z", () => {
    // Sem isto, o filtro automático apontaria para o intervalo errado numa
    // planilha com mais de 26 colunas — e o Excel recusaria o arquivo.
    expect(letraDaColuna(27)).toBe("AA");
    expect(letraDaColuna(28)).toBe("AB");
    expect(letraDaColuna(52)).toBe("AZ");
    expect(letraDaColuna(53)).toBe("BA");
  });
});
