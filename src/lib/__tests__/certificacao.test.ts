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
  cargosElegiveis,
  contaDesde,
  ehTipoDeTurma,
  missaoEstaValendo,
  podeIniciar,
  recadoDaMatricula,
  resumoDaPrevia,
  ehModoDeGrupo,
  grupoEstaDefinido,
  missaoDependeSoDeTerceiros,
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

describe("a origem de cada indicador (o que a Etapa 2 vai contar)", () => {
  it("todo indicador diz de onde o número sai", () => {
    // Sem isto, a contagem da Etapa 2 seria escrita "de cabeça" e o número
    // sairia de outro lugar — a tela mostraria "3 de 5" e ninguém saberia 3
    // do quê. Mostrar a origem do número faz parte do número.
    for (const i of INDICADORES) {
      expect(i.origem, `"${i.chave}" não diz de onde vem`).toMatch(
        /^[a-z_]+\.[a-z_]+(\.[a-z_]+)?( \+ .+)?$/
      );
    }
  });

  it("duas metas diferentes não saem da mesma coluna sem filtro", () => {
    // `primeiros_agendamentos` e `agendamentos_reavaliacao` vêm os dois de
    // `appointments.created_by` — e só se distinguem pelo `+ type=`. Origem
    // repetida SEM filtro seria o mesmo número em dois lugares, e o Admin
    // exigiria a mesma coisa duas vezes achando que exige duas.
    const semFiltro = INDICADORES.filter((i) => !i.origem.includes(" + ")).map(
      (i) => i.origem
    );
    expect(new Set(semFiltro).size).toBe(semFiltro.length);
  });
});

describe("o grupo do teste coletivo (0272)", () => {
  const metas: MetaDoTreino[] = [
    { role: "receptionist", indicator: "cadastros", minimum_count: 5 },
  ];

  it("⚠️ grupo vazio NÃO significa 'todo mundo'", () => {
    // Ler o vazio como "todos" escolheria o comportamento mais destrutivo
    // justamente quando ninguém escolheu nada: bastaria uma pessoa de férias
    // para travar a unidade inteira.
    expect(grupoEstaDefinido("papeis", [], [])).toBe(false);
    expect(grupoEstaDefinido("pessoas", [], [])).toBe(false);
  });

  it("cada modo olha a SUA lista, não a outra", () => {
    // Guardamos as duas listas para o Admin poder trocar de modo e voltar sem
    // perder o que montou. Se o modo olhasse a lista errada, ele veria o grupo
    // "definido" por causa de uma seleção que não está valendo.
    expect(grupoEstaDefinido("papeis", ["receptionist"], [])).toBe(true);
    expect(grupoEstaDefinido("pessoas", ["receptionist"], [])).toBe(false);
    expect(grupoEstaDefinido("pessoas", [], [{ user_id: "x" }])).toBe(true);
    expect(grupoEstaDefinido("papeis", [], [{ user_id: "x" }])).toBe(false);
  });

  it("só é elegível por cargo quem tem missão de verdade", () => {
    // Cargo sem meta nenhuma nasce aprovado: pô-lo no grupo faria a liberação
    // coletiva depender de gente que nunca foi medida.
    const elegiveis = cargosElegiveis(metas);
    expect(elegiveis).toContain("receptionist");
    expect(elegiveis).not.toContain("dentist");
    expect(cargosElegiveis([])).toHaveLength(0);
  });

  it("reconhece só os modos que o banco aceita", () => {
    expect(ehModoDeGrupo("papeis")).toBe(true);
    expect(ehModoDeGrupo("pessoas")).toBe(true);
    expect(ehModoDeGrupo("todos")).toBe(false);
  });
});

describe("as explicações que ajudam a configurar (25/09/2026)", () => {
  it("todo indicador diz o que conta, onde se faz e o quanto pesa", () => {
    // Sem isso o Admin escolhe o número no escuro: "recebimentos de
    // mercadoria" parece boa meta até ele perceber que exige um pedido feito
    // antes, por outra pessoa.
    for (const i of INDICADORES) {
      expect(i.ajuda.length, `"${i.chave}" sem explicação`).toBeGreaterThan(20);
      expect(i.onde.length, `"${i.chave}" não diz onde se faz`).toBeGreaterThan(4);
      expect(["essencial", "complementar"]).toContain(i.nivel);
    }
  });

  it("toda função tem pelo menos uma ação do dia a dia", () => {
    // Função só de "complementar" nasceria sem por onde começar, e o Admin
    // montaria a missão inteira de exceções.
    for (const papel of PAPEIS_COM_MISSAO) {
      const essenciais = indicadoresDoPapel(papel).filter(
        (i) => i.nivel === "essencial"
      );
      expect(
        essenciais.length,
        `${papel} não tem nenhuma ação essencial`
      ).toBeGreaterThan(0);
    }
  });

  it("os essenciais vêm PRIMEIRO na lista", () => {
    // A ordem decide o que o Admin configura: com até 16 opções numa função,
    // o que aparece embaixo não é lido.
    for (const papel of PAPEIS_COM_MISSAO) {
      const niveis = indicadoresDoPapel(papel).map((i) => i.nivel);
      const primeiroComplementar = niveis.indexOf("complementar");
      if (primeiroComplementar === -1) continue;
      expect(
        niveis.slice(primeiroComplementar).every((n) => n === "complementar"),
        `${papel} tem essencial depois de complementar`
      ).toBe(true);
    }
  });

  it("⚠️ avisa quando a missão inteira depende de terceiros", () => {
    // "Aprovar 5 planos" precisa de 5 planos prontos. Missão só disso trava a
    // pessoa por culpa de outra, e ela não tem como destravar sozinha.
    const soDependentes: MetaDoTreino[] = [
      { role: "clinical_coordinator", indicator: "aprovacoes_plano", minimum_count: 5 },
    ];
    expect(missaoDependeSoDeTerceiros(soDependentes, "clinical_coordinator")).toBe(
      true
    );

    // Basta UMA ação que ela faça do zero para o aviso sumir.
    const comAutonomia: MetaDoTreino[] = [
      ...soDependentes,
      { role: "clinical_coordinator", indicator: "avaliacoes", minimum_count: 3 },
    ];
    expect(missaoDependeSoDeTerceiros(comAutonomia, "clinical_coordinator")).toBe(
      false
    );

    // Sem missão nenhuma não há o que avisar — seria alarme sobre o vazio.
    expect(missaoDependeSoDeTerceiros([], "clinical_coordinator")).toBe(false);
  });

  it("as quatro ações desaconselhadas NÃO entraram", () => {
    // O dono viu a lista e concordou em deixá-las fora. Se alguém acrescentar
    // uma delas amanhã, é decisão nova — não pode entrar de carona.
    const fontesProibidas = [
      "audit_logs",        // mede navegação, não competência
      "chat_messages",     // mede conversa
      "notifications",     // não é ato dela
      "cancelled_by",      // premiar cancelamento produz cancelamento
      "reopened_by",       // mede retrabalho
    ];
    for (const i of INDICADORES) {
      for (const proibida of fontesProibidas) {
        expect(
          i.origem,
          `"${i.chave}" usa ${proibida}, que ficou de fora de propósito`
        ).not.toContain(proibida);
      }
    }
  });
});

describe("⚠️ A LEI DO MARCO: só conta depois do clique (0273)", () => {
  const convocado = {
    status: "convocado" as const,
    started_at: null,
  };
  const iniciada = {
    status: "em_andamento" as const,
    started_at: "2026-09-26T13:00:00.000Z",
  };

  it("sem o clique, NÃO existe janela de contagem", () => {
    // `null` não é zero: é "não há janela". Se quem chamar isto tratar null
    // como "conte desde sempre", a pessoa se certifica com o que fez enquanto
    // só estava aprendendo — que é exatamente o que esta lei proíbe.
    expect(contaDesde(convocado)).toBeNull();
    expect(contaDesde({ started_at: null })).toBeNull();
  });

  it("depois do clique, a janela começa no instante do clique", () => {
    const desde = contaDesde(iniciada);
    expect(desde).toBeInstanceOf(Date);
    expect(desde!.toISOString()).toBe("2026-09-26T13:00:00.000Z");
  });

  it("data estragada vira 'sem janela', não uma data maluca", () => {
    // Uma data inválida viraria `Invalid Date` e qualquer comparação com ela
    // é falsa — a contagem daria zero PARA SEMPRE, sem nada explicando.
    // Melhor não ter janela: aí o estado é visível ("não começou").
    expect(contaDesde({ started_at: "não é data" })).toBeNull();
  });

  it("só quem está convocado e não começou pode começar", () => {
    expect(podeIniciar(convocado)).toBe(true);
    expect(podeIniciar(iniciada)).toBe(false);
    expect(podeIniciar({ status: "concluido", started_at: "2026-09-26T13:00:00Z" })).toBe(false);
    expect(podeIniciar({ status: "dispensado", started_at: null })).toBe(false);
  });

  it("a missão vale só enquanto está em andamento", () => {
    expect(missaoEstaValendo(convocado)).toBe(false);
    expect(missaoEstaValendo(iniciada)).toBe(true);
    // Concluída não vale mais: quem passou não precisa continuar produzindo.
    expect(
      missaoEstaValendo({ status: "concluido", started_at: "2026-09-26T13:00:00Z" })
    ).toBe(false);
  });

  it("⚠️ o recado do convocado avisa que NADA está sendo medido", () => {
    // É a frase mais importante do módulo. Sem ela a pessoa evitaria usar o
    // treino com medo de "gastar a chance" — o oposto do que o treino é.
    const recado = recadoDaMatricula(convocado);
    expect(recado).toMatch(/não.*contad|nada.*cont/i);
    expect(recado).toMatch(/aprender|à vontade/i);

    expect(recadoDaMatricula(iniciada)).toMatch(/valendo|conta/i);
  });
});

describe("a prévia da turma (0273)", () => {
  const candidatos = [
    { user_id: "1", full_name: "Ana", role: "receptionist" as const, ja_certificado: false },
    { user_id: "2", full_name: "Bia", role: "receptionist" as const, ja_certificado: true },
    { user_id: "3", full_name: "Caio", role: "dentist" as const, ja_certificado: false },
  ];

  it("separa quem já passou de quem nunca fez", () => {
    // O Admin precisa da conta ANTES de convocar: descobrir depois que chamou
    // 2 em vez de 20 gasta a confiança da equipe no portão.
    expect(resumoDaPrevia(candidatos)).toEqual({
      total: 3,
      jaCertificados: 1,
      novos: 2,
    });
  });

  it("lista vazia devolve zeros, não quebra", () => {
    expect(resumoDaPrevia([])).toEqual({ total: 0, jaCertificados: 0, novos: 0 });
  });

  it("reconhece só os tipos que o banco aceita", () => {
    expect(ehTipoDeTurma("novatos")).toBe(true);
    expect(ehTipoDeTurma("reciclagem")).toBe(true);
    expect(ehTipoDeTurma("todos")).toBe(false);
  });
});
