import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cruzar,
  desfechoDe,
  formatarHoras,
  formatarOcupacao,
  horasDoDia,
  horasDosAtendimentos,
  horasPossiveis,
  lerPeriodo,
  MAXIMO_DE_DIAS,
  medir,
  minutosMarcados,
  montarQuadro,
  ocupacao,
  porMes,
  resumir,
  tirar,
  unir,
  type AtendimentoDaAgenda,
  type EntradaDasHoras,
  type FechamentoDeAgenda,
  type PeriodoPlanejado,
} from "@/lib/horas-da-agenda";

// Relato OC-00071: liberar horário avulso não aumentava a estimativa de horas
// do Planejamento Anual, e fechar a agenda não reduzia. Estas réguas prendem a
// conta nova — e cada uma foi provada quebrando o código de propósito.

// 14/09/2026 é segunda-feira; 13/09/2026 é domingo.
const SEGUNDA = "2026-09-14";
const TERCA = "2026-09-15";
const DOMINGO = "2026-09-13";

type Base = Omit<EntradaDasHoras, "de" | "ate">;

function base(mudancas: Partial<Base> = {}): Base {
  return {
    jornada: {
      openTime: "08:00",
      closeTime: "18:00",
      weekdays: [1, 2, 3, 4, 5, 6],
      lunchEnabled: false,
      lunchStart: "12:00",
      lunchEnd: "13:00",
    },
    feriados: new Map(),
    planejados: [],
    avulsos: [],
    fechamentos: [],
    cadeiras: ["sala-1", "sala-2"],
    ...mudancas,
  };
}

const comAlmoco = (b: Base): Base => ({ ...b, jornada: { ...b.jornada, lunchEnabled: true } });

/** Um instante a partir da hora de parede BRASILEIRA (UTC−3, sem horário de verão). */
function br(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00-03:00`;
}

function fechamento(
  de: string,
  ate: string,
  mudancas: Partial<FechamentoDeAgenda> = {}
): FechamentoDeAgenda {
  return { startsAt: de, endsAt: ate, scope: "unit", roomIds: [], providerIds: [], ...mudancas };
}

function periodo(mudancas: Partial<PeriodoPlanejado> = {}): PeriodoPlanejado {
  return {
    type: "recess",
    startsDate: SEGUNDA,
    endsDate: SEGUNDA,
    isNetwork: false,
    locked: false,
    ...mudancas,
  };
}

describe("intervalos", () => {
  it("unir junta o que se sobrepõe e o que se toca", () => {
    expect(unir([[600, 720], [480, 600], [700, 800], [900, 960]])).toEqual([[480, 800], [900, 960]]);
    expect(unir([[10, 10], [20, 5]])).toEqual([]);
  });
  it("cruzar, tirar e medir", () => {
    expect(cruzar([[480, 1080]], [[720, 780], [1000, 1200]])).toEqual([[720, 780], [1000, 1080]]);
    expect(tirar([[480, 1080]], [[720, 780]])).toEqual([[480, 720], [780, 1080]]);
    expect(tirar([[480, 1080]], [[0, 1440]])).toEqual([]);
    expect(medir([[480, 720], [600, 780]])).toBe(300);
  });
});

describe("o dia pela semana configurada", () => {
  it("dia normal vale a jornada inteira, nas duas contas", () => {
    const d = horasDoDia(SEGUNDA, base());
    expect(d.situacao).toBe("normal");
    expect(d.funcionamento).toBe(600);
    expect(d.cadeira).toBe(1200); // 10h × 2 cadeiras
  });
  it("o almoço sai da conta", () => {
    expect(horasDoDia(SEGUNDA, comAlmoco(base())).funcionamento).toBe(540);
  });
  it("dia fora da semana não abre", () => {
    const d = horasDoDia(DOMINGO, base());
    expect(d.situacao).toBe("fora_da_semana");
    expect(d.funcionamento).toBe(0);
    expect(d.cadeira).toBe(0);
  });
  it("sem cadeira ativa não há hora de cadeira, mas a unidade funciona", () => {
    const d = horasDoDia(SEGUNDA, base({ cadeiras: [] }));
    expect(d.funcionamento).toBe(600);
    expect(d.cadeira).toBe(0);
  });
});

describe("OC-00071 — horário avulso AUMENTA as horas possíveis", () => {
  it("num dia fechado, vale a janela do avulso", () => {
    const d = horasDoDia(DOMINGO, base({ avulsos: [{ date: DOMINGO, start: "08:00", end: "12:00" }] }));
    expect(d.situacao).toBe("avulso");
    expect(d.temAvulso).toBe(true);
    expect(d.ganhoAvulso).toBe(240);
    expect(d.funcionamento).toBe(240);
    expect(d.cadeira).toBe(480);
  });
  it("num dia normal, ESTENDE o horário: conta só o que passou da jornada", () => {
    const depois = horasDoDia(SEGUNDA, base({ avulsos: [{ date: SEGUNDA, start: "18:00", end: "20:00" }] }));
    expect(depois.funcionamento).toBe(720);
    expect(depois.ganhoAvulso).toBe(120);
    const antes = horasDoDia(SEGUNDA, base({ avulsos: [{ date: SEGUNDA, start: "07:00", end: "09:00" }] }));
    expect(antes.funcionamento).toBe(660);
    expect(antes.ganhoAvulso).toBe(60);
  });
  it("avulso dentro da jornada não acrescenta nada", () => {
    const d = horasDoDia(SEGUNDA, base({ avulsos: [{ date: SEGUNDA, start: "09:00", end: "11:00" }] }));
    expect(d.funcionamento).toBe(600);
    expect(d.ganhoAvulso).toBe(0);
    expect(d.temAvulso).toBe(false);
  });
  it("o almoço vale também na janela do avulso", () => {
    const d = horasDoDia(
      DOMINGO,
      comAlmoco(base({ avulsos: [{ date: DOMINGO, start: "10:00", end: "14:00" }] }))
    );
    expect(d.funcionamento).toBe(180);
  });
  it("avulso de outro dia não mexe neste", () => {
    const d = horasDoDia(DOMINGO, base({ avulsos: [{ date: "2026-09-20", start: "08:00", end: "12:00" }] }));
    expect(d.funcionamento).toBe(0);
  });
});

describe("feriado", () => {
  it("feriado fechado tira o dia — nem o avulso abre", () => {
    const d = horasDoDia(
      SEGUNDA,
      base({
        feriados: new Map([[SEGUNDA, false]]),
        avulsos: [{ date: SEGUNDA, start: "08:00", end: "12:00" }],
      })
    );
    expect(d.situacao).toBe("feriado_fechado");
    expect(d.perdidoFeriado).toBe(600);
    expect(d.funcionamento).toBe(0);
  });
  it("feriado em que a unidade atende abre até fora da semana", () => {
    const d = horasDoDia(DOMINGO, base({ feriados: new Map([[DOMINGO, true]]) }));
    expect(d.situacao).toBe("normal");
    expect(d.funcionamento).toBe(600);
  });
  it("feriado fechado num dia que já não abria não é perda", () => {
    const d = horasDoDia(DOMINGO, base({ feriados: new Map([[DOMINGO, false]]) }));
    expect(d.perdidoFeriado).toBe(0);
    expect(d.situacao).toBe("fora_da_semana");
  });
});

describe("períodos planejados", () => {
  it("o da unidade fecha o dia", () => {
    const d = horasDoDia(SEGUNDA, base({ planejados: [periodo()] }));
    expect(d.situacao).toBe("periodo_da_unidade");
    expect(d.perdidoUnidade).toBe(600);
    expect(d.funcionamento).toBe(0);
  });
  it("o da REDE também fecha (antes a estimativa não via)", () => {
    const d = horasDoDia(SEGUNDA, base({ planejados: [periodo({ isNetwork: true })] }));
    expect(d.situacao).toBe("periodo_da_rede");
    expect(d.perdidoRede).toBe(600);
    expect(d.perdidoUnidade).toBe(0);
    expect(d.funcionamento).toBe(0);
  });
  it("com horário avulso por cima, vale SÓ a janela do avulso (o dia era fechado)", () => {
    const d = horasDoDia(
      SEGUNDA,
      base({
        planejados: [periodo()],
        avulsos: [{ date: SEGUNDA, start: "08:00", end: "12:00" }],
      })
    );
    expect(d.situacao).toBe("avulso");
    expect(d.perdidoUnidade).toBe(600);
    expect(d.ganhoAvulso).toBe(240);
    expect(d.funcionamento).toBe(240);
  });
  it("item da rede TRAVADO não abre nem com avulso", () => {
    const d = horasDoDia(
      SEGUNDA,
      base({
        planejados: [periodo({ isNetwork: true, locked: true })],
        avulsos: [{ date: SEGUNDA, start: "08:00", end: "12:00" }],
      })
    );
    expect(d.funcionamento).toBe(0);
    expect(d.perdidoRede).toBe(600);
  });
  it("campanha e férias individuais não fecham a unidade", () => {
    for (const type of ["campaign", "individual_vacation"] as const) {
      expect(horasDoDia(SEGUNDA, base({ planejados: [periodo({ type })] })).funcionamento).toBe(600);
    }
  });
  it("fora das datas do período, nada muda", () => {
    expect(horasDoDia(TERCA, base({ planejados: [periodo()] })).funcionamento).toBe(600);
  });
});

describe("OC-00071 — fechar a agenda REDUZ as horas possíveis", () => {
  it("fechamento da unidade toda tira das duas contas", () => {
    const d = horasDoDia(SEGUNDA, base({ fechamentos: [fechamento(br(SEGUNDA, "14:00"), br(SEGUNDA, "16:00"))] }));
    expect(d.fechadoUnidade).toBe(120);
    expect(d.funcionamento).toBe(480);
    expect(d.cadeira).toBe(960);
  });
  it("dois fechamentos por cima do mesmo horário não descontam duas vezes", () => {
    const d = horasDoDia(
      SEGUNDA,
      base({
        fechamentos: [
          fechamento(br(SEGUNDA, "14:00"), br(SEGUNDA, "16:00")),
          fechamento(br(SEGUNDA, "15:00"), br(SEGUNDA, "17:00")),
        ],
      })
    );
    expect(d.fechadoUnidade).toBe(180);
    expect(d.funcionamento).toBe(420);
  });
  it("fechamento que atravessa a noite desconta de cada dia só o seu pedaço", () => {
    const f = [fechamento(br(SEGUNDA, "16:00"), br(TERCA, "10:00"))];
    expect(horasDoDia(SEGUNDA, base({ fechamentos: f })).funcionamento).toBe(480);
    expect(horasDoDia(TERCA, base({ fechamentos: f })).funcionamento).toBe(480);
  });
  it("fora do horário de atendimento (ou no almoço) não há o que tirar", () => {
    const noite = horasDoDia(SEGUNDA, base({ fechamentos: [fechamento(br(SEGUNDA, "20:00"), br(SEGUNDA, "22:00"))] }));
    expect(noite.funcionamento).toBe(600);
    const almoco = horasDoDia(
      SEGUNDA,
      comAlmoco(base({ fechamentos: [fechamento(br(SEGUNDA, "12:00"), br(SEGUNDA, "13:00"))] }))
    );
    expect(almoco.fechadoUnidade).toBe(0);
    expect(almoco.funcionamento).toBe(540);
  });
  it("o dia é o BRASILEIRO: 02h em UTC ainda é a noite anterior aqui", () => {
    // 2026-09-15T02:00Z = 23:00 de segunda no Brasil — fora do horário, e não é terça.
    const f = [fechamento("2026-09-15T02:00:00.000Z", "2026-09-15T02:30:00.000Z")];
    expect(horasDoDia(SEGUNDA, base({ fechamentos: f })).funcionamento).toBe(600);
    expect(horasDoDia(TERCA, base({ fechamentos: f })).funcionamento).toBe(600);
    // 09:00Z–10:30Z = 06:00–07:30 no Brasil: FORA do horário. Lido em UTC, cairia dentro.
    const cedo = [fechamento("2026-09-14T09:00:00.000Z", "2026-09-14T10:30:00.000Z")];
    expect(horasDoDia(SEGUNDA, base({ fechamentos: cedo })).funcionamento).toBe(600);
    // 20:00Z–21:00Z = 17:00–18:00 no Brasil: DENTRO do horário. Lido em UTC, cairia fora.
    const tarde = [fechamento("2026-09-14T20:00:00.000Z", "2026-09-14T21:00:00.000Z")];
    expect(horasDoDia(SEGUNDA, base({ fechamentos: tarde })).funcionamento).toBe(540);
  });
  it("fechamento de SALA tira só as horas daquela cadeira", () => {
    const d = horasDoDia(
      SEGUNDA,
      base({
        fechamentos: [fechamento(br(SEGUNDA, "08:00"), br(SEGUNDA, "12:00"), { scope: "rooms", roomIds: ["sala-1"] })],
      })
    );
    expect(d.funcionamento).toBe(600); // a unidade continua aberta
    expect(d.fechadoSala).toBe(240);
    expect(d.cadeira).toBe(960); // 1200 − 240
  });
  it("sala que não está entre as cadeiras ativas não desconta", () => {
    const d = horasDoDia(
      SEGUNDA,
      base({
        fechamentos: [fechamento(br(SEGUNDA, "08:00"), br(SEGUNDA, "12:00"), { scope: "rooms", roomIds: ["sala-antiga"] })],
      })
    );
    expect(d.cadeira).toBe(1200);
  });
  it("sala fechada dentro de um fechamento da unidade não desconta em dobro", () => {
    const d = horasDoDia(
      SEGUNDA,
      base({
        fechamentos: [
          fechamento(br(SEGUNDA, "08:00"), br(SEGUNDA, "18:00")),
          fechamento(br(SEGUNDA, "08:00"), br(SEGUNDA, "12:00"), { scope: "rooms", roomIds: ["sala-1"] }),
        ],
      })
    );
    expect(d.funcionamento).toBe(0);
    expect(d.fechadoSala).toBe(0);
    expect(d.cadeira).toBe(0);
  });
  it("fechamento de PROFISSIONAL não reduz nada — só aparece à parte", () => {
    const d = horasDoDia(
      SEGUNDA,
      base({
        fechamentos: [
          fechamento(br(SEGUNDA, "08:00"), br(SEGUNDA, "10:00"), { scope: "providers", providerIds: ["a", "b"] }),
        ],
      })
    );
    expect(d.funcionamento).toBe(600);
    expect(d.cadeira).toBe(1200);
    expect(d.fechadoProfissional).toBe(240); // 2h × 2 profissionais
  });
  it("em dia que não abre, fechamento não desconta nada", () => {
    const d = horasDoDia(DOMINGO, base({ fechamentos: [fechamento(br(DOMINGO, "08:00"), br(DOMINGO, "12:00"))] }));
    expect(d.fechadoUnidade).toBe(0);
    expect(d.funcionamento).toBe(0);
  });
});

describe("a conta fecha", () => {
  const cenarios: Base[] = [
    base(),
    comAlmoco(base()),
    base({ avulsos: [{ date: SEGUNDA, start: "06:00", end: "21:00" }] }),
    base({ avulsos: [{ date: DOMINGO, start: "08:00", end: "12:00" }] }),
    base({ feriados: new Map([[SEGUNDA, false]]) }),
    base({ planejados: [periodo()], avulsos: [{ date: SEGUNDA, start: "08:00", end: "12:00" }] }),
    base({ planejados: [periodo({ isNetwork: true, locked: true })] }),
    comAlmoco(
      base({
        fechamentos: [
          fechamento(br(SEGUNDA, "09:00"), br(SEGUNDA, "13:30")),
          fechamento(br(SEGUNDA, "15:00"), br(SEGUNDA, "16:00"), { scope: "rooms", roomIds: ["sala-2"] }),
        ],
      })
    ),
  ];
  it("funcionamento = potencial − perdidos + avulso − fechado, em todo cenário", () => {
    for (const c of cenarios) {
      for (const dia of [DOMINGO, SEGUNDA, TERCA]) {
        const d = horasDoDia(dia, c);
        expect(d.funcionamento).toBe(
          d.potencial - d.perdidoFeriado - d.perdidoUnidade - d.perdidoRede + d.ganhoAvulso - d.fechadoUnidade
        );
        expect(d.cadeira).toBe(d.funcionamento * c.cadeiras.length - d.fechadoSala);
        expect(d.cadeira).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("o período", () => {
  it("um dia calculado por data, pontas incluídas", () => {
    const dias = horasPossiveis({ ...base(), de: DOMINGO, ate: "2026-09-19" });
    expect(dias).toHaveLength(7);
    const r = resumir(dias);
    expect(r.diasAbertos).toBe(6);
    expect(r.funcionamento).toBe(3600);
    expect(r.cadeira).toBe(7200);
  });
  it("o resumo conta os dias por motivo", () => {
    const r = resumir(
      horasPossiveis({
        ...base({
          feriados: new Map([[SEGUNDA, false]]),
          planejados: [
            periodo({ startsDate: TERCA, endsDate: TERCA }),
            periodo({ startsDate: "2026-09-16", endsDate: "2026-09-16", isNetwork: true }),
          ],
          avulsos: [{ date: DOMINGO, start: "08:00", end: "12:00" }],
        }),
        de: DOMINGO,
        ate: "2026-09-19",
      })
    );
    expect(r.diasFeriadoFechado).toBe(1);
    expect(r.diasPeriodoUnidade).toBe(1);
    expect(r.diasPeriodoRede).toBe(1);
    expect(r.diasComAvulso).toBe(1);
    expect(r.diasAbertos).toBe(4); // domingo (avulso) + quinta, sexta, sábado
    expect(r.funcionamento).toBe(240 + 3 * 600);
  });
  it("sem pedido, vale o ano inteiro", () => {
    expect(lerPeriodo({}, 2026)).toEqual({ de: "2026-01-01", ate: "2026-12-31", encurtado: false, padrao: true });
    expect(lerPeriodo({ de: "ontem", ate: "2026-02-31" }, 2026).padrao).toBe(true);
  });
  it("datas trocadas são destrocadas; uma só ponta completa com o ano", () => {
    expect(lerPeriodo({ de: "2026-09-30", ate: "2026-09-01" }, 2026)).toMatchObject({ de: "2026-09-01", ate: "2026-09-30" });
    expect(lerPeriodo({ de: "2026-09-01" }, 2026)).toMatchObject({ de: "2026-09-01", ate: "2026-12-31", padrao: false });
    expect(lerPeriodo({ ate: "2026-03-31" }, 2026)).toMatchObject({ de: "2026-01-01", ate: "2026-03-31" });
    expect(lerPeriodo({ de: "2027-03-01" }, 2026)).toMatchObject({ de: "2027-03-01", ate: "2027-03-01" });
    expect(lerPeriodo({ ate: "2025-03-01" }, 2026)).toMatchObject({ de: "2025-03-01", ate: "2025-03-01" });
  });
  it("período maior que dois anos é encurtado, e avisa", () => {
    const p = lerPeriodo({ de: "2020-01-01", ate: "2026-12-31" }, 2026);
    expect(p.encurtado).toBe(true);
    expect(horasPossiveis({ ...base(), de: p.de, ate: p.ate })).toHaveLength(MAXIMO_DE_DIAS);
  });
});

function atendimento(
  date: string,
  de: string,
  ate: string,
  mudancas: Partial<AtendimentoDaAgenda> = {}
): AtendimentoDaAgenda {
  return {
    startsAt: br(date, de),
    endsAt: br(date, ate),
    status: "scheduled",
    attendance: null,
    isOnline: false,
    ...mudancas,
  };
}

describe("horas agendadas e horas trabalhadas", () => {
  it("o desfecho de cada atendimento", () => {
    expect(desfechoDe({ status: "completed", attendance: "done" })).toBe("concluido");
    expect(desfechoDe({ status: "scheduled", attendance: "done" })).toBe("concluido");
    expect(desfechoDe({ status: "completed", attendance: null })).toBe("concluido");
    expect(desfechoDe({ status: "cancelled", attendance: "gave_up" })).toBe("desistencia");
    expect(desfechoDe({ status: "no_show", attendance: null })).toBe("falta");
    expect(desfechoDe({ status: "cancelled", attendance: null })).toBe("cancelado");
    expect(desfechoDe({ status: "scheduled", attendance: "waiting" })).toBe("marcado");
    expect(desfechoDe({ status: "confirmed", attendance: "in_service" })).toBe("marcado");
  });
  it("vale o tempo MARCADO; fim antes do início vale zero", () => {
    expect(minutosMarcados(atendimento(SEGUNDA, "09:00", "10:30"))).toBe(90);
    expect(minutosMarcados({ startsAt: br(SEGUNDA, "10:00"), endsAt: br(SEGUNDA, "09:00") })).toBe(0);
    expect(minutosMarcados({ startsAt: "x", endsAt: br(SEGUNDA, "09:00") })).toBe(0);
  });

  const lista: AtendimentoDaAgenda[] = [
    atendimento(SEGUNDA, "08:00", "09:00", { status: "completed", attendance: "done" }), // 60 trabalhadas
    atendimento(SEGUNDA, "09:00", "09:30", { status: "no_show" }), // 30 falta
    atendimento(SEGUNDA, "10:00", "10:45", { status: "cancelled", attendance: "gave_up" }), // 45 desistência
    atendimento(SEGUNDA, "11:00", "12:00", { status: "cancelled" }), // cancelado: fora
    atendimento(SEGUNDA, "13:00", "14:00"), // 60 sem desfecho (segunda já passou)
    atendimento(TERCA, "08:00", "10:00"), // 120 marcado para hoje
    atendimento(SEGUNDA, "15:00", "16:00", { status: "completed", attendance: "done", isOnline: true }), // online
    atendimento("2026-09-20", "08:00", "09:00", { status: "completed", attendance: "done" }), // fora do período
  ];

  it("soma por desfecho; cancelado e online ficam fora da ocupação", () => {
    const r = horasDosAtendimentos(lista, { de: SEGUNDA, ate: TERCA, hoje: TERCA });
    expect(r.trabalhadas).toBe(60);
    expect(r.faltas).toBe(75);
    expect(r.semDesfecho).toBe(60);
    expect(r.agendadas).toBe(60 + 30 + 45 + 60 + 120);
    expect(r.canceladas).toBe(60);
    expect(r.onlineAgendadas).toBe(60);
    expect(r.onlineTrabalhadas).toBe(60);
    expect(r.concluidos).toBe(2);
    expect(r.quantidade).toBe(6);
  });
  it("marcado para hoje ou para a frente ainda não é 'sem desfecho'", () => {
    const r = horasDosAtendimentos(lista, { de: SEGUNDA, ate: TERCA, hoje: SEGUNDA });
    expect(r.semDesfecho).toBe(0);
  });
  it("o dia do atendimento é o BRASILEIRO", () => {
    // 2026-09-15T01:00Z = 22:00 de segunda no Brasil.
    const tarde: AtendimentoDaAgenda = {
      startsAt: "2026-09-15T01:00:00.000Z",
      endsAt: "2026-09-15T02:00:00.000Z",
      status: "completed",
      attendance: "done",
      isOnline: false,
    };
    expect(horasDosAtendimentos([tarde], { de: SEGUNDA, ate: SEGUNDA, hoje: TERCA }).trabalhadas).toBe(60);
    expect(horasDosAtendimentos([tarde], { de: TERCA, ate: TERCA, hoje: TERCA }).trabalhadas).toBe(0);
  });
  it("mês a mês, com o 'até hoje' separado", () => {
    const dias = horasPossiveis({ ...base(), de: "2026-09-28", ate: "2026-10-03" });
    const meses = porMes(
      dias,
      [atendimento("2026-09-29", "08:00", "09:00", { status: "completed", attendance: "done" })],
      "2026-09-30"
    );
    expect(meses.map((m) => m.mes)).toEqual(["2026-09", "2026-10"]);
    expect(meses[0].possiveis.funcionamento).toBe(3 * 600);
    expect(meses[0].possiveisAteHoje.funcionamento).toBe(3 * 600);
    expect(meses[0].atendimentos.trabalhadas).toBe(60);
    expect(meses[1].possiveis.funcionamento).toBe(3 * 600);
    expect(meses[1].possiveisAteHoje.funcionamento).toBe(0);
    expect(meses[1].atendimentos.trabalhadas).toBe(0);
  });
});

describe("o quadro da tela", () => {
  const dias = horasPossiveis({ ...base(), de: SEGUNDA, ate: "2026-09-19" }); // seg a sáb
  const feitos: AtendimentoDaAgenda[] = [
    atendimento(SEGUNDA, "08:00", "14:00", { status: "completed", attendance: "done" }), // 360
    atendimento("2026-09-18", "08:00", "12:00"), // 240 marcado, no futuro
  ];
  it("a ocupação REALIZADA é contra os dias até hoje; a da AGENDA, contra o período", () => {
    const q = montarQuadro(dias, feitos, TERCA);
    expect(q.total.cadeira).toBe(7200);
    expect(q.ateHoje.cadeira).toBe(2400); // segunda e terça
    expect(q.ocupacaoRealizada).toBe(15); // 360 ÷ 2400
    expect(q.ocupacaoDaAgenda).toBe(8.3); // 600 ÷ 7200
    expect(q.comecou).toBe(true);
    expect(q.terminou).toBe(false);
  });
  it("período que ainda não começou não tem ocupação realizada (nem 0%)", () => {
    const q = montarQuadro(dias, feitos, DOMINGO);
    expect(q.comecou).toBe(false);
    expect(q.ocupacaoRealizada).toBeNull();
    expect(q.ocupacaoDaAgenda).toBe(8.3);
  });
  it("sem ler os atendimentos, o lado trabalhado fica NULO — não zero", () => {
    const q = montarQuadro(dias, null, TERCA);
    expect(q.agenda).toBeNull();
    expect(q.ocupacaoRealizada).toBeNull();
    expect(q.ocupacaoDaAgenda).toBeNull();
    expect(q.total.funcionamento).toBe(3600);
  });
});

describe("ocupação e exibição", () => {
  it("sem horas possíveis não existe ocupação — nunca 0%", () => {
    expect(ocupacao(0, 0)).toBeNull();
    expect(ocupacao(120, 0)).toBeNull();
    expect(formatarOcupacao(null)).toBe("—");
  });
  it("percentual com uma casa, e pode passar de 100%", () => {
    expect(ocupacao(300, 1200)).toBe(25);
    expect(ocupacao(1, 3)).toBe(33.3);
    expect(ocupacao(1500, 1200)).toBe(125);
    expect(formatarOcupacao(33.3)).toBe("33,3%");
    expect(formatarOcupacao(0)).toBe("0,0%");
  });
  it("horas: com minutos enquanto cabe, arredondado acima de 100 horas", () => {
    expect(formatarHoras(0)).toBe("0h");
    expect(formatarHoras(450)).toBe("7h30");
    expect(formatarHoras(600)).toBe("10h");
    expect(formatarHoras(5999)).toBe("99h59");
    expect(formatarHoras(6030)).toBe("101h"); // de 100 horas em diante, sem minutos
    expect(formatarHoras(148_200)).toBe("2.470h");
    expect(formatarHoras(-90)).toBe("−1h30");
  });
});

// ---------------------------------------------------------------------------
// A tela usa ESTA conta — e não voltou à antiga
// ---------------------------------------------------------------------------
describe("a tela do Planejamento Anual", () => {
  const pasta = join(process.cwd(), "src/app/(app)/agenda/planejamento-anual");
  const pagina = readFileSync(join(pasta, "page.tsx"), "utf8");
  const dados = readFileSync(join(pasta, "horas-dados.ts"), "utf8");

  it("não faz mais a conta antiga (dias × jornada)", () => {
    expect(pagina).not.toMatch(/workingDays\s*\*\s*dailyMinutes/);
    expect(pagina).not.toMatch(/não\s+entram\s+nesta\s+conta/);
  });
  it("lê avulsos, fechamentos e os períodos da REDE para calcular", () => {
    expect(dados).toMatch(/\.from\("agenda_open_days"\)/);
    expect(dados).toMatch(/\.from\("agenda_closures"\)/);
    expect(dados).toMatch(/clinic_id\.is\.null/);
    expect(dados).toMatch(/horasPossiveis\(/);
  });
  it("lê os atendimentos em páginas (a API corta em 1.000 linhas)", () => {
    expect(dados).toMatch(/lerTodasAsPaginas/);
    // Ordem estável: sem desempate, página lida repete umas linhas e pula outras.
    // São DUAS leituras em páginas (fechamentos e atendimentos), e as duas desempatam.
    expect(dados.match(/lerTodasAsPaginas</g)).toHaveLength(2);
    expect(dados.match(/\.order\("starts_at"\)\s*\.order\("id"\)\s*\.range\(/g)).toHaveLength(2);
  });
  it("falha de leitura não vira zero: a conta é recusada", () => {
    expect(dados).toMatch(/naoLido/);
    expect(dados).not.toMatch(/data\s*\?\?\s*\[\]/);
  });
});
