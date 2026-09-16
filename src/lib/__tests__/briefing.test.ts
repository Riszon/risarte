import { describe, expect, it } from "vitest";
import { montarBriefing } from "@/app/(app)/problemas/preparar-briefing";
import type { MensagemDeRelato, Relato } from "@/lib/system-reports";

const RELATO: Relato = {
  id: "abc",
  code: "OC-00012",
  kind: "erro",
  severity: "alta",
  title: "A agenda não deixa marcar no sábado",
  whatHappened: "Escolhi sábado e o sistema disse que a unidade está fechada.",
  expected: "Que deixasse marcar, porque atendemos sábado agora.",
  screen: "/agenda",
  module: "agenda",
  appVersion: "0.229.0",
  errorDigest: "1a2b3c",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Edg/141",
  status: "aberto",
  answer: null,
  answeredAt: null,
  resolvedVersion: null,
  createdAt: "2026-09-07T17:32:00.000Z",
  statusChangedAt: null,
  closedAt: null,
  firstResponseAt: null,
  reopenedCount: 0,
  reporterRole: "Recepcionista",
  reporterName: "Maria da Silva",
  clinicId: "c1",
  clinicName: "Risarte Cambé",
  meu: false,
  respostaLida: false,
  respostas: 0,
  ultimaFalaDoRelator: false,
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

describe("a conversa entra no briefing (0256)", () => {
  const msg = (p: Partial<MensagemDeRelato>): MensagemDeRelato => ({
    id: String(p.seq),
    seq: 1,
    kind: "resposta",
    body: null,
    statusFrom: null,
    statusTo: null,
    createdAt: "2026-09-08T12:00:00.000Z",
    authorName: "Maria da Silva",
    doRelator: false,
    ...p,
  });
  const conversa = [
    msg({ seq: 1, kind: "situacao", statusTo: "resolvido", authorName: "Jeferson" }),
    msg({ seq: 2, kind: "resposta", body: "Liberei o sábado.", authorName: "Jeferson" }),
    msg({ seq: 3, kind: "reabertura", body: "Continua recusando às 8h.", doRelator: true }),
  ];
  const t = montarBriefing({ ...RELATO, reopenedCount: 1 }, "corrigir", "", conversa);

  it("leva cada fala e a mudança de situação, na ordem", () => {
    const a = t.indexOf("situação mudou para: Resolvido");
    const b = t.indexOf("Liberei o sábado.");
    const c = t.indexOf("Continua recusando às 8h.");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("a reabertura aparece como correção que NÃO funcionou", () => {
    expect(t).toContain("REABRIU (a solução não funcionou)");
    expect(t).toContain("Reaberto: 1 vez");
  });

  it("⚠️ nenhum nome viaja na conversa — nem de quem relatou, nem do suporte", () => {
    expect(t).not.toContain("Maria");
    expect(t).not.toContain("Jeferson");
  });

  it("sem conversa, o bloco não aparece", () => {
    expect(montarBriefing(RELATO, "corrigir", "")).not.toContain("A CONVERSA ATÉ AQUI");
  });

  it("leva a parte do sistema", () => {
    expect(t).toContain("Parte do sistema: Agenda e Atendimento");
  });
});
