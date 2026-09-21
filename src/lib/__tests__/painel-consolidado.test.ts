import { describe, expect, it } from "vitest";
import {
  inicioDoBalde,
  medianaInterpolada,
  montarPainel,
  type RelatoCru,
} from "../painel-de-relatos";

/**
 * O painel consolidado (20/09/2026): a conta saiu do banco (0258) e veio para o
 * código, para poder juntar os relatos do sistema e os do treino. Estes testes
 * prendem as MESMAS regras que estavam declaradas na migração.
 */

// 12:00 em Brasília = 15:00Z. Fugir da virada do dia é de propósito: a régua é
// a data civil brasileira, e meia-noite UTC já é o dia anterior aqui (0201).
const meioDia = (dia: string) => `${dia}T15:00:00.000Z`;

function relato(p: Partial<RelatoCru> = {}): RelatoCru {
  return {
    code: "OC-00001",
    kind: "erro",
    status: "aberto",
    modulo: "agenda",
    clinicId: "cam",
    clinicNome: "Risarte Cambé",
    reporterId: "p1",
    reporterNome: "Recepção",
    reporterPapel: "receptionist",
    reporterEhAdmin: false,
    criadoEm: meioDia("2026-09-10"),
    primeiraRespostaEm: null,
    encerradoEm: null,
    reaberturas: 0,
    ambiente: "sistema",
    ...p,
  };
}

const PERIODO = { de: "2026-09-01", ate: "2026-09-30" };
const CHEIO = {
  periodo: PERIODO,
  rede: true,
  unidades: null,
  unidadesDoEscopo: [{ id: "cam", nome: "Risarte Cambé" }],
  respostas: [],
};

describe("montarPainel — os dois ambientes na mesma conta", () => {
  it("soma relatos do sistema e do treino", () => {
    const p = montarPainel({
      ...CHEIO,
      relatos: [
        relato({ code: "OC-1", ambiente: "sistema" }),
        relato({ code: "OC-2", ambiente: "treino" }),
      ],
    });
    expect(p.totais.relatos).toBe(2);
    expect(p.totais.em_aberto).toBe(2);
  });

  it("o período filtra pela data de REGISTRO, no relógio brasileiro", () => {
    const p = montarPainel({
      ...CHEIO,
      relatos: [
        relato({ code: "OC-1", criadoEm: meioDia("2026-08-31") }),
        relato({ code: "OC-2", criadoEm: meioDia("2026-09-01") }),
        relato({ code: "OC-3", criadoEm: meioDia("2026-10-01") }),
        // 21h de 30/09 no Brasil = 00h de 01/10 em UTC: continua sendo setembro.
        relato({ code: "OC-4", criadoEm: "2026-10-01T00:30:00.000Z" }),
      ],
    });
    expect(p.totais.relatos).toBe(2);
  });

  it("aproveitado é RESOLVIDO; 'não é defeito' é participação", () => {
    const p = montarPainel({
      ...CHEIO,
      relatos: [
        relato({ code: "OC-1", kind: "sugestao", status: "resolvido" }),
        relato({ code: "OC-2", kind: "sugestao", status: "nao_e_defeito" }),
      ],
    });
    expect(p.totais.sugestoes).toBe(2);
    expect(p.totais.sugestoes_implantadas).toBe(1);
    expect(p.totais.sugestoes_recusadas).toBe(1);
    expect(p.por_unidade[0].aproveitados).toBe(1);
  });

  it("tempo usa só quem chegou lá — sem resposta NÃO entra como zero", () => {
    const p = montarPainel({
      ...CHEIO,
      relatos: [
        relato({
          code: "OC-1",
          criadoEm: "2026-09-10T15:00:00.000Z",
          primeiraRespostaEm: "2026-09-10T17:00:00.000Z", // 2h
        }),
        relato({
          code: "OC-2",
          criadoEm: "2026-09-11T15:00:00.000Z",
          primeiraRespostaEm: "2026-09-11T19:00:00.000Z", // 4h
        }),
        relato({ code: "OC-3" }), // sem resposta
      ],
    });
    expect(p.tempos.respondidos).toBe(2);
    expect(p.tempos.resposta_media_h).toBe(3);
    expect(p.tempos.resposta_mediana_h).toBe(3);
  });

  it("encerrado sem data de conclusão fica fora da média e é contado à parte", () => {
    const p = montarPainel({
      ...CHEIO,
      relatos: [
        relato({ code: "OC-1", status: "resolvido", encerradoEm: null }),
        relato({
          code: "OC-2",
          status: "resolvido",
          criadoEm: "2026-09-10T15:00:00.000Z",
          encerradoEm: "2026-09-11T15:00:00.000Z", // 24h
        }),
      ],
    });
    expect(p.tempos.concluidos).toBe(1);
    expect(p.tempos.concluidos_sem_data).toBe(1);
    expect(p.tempos.conclusao_media_h).toBe(24);
  });

  it("os rankings deixam de fora os relatos do Admin Master", () => {
    const p = montarPainel({
      ...CHEIO,
      relatos: [
        relato({ code: "OC-1", reporterId: "admin", reporterEhAdmin: true }),
        relato({ code: "OC-2", reporterId: "p1" }),
      ],
    });
    expect(p.totais.relatos).toBe(2);
    expect(p.por_unidade[0].relatos).toBe(1);
    expect(p.por_pessoa?.map((x) => x.reporter_id)).toEqual(["p1"]);
  });

  it("unidade não vê ranking de pessoas", () => {
    const p = montarPainel({ ...CHEIO, rede: false, relatos: [relato()] });
    expect(p.por_pessoa).toBeNull();
  });

  it("o escopo de unidades corta o que não é seu", () => {
    const p = montarPainel({
      ...CHEIO,
      rede: false,
      unidades: ["cam"],
      relatos: [
        relato({ code: "OC-1", clinicId: "cam" }),
        relato({ code: "OC-2", clinicId: "lon", clinicNome: "Londrina" }),
      ],
    });
    expect(p.totais.relatos).toBe(1);
  });

  it("'parados' é o que está aberto AGORA, de qualquer data, sem o título", () => {
    const p = montarPainel({
      ...CHEIO,
      relatos: [
        relato({ code: "OC-VELHO", criadoEm: meioDia("2026-01-05") }),
        relato({ code: "OC-RESOLVIDO", status: "resolvido" }),
      ],
    });
    expect(p.parados.map((x) => x.code)).toEqual(["OC-VELHO"]);
    expect(Object.keys(p.parados[0])).not.toContain("title");
  });

  it("respostas enviadas contam pela data em que foram ESCRITAS", () => {
    const p = montarPainel({
      ...CHEIO,
      relatos: [],
      respostas: [
        { criadaEm: meioDia("2026-09-10"), clinicId: "cam" },
        { criadaEm: meioDia("2026-08-10"), clinicId: "cam" },
      ],
    });
    expect(p.respostas_enviadas).toBe(1);
  });

  it("a série usa semana até 120 dias e mês depois", () => {
    const semana = montarPainel({ ...CHEIO, relatos: [] });
    expect(semana.escopo.grao).toBe("week");
    const mes = montarPainel({
      ...CHEIO,
      periodo: { de: "2026-01-01", ate: "2026-09-30" },
      relatos: [],
    });
    expect(mes.escopo.grao).toBe("month");
    expect(mes.serie[0].inicio).toBe("2026-01-01");
  });

  it("a série conta relatados pela abertura e concluídos pelo encerramento", () => {
    const p = montarPainel({
      ...CHEIO,
      relatos: [
        relato({
          code: "OC-1",
          criadoEm: meioDia("2026-09-08"), // terça
          status: "resolvido",
          encerradoEm: meioDia("2026-09-16"), // semana seguinte
        }),
      ],
    });
    const semanaDaAbertura = p.serie.find((s) => s.inicio === "2026-09-07");
    const semanaDoFecho = p.serie.find((s) => s.inicio === "2026-09-14");
    expect(semanaDaAbertura?.relatados).toBe(1);
    expect(semanaDaAbertura?.concluidos).toBe(0);
    expect(semanaDoFecho?.concluidos).toBe(1);
  });
});

describe("medianaInterpolada — a mesma do Postgres", () => {
  it("ímpar devolve o do meio", () => {
    expect(medianaInterpolada([1, 5, 9])).toBe(5);
  });
  it("par interpola entre os dois vizinhos", () => {
    expect(medianaInterpolada([1, 2, 3, 10])).toBe(2.5);
  });
  it("conjunto vazio não vira zero", () => {
    expect(medianaInterpolada([])).toBeNull();
  });
});

describe("inicioDoBalde", () => {
  it("semana começa na segunda, como o date_trunc", () => {
    expect(inicioDoBalde("2026-09-10", "week")).toBe("2026-09-07"); // quinta → segunda
    expect(inicioDoBalde("2026-09-07", "week")).toBe("2026-09-07");
    expect(inicioDoBalde("2026-09-13", "week")).toBe("2026-09-07"); // domingo
  });
  it("mês começa no dia 1", () => {
    expect(inicioDoBalde("2026-09-23", "month")).toBe("2026-09-01");
  });
});
