import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLLECTION_OUTCOMES,
  COLLECTION_OUTCOME_LABELS,
  agruparInadimplentes,
  cobertura,
  dataDoFiltro,
  situacaoDaMargem,
  exigeDataPrometida,
  linkDoWhatsApp,
  noPeriodo,
  rotuloDoPeriodo,
  precisaDeOutraPessoa,
  promessasVencidas,
  type CobrancaParaCobranca,
  type CollectionOutcome,
  type Inadimplente,
  type UltimoContato,
} from "@/lib/finance/collection";

function cobranca(
  over: Partial<CobrancaParaCobranca> = {}
): CobrancaParaCobranca {
  return {
    clientId: "c1",
    cliente: "Maria Souza",
    telefone: "(43) 99999-0000",
    isLate: true,
    daysLate: 10,
    balanceCents: 10_000,
    updatedBalanceCents: 10_500,
    ...over,
  };
}

const semContatos = new Map<string, { ultimo: UltimoContato; total: number }>();

describe("agrupar a dívida por pessoa", () => {
  it("quem deve cinco parcelas vira UMA linha", () => {
    // A tela de recebíveis mostra cinco; ninguém liga cinco vezes.
    const { fila } = agruparInadimplentes(
      [
        cobranca({ updatedBalanceCents: 10_000, daysLate: 30 }),
        cobranca({ updatedBalanceCents: 20_000, daysLate: 60 }),
        cobranca({ updatedBalanceCents: 5_000, daysLate: 5 }),
      ],
      semContatos
    );
    expect(fila).toHaveLength(1);
    expect(fila[0].vencidoCents).toBe(35_000);
    expect(fila[0].quantidadeVencida).toBe(3);
  });

  it("o atraso que vale é o MAIS ANTIGO", () => {
    // É ele que diz há quanto tempo a dívida existe; o mais recente faria a
    // pessoa parecer caloteira de ontem.
    const { fila } = agruparInadimplentes(
      [cobranca({ daysLate: 5 }), cobranca({ daysLate: 90 })],
      semContatos
    );
    expect(fila[0].diasDoMaisAntigo).toBe(90);
  });

  it("o valor de cobrança é o ATUALIZADO, com multa e juros", () => {
    const { fila } = agruparInadimplentes(
      [cobranca({ balanceCents: 10_000, updatedBalanceCents: 11_234 })],
      semContatos
    );
    expect(fila[0].vencidoCents).toBe(11_234);
  });

  it("o que ainda NÃO venceu entra separado, pelo principal", () => {
    // Serve para negociar a dívida inteira na mesma ligação — mas somá-lo ao
    // vencido inflaria o valor de cobrança com o que ainda não é devido.
    const { fila } = agruparInadimplentes(
      [
        cobranca({ isLate: true, updatedBalanceCents: 10_000 }),
        cobranca({ isLate: false, balanceCents: 40_000, daysLate: 0 }),
      ],
      semContatos
    );
    expect(fila[0].vencidoCents).toBe(10_000);
    expect(fila[0].aVencerCents).toBe(40_000);
  });

  it("QUEM SÓ TEM PARCELA A VENCER NÃO É INADIMPLENTE", () => {
    // Misturá-lo encheria a lista de ligação de gente em dia — que é como uma
    // lista de cobrança deixa de ser usada.
    const { fila } = agruparInadimplentes(
      [cobranca({ isLate: false, daysLate: 0 })],
      semContatos
    );
    expect(fila).toEqual([]);
  });

  it("COBRANÇA SEM CLIENTE fica de fora E É CONTADA", () => {
    // Sem pessoa não há para quem ligar; somá-la a um "sem nome" inventaria um
    // devedor. Mas sumir em silêncio esconderia dívida da unidade.
    const { fila, semCliente } = agruparInadimplentes(
      [cobranca(), cobranca({ clientId: null }), cobranca({ clientId: null })],
      semContatos
    );
    expect(fila).toHaveLength(1);
    expect(semCliente).toBe(2);
  });

  it("cobrança sem cliente e EM DIA não entra na contagem", () => {
    const { semCliente } = agruparInadimplentes(
      [cobranca({ clientId: null, isLate: false })],
      semContatos
    );
    expect(semCliente).toBe(0);
  });

  it("quem deve MAIS aparece primeiro", () => {
    const { fila } = agruparInadimplentes(
      [
        cobranca({ clientId: "a", cliente: "Ana", updatedBalanceCents: 5_000 }),
        cobranca({ clientId: "b", cliente: "Bia", updatedBalanceCents: 90_000 }),
      ],
      semContatos
    );
    expect(fila.map((p) => p.cliente)).toEqual(["Bia", "Ana"]);
  });

  it("empate no valor desempata pelo atraso mais antigo", () => {
    const { fila } = agruparInadimplentes(
      [
        cobranca({ clientId: "a", cliente: "Ana", updatedBalanceCents: 5_000, daysLate: 10 }),
        cobranca({ clientId: "b", cliente: "Bia", updatedBalanceCents: 5_000, daysLate: 200 }),
      ],
      semContatos
    );
    expect(fila.map((p) => p.cliente)).toEqual(["Bia", "Ana"]);
  });

  it("SEM TELEFONE o campo vem nulo — e é essa a informação", () => {
    // É exatamente o que impede a ligação; esconder faria a cobrança descobrir
    // só na hora de discar.
    const { fila } = agruparInadimplentes(
      [cobranca({ telefone: null })],
      semContatos
    );
    expect(fila[0].telefone).toBeNull();
  });

  it("lista vazia não quebra", () => {
    expect(agruparInadimplentes([], semContatos)).toEqual({
      fila: [],
      semCliente: 0,
    });
  });
});

describe("o último contato entra na linha", () => {
  const ultimo: UltimoContato = {
    outcome: "PROMETEU_PAGAR",
    note: "paga na sexta",
    promisedDate: "2026-09-10",
    contactedAt: "2026-09-05T12:00:00Z",
    authorName: "Ana",
  };

  it("cola o último contato e o total", () => {
    const { fila } = agruparInadimplentes(
      [cobranca()],
      new Map([["c1", { ultimo, total: 3 }]])
    );
    expect(fila[0].ultimoContato?.outcome).toBe("PROMETEU_PAGAR");
    expect(fila[0].totalDeContatos).toBe(3);
  });

  it("quem nunca foi contatado fica com nulo, não com um contato vazio", () => {
    const { fila } = agruparInadimplentes([cobranca()], semContatos);
    expect(fila[0].ultimoContato).toBeNull();
    expect(fila[0].totalDeContatos).toBe(0);
  });
});

describe("cobertura da cobrança", () => {
  function pessoa(total: number): Inadimplente {
    return {
      clientId: `x${total}`,
      cliente: "X",
      telefone: null,
      vencidoCents: 1,
      quantidadeVencida: 1,
      aVencerCents: 0,
      diasDoMaisAntigo: 1,
      ultimoContato: null,
      totalDeContatos: total,
    };
  }

  it("conta quem já foi contatado", () => {
    const c = cobertura([pessoa(1), pessoa(2), pessoa(0)]);
    expect(c.contatados).toBe(2);
    expect(c.semContato).toBe(1);
    expect(c.percentual).toBe(67);
  });

  it("FILA VAZIA devolve NULO, não 0%", () => {
    // "0% contatado" acusaria de omissão quem não tem o que cobrar.
    const c = cobertura([]);
    expect(c.percentual).toBeNull();
    expect(c.contatados).toBe(0);
  });
});

describe("promessas vencidas", () => {
  function comPromessa(
    data: string | null,
    outcome: CollectionOutcome = "PROMETEU_PAGAR"
  ) {
    return {
      clientId: "c",
      cliente: "C",
      telefone: null,
      vencidoCents: 1,
      quantidadeVencida: 1,
      aVencerCents: 0,
      diasDoMaisAntigo: 1,
      totalDeContatos: 1,
      ultimoContato: {
        outcome,
        note: null,
        promisedDate: data,
        contactedAt: "2026-09-01T12:00:00Z",
        authorName: null,
      },
    } satisfies Inadimplente;
  }

  it("pega a promessa que já passou", () => {
    expect(promessasVencidas([comPromessa("2026-09-10")], "2026-09-15")).toHaveLength(1);
  });

  it("promessa para hoje ainda NÃO está vencida", () => {
    // O dia combinado é do cliente até o fim dele.
    expect(promessasVencidas([comPromessa("2026-09-15")], "2026-09-15")).toEqual([]);
  });

  it("promessa futura não entra", () => {
    expect(promessasVencidas([comPromessa("2026-09-20")], "2026-09-15")).toEqual([]);
  });

  it("promessa SEM data não vira promessa vencida", () => {
    expect(promessasVencidas([comPromessa(null)], "2026-09-15")).toEqual([]);
  });

  it("outro resultado não conta, mesmo com data", () => {
    expect(
      promessasVencidas([comPromessa("2026-09-01", "NAO_ATENDEU")], "2026-09-15")
    ).toEqual([]);
  });
});

describe("as respostas possíveis", () => {
  it("todas têm rótulo em português", () => {
    for (const o of COLLECTION_OUTCOMES) {
      expect(COLLECTION_OUTCOME_LABELS[o]).toBeTruthy();
      expect(COLLECTION_OUTCOME_LABELS[o]).not.toBe(o);
    }
  });

  it("só a promessa exige data", () => {
    expect(exigeDataPrometida("PROMETEU_PAGAR")).toBe(true);
    for (const o of COLLECTION_OUTCOMES) {
      if (o !== "PROMETEU_PAGAR") expect(exigeDataPrometida(o)).toBe(false);
    }
  });

  it("três respostas chamam outra pessoa", () => {
    expect(precisaDeOutraPessoa("JA_PAGOU")).toBe(true);
    expect(precisaDeOutraPessoa("CONTESTA")).toBe(true);
    expect(precisaDeOutraPessoa("PEDIU_RENEGOCIAR")).toBe(true);
    expect(precisaDeOutraPessoa("NAO_ATENDEU")).toBe(false);
  });

  it("o CHECK da migração 0255 lista exatamente estas respostas", () => {
    // Duas listas da mesma coisa divergem no dia em que alguém mexe só numa.
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0255_cobranca_retorno_do_contato.sql"),
      "utf8"
    );
    const bloco = sql.match(/check \(outcome in \(([\s\S]*?)\)\)/);
    expect(bloco, "não achei o CHECK de outcome na 0255").toBeTruthy();
    const doBanco = [...bloco![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect([...doBanco].sort()).toEqual([...COLLECTION_OUTCOMES].sort());
  });
});

describe("o link do WhatsApp", () => {
  it("põe o código do país quando falta", () => {
    expect(linkDoWhatsApp("(43) 99999-0000")).toBe("https://wa.me/5543999990000");
  });

  it("não duplica o código do país", () => {
    expect(linkDoWhatsApp("55 43 99999-0000")).toBe("https://wa.me/5543999990000");
  });

  it("SEM TELEFONE devolve nulo — botão que abre vazio parece que funcionou", () => {
    expect(linkDoWhatsApp(null)).toBeNull();
    expect(linkDoWhatsApp("")).toBeNull();
    expect(linkDoWhatsApp("1234")).toBeNull();
  });
});

describe("o filtro por período", () => {
  it("os extremos entram", () => {
    // Quem pede "de 01/03 a 31/03" espera o dia 31 dentro.
    expect(noPeriodo("2026-03-01", "2026-03-01", "2026-03-31")).toBe(true);
    expect(noPeriodo("2026-03-31", "2026-03-01", "2026-03-31")).toBe(true);
  });

  it("fora do intervalo fica fora", () => {
    expect(noPeriodo("2026-02-28", "2026-03-01", "2026-03-31")).toBe(false);
    expect(noPeriodo("2026-04-01", "2026-03-01", "2026-03-31")).toBe(false);
  });

  it("ponta em branco é ponta ABERTA", () => {
    // "De março em diante" é um filtro legítimo; exigir as duas datas
    // obrigaria a inventar um fim.
    expect(noPeriodo("2029-01-01", "2026-03-01", null)).toBe(true);
    expect(noPeriodo("2020-01-01", "2026-03-01", null)).toBe(false);
    expect(noPeriodo("2020-01-01", null, "2026-03-31")).toBe(true);
  });

  it("sem filtro nenhum, tudo passa", () => {
    expect(noPeriodo("2026-03-15", null, null)).toBe(true);
  });
});

describe("o rótulo do período", () => {
  const f = (iso: string) => iso.split("-").reverse().join("/");

  it("SEM FILTRO não inventa data", () => {
    // Relatório que declara um período que ninguém escolheu faz quem lê
    // acreditar num recorte que não existe.
    expect(rotuloDoPeriodo(null, null, f)).toBe("Tudo em aberto");
  });

  it("com as duas pontas", () => {
    expect(rotuloDoPeriodo("2026-03-01", "2026-03-31", f)).toBe(
      "Vencimento de 01/03/2026 a 31/03/2026"
    );
  });

  it("com uma ponta só, diz qual", () => {
    expect(rotuloDoPeriodo("2026-03-01", null, f)).toMatch(/a partir de/);
    expect(rotuloDoPeriodo(null, "2026-03-31", f)).toMatch(/até/);
  });
});

// ⚠️ O DEFEITO DE 15/09/2026: data ilegível na URL derrubava a tela com 500.
//
// A página chegava a `formatBrDate` com um texto que não é data e o formatador
// levantava "Invalid time value". Apareceu num endereço montado à mão — e
// endereço montado à mão é exatamente o que um favorito velho ou um link
// compartilhado produz.
describe("a data que vem da URL", () => {
  it("aceita o formato do campo de data", () => {
    expect(dataDoFiltro("2026-03-15")).toBe("2026-03-15");
  });

  it("TEXTO QUE NÃO É DATA VIRA NULO, nunca erro de tela", () => {
    for (const lixo of [
      "ontem",
      "15/03/2026",
      "Mon Sep 01 2025 00:00:00 GMT-0300",
      "2026-3-5",
      "javascript:alert(1)",
    ]) {
      expect(dataDoFiltro(lixo), lixo).toBeNull();
    }
  });

  it("formato certo com data que NÃO EXISTE também vira nulo", () => {
    // "2026-02-31" passa no molde e não é um dia do calendário.
    expect(dataDoFiltro("2026-02-31")).toBeNull();
    expect(dataDoFiltro("2026-13-01")).toBeNull();
  });

  it("vazio e ausente são nulo", () => {
    expect(dataDoFiltro("")).toBeNull();
    expect(dataDoFiltro(null)).toBeNull();
    expect(dataDoFiltro(undefined)).toBeNull();
  });

  it("espaço em volta não atrapalha", () => {
    expect(dataDoFiltro("  2026-03-15  ")).toBe("2026-03-15");
  });

  it("ano bissexto de verdade passa", () => {
    expect(dataDoFiltro("2028-02-29")).toBe("2028-02-29");
    expect(dataDoFiltro("2026-02-29")).toBeNull();
  });
});

describe("a frase da margem", () => {
  it('diz "dentro do limite", nunca "saudável"', () => {
    // O número é decisão da rede, não referência de mercado.
    const dentro = situacaoDaMargem(4, 7);
    expect(dentro).toMatch(/Dentro do limite de 7%/);
    expect(dentro).not.toMatch(/saudáv/i);
  });

  it("acima do limite fala alto", () => {
    expect(situacaoDaMargem(9, 7)).toMatch(/ACIMA/);
  });

  it("empatar com o limite ainda está dentro", () => {
    expect(situacaoDaMargem(7, 7)).toMatch(/Dentro/);
  });

  it("sem taxa e sem limite dizem o que falta, não um veredito", () => {
    expect(situacaoDaMargem(null, 7)).toMatch(/Nada a receber/);
    expect(situacaoDaMargem(4, null)).toMatch(/não definiu limite/);
  });
});
