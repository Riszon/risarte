import { describe, expect, it } from "vitest";
import {
  MODULOS,
  abaInicial,
  aguardaSuporte,
  casaBusca,
  contarAbas,
  faixaDeIdade,
  moduloDaTela,
  naAba,
  ordenar,
  relogioDoRelato,
  rotuloDeDuracao,
  temRespostaNova,
  type Relato,
} from "@/lib/system-reports";
import { readFileSync } from "node:fs";

const HORA = 3_600_000;
const DIA = 24 * HORA;
const AGORA = Date.parse("2026-09-16T15:00:00.000Z");

function relato(p: Partial<Relato> = {}): Relato {
  return {
    id: "r1",
    code: "OC-00009",
    kind: "erro",
    severity: "media",
    title: "A agenda não deixa marcar no sábado",
    whatHappened: "Escolhi sábado e o sistema recusou.",
    expected: null,
    screen: "/agenda",
    module: "agenda",
    appVersion: "0.246.0",
    errorDigest: null,
    userAgent: null,
    status: "aberto",
    answer: null,
    answeredAt: null,
    resolvedVersion: null,
    createdAt: new Date(AGORA - DIA).toISOString(),
    statusChangedAt: null,
    closedAt: null,
    firstResponseAt: null,
    reopenedCount: 0,
    reporterRole: "Recepcionista",
    reporterName: "Maria da Silva",
    clinicId: "c1",
    clinicName: "Risarte Cambé",
    meu: false,
    respostaLida: false,
    respostas: 0,
    ultimaFalaDoRelator: false,
    ambiente: "sistema",
    ...p,
  };
}

describe("módulo sugerido pela tela", () => {
  it("reconhece o primeiro pedaço do endereço", () => {
    expect(moduloDaTela("/agenda")).toBe("agenda");
    expect(moduloDaTela("/financeiro/recebiveis/inadimplentes")).toBe("financeiro");
    expect(moduloDaTela("/empresarial/funil/abc")).toBe("empresarial");
  });

  it("ignora o que vem depois de ? e #", () => {
    expect(moduloDaTela("/estoque?aba=kits#x")).toBe("estoque");
  });

  it("a tela inicial é do módulo geral", () => {
    expect(moduloDaTela("/")).toBe("geral");
  });

  it("não chuta: texto livre e tela desconhecida ficam sem módulo", () => {
    expect(moduloDaTela("Agenda · sábado")).toBeNull();
    expect(moduloDaTela("/tela-que-nao-existe")).toBeNull();
    expect(moduloDaTela("")).toBeNull();
    expect(moduloDaTela(null)).toBeNull();
  });

  it("casa o SEGMENTO inteiro, não o começo da palavra", () => {
    // "planos" é do clínico; "planejamento" não pode cair nele por prefixo.
    expect(moduloDaTela("/planejamento/x")).toBe("planejamento");
    expect(moduloDaTela("/planos")).toBe("clinico");
  });

  // ⚠️ A lista do TypeScript e o `check` do banco são duas cópias. Se um
  // módulo entrar só aqui, o relato é recusado ao gravar — e a pessoa perde o
  // texto que escreveu.
  it("a lista é a mesma do check da migração 0256", () => {
    const sql = readFileSync(
      "supabase/migrations/0256_relatos_conversa_e_tempo.sql",
      "utf8"
    );
    const bloco = /module in \(([\s\S]*?)\)/.exec(sql)?.[1];
    expect(bloco, "não achei o check na migração").toBeTruthy();
    const doBanco = [...bloco!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(doBanco.length).toBeGreaterThan(0);
    expect(MODULOS.map((m) => m.value).sort()).toEqual(doBanco);
  });
});

describe("relógio do relato", () => {
  it("duração legível e nunca negativa", () => {
    expect(rotuloDeDuracao(-5)).toBe("menos de 1 h");
    expect(rotuloDeDuracao(30 * 60_000)).toBe("menos de 1 h");
    expect(rotuloDeDuracao(5 * HORA)).toBe("5 h");
    expect(rotuloDeDuracao(DIA)).toBe("1 dia");
    expect(rotuloDeDuracao(12 * DIA + 5 * HORA)).toBe("12 dias");
  });

  it("faixas combinadas: até 2 dias, de 3 a 7, acima de 7", () => {
    expect(faixaDeIdade(0)).toBe("recente");
    expect(faixaDeIdade(2 * DIA + 23 * HORA)).toBe("recente");
    expect(faixaDeIdade(3 * DIA)).toBe("atencao");
    expect(faixaDeIdade(7 * DIA + 23 * HORA)).toBe("atencao");
    expect(faixaDeIdade(8 * DIA)).toBe("atrasado");
  });

  it("aberto mostra há quanto tempo, com cor", () => {
    const r = relogioDoRelato(
      relato({ createdAt: new Date(AGORA - 4 * DIA).toISOString() }),
      AGORA
    );
    expect(r.principal).toBe("aberto há 4 dias");
    expect(r.faixa).toBe("atencao");
    expect(r.secundario).toBeNull();
  });

  it("em análise mostra os DOIS tempos, e a cor segue o total", () => {
    const r = relogioDoRelato(
      relato({
        status: "em_analise",
        createdAt: new Date(AGORA - 10 * DIA).toISOString(),
        statusChangedAt: new Date(AGORA - 5 * HORA).toISOString(),
      }),
      AGORA
    );
    expect(r.principal).toBe("aberto há 10 dias");
    expect(r.secundario).toBe("em análise há 5 h");
    // Passar para "em análise" não zera o atraso de quem esperou dez dias.
    expect(r.faixa).toBe("atrasado");
  });

  it("encerrado mostra quanto levou, sem cor de atraso", () => {
    const r = relogioDoRelato(
      relato({
        status: "resolvido",
        createdAt: new Date(AGORA - 10 * DIA).toISOString(),
        closedAt: new Date(AGORA - 7 * DIA).toISOString(),
      }),
      AGORA
    );
    expect(r.principal).toBe("resolvido em 3 dias");
    expect(r.faixa).toBeNull();
  });

  it("encerrado antigo sem data de conclusão não inventa duração", () => {
    const r = relogioDoRelato(
      relato({ status: "nao_e_defeito", closedAt: null }),
      AGORA
    );
    expect(r.principal).toBe("encerrado");
  });
});

describe("abas", () => {
  const lista = [
    relato({ id: "a", status: "aberto" }),
    relato({ id: "b", status: "em_analise", meu: true }),
    relato({ id: "c", status: "resolvido", respostas: 1, meu: true }),
    relato({ id: "d", status: "nao_e_defeito", respostas: 2 }),
  ];

  it("cada relato cai onde deve", () => {
    expect(contarAbas(lista)).toEqual({
      fila: 2,
      meus: 2,
      respondidos: 2,
      encerrados: 2,
      todos: 4,
    });
  });

  it("respondido em aberto aparece nas duas abas", () => {
    const r = relato({ status: "em_analise", respostas: 1 });
    expect(naAba(r, "fila")).toBe(true);
    expect(naAba(r, "respondidos")).toBe(true);
  });

  it("o Admin Master abre na fila", () => {
    expect(abaInicial(lista, true)).toBe("fila");
  });

  it("quem tem relato abre nos seus; quem não tem, na fila da unidade", () => {
    expect(abaInicial(lista, false)).toBe("meus");
    expect(abaInicial([relato()], false)).toBe("fila");
  });

  it("a fila põe quem espera há mais tempo primeiro", () => {
    const velho = relato({ id: "velho", createdAt: new Date(AGORA - 9 * DIA).toISOString() });
    const novo = relato({ id: "novo", createdAt: new Date(AGORA - DIA).toISOString() });
    expect(ordenar([novo, velho], "fila").map((r) => r.id)).toEqual(["velho", "novo"]);
    expect(ordenar([velho, novo], "todos").map((r) => r.id)).toEqual(["novo", "velho"]);
  });

  it("respondidos: a resposta mais recente primeiro", () => {
    const ontem = relato({ id: "ontem", answeredAt: new Date(AGORA - DIA).toISOString() });
    const hoje = relato({ id: "hoje", answeredAt: new Date(AGORA - HORA).toISOString() });
    expect(ordenar([ontem, hoje], "respondidos").map((r) => r.id)).toEqual([
      "hoje",
      "ontem",
    ]);
  });
});

describe("sinais", () => {
  it("resposta nova só para quem relatou, e some depois de lida", () => {
    expect(temRespostaNova(relato({ meu: true, respostas: 1 }))).toBe(true);
    expect(temRespostaNova(relato({ meu: true, respostas: 1, respostaLida: true }))).toBe(false);
    expect(temRespostaNova(relato({ meu: false, respostas: 1 }))).toBe(false);
    expect(temRespostaNova(relato({ meu: true, respostas: 0 }))).toBe(false);
  });

  it("aguarda o suporte: nunca respondido, ou a última palavra é de quem relatou", () => {
    expect(aguardaSuporte(relato())).toBe(true);
    expect(aguardaSuporte(relato({ respostas: 1 }))).toBe(false);
    expect(aguardaSuporte(relato({ respostas: 1, ultimaFalaDoRelator: true }))).toBe(true);
    expect(
      aguardaSuporte(relato({ status: "resolvido", respostas: 1, ultimaFalaDoRelator: true }))
    ).toBe(false);
  });
});

describe("busca", () => {
  const r = relato();

  it("acha pelo código de qualquer jeito que se digite", () => {
    for (const t of ["OC-00009", "oc-9", "00009", "9", "oc9"]) {
      expect(casaBusca(r, t), t).toBe(true);
    }
    expect(casaBusca(r, "OC-00010")).toBe(false);
  });

  it("ignora acento e caixa, e aceita palavras fora de ordem", () => {
    expect(casaBusca(r, "SABADO agenda")).toBe(true);
    expect(casaBusca(r, "nao deixa")).toBe(true);
    expect(casaBusca(r, "sabado financeiro")).toBe(false);
  });

  it("acha por quem relatou", () => {
    expect(casaBusca(r, "maria")).toBe(true);
  });

  it("busca vazia mostra tudo", () => {
    expect(casaBusca(r, "   ")).toBe(true);
  });
});
