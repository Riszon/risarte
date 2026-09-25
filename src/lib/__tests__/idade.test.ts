import { describe, expect, it } from "vitest";
import {
  anosCompletos,
  ehMenorDeIdade,
  idadeCurta,
  idadeDetalhada,
} from "@/lib/idade";
import { formatIsoDateBr } from "@/lib/dates";

describe("idade: calendário, não relógio (achado AP3)", () => {
  it("conta os anos completos", () => {
    expect(anosCompletos("2004-03-04", "2026-09-25")).toBe(22);
    expect(anosCompletos("1990-01-01", "2026-09-25")).toBe(36);
  });

  it("no DIA do aniversário a idade já virou", () => {
    expect(anosCompletos("2004-09-25", "2026-09-25")).toBe(22);
  });

  it("um dia antes do aniversário, ainda não", () => {
    expect(anosCompletos("2004-09-26", "2026-09-25")).toBe(21);
  });

  // ⚠️ O DEFEITO QUE ISTO IMPEDE. A versão antiga lia `now` no relógio da
  // máquina: no servidor em UTC, às 22h de 24/09 já era dia 25 — e quem faz
  // aniversário no dia 25 aparecia com a idade nova na véspera.
  it("a véspera à noite NÃO adianta o aniversário", () => {
    // Hoje no Brasil ainda é 24, mesmo que em UTC já seja 25.
    expect(anosCompletos("2004-09-25", "2026-09-24")).toBe(21);
    expect(anosCompletos("2004-09-25", "2026-09-25")).toBe(22);
  });

  it("data no futuro ou ilegível devolve nulo — não devolve zero", () => {
    // Zero afirmaria "menos de um ano de idade", que é uma informação falsa.
    expect(anosCompletos("2030-01-01", "2026-09-25")).toBeNull();
    expect(anosCompletos("", "2026-09-25")).toBeNull();
    expect(anosCompletos("04/03/2004", "2026-09-25")).toBeNull();
  });

  it("29 de fevereiro: o aniversário completa em 1º de março nos anos comuns", () => {
    expect(anosCompletos("2004-02-29", "2026-02-28")).toBe(21);
    expect(anosCompletos("2004-02-29", "2026-03-01")).toBe(22);
    // E no próprio 29, em ano bissexto.
    expect(anosCompletos("2004-02-29", "2028-02-29")).toBe(24);
  });

  it("menor de idade: vira maior no dia dos 18", () => {
    expect(ehMenorDeIdade("2008-09-26", "2026-09-25")).toBe(true);
    expect(ehMenorDeIdade("2008-09-25", "2026-09-25")).toBe(false);
  });

  // ⚠️ NA DÚVIDA, MENOR: pedir responsável a mais custa uma pergunta; deixar de
  // pedir cria prontuário de criança sem responsável.
  it("data ilegível é tratada como MENOR", () => {
    expect(ehMenorDeIdade("", "2026-09-25")).toBe(true);
    expect(ehMenorDeIdade("nascimento", "2026-09-25")).toBe(true);
  });

  it("idade curta usa singular no primeiro ano", () => {
    expect(idadeCurta("2025-09-25", "2026-09-25")).toBe("1 ano");
    expect(idadeCurta("2024-09-25", "2026-09-25")).toBe("2 anos");
    expect(idadeCurta("2030-01-01", "2026-09-25")).toBe("");
  });

  it("idade detalhada em anos, meses e dias", () => {
    expect(idadeDetalhada("2004-06-10", "2026-09-25")).toBe(
      "22 anos, 3 meses e 15 dias"
    );
    expect(idadeDetalhada("2026-09-24", "2026-09-25")).toBe(
      "0 anos, 0 meses e 1 dia"
    );
  });

  it("idade detalhada empresta dias do mês ANTERIOR ao de hoje", () => {
    // De 31/01 até 01/03/2026: fevereiro tem 28 dias em 2026.
    expect(idadeDetalhada("2026-01-31", "2026-03-01")).toBe(
      "0 anos, 1 mês e 1 dia"
    );
    // Virada de ano: o mês anterior a janeiro é dezembro do ano passado.
    expect(idadeDetalhada("2025-12-20", "2026-01-05")).toBe(
      "0 anos, 0 meses e 16 dias"
    );
  });
});

describe("formatIsoDateBr: data civil sem instante no meio", () => {
  it("formata sem voltar um dia", () => {
    expect(formatIsoDateBr("2026-09-05")).toBe("05/09/2026");
    expect(formatIsoDateBr("2004-03-04")).toBe("04/03/2004");
  });

  // ⚠️ O DEFEITO: os dois jeitos antigos voltam um dia no servidor em UTC.
  it("o jeito antigo erra o dia; este não", () => {
    const comoEra = new Date("2004-03-04T00:00:00Z").toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    expect(comoEra).toBe("03/03/2004");
    expect(formatIsoDateBr("2004-03-04")).toBe("04/03/2004");
  });

  it("vazio ou ilegível não vira data inventada", () => {
    expect(formatIsoDateBr("")).toBe("");
    expect(formatIsoDateBr(null)).toBe("");
    expect(formatIsoDateBr("ontem")).toBe("");
  });
});
