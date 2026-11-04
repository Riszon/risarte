import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENDA_DEFAULTS, type AgendaSettings } from "@/lib/agenda-settings";
import { instantFromBrazil, weekdayOf } from "@/lib/dates";
import {
  horariosLivres,
  janelaDosHorarios,
  type EntradaDosHorarios,
} from "@/lib/horarios-livres";

// ⚠️ A PROVA DO AP104 (plano `docs/sdr/PLANO-CORRECOES-SECAO-2.md` §5a).
//
// A lista de próximos horários montava a janela em `new Date(ano, mês, dia)`
// — a meia-noite da MÁQUINA — e lia o dia da semana com `day.getDay()`,
// também no relógio da máquina. No computador de quem programa (Brasília) as
// duas contas batem com a data civil brasileira que `toIsoDate` devolve; na
// Vercel (UTC), a partir das 21h de Brasília, o dia da MÁQUINA já é o seguinte.
//
// Este arquivo roda com o relógio da máquina em UTC DE PROPÓSITO, porque é
// onde o sistema roda de verdade. Os outros testes comparam instantes
// absolutos e não dependem do fuso; este precisa dele para ser a prova.

const TZ_ANTES = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "UTC";
  // Régua que não mede tem de gritar: se a troca de fuso não valeu, o teste
  // passaria por ausência de UTC, não por saúde da conta.
  if (new Date(2026, 0, 1, 12).getTimezoneOffset() !== 0) {
    throw new Error("não consegui pôr o relógio da máquina em UTC — a prova não vale");
  }
});

afterAll(() => {
  if (TZ_ANTES === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ANTES;
});

/** Unidade das 08h às 18h, sem almoço, fechada no fim de semana. */
const SEMANA: AgendaSettings = {
  ...AGENDA_DEFAULTS,
  openTime: "08:00",
  closeTime: "18:00",
  weekdays: [1, 2, 3, 4, 5],
  lunchEnabled: false,
};

function entrada(parcial: Partial<EntradaDosHorarios>): EntradaDosHorarios {
  return {
    agora: instantFromBrazil("2026-11-06", "22:00"), // sexta, 22h de Brasília
    cfg: SEMANA,
    jornadaOnline: null,
    isOnline: false,
    providerUserId: null,
    roomId: null,
    clientId: null,
    durationMin: 60,
    limit: 3,
    closures: [],
    openDayHours: new Map(),
    holidayDecision: new Map(),
    appts: [],
    itensDoPlano: [],
    ...parcial,
  };
}

describe("horários livres com o relógio da máquina em UTC (AP104)", () => {
  it("o cenário é o que a prova exige: 06/11/2026 é sexta e são 01:00Z de sábado", () => {
    expect(weekdayOf("2026-11-06")).toBe(5);
    expect(entrada({}).agora.toISOString()).toBe("2026-11-07T01:00:00.000Z");
  });

  it("sexta à noite, unidade fechada no fim de semana: oferece SEGUNDA, nunca sábado nem domingo", () => {
    const slots = horariosLivres(entrada({}));
    expect(slots.length).toBe(3);
    // O primeiro horário é segunda 09/11 às 08:00 — não "domingo às 08:00".
    expect(slots[0]).toEqual({ date: "2026-11-09", time: "08:00" });
    for (const s of slots) {
      expect([0, 6], `ofereceu ${s.date} (dia ${weekdayOf(s.date)})`).not.toContain(
        weekdayOf(s.date)
      );
    }
  });

  it("sexta à noite, unidade ABERTA no sábado: o primeiro horário é o sábado 07/11", () => {
    const slots = horariosLivres(entrada({ cfg: { ...SEMANA, weekdays: [1, 2, 3, 4, 5, 6] } }));
    expect(slots[0]).toEqual({ date: "2026-11-07", time: "08:00" });
  });

  it("a janela começa na meia-noite BRASILEIRA de hoje (sexta), não na da máquina", () => {
    const j = janelaDosHorarios(instantFromBrazil("2026-11-06", "22:00"));
    expect(j.hojeIso).toBe("2026-11-06");
    expect(j.inicioIso).toBe("2026-11-06T03:00:00.000Z");
    expect(j.fimIso).toBe("2026-12-21T03:00:00.000Z");
  });

  it("de dia a resposta é a mesma em qualquer fuso (o defeito só aparecia à noite)", () => {
    const slots = horariosLivres(entrada({ agora: instantFromBrazil("2026-11-06", "10:00") }));
    expect(slots[0]).toEqual({ date: "2026-11-06", time: "10:00" });
  });
});

describe("as regras que a extração não podia mudar", () => {
  it("respeita o almoço, a duração e o horário já passado", () => {
    const slots = horariosLivres(
      entrada({
        agora: instantFromBrazil("2026-11-06", "11:40"),
        cfg: { ...SEMANA, lunchEnabled: true, lunchStart: "12:00", lunchEnd: "13:00" },
        limit: 2,
      })
    );
    // 11:45 avançaria sobre o almoço; 13:00 é o primeiro depois dele.
    expect(slots).toEqual([
      { date: "2026-11-06", time: "13:00" },
      { date: "2026-11-06", time: "13:15" },
    ]);
  });

  it("pula o horário ocupado do profissional, mas não o do encaixe", () => {
    const comum = {
      provider_user_id: "p1",
      room_id: null,
      client_id: "c9",
      status: "scheduled",
    };
    const slots = horariosLivres(
      entrada({
        agora: instantFromBrazil("2026-11-06", "07:00"),
        providerUserId: "p1",
        limit: 2,
        appts: [
          {
            ...comum,
            type: "evaluation",
            starts_at: instantFromBrazil("2026-11-06", "08:00").toISOString(),
            ends_at: instantFromBrazil("2026-11-06", "09:00").toISOString(),
          },
          {
            ...comum,
            type: "urgency",
            starts_at: instantFromBrazil("2026-11-06", "09:00").toISOString(),
            ends_at: instantFromBrazil("2026-11-06", "10:00").toISOString(),
          },
        ],
      })
    );
    expect(slots).toEqual([
      { date: "2026-11-06", time: "09:00" },
      { date: "2026-11-06", time: "09:15" },
    ]);
  });

  it("feriado decidido como 'não atende' fecha o dia; dia avulso abre o fechado", () => {
    const slots = horariosLivres(
      entrada({
        agora: instantFromBrazil("2026-11-06", "07:00"),
        holidayDecision: new Map([["2026-11-06", false]]),
        openDayHours: new Map([["2026-11-07", { open: 9 * 60, close: 12 * 60 }]]),
        limit: 1,
      })
    );
    expect(slots).toEqual([{ date: "2026-11-07", time: "09:00" }]);
  });
});
