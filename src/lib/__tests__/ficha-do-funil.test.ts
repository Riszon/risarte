import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEAD_STAGES } from "@/lib/empresarial/constants";
import { ETAPAS_DA_FICHA } from "@/lib/empresarial/etapas-do-funil";
import {
  FASE_SIGNIFICA,
  linhaDoTempo,
  proximaAcao,
  proximaReuniao,
  proximoPasso,
  situacaoDoHistorico,
  type DadosDoProximoPasso,
  type FontesDoHistorico,
} from "@/lib/empresarial/ficha-do-funil";

// A ficha da empresa no funil, 3ª volta do OC-00083 (13/10/2026): o cabeçalho
// diz quem é a empresa e o que fazer agora, a aba Fechamento deixou de abrir
// em branco e o histórico ganhou aba.

const base: DadosDoProximoPasso = {
  stage: "PRESENTED",
  motivoDaPerda: null,
  temLevantamento: true,
  faltaProposta: 0,
  propostaEnviada: false,
  contratoAssinado: false,
  implantacaoPaga: false,
  conferido: false,
  empresaCriada: false,
  passosFeitos: 0,
  passosTotal: 5,
  tentativasDeContato: 0,
  proximaReuniao: null,
};

const ABAS = [...ETAPAS_DA_FICHA, "historico"];

describe("o próximo passo", () => {
  it("TODA fase tem resposta, e ela aponta para uma aba que existe", () => {
    // Fase nova no banco sem entrada aqui deixaria o alto da ficha vazio — e
    // o botão "Ir para…" levando a lugar nenhum.
    for (const stage of LEAD_STAGES) {
      const p = proximoPasso({ ...base, stage });
      expect(p, stage).toBeDefined();
      expect(p.titulo.length, stage).toBeGreaterThan(0);
      expect(ABAS, stage).toContain(p.aba);
      expect(FASE_SIGNIFICA[stage].length, stage).toBeGreaterThan(0);
    }
  });

  it("empresa perdida não tem próximo passo: diz o desfecho e o motivo", () => {
    const p = proximoPasso({
      ...base,
      stage: "CLOSED_LOST",
      motivoDaPerda: "Fechou com outro convênio",
    });
    expect(p.tom).toBe("encerrado");
    expect(p.detalhe).toContain("Fechou com outro convênio");
    expect(p.aba).toBe("fechamento");
    // Sem motivo gravado, diz que não há — não inventa um.
    expect(proximoPasso({ ...base, stage: "CLOSED_LOST" }).detalhe).toBe(
      "Nenhum motivo foi registrado."
    );
  });

  it("O BURACO VEM ANTES DO ROTEIRO: apresentada sem levantamento não ouve 'complete a proposta'", () => {
    for (const stage of ["PRESENTED", "PROPOSAL_SENT", "FOLLOW_UP"] as const) {
      const p = proximoPasso({
        ...base,
        stage,
        temLevantamento: false,
        faltaProposta: 6,
      });
      expect(p.tom, stage).toBe("alerta");
      expect(p.aba, stage).toBe("levantamento");
    }
    // Antes da apresentação, levantamento vazio é o esperado — sem alerta.
    expect(
      proximoPasso({ ...base, stage: "CONTACT", temLevantamento: false }).tom
    ).toBe("agir");
  });

  it("captação e contato mandam registrar no Histórico, e contam as tentativas", () => {
    expect(proximoPasso({ ...base, stage: "CAPTURE" }).aba).toBe("historico");
    const contato = proximoPasso({ ...base, stage: "CONTACT", tentativasDeContato: 3 });
    expect(contato.aba).toBe("historico");
    expect(contato.detalhe).toContain("3 tentativas registradas");
    expect(
      proximoPasso({ ...base, stage: "CONTACT", tentativasDeContato: 1 }).detalhe
    ).toContain("1 tentativa registrada");
  });

  it("reunião agendada SEM reunião futura é avisada, em vez de mandar preparar a apresentação", () => {
    const com = proximoPasso({
      ...base,
      stage: "MEETING_SCHEDULED",
      proximaReuniao: "2026-10-20T14:00:00Z",
    });
    expect(com.aba).toBe("apresentacao");
    const sem = proximoPasso({ ...base, stage: "MEETING_SCHEDULED" });
    expect(sem.aba).toBe("historico");
    expect(sem.detalhe).toContain("nenhuma reunião futura");
  });

  it("apresentada: completa a proposta; pronta, manda enviar", () => {
    const falta = proximoPasso({ ...base, faltaProposta: 6 });
    expect(falta.titulo).toBe("Completar a proposta");
    expect(falta.detalhe).toContain("6 campos faltam");
    expect(falta.aba).toBe("proposta");
    expect(proximoPasso({ ...base, faltaProposta: 1 }).detalhe).toContain("1 campo falta");
    const pronta = proximoPasso(base);
    expect(pronta.titulo).toBe("Enviar a proposta");
    expect(pronta.aba).toBe("envio");
  });

  it("em negociação: primeiro o envio registrado, depois o contrato, depois o pagamento", () => {
    const negociando = { ...base, stage: "FOLLOW_UP" as const };
    const semEnvio = proximoPasso(negociando);
    expect(semEnvio.tom).toBe("alerta");
    expect(semEnvio.titulo).toBe("Registrar o envio da proposta");

    const semContrato = proximoPasso({ ...negociando, propostaEnviada: true });
    expect(semContrato.titulo).toBe("Conseguir a assinatura do contrato");
    expect(semContrato.detalhe).toContain("Só é ganho com os dois");

    const soFaltaContrato = proximoPasso({
      ...negociando,
      propostaEnviada: true,
      implantacaoPaga: true,
    });
    expect(soFaltaContrato.detalhe).toContain("falta só o contrato");

    const semPagamento = proximoPasso({
      ...negociando,
      propostaEnviada: true,
      contratoAssinado: true,
    });
    expect(semPagamento.titulo).toBe("Confirmar o pagamento da implantação");
    for (const p of [semEnvio, semContrato, semPagamento]) expect(p.aba).toBe("envio");
  });

  it("GANHA: a empresa vem ANTES da conferência — a conferência recusa sem ela", () => {
    const ganha = { ...base, stage: "CLOSED_WON" as const };
    // Sem cadastro E sem conferência — o caso de quem acabou de ganhar. A
    // primeira versão deste teste não tinha esta linha e passava verde com a
    // ordem invertida (pego ao quebrar o código de propósito).
    expect(proximoPasso(ganha).titulo).toBe("Criar o cadastro da empresa");
    // Mesmo já "conferida", sem cadastro o passo é criar a empresa.
    expect(proximoPasso({ ...ganha, conferido: true }).titulo).toBe(
      "Criar o cadastro da empresa"
    );
    expect(proximoPasso({ ...ganha, empresaCriada: true }).titulo).toBe(
      "Fazer a conferência do fechamento"
    );
    const tudo = proximoPasso({ ...ganha, empresaCriada: true, conferido: true });
    expect(tudo.tom).toBe("ok");
  });

  it("implantação conta os passos — e '0 de 5' não é 'concluída'", () => {
    const comeco = proximoPasso({ ...base, stage: "IMPLEMENTATION", empresaCriada: true });
    expect(comeco.tom).toBe("agir");
    expect(comeco.detalhe).toBe("0 de 5 passos resolvidos.");
    const fim = proximoPasso({
      ...base,
      stage: "IMPLEMENTATION",
      empresaCriada: true,
      passosFeitos: 5,
    });
    expect(fim.tom).toBe("ok");
    expect(fim.titulo).toBe("Implantação concluída");
  });
});

describe("a próxima ação agendada", () => {
  it("conta em dias de calendário e diz quando está atrasada", () => {
    const hoje = "2026-10-13";
    expect(proximaAcao(null, hoje)).toBeNull();
    expect(proximaAcao("2026-10-13", hoje)).toEqual({ atrasada: false, quando: "hoje" });
    expect(proximaAcao("2026-10-14", hoje)).toEqual({ atrasada: false, quando: "amanhã" });
    expect(proximaAcao("2026-10-16", hoje)).toEqual({ atrasada: false, quando: "em 3 dias" });
    expect(proximaAcao("2026-10-12", hoje)).toEqual({ atrasada: true, quando: "ontem" });
    expect(proximaAcao("2026-10-03", hoje)).toEqual({ atrasada: true, quando: "há 10 dias" });
    // Data que não é data não vira "hoje" nem "atrasada": é ausência de medida.
    expect(proximaAcao("sem data", hoje)).toBeNull();
  });
});

const vazio: FontesDoHistorico = {
  fases: [],
  tentativas: [],
  reunioes: [],
  envios: [],
  notas: [],
  contratoAssinadoEm: null,
  implantacaoPagaEm: null,
  conferidoEm: null,
  conferidoPor: null,
};
const agora = new Date("2026-10-13T15:00:00Z");

describe("a linha do tempo", () => {
  it("junta as sete origens e ordena do mais recente para o mais antigo", () => {
    const eventos = linhaDoTempo(
      {
        fases: [
          {
            stage: "CONTACT",
            enteredAt: "2026-09-20T10:00:00Z",
            leftAt: null,
            isInitial: false,
          },
        ],
        tentativas: [
          {
            id: "t1",
            channel: "CALL",
            outcome: "NO_ANSWER",
            note: "caixa postal",
            attemptedAt: "2026-09-21T10:00:00Z",
            authorName: "Ana",
          },
        ],
        reunioes: [
          {
            id: "r1",
            title: "Apresentação",
            mode: "ONLINE",
            location: "meet.example/abc",
            startsAt: "2026-09-25T13:00:00Z",
            status: "DONE",
            statusNote: null,
          },
        ],
        envios: [
          {
            id: "e1",
            channel: "WHATSAPP",
            items: ["PROPOSAL", "CONTRACT"],
            note: null,
            sentAt: "2026-09-26T09:00:00Z",
            authorName: "Ana",
          },
        ],
        notas: [
          {
            id: "n1",
            kind: "CALL",
            note: "Pediu para ligar na sexta",
            createdAt: "2026-09-22T10:00:00Z",
            authorName: "Ana",
          },
        ],
        contratoAssinadoEm: "2026-09-28T10:00:00Z",
        implantacaoPagaEm: "2026-09-29T10:00:00Z",
        conferidoEm: "2026-09-30T10:00:00Z",
        conferidoPor: "Bruno",
      },
      agora
    );
    expect(eventos.map((e) => e.tipo)).toEqual([
      "conferencia",
      "selo",
      "selo",
      "envio",
      "reuniao",
      "nota",
      "tentativa",
      "fase",
    ]);
    const datas = eventos.map((e) => e.quando);
    expect([...datas].sort().reverse()).toEqual(datas);

    expect(eventos[3].titulo).toBe("Enviado por WhatsApp: Proposta comercial, Contrato");
    expect(eventos[4].titulo).toBe("Reunião online — Realizada");
    expect(eventos[4].detalhe).toBe("Apresentação · meet.example/abc");
    expect(eventos[5].titulo).toBe("Ligação");
    expect(eventos[6].titulo).toBe("Ligação — Não atendeu");
    expect(eventos[0].autor).toBe("Bruno");
  });

  it("a entrada INICIAL não inventa data de entrada: diz que o registro começa ali", () => {
    const [e] = linhaDoTempo(
      {
        ...vazio,
        fases: [
          {
            stage: "CAPTURE",
            enteredAt: "2026-09-14T22:00:00Z",
            leftAt: null,
            isInitial: true,
          },
        ],
      },
      agora
    );
    expect(e.titulo).toBe("Já estava em Captação quando o registro começou");
    expect(e.titulo).not.toContain("Entrou");
  });

  it("MUDANÇA DE FASE APARECE UMA VEZ, e o autor vai para a fase CERTA", () => {
    // O caso visto no treino: funil andado depressa. A anotação "Movido para
    // Contato" nasce a 30s da entrada em Captação e a 1s da entrada em
    // Contato. Casando só pela hora, o autor grudava em Captação.
    const eventos = linhaDoTempo(
      {
        ...vazio,
        fases: [
          {
            stage: "CAPTURE",
            enteredAt: "2026-09-14T19:29:30Z",
            leftAt: "2026-09-14T19:30:00Z",
            isInitial: false,
          },
          {
            stage: "CONTACT",
            enteredAt: "2026-09-14T19:30:00Z",
            leftAt: null,
            isInitial: false,
          },
        ],
        notas: [
          {
            id: "n1",
            kind: "STAGE_CHANGE",
            note: "Movido para Contato",
            createdAt: "2026-09-14T19:30:01Z",
            authorName: "Ana",
          },
        ],
      },
      agora
    );
    // Duas linhas, não três: a anotação se fundiu à linha do relógio.
    expect(eventos).toHaveLength(2);
    expect(eventos.filter((e) => e.tipo === "nota")).toHaveLength(0);
    const contato = eventos.find((e) => e.titulo === "Entrou em Contato");
    const captacao = eventos.find((e) => e.titulo === "Entrou em Captação");
    expect(contato?.autor).toBe("Ana");
    expect(captacao?.autor).toBeNull();
  });

  it("a perda leva o MOTIVO para a linha da fase", () => {
    const [e] = linhaDoTempo(
      {
        ...vazio,
        fases: [
          {
            stage: "CLOSED_LOST",
            enteredAt: "2026-10-13T14:00:00Z",
            leftAt: null,
            isInitial: false,
          },
        ],
        notas: [
          {
            id: "n1",
            kind: "STAGE_CHANGE",
            note: "Movido para Fechamento (perda) — motivo: Fechou com outro convênio",
            createdAt: "2026-10-13T14:00:02Z",
            authorName: "Ana",
          },
        ],
      },
      agora
    );
    expect(e.titulo).toBe("Entrou em Fechamento (perda)");
    expect(e.detalhe).toContain("Motivo: Fechou com outro convênio");
    expect(e.autor).toBe("Ana");
  });

  it("'Fechado (ganho) — empresa criada…' NÃO é fundida: ela diz o que foi copiado", () => {
    const aviso =
      "Fechado (ganho) — empresa criada, mas NÃO foi possível copiar: as faixas de preço. Confira no cadastro.";
    const eventos = linhaDoTempo(
      {
        ...vazio,
        fases: [
          {
            stage: "CLOSED_WON",
            enteredAt: "2026-10-01T14:00:00Z",
            leftAt: null,
            isInitial: false,
          },
        ],
        notas: [
          {
            id: "n1",
            kind: "STAGE_CHANGE",
            note: aviso,
            createdAt: "2026-10-01T14:00:01Z",
            authorName: "Ana",
          },
        ],
      },
      agora
    );
    expect(eventos).toHaveLength(2);
    const nota = eventos.find((e) => e.tipo === "nota");
    expect(nota?.titulo).toBe("Mudança de fase");
    expect(nota?.detalhe).toBe(aviso);
  });

  it("anotação de mudança SEM linha de relógio (antes de 14/09) aparece sozinha", () => {
    const eventos = linhaDoTempo(
      {
        ...vazio,
        notas: [
          {
            id: "n1",
            kind: "STAGE_CHANGE",
            note: "Movido para Contato",
            createdAt: "2026-08-01T10:00:00Z",
            authorName: "Ana",
          },
        ],
      },
      agora
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0].detalhe).toBe("Movido para Contato");
  });

  it("uma anotação se funde a UMA fase só, mesmo com duas passagens pela mesma fase", () => {
    const eventos = linhaDoTempo(
      {
        ...vazio,
        fases: [
          {
            stage: "CONTACT",
            enteredAt: "2026-09-14T19:30:00Z",
            leftAt: "2026-09-14T19:30:40Z",
            isInitial: false,
          },
          {
            stage: "CONTACT",
            enteredAt: "2026-09-14T19:31:00Z",
            leftAt: null,
            isInitial: false,
          },
        ],
        notas: [
          {
            id: "n1",
            kind: "STAGE_CHANGE",
            note: "Movido para Contato",
            createdAt: "2026-09-14T19:31:01Z",
            authorName: "Ana",
          },
        ],
      },
      agora
    );
    const comAutor = eventos.filter((e) => e.autor === "Ana");
    expect(comAutor).toHaveLength(1);
    // …e é a passagem mais próxima da anotação, não a primeira da lista.
    expect(comAutor[0].quando).toBe("2026-09-14T19:31:00Z");
  });

  it("sem nada registrado, devolve lista vazia — e a aba diz 'sem registros'", () => {
    expect(linhaDoTempo(vazio, agora)).toEqual([]);
    expect(situacaoDoHistorico(0).resumo).toBe("sem registros");
    expect(situacaoDoHistorico(1).resumo).toBe("1 registro");
    expect(situacaoDoHistorico(8).resumo).toBe("8 registros");
  });
});

describe("a próxima reunião", () => {
  it("só conta reunião FUTURA e ainda de pé; devolve a mais próxima", () => {
    const r = (startsAt: string, status: "SCHEDULED" | "CONFIRMED" | "DONE" | "CANCELLED") => ({
      startsAt,
      status,
    });
    expect(proximaReuniao([], agora)).toBeNull();
    // Passada, cancelada e realizada não contam.
    expect(
      proximaReuniao(
        [
          r("2026-10-10T13:00:00Z", "SCHEDULED"),
          r("2026-10-20T13:00:00Z", "CANCELLED"),
          r("2026-10-21T13:00:00Z", "DONE"),
        ],
        agora
      )
    ).toBeNull();
    expect(
      proximaReuniao(
        [r("2026-10-25T13:00:00Z", "SCHEDULED"), r("2026-10-18T13:00:00Z", "CONFIRMED")],
        agora
      )
    ).toBe("2026-10-18T13:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS — leem o código da tela. Cada uma foi provada quebrando o código de
// propósito (régua nova só vale depois de reprovar uma vez).
// ---------------------------------------------------------------------------

const FICHA = join(process.cwd(), "src/app/(app)/empresarial/funil/[leadId]");
const ler = (arquivo: string) => {
  const texto = readFileSync(join(FICHA, arquivo), "utf8");
  // Régua que não acha o que medir tem de gritar, nunca responder "tudo certo".
  if (texto.length < 200) throw new Error(`${arquivo}: arquivo vazio ou curto demais`);
  return texto.replace(/\r\n/g, "\n");
};
/** O corpo de uma função, do nome dela até o começo da próxima. */
const trecho = (texto: string, de: string, ate: string) => {
  const i = texto.indexOf(de);
  const f = texto.indexOf(ate, i + de.length);
  if (i < 0 || f < 0) throw new Error(`não achei o trecho entre "${de}" e "${ate}"`);
  return texto.slice(i, f);
};

describe("réguas da ficha da empresa", () => {
  it("A ABA FECHAMENTO NUNCA ABRE EM BRANCO: toda fase devolve alguma coisa", () => {
    const corpo = trecho(
      ler("fechamento-e-implantacao.tsx"),
      "export function FechamentoEImplantacao(",
      "function Conferencia("
    );
    // O defeito do relato: `if (!noFechamento) return null;`.
    expect(corpo).not.toMatch(/return\s+null/);
    expect(corpo).toContain("<FechamentoEmAberto");
    expect(corpo).toContain("<NegocioPerdido");
    // Ganho sem cadastro: o botão que resolve está na própria aba.
    expect(corpo).toContain("<CriarEmpresaDoLead");
  });

  it("as abas inativas ficam ESCONDIDAS, não desmontadas (não perde o que foi digitado)", () => {
    const abas = ler("abas-da-ficha.tsx");
    expect(abas).toContain("hidden={ativa !== aba.id}");
    // Renderização condicional do painel desmontaria os formulários.
    expect(abas).not.toMatch(/ativa === aba\.id\s*&&/);
    expect(abas).not.toMatch(/ativa === aba\.id\s*\?\s*aba\.painel/);
  });

  it("a ficha REUSA as peças do cartão do funil, em vez de ter cópias", () => {
    const historico = ler("historico-da-empresa.tsx");
    const resumo = ler("resumo-da-empresa.tsx");
    expect(historico).toMatch(/import \{[^}]*ReunioesDoLead[^}]*\} from "\.\.\/lead-board"/);
    expect(historico).toMatch(/import \{[^}]*TentativasDeContato[^}]*\} from "\.\.\/lead-board"/);
    expect(resumo).toMatch(/import \{[^}]*LeadFields[^}]*\} from "\.\.\/lead-board"/);
    // Chamar a action direto seria escrever o formulário de novo.
    for (const texto of [historico, resumo]) {
      expect(texto).not.toContain("registerContactAttempt");
      expect(texto).not.toContain("scheduleMeeting");
    }
  });

  it("a regra de ouro tem UMA régua: a aba Fechamento lê a mesma da aba Envio", () => {
    const aberto = ler("fechamento-em-aberto.tsx");
    expect(aberto).toMatch(/import \{ faltaParaFechar \} from "@\/lib\/empresarial\/envio"/);
    expect(aberto).toContain("faltaParaFechar({");
  });

  it("os passos da implantação vêm da régua do progresso, não do número de linhas gravadas", () => {
    const pagina = ler("page.tsx");
    // Contar linhas dava "0 de 0", e zero de zero parecia implantação concluída.
    expect(pagina).not.toMatch(/passosTotal:\s*passos\.length/);
    expect(pagina.match(/passosTotal:\s*progresso\.total/g)?.length).toBe(2);
    expect(pagina.match(/passosFeitos:\s*progresso\.concluidos/g)?.length).toBe(2);
  });

  it("o próximo passo conta os campos da proposta IGUAL ao selo da aba", () => {
    const pagina = ler("page.tsx");
    const chamada = trecho(pagina, "const proximo = proximoPasso({", "});");
    expect(chamada).toContain("faltaParaProposta(dadosDaProposta)");
    expect(chamada).toContain("faltaParaContrato(dadosDaProposta)");
  });

  it("leitura do histórico que falha é AVISADA — não vira 'sem registros'", () => {
    const pagina = ler("page.tsx");
    expect(pagina).toContain("naoLidoDoHistorico.length > 0");
    for (const erro of ["erroNotas", "erroFases", "erroTentativas", "erroReunioes"]) {
      expect(pagina.split(erro).length - 1, erro).toBeGreaterThanOrEqual(3);
    }
  });
});
