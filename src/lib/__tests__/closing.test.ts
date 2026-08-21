import { describe, expect, it } from "vitest";
import {
  closeBlock,
  closeBlockMessage,
  highSeverity,
  monthName,
  type ChecklistItem,
  type MonthStatus,
} from "@/lib/finance/closing";
import { financeErrorMessage } from "@/lib/finance/errors";

const month = (
  m: number,
  status: "open" | "closed" = "open",
  entries = 0
): MonthStatus => ({
  month: m,
  status,
  closedAt: null,
  closedByName: null,
  reopenedAt: null,
  reopenReason: null,
  entries,
});

describe("o que impede fechar", () => {
  it("mês que ainda não terminou não fecha", () => {
    const b = closeBlock({
      year: 2026,
      month: 8,
      months: [month(8)],
      today: "2026-08-21",
    });
    expect(b.can).toBe(false);
    expect(closeBlockMessage(b)).toContain("ainda não terminou");
  });

  it("o último dia do mês ainda não serve — só a partir do dia seguinte", () => {
    expect(
      closeBlock({
        year: 2026,
        month: 8,
        months: [month(8)],
        today: "2026-08-31",
      }).can
    ).toBe(false);
    expect(
      closeBlock({
        year: 2026,
        month: 8,
        months: [month(8)],
        today: "2026-09-01",
      }).can
    ).toBe(true);
  });

  it("mês anterior aberto COM movimento bloqueia", () => {
    const b = closeBlock({
      year: 2026,
      month: 3,
      months: [month(1, "closed"), month(2, "open", 40), month(3)],
      today: "2026-04-05",
    });
    expect(b.can).toBe(false);
    expect(closeBlockMessage(b)).toContain("Fevereiro");
  });

  it("mês anterior aberto SEM movimento não atrapalha", () => {
    // Unidade que começou a lançar em março não precisa fechar janeiro vazio.
    expect(
      closeBlock({
        year: 2026,
        month: 3,
        months: [month(1), month(2), month(3, "open", 12)],
        today: "2026-04-05",
      }).can
    ).toBe(true);
  });

  it("mês já fechado não fecha de novo", () => {
    const b = closeBlock({
      year: 2026,
      month: 3,
      months: [month(3, "closed", 10)],
      today: "2026-04-05",
    });
    expect(b.can).toBe(false);
    expect(closeBlockMessage(b)).toContain("já está fechado");
  });

  it("fevereiro bissexto fecha no dia 1º de março", () => {
    expect(
      closeBlock({
        year: 2028,
        month: 2,
        months: [month(2)],
        today: "2028-02-29",
      }).can
    ).toBe(false);
    expect(
      closeBlock({
        year: 2028,
        month: 2,
        months: [month(2)],
        today: "2028-03-01",
      }).can
    ).toBe(true);
  });

  it("pendência NÃO impede fechar — ela avisa", () => {
    // Nenhuma regra de bloqueio olha a conferência: é decisão de propósito.
    const b = closeBlock({
      year: 2026,
      month: 7,
      months: [month(7, "open", 300)],
      today: "2026-08-21",
    });
    expect(b.can).toBe(true);
    expect(closeBlockMessage(b)).toBeNull();
  });
});

describe("a conferência", () => {
  const items: ChecklistItem[] = [
    {
      key: "depreciacao",
      label: "Bens sem depreciação",
      items: 3,
      amountCents: 0,
      severity: "alta",
    },
    {
      key: "banco",
      label: "Não conciliados",
      items: 5,
      amountCents: 12_000,
      severity: "media",
    },
  ];

  it("separa o que deixa o resultado errado", () => {
    expect(highSeverity(items).map((i) => i.key)).toEqual(["depreciacao"]);
  });

  it("sem pendência, não sobra nada de severidade alta", () => {
    expect(highSeverity([])).toEqual([]);
  });
});

describe("nomes de mês", () => {
  it("traduz e não estoura os limites", () => {
    expect(monthName(1)).toBe("Janeiro");
    expect(monthName(12)).toBe("Dezembro");
    expect(monthName(0)).toBe("Janeiro");
    expect(monthName(99)).toBe("Dezembro");
  });
});

describe("tradução dos erros do banco", () => {
  it("reconhece o período fechado", () => {
    expect(
      financeErrorMessage('erro: PERIOD_CLOSED')
    ).toContain("já foi fechado");
  });

  it("mostra o detalhe quando o erro carrega um", () => {
    expect(financeErrorMessage("EARLIER_PERIOD_OPEN: 02/2026")).toContain(
      "(02/2026)"
    );
  });

  it("erro desconhecido devolve null em vez de chutar", () => {
    // Quem chama decide o texto genérico — assim um erro novo nunca vira uma
    // mensagem errada com cara de certa.
    expect(financeErrorMessage("connection reset by peer")).toBeNull();
    expect(financeErrorMessage(null)).toBeNull();
  });
});
