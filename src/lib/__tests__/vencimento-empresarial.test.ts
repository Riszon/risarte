import { afterEach, describe, expect, it, vi } from "vitest";
import {
  diasNoMes,
  proximoVencimento,
  rotuloDoMes,
} from "@/lib/empresarial/vencimento";

describe("o vencimento da cobrança do Empresarial (achado AP1)", () => {
  it("o dia ainda não chegou: vence neste mês", () => {
    const v = proximoVencimento(10, "2026-09-05");
    expect(v.dueDate).toBe("2026-09-10");
    expect(v.referenceMonth).toBe("2026-09-01");
  });

  it("o dia já passou: vai para o mês que vem", () => {
    expect(proximoVencimento(10, "2026-09-24").dueDate).toBe("2026-10-10");
  });

  it("o dia é HOJE: vai para o mês que vem (a regra de antes, preservada)", () => {
    expect(proximoVencimento(10, "2026-09-10").dueDate).toBe("2026-10-10");
  });

  it("vira o ano quando o mês que vem é janeiro", () => {
    const v = proximoVencimento(5, "2026-12-20");
    expect(v.dueDate).toBe("2027-01-05");
    // ⚠️ A competência continua sendo DEZEMBRO: a mensalidade de dezembro que
    // vence em janeiro é de dezembro. Isto é o que a DRE lê.
    expect(v.referenceMonth).toBe("2026-12-01");
  });

  // ⚠️ O DEFEITO 1 — o fuso. A versão antiga lia o calendário do servidor, que
  // na Vercel é UTC: às 22h de 30/09 no Brasil, lá já era 01/10.
  it("a data civil brasileira manda: às 22h do dia 30 ainda é setembro", () => {
    // 30/09/2026 às 22h de Brasília = 01/10/2026 às 01h UTC.
    const instante = new Date("2026-10-01T01:00:00Z");
    const noBrasil = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instante);
    expect(noBrasil).toBe("2026-09-30");

    const certo = proximoVencimento(10, noBrasil);
    expect(certo.referenceMonth).toBe("2026-09-01");

    // O que a versão antiga teria feito, lendo o relógio do servidor:
    const comoEra = proximoVencimento(10, "2026-10-01");
    expect(comoEra.referenceMonth).toBe("2026-10-01");
    // Um mês inteiro de diferença na competência, por causa da hora do clique.
    expect(comoEra.referenceMonth).not.toBe(certo.referenceMonth);
  });

  // ⚠️ O DEFEITO 2 — `new Date(2026, 1, 31)` é 3 de MARÇO, não 28 de fevereiro.
  it("dia 31 em mês que não tem 31 cai no ÚLTIMO dia do mês, não escorrega", () => {
    expect(proximoVencimento(31, "2026-02-01").dueDate).toBe("2026-02-28");
    expect(proximoVencimento(31, "2026-04-01").dueDate).toBe("2026-04-30");
    // E em ano bissexto o último dia de fevereiro é 29.
    expect(proximoVencimento(31, "2028-02-01").dueDate).toBe("2028-02-29");
  });

  it("dia 31 no mês seguinte também é preso ao último dia", () => {
    // Em 31/01 o dia 31 já é hoje → vai para fevereiro, que não tem 31.
    expect(proximoVencimento(31, "2026-01-31").dueDate).toBe("2026-02-28");
  });

  it("dia fora da faixa é preso na faixa, e a regra do mês continua valendo", () => {
    // 0 vira dia 1 — que no dia 5 já passou, então é outubro. (A primeira
    // versão deste teste esperava setembro: eu tinha esquecido a própria regra
    // de "já passou vai para o mês que vem" ao escrever a asserção.)
    expect(proximoVencimento(0, "2026-09-05").dueDate).toBe("2026-10-01");
    // 99 vira 31, preso ao último dia de setembro (30), que ainda não chegou.
    expect(proximoVencimento(99, "2026-09-05").dueDate).toBe("2026-09-30");
  });

  it("data inválida FALHA em vez de devolver um número plausível", () => {
    // Boleto com data inventada é pior que boleto que não sai.
    expect(() => proximoVencimento(10, "31/12/2026")).toThrow();
    expect(() => proximoVencimento(10, "")).toThrow();
  });

  it("diasNoMes conhece os meses e o ano bissexto", () => {
    expect(diasNoMes(2026, 1)).toBe(31);
    expect(diasNoMes(2026, 2)).toBe(28);
    expect(diasNoMes(2028, 2)).toBe(29);
    expect(diasNoMes(2026, 4)).toBe(30);
    expect(diasNoMes(2026, 12)).toBe(31);
  });
});

describe("o rótulo do mês da cobrança", () => {
  it("lê o mês como NÚMERO, sem instante no meio", () => {
    expect(rotuloDoMes("2026-09-01")).toBe("setembro de 2026");
    expect(rotuloDoMes("2026-01-01")).toBe("janeiro de 2026");
    expect(rotuloDoMes("2026-12-01")).toBe("dezembro de 2026");
  });

  // ⚠️ O DEFEITO QUE ISTO SUBSTITUI. `new Date("2026-09-01T00:00:00")` é lido
  // no fuso da MÁQUINA: na Vercel (UTC) vira meia-noite em UTC e, formatado em
  // São Paulo, volta três horas — cai em 31/08. A mensalidade de SETEMBRO
  // sairia descrita como "agosto de 2026", e só no servidor.
  it("o jeito antigo erra o mês no servidor — este não", () => {
    const comoEra = new Date("2026-09-01T00:00:00Z").toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      month: "long",
      year: "numeric",
    });
    expect(comoEra).toContain("agosto");
    expect(rotuloDoMes("2026-09-01")).toBe("setembro de 2026");
  });

  it("texto que não é mês volta como veio, sem inventar", () => {
    expect(rotuloDoMes("")).toBe("");
    expect(rotuloDoMes("2026-13-01")).toBe("2026-13-01");
  });
});

// ⚠️ A BRECHA DA PRÓPRIA RÉGUA, fechada em 25/09/2026.
//
// Todos os testes acima passam a data de propósito, para não dependerem do dia
// em que rodam — e, por isso, NENHUM deles exercitava o valor padrão. Ao provar
// a régua quebrando o código (trocando `todayInBrazil()` por
// `new Date().toISOString()`), os 13 testes continuaram VERDES: o defeito
// original moraria exatamente ali, e a régua não o veria.
//
// Com o relógio congelado o padrão vira determinístico, e a janela das 21h à
// meia-noite — a única em que o defeito aparece — pode ser visitada de propósito.
describe("o valor padrão de 'hoje' (a janela das 21h à meia-noite)", () => {
  afterEach(() => vi.useRealTimers());

  it("às 22h do dia 30/09 no Brasil, a competência ainda é SETEMBRO", () => {
    // 01/10/2026 01:00 UTC = 30/09/2026 22:00 em Brasília.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T01:00:00Z"));

    const v = proximoVencimento(10);
    expect(v.referenceMonth).toBe("2026-09-01");
    expect(v.dueDate).toBe("2026-10-10");
  });

  it("às 10h do mesmo dia dá o MESMO resultado — calendário não tem hora", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T13:00:00Z")); // 10h em Brasília

    const v = proximoVencimento(10);
    expect(v.referenceMonth).toBe("2026-09-01");
    expect(v.dueDate).toBe("2026-10-10");
  });
});
