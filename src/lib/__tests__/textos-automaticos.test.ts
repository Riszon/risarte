import { describe, expect, it } from "vitest";
import {
  BOAS_VINDAS,
  deveMostrarBoasVindas,
  GUIA_DO_TREINO,
  pedacos,
  semMarcas,
} from "../textos-automaticos";

describe("pedacos — o negrito do texto automático", () => {
  it("separa o que está entre ** do resto", () => {
    expect(pedacos("Olá **Fulana**, tudo bem?")).toEqual([
      { texto: "Olá ", forte: false },
      { texto: "Fulana", forte: true },
      { texto: ", tudo bem?", forte: false },
    ]);
  });
  it("texto sem marca volta inteiro", () => {
    expect(pedacos("sem nada")).toEqual([{ texto: "sem nada", forte: false }]);
  });
  it("mais de um negrito na mesma frase", () => {
    expect(pedacos("**um** e **dois**").filter((p) => p.forte)).toHaveLength(2);
  });
});

describe("semMarcas", () => {
  it("tira as marcas para onde não há formatação", () => {
    expect(semMarcas("**Troque a senha** em Perfil")).toBe("Troque a senha em Perfil");
  });
});

describe("os textos que a equipe recebe", () => {
  it("as boas-vindas têm as duas versões do próximo passo", () => {
    expect(BOAS_VINDAS.proximoPasso.recemChegado).toContain("riSZon Treino");
    expect(BOAS_VINDAS.proximoPasso.liberado).toContain("acesso está liberado");
  });

  it("o título usa o primeiro nome de quem entra", () => {
    expect(BOAS_VINDAS.titulo("Ana")).toBe("Bem-vindo(a) ao riSZon, Ana!");
  });

  // O aviso de LGPD é o que impede dado de paciente real de entrar no treino.
  // Se alguém reescrever o guia e ele sumir, este teste avisa.
  it("o guia do treino mantém o aviso de não usar dados reais", () => {
    const tudo = GUIA_DO_TREINO.itens.map((i) => `${i.titulo} ${i.texto}`).join(" ");
    expect(tudo).toContain("Nunca use dados de pacientes reais");
    expect(tudo).toContain("LGPD");
  });

  it("todo negrito abre e fecha", () => {
    const textos = [
      BOAS_VINDAS.abertura,
      BOAS_VINDAS.proximoPasso.recemChegado,
      BOAS_VINDAS.proximoPasso.liberado,
      BOAS_VINDAS.senha,
      BOAS_VINDAS.manual,
      GUIA_DO_TREINO.abertura,
    ];
    for (const t of textos) {
      expect((t.match(/\*\*/g) ?? []).length % 2).toBe(0);
    }
  });
});

describe("deveMostrarBoasVindas — os 3 primeiros acessos (0265)", () => {
  const diaDe = (iso: string) => iso.slice(0, 10);
  const base = {
    vezes: 0,
    ultimaVezEm: null as string | null,
    hoje: "2026-09-20",
    diaDe,
    noTreino: false,
    erroAoLer: false,
  };

  it("quem nunca viu, vê", () => {
    expect(deveMostrarBoasVindas(base)).toBe(true);
  });
  it("na segunda e na terceira vez, ainda vê", () => {
    expect(deveMostrarBoasVindas({ ...base, vezes: 1, ultimaVezEm: "2026-09-19" })).toBe(true);
    expect(deveMostrarBoasVindas({ ...base, vezes: 2, ultimaVezEm: "2026-09-19" })).toBe(true);
  });
  it("na quarta, não vê mais", () => {
    expect(deveMostrarBoasVindas({ ...base, vezes: 3, ultimaVezEm: "2026-09-19" })).toBe(false);
  });
  it("no mesmo dia não repete — senão as três se gastariam num dia só", () => {
    expect(deveMostrarBoasVindas({ ...base, vezes: 1, ultimaVezEm: "2026-09-20" })).toBe(false);
  });
  it("no treino nunca aparece (lá o Início tem o guia do treino)", () => {
    expect(deveMostrarBoasVindas({ ...base, noTreino: true })).toBe(false);
  });
  it("banco sem a migração: esconde em vez de repetir toda entrada", () => {
    expect(deveMostrarBoasVindas({ ...base, erroAoLer: true })).toBe(false);
  });
});
