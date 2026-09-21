import { describe, expect, it } from "vitest";
import {
  BOAS_VINDAS,
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
