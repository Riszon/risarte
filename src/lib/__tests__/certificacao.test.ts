import { describe, expect, it } from "vitest";
import {
  ESCOPOS,
  GATILHOS,
  INDICADORES,
  PADRAO_DO_PORTAO,
  PAPEIS_COM_MISSAO,
  ehEscopo,
  ehGatilho,
  indicadoresDoPapel,
  missaoDoPapel,
  normalizarMeta,
  resumoDaMissao,
  temMissao,
  type MetaDoTreino,
} from "@/lib/certificacao";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";

describe("catálogo de indicadores", () => {
  it("todo indicador aponta para função que existe", () => {
    // Indicador amarrado a um papel inventado nunca apareceria na tela, e o
    // Admin procuraria um defeito que está no catálogo, não na tela.
    for (const indicador of INDICADORES) {
      for (const papel of indicador.papeis) {
        expect(
          Object.keys(ROLE_LABELS),
          `indicador "${indicador.chave}" aponta para função inexistente: ${papel}`
        ).toContain(papel);
      }
    }
  });

  it("toda função com missão tem pelo menos um indicador", () => {
    // Função na lista sem nada para medir viraria um cartão vazio na tela,
    // sugerindo que falta configurar quando na verdade não há o que configurar.
    for (const papel of PAPEIS_COM_MISSAO) {
      expect(
        indicadoresDoPapel(papel).length,
        `${papel} está em PAPEIS_COM_MISSAO e não tem indicador nenhum`
      ).toBeGreaterThan(0);
    }
  });

  it("todo indicador é alcançável por alguma função da lista", () => {
    // ⚠️ RÉGUA VAZIA GRITA: indicador que não pertence a nenhuma função da
    // tela é código que ninguém consegue configurar — existe e não serve.
    for (const indicador of INDICADORES) {
      const alcancado = PAPEIS_COM_MISSAO.some((p) =>
        indicadoresDoPapel(p).some((i) => i.chave === indicador.chave)
      );
      expect(
        alcancado,
        `"${indicador.chave}" não aparece para nenhuma função configurável`
      ).toBe(true);
    }
  });

  it("não há chave repetida", () => {
    const chaves = INDICADORES.map((i) => i.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe("a missão de cada função", () => {
  const metas: MetaDoTreino[] = [
    { role: "receptionist", indicator: "cadastros", minimum_count: 5 },
    { role: "receptionist", indicator: "primeiros_agendamentos", minimum_count: 3 },
    { role: "clinical_coordinator", indicator: "avaliacoes", minimum_count: 2 },
  ];

  it("indicador sem linha no banco vale ZERO, não some da tela", () => {
    // O Admin precisa VER o indicador que ainda não exigiu, senão ele não tem
    // como passar a exigi-lo — a tela mostraria só o que já está configurado.
    const missao = missaoDoPapel(metas, "receptionist");
    const reavaliacao = missao.find(
      (m) => m.indicador.chave === "agendamentos_reavaliacao"
    );
    expect(reavaliacao).toBeDefined();
    expect(reavaliacao!.minimo).toBe(0);
  });

  it("lê a meta gravada", () => {
    const missao = missaoDoPapel(metas, "receptionist");
    expect(missao.find((m) => m.indicador.chave === "cadastros")!.minimo).toBe(5);
  });

  it("não mistura a meta de uma função com a de outra", () => {
    // Mesma chave de indicador em funções diferentes é normal (`cadastros`
    // vale para recepcionista E para SDR); buscar só pela chave misturaria as
    // duas e a SDR herdaria a exigência da recepção.
    const daSdr = missaoDoPapel(metas, "sdr");
    expect(daSdr.find((m) => m.indicador.chave === "cadastros")!.minimo).toBe(0);
  });

  it("função sem nenhuma meta não tem missão", () => {
    expect(temMissao(metas, "receptionist")).toBe(true);
    expect(temMissao(metas, "dentist")).toBe(false);
    expect(temMissao([], "receptionist")).toBe(false);
  });

  it("o resumo devolve null quando não há missão", () => {
    // Não é uma frase vazia: quem chama decide o que escrever ("sem missão
    // definida"), em vez de mostrar um traço solto com cara de defeito.
    expect(resumoDaMissao(metas, "dentist")).toBeNull();
    expect(resumoDaMissao(metas, "receptionist")).toContain("5 ×");
  });
});

describe("normalizar o que veio do formulário", () => {
  it("número bom passa inteiro", () => {
    expect(normalizarMeta("5")).toBe(5);
    expect(normalizarMeta(12)).toBe(12);
  });

  it("vazio, lixo e negativo viram zero em vez de derrubar a gravação", () => {
    // A tela tem um campo por indicador. Um em branco não pode impedir o Admin
    // de salvar os outros — zero é "sem exigência", que é o que ele quis dizer.
    for (const bruto of ["", "   ", "abc", null, undefined, -3, "-3", 0]) {
      expect(normalizarMeta(bruto), `"${String(bruto)}" deveria virar 0`).toBe(0);
    }
  });

  it("quebrado vira inteiro para baixo", () => {
    // "2,5 cadastros" não existe. Arredondar para cima exigiria 3 de quem
    // digitou 2,5 — pedir mais do que foi escrito é pior que pedir menos.
    expect(normalizarMeta("2.9")).toBe(2);
  });
});

describe("os dois eixos de liberação", () => {
  it("o padrão é o mais cauteloso dos quatro", () => {
    // Individual (ninguém fica preso esperando colega) + aprovação (nada abre
    // sozinho sem alguém olhar). Abrir por engano não tem volta; travar tem.
    expect(PADRAO_DO_PORTAO.release_scope).toBe("individual");
    expect(PADRAO_DO_PORTAO.release_trigger).toBe("aprovacao");
  });

  it("reconhece só os valores que o banco aceita", () => {
    expect(ehEscopo("individual")).toBe(true);
    expect(ehEscopo("coletiva")).toBe(true);
    expect(ehEscopo("qualquer")).toBe(false);
    expect(ehGatilho("automatica")).toBe(true);
    expect(ehGatilho("aprovacao")).toBe(true);
    expect(ehGatilho("")).toBe(false);
  });

  it("os valores do código são os mesmos do banco (0271)", () => {
    // Se divergirem, a tela grava um valor que o `check` do banco recusa — e o
    // Admin vê "erro ao salvar" sem nada explicando o quê.
    expect([...ESCOPOS]).toEqual(["individual", "coletiva"]);
    expect([...GATILHOS]).toEqual(["automatica", "aprovacao"]);
  });
});

describe("⚠️ o padrão é ÚNICO DA REDE (ordem do dono, 25/09/2026)", () => {
  it("nenhuma função do módulo aceita unidade", () => {
    // Esta é a única configuração do sistema FORA da cascata rede→unidade, e é
    // de propósito: unidade que pudesse baixar a própria régua transformaria o
    // portão em sugestão. Se alguém acrescentar `clinicId` aqui amanhã, é
    // porque a regra mudou — e a mudança tem de ser decidida, não descoberta.
    const assinaturas = [
      missaoDoPapel,
      temMissao,
      resumoDaMissao,
      indicadoresDoPapel,
    ];
    for (const fn of assinaturas) {
      expect(
        fn.toString(),
        `${fn.name} passou a mencionar unidade — a regra da rede mudou?`
      ).not.toMatch(/clinic|unidade/i);
    }
  });

  it("toda função com missão é papel de verdade", () => {
    for (const papel of PAPEIS_COM_MISSAO) {
      expect(Object.keys(ROLE_LABELS)).toContain(papel as UserRole);
    }
  });
});
