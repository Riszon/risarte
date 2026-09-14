import { describe, expect, it } from "vitest";
import {
  buildIcs,
  icsFileName,
  icsInstant,
  isMeetingOpen,
  nextMeetingStatuses,
  requiresStatusNote,
  timesRescheduled,
} from "@/lib/empresarial/agenda";
import {
  MEETING_STATUSES,
  type MeetingStatus,
} from "@/lib/empresarial/constants";

describe("situação da reunião", () => {
  it("só agendada e confirmada ainda ocupam a agenda", () => {
    expect(isMeetingOpen("SCHEDULED")).toBe(true);
    expect(isMeetingOpen("CONFIRMED")).toBe(true);
    for (const s of ["DONE", "RESCHEDULED", "CANCELLED", "NO_SHOW"] as const) {
      expect(isMeetingOpen(s)).toBe(false);
    }
  });

  it("reunião encerrada não muda mais de situação", () => {
    // Desfazer "realizada" seria o sistema fingindo que a conversa não houve —
    // e o cartão já andou para Apresentado por causa dela.
    for (const s of ["DONE", "RESCHEDULED", "CANCELLED", "NO_SHOW"] as const) {
      expect(nextMeetingStatuses(s)).toEqual([]);
    }
  });

  it("agendada pode ir para qualquer desfecho, menos para ela mesma", () => {
    const destinos = nextMeetingStatuses("SCHEDULED");
    expect(destinos).toContain("CONFIRMED");
    expect(destinos).toContain("DONE");
    expect(destinos).not.toContain("SCHEDULED");
  });

  it("confirmada não oferece 'confirmar' de novo", () => {
    expect(nextMeetingStatuses("CONFIRMED")).not.toContain("CONFIRMED");
  });

  it("todo destino oferecido é uma situação que o banco aceita", () => {
    // Oferecer na tela um valor que o CHECK recusa é erro que só aparece no
    // clique — e com cara de "o sistema não salvou".
    for (const s of MEETING_STATUSES) {
      for (const destino of nextMeetingStatuses(s)) {
        expect(MEETING_STATUSES).toContain(destino);
      }
    }
  });

  it("cancelar, remarcar e faltar exigem motivo escrito", () => {
    expect(requiresStatusNote("CANCELLED")).toBe(true);
    expect(requiresStatusNote("NO_SHOW")).toBe(true);
    expect(requiresStatusNote("RESCHEDULED")).toBe(true);
    expect(requiresStatusNote("DONE")).toBe(false);
    expect(requiresStatusNote("CONFIRMED")).toBe(false);
  });
});

describe("quantas vezes a empresa já remarcou", () => {
  const corrente = new Map<string, string | null>([
    ["c", "b"],
    ["b", "a"],
    ["a", null],
  ]);

  it("segue a corrente para trás", () => {
    expect(timesRescheduled("a", corrente)).toBe(0);
    expect(timesRescheduled("b", corrente)).toBe(1);
    expect(timesRescheduled("c", corrente)).toBe(2);
  });

  it("dado estragado com laço NÃO trava a tela", () => {
    // Travar a tela é pior que mostrar um número incompleto.
    const laco = new Map<string, string | null>([
      ["x", "y"],
      ["y", "x"],
    ]);
    expect(timesRescheduled("x", laco)).toBe(1);
  });
});

describe("arquivo de calendário (.ics)", () => {
  const base = {
    id: "11111111-2222-3333-4444-555555555555",
    resumo: "Apresentação Risarte Empresarial — Bom Sabor",
    inicio: "2026-09-15T17:00:00.000Z",
    fim: "2026-09-15T18:00:00.000Z",
    agora: new Date("2026-09-14T12:00:00.000Z"),
  };

  it("tem a moldura que todo calendário espera", () => {
    const ics = buildIcs(base);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("VERSION:2.0");
  });

  it("usa CRLF, que é o que o formato exige", () => {
    // Só "\n" faz alguns calendários recusarem o arquivo inteiro, e o sintoma
    // é "não aconteceu nada ao clicar".
    const ics = buildIcs(base);
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it("a HORA VAI EM UTC — é o que faz o compromisso cair na hora certa", () => {
    const ics = buildIcs(base);
    expect(ics).toContain("DTSTART:20260915T170000Z");
    expect(ics).toContain("DTEND:20260915T180000Z");
    expect(ics).toContain("DTSTAMP:20260914T120000Z");
  });

  it("14:00 de Brasília vira 17:00Z, não 14:00Z", () => {
    expect(icsInstant("2026-09-15T14:00:00-03:00")).toBe("20260915T170000Z");
  });

  it("data inválida GRITA, não gera evento torto", () => {
    expect(() => icsInstant("quinta que vem")).toThrow(/Data inválida/);
  });

  it("escapa vírgula, ponto-e-vírgula e quebra de linha", () => {
    // Vírgula sem escape parte o campo em dois, e o título chega cortado.
    const ics = buildIcs({
      ...base,
      resumo: "Reunião, com a diretoria; sala 2",
      descricao: "Linha 1\nLinha 2",
    });
    expect(ics).toContain("SUMMARY:Reunião\\, com a diretoria\\; sala 2");
    expect(ics).toContain("DESCRIPTION:Linha 1\\nLinha 2");
  });

  it("dobra linha comprida em 75 octetos", () => {
    const ics = buildIcs({ ...base, descricao: "a".repeat(300) });
    for (const linha of ics.split("\r\n")) {
      expect(new TextEncoder().encode(linha).length).toBeLessThanOrEqual(75);
    }
    // E o conteúdo continua inteiro depois de desdobrar.
    const desdobrado = ics.replace(/\r\n /g, "");
    expect(desdobrado).toContain(`DESCRIPTION:${"a".repeat(300)}`);
  });

  it("dobra sem partir caractere acentuado ao meio", () => {
    // "ã" ocupa dois octetos: cortar no meio produz lixo no calendário.
    const ics = buildIcs({ ...base, descricao: "ã".repeat(120) });
    const desdobrado = ics.replace(/\r\n /g, "");
    expect(desdobrado).toContain(`DESCRIPTION:${"ã".repeat(120)}`);
    expect(ics).not.toContain("�");
  });

  it("campos vazios não viram linha vazia", () => {
    const ics = buildIcs({ ...base, descricao: null, local: null });
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("LOCATION:");
  });
});

describe("nome do arquivo baixado", () => {
  it("tira acento e espaço", () => {
    expect(icsFileName("Construções Almeida S.A.")).toBe(
      "reuniao-construcoes-almeida-s-a.ics"
    );
  });

  it("nome que vira vazio ainda gera arquivo com nome", () => {
    expect(icsFileName("!!!")).toBe("reuniao-risarte.ics");
  });
});

describe("o TypeScript e o banco falam das mesmas situações", () => {
  it("MEETING_STATUSES tem as 6 situações do comercial", () => {
    const esperado: MeetingStatus[] = [
      "SCHEDULED",
      "CONFIRMED",
      "DONE",
      "RESCHEDULED",
      "CANCELLED",
      "NO_SHOW",
    ];
    expect([...MEETING_STATUSES]).toEqual(esperado);
  });
});
