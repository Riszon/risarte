import { describe, expect, it } from "vitest";
import {
  conversaoDoFunil,
  paradasAlemDoLimite,
  porCanal,
  porConsultor,
  temCaminhoMedivel,
  tempoMedioPorFase,
  type LeadDoPainel,
} from "@/lib/empresarial/painel-funil";
import {
  CAPTURE_CHANNEL_LABELS,
  type CaptureChannel,
  type LeadStage,
} from "@/lib/empresarial/constants";
import type { StagePeriod } from "@/lib/empresarial/funnel";

const AGORA = new Date("2026-09-30T12:00:00.000Z");
const UM_DIA = 24 * 60 * 60 * 1000;

function dia(n: number): string {
  return new Date(Date.UTC(2026, 8, n, 12, 0, 0)).toISOString();
}

function p(
  stage: LeadStage,
  de: number,
  ate: number | null = null,
  isInitial = false
): StagePeriod {
  return {
    stage,
    enteredAt: dia(de),
    leftAt: ate == null ? null : dia(ate),
    isInitial,
  };
}

function lead(
  id: string,
  stage: LeadStage,
  history: StagePeriod[],
  extra: Partial<LeadDoPainel> = {}
): LeadDoPainel {
  return {
    id,
    companyName: `Empresa ${id}`,
    stage,
    consultantId: null,
    consultantName: null,
    captureChannel: null,
    estimatedValueCents: null,
    history,
    ...extra,
  };
}

describe("caminho medível", () => {
  it("lead com histórico completo é medível", () => {
    expect(temCaminhoMedivel(lead("a", "CONTACT", [p("CAPTURE", 1, 3), p("CONTACT", 3)]))).toBe(true);
  });

  it("lead do backfill NÃO é medível — o passado dele não existe", () => {
    expect(temCaminhoMedivel(lead("b", "CONTACT", [p("CONTACT", 1, null, true)]))).toBe(false);
  });

  it("lead sem histórico nenhum não é medível", () => {
    expect(temCaminhoMedivel(lead("c", "CONTACT", []))).toBe(false);
  });
});

describe("conversão fase a fase", () => {
  const leads = [
    // 3 passaram por Captação; 2 chegaram a Contato; 1 chegou a Apresentado.
    lead("1", "CONTACT", [p("CAPTURE", 1, 3), p("CONTACT", 3)]),
    lead("2", "PRESENTED", [
      p("CAPTURE", 1, 2),
      p("CONTACT", 2, 4),
      p("MEETING_SCHEDULED", 4, 6),
      p("PRESENTED", 6),
    ]),
    lead("3", "CAPTURE", [p("CAPTURE", 5)]),
  ];

  it("conta quem JÁ PASSOU pela fase, não quem está nela", () => {
    const c = conversaoDoFunil(leads);
    expect(c.degraus[0].alcancaram).toBe(3); // Captação
    expect(c.degraus[1].alcancaram).toBe(2); // Contato
    expect(c.degraus[3].alcancaram).toBe(1); // Apresentado
  });

  it("a conversão é sobre a fase anterior", () => {
    const c = conversaoDoFunil(leads);
    expect(c.degraus[0].conversao).toBeNull(); // a primeira não tem base
    expect(c.degraus[1].conversao).toBe(67); // 2 de 3
    expect(c.degraus[2].conversao).toBe(50); // 1 de 2
  });

  it("FASE SEM NINGUÉM ANTES devolve NULO, não 0%", () => {
    // "0%" seria uma afirmação sobre uma etapa que ninguém percorreu.
    const c = conversaoDoFunil([lead("x", "CAPTURE", [p("CAPTURE", 1)])]);
    expect(c.degraus[1].conversao).toBe(0); // ninguém dos 1 passou: isso é 0 real
    expect(c.degraus[2].conversao).toBeNull(); // base zero: sem resposta
  });

  it("os leads do backfill FICAM DE FORA, e a conta diz quantos", () => {
    // Contá-los como "não passaram" faria a conversão parecer pior do que é.
    const c = conversaoDoFunil([
      ...leads,
      lead("velho", "FOLLOW_UP", [p("FOLLOW_UP", 1, null, true)]),
    ]);
    expect(c.medidas).toBe(3);
    expect(c.foraDaMedicao).toBe(1);
    expect(c.degraus[0].alcancaram).toBe(3);
  });

  it("ganho e perda caem no mesmo degrau de Fechamento", () => {
    const c = conversaoDoFunil([
      lead("g", "CLOSED_WON", [p("FOLLOW_UP", 1, 2), p("CLOSED_WON", 2)]),
      lead("pd", "CLOSED_LOST", [p("FOLLOW_UP", 1, 2), p("CLOSED_LOST", 2)]),
    ]);
    expect(c.degraus[6].titulo).toBe("Fechamento");
    expect(c.degraus[6].alcancaram).toBe(2);
  });
});

describe("tempo médio por fase", () => {
  it("promedia só as passagens que TERMINARAM", () => {
    // A passagem aberta ainda está crescendo: incluí-la faria a fase parecer
    // mais rápida justamente quando há empresa empacada nela.
    const leads = [
      lead("1", "CONTACT", [p("CAPTURE", 1, 3), p("CONTACT", 3)]), // 2 dias
      lead("2", "CONTACT", [p("CAPTURE", 1, 5), p("CONTACT", 5)]), // 4 dias
    ];
    const t = tempoMedioPorFase(leads).find((x) => x.stage === "CAPTURE")!;
    expect(t.mediaDias).toBe(3);
    expect(t.passagensCompletas).toBe(2);
    expect(t.emAberto).toBe(0);
  });

  it("conta separadamente as passagens ainda abertas", () => {
    const t = tempoMedioPorFase([
      lead("1", "CONTACT", [p("CONTACT", 3)]),
      lead("2", "CONTACT", [p("CONTACT", 5)]),
    ]).find((x) => x.stage === "CONTACT")!;
    expect(t.mediaDias).toBeNull();
    expect(t.emAberto).toBe(2);
  });

  it("SEM passagem completa a média é NULA, não zero", () => {
    const t = tempoMedioPorFase([]).find((x) => x.stage === "FOLLOW_UP")!;
    expect(t.mediaDias).toBeNull();
    expect(t.passagensCompletas).toBe(0);
  });

  it("soma as duas passagens quando o lead volta para a mesma fase", () => {
    const t = tempoMedioPorFase([
      lead("1", "PRESENTED", [
        p("CONTACT", 1, 3), // 2 dias
        p("FOLLOW_UP", 3, 4),
        p("CONTACT", 4, 10), // 6 dias
        p("PRESENTED", 10),
      ]),
    ]).find((x) => x.stage === "CONTACT")!;
    expect(t.passagensCompletas).toBe(2);
    expect(t.mediaDias).toBe(4);
  });
});

describe("quem está parado", () => {
  const limites = new Map([
    ["PROPOSAL_SENT", 5],
    ["CONTACT", 7],
  ]);

  it("lista quem passou do limite da fase", () => {
    const paradas = paradasAlemDoLimite(
      [lead("1", "PROPOSAL_SENT", [p("PROPOSAL_SENT", 10)])],
      limites,
      AGORA
    );
    expect(paradas).toHaveLength(1);
    expect(paradas[0].dias).toBe(20);
    expect(paradas[0].limite).toBe(5);
  });

  it("quem está dentro do limite não entra", () => {
    expect(
      paradasAlemDoLimite(
        [lead("1", "CONTACT", [p("CONTACT", 28)])],
        limites,
        AGORA
      )
    ).toEqual([]);
  });

  it("FASE SEM LIMITE CADASTRADO não vira alerta", () => {
    // É ausência de configuração, não empresa saudável. Inventar um limite
    // faria a tela cobrar por uma régua que ninguém definiu.
    expect(
      paradasAlemDoLimite(
        [lead("1", "FOLLOW_UP", [p("FOLLOW_UP", 1)])],
        limites,
        AGORA
      )
    ).toEqual([]);
  });

  it("marca quando o tempo só vale desde que o relógio ligou", () => {
    const paradas = paradasAlemDoLimite(
      [lead("1", "PROPOSAL_SENT", [p("PROPOSAL_SENT", 10, null, true)])],
      limites,
      AGORA
    );
    expect(paradas[0].parcial).toBe(true);
  });

  it("pior primeiro", () => {
    const paradas = paradasAlemDoLimite(
      [
        lead("novo", "PROPOSAL_SENT", [p("PROPOSAL_SENT", 20)]),
        lead("velho", "PROPOSAL_SENT", [p("PROPOSAL_SENT", 2)]),
      ],
      limites,
      AGORA
    );
    expect(paradas.map((x) => x.lead.id)).toEqual(["velho", "novo"]);
  });

  it("lead sem fase aberta não entra", () => {
    expect(
      paradasAlemDoLimite(
        [lead("1", "CLOSED_WON", [p("PROPOSAL_SENT", 1, 2)])],
        limites,
        AGORA
      )
    ).toEqual([]);
  });
});

describe("por consultor", () => {
  const leads = [
    lead("1", "FOLLOW_UP", [], {
      consultantId: "u1",
      consultantName: "Ana",
      estimatedValueCents: 100_000,
    }),
    lead("2", "CLOSED_WON", [], { consultantId: "u1", consultantName: "Ana" }),
    lead("3", "CLOSED_LOST", [], { consultantId: "u1", consultantName: "Ana" }),
    lead("4", "CAPTURE", [], { estimatedValueCents: 50_000 }),
  ];

  it("separa aberto, ganho e perdido", () => {
    const [ana] = porConsultor(leads);
    expect(ana.rotulo).toBe("Ana");
    expect(ana.emAberto).toBe(1);
    expect(ana.ganhos).toBe(1);
    expect(ana.perdas).toBe(1);
    expect(ana.taxaDeGanho).toBe(50);
  });

  it("implantação conta como ganho — o negócio foi fechado", () => {
    const [r] = porConsultor([
      lead("x", "IMPLEMENTATION", [], { consultantId: "u9", consultantName: "Bia" }),
    ]);
    expect(r.ganhos).toBe(1);
  });

  it("SEM NENHUM FECHAMENTO a taxa é NULA, não 0%", () => {
    // "0%" diria que o consultor perdeu tudo, quando ele ainda não fechou nada.
    const [r] = porConsultor([
      lead("x", "CONTACT", [], { consultantId: "u9", consultantName: "Bia" }),
    ]);
    expect(r.taxaDeGanho).toBeNull();
  });

  it('"Sem consultor" é um recorte de verdade — é a fila que ninguém assumiu', () => {
    const semDono = porConsultor(leads).find((r) => r.chave === "SEM_CONSULTOR");
    expect(semDono?.rotulo).toBe("Sem consultor");
    expect(semDono?.emAberto).toBe(1);
  });

  it("só o que está em aberto soma valor — ganho e perda não são pipeline", () => {
    const [ana] = porConsultor(leads);
    expect(ana.valorEmAbertoCents).toBe(100_000);
  });
});

describe("por canal de captação", () => {
  it("agrupa pelo canal e usa o rótulo em português", () => {
    const r = porCanal(
      [
        lead("1", "CONTACT", [], { captureChannel: "INDICACAO" as CaptureChannel }),
        lead("2", "CLOSED_WON", [], { captureChannel: "INDICACAO" as CaptureChannel }),
        lead("3", "CONTACT", []),
      ],
      CAPTURE_CHANNEL_LABELS
    );
    const indicacao = r.find((x) => x.chave === "INDICACAO");
    expect(indicacao?.rotulo).toBe("Indicação");
    expect(indicacao?.ganhos).toBe(1);
    expect(indicacao?.emAberto).toBe(1);
    expect(r.find((x) => x.chave === "NAO_INFORMADO")?.rotulo).toBe("Não informado");
  });
});

describe("tudo vazio não vira número inventado", () => {
  it("sem lead nenhum, nada afirma coisa alguma", () => {
    const c = conversaoDoFunil([]);
    expect(c.medidas).toBe(0);
    expect(c.foraDaMedicao).toBe(0);
    expect(c.degraus.every((d) => d.alcancaram === 0)).toBe(true);
    // Todos os degraus a partir do segundo: base zero → nulo, nunca 0%.
    expect(c.degraus.slice(1).every((d) => d.conversao === null)).toBe(true);
    expect(porConsultor([])).toEqual([]);
    expect(paradasAlemDoLimite([], new Map(), AGORA)).toEqual([]);
  });
});

describe("dias são contados em dias inteiros", () => {
  it("uma passagem de 36 horas conta como 1 dia", () => {
    const t = tempoMedioPorFase([
      lead("1", "CONTACT", [
        {
          stage: "CAPTURE",
          enteredAt: new Date(Date.UTC(2026, 8, 1, 0, 0)).toISOString(),
          leftAt: new Date(
            Date.UTC(2026, 8, 1, 0, 0) + 1.5 * UM_DIA
          ).toISOString(),
          isInitial: false,
        },
      ]),
    ]).find((x) => x.stage === "CAPTURE")!;
    expect(t.mediaDias).toBe(2); // 1,5 arredonda para 2
  });
});
