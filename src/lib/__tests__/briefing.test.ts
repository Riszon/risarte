import { describe, expect, it } from "vitest";
import { montarBriefing } from "@/app/(app)/sistema/preparar-briefing";
import type { Relato } from "@/app/(app)/sistema/problemas";

const RELATO: Relato = {
  id: "abc",
  code: "OC-00012",
  kind: "erro",
  severity: "alta",
  title: "A agenda não deixa marcar no sábado",
  whatHappened: "Escolhi sábado e o sistema disse que a unidade está fechada.",
  expected: "Que deixasse marcar, porque atendemos sábado agora.",
  screen: "/agenda",
  appVersion: "0.229.0",
  errorDigest: "1a2b3c",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Edg/141",
  status: "aberto",
  answer: null,
  answeredAt: null,
  resolvedVersion: null,
  createdAt: "2026-09-07T17:32:00.000Z",
  reporterRole: "Recepcionista",
  reporterName: "Maria da Silva",
  clinicName: "Risarte Cambé",
  meu: false,
};

describe("briefing de um relato", () => {
  const texto = montarBriefing(RELATO, "corrigir", "Acontece só na Cambé.");

  it("leva o código, que é como se fala do caso depois", () => {
    expect(texto).toContain("OC-00012");
  });

  it("leva o relato nas palavras de quem escreveu, sem reescrever", () => {
    expect(texto).toContain(RELATO.whatHappened);
    expect(texto).toContain(RELATO.expected!);
  });

  it("leva as considerações do Admin Master", () => {
    expect(texto).toContain("Acontece só na Cambé.");
  });

  it("leva o contexto que o sistema coletou — inclusive o navegador", () => {
    // O `user_agent` era gravado e nunca lido; é aqui que ele serve.
    expect(texto).toContain("/agenda");
    expect(texto).toContain("0.229.0");
    expect(texto).toContain("Risarte Cambé");
    expect(texto).toContain("Recepcionista");
    expect(texto).toContain("1a2b3c");
    expect(texto).toContain("Edg/141");
  });

  it("⚠️ NÃO leva o nome de quem relatou", () => {
    // Decisão do desenho: a função e a unidade dizem tudo o que importa para
    // consertar. O nome é dado pessoal que viajaria para fora do sistema sem
    // ajudar em nada. Se este teste cair, alguém acrescentou o nome ao texto.
    expect(texto).not.toContain("Maria da Silva");
    expect(texto).not.toContain("Maria");
  });

  it("a data sai no horário de Brasília, não em UTC", () => {
    // 17:32Z é 14:32 aqui. Se sair 17:32, o fuso voltou.
    expect(texto).toContain("14:32");
  });

  it("campo vazio não vira a palavra 'null' no texto", () => {
    const magro = montarBriefing(
      { ...RELATO, screen: null, errorDigest: null, userAgent: null, expected: null },
      "corrigir",
      ""
    );
    expect(magro).not.toContain("null");
    expect(magro).toContain("(não informado)");
  });
});

describe("os dois objetivos pedem coisas diferentes", () => {
  it("corrigir manda CONFIRMAR que é defeito antes de mexer", () => {
    // É a instrução que impede "consertar" o sistema fazendo o combinado.
    const t = montarBriefing(RELATO, "corrigir", "");
    expect(t).toContain("confirme que o defeito EXISTE");
    expect(t).toContain("em vez de mudar o comportamento");
  });

  it("responder pede o texto pronto, na linguagem de quem vai ler", () => {
    const t = montarBriefing(RELATO, "responder", "");
    expect(t).toContain("Recepcionista");
    expect(t).toContain("sem jargão");
    expect(t).toContain("pronto para eu colar");
    expect(t).not.toContain("Diagnostique a causa e corrija.");
  });
});
