import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectedSession } from "@/lib/planning";
import {
  itensPelaSequencia,
  textoDosTotais,
  totaisDoTratamento,
} from "@/lib/sequencia-do-plano";

// OC-00006 e OC-00007 (30/10/2026). O resumo dizia 19 sessões e 9h15; a sequência
// montada pelo Planner dava 6 atendimentos e 7h15. O número que o Coordenador
// aprova e o Consultor vende é o da sequência.

const sessao = (
  itemId: string,
  sessionIndex: number,
  plannedMinutes: number | null,
  groupNo: number | null,
  blockOrder: number | null = 0
): ProjectedSession => ({
  itemId,
  sessionIndex,
  procedureName: itemId,
  name: `Sessão ${sessionIndex}`,
  plannedMinutes,
  groupNo,
  blockOrder,
  providerId: null,
});

const itens = [
  { id: "a", plannedSessions: 1, plannedMinutes: 60 },
  { id: "b", plannedSessions: 1, plannedMinutes: 60 },
  { id: "c", plannedSessions: 2, plannedMinutes: 120 },
];
const juntas = [
  sessao("a", 1, 30, 1),
  sessao("b", 1, 30, 1),
  sessao("c", 1, 45, null, 1),
  sessao("c", 2, 45, null, 2),
];

describe("os totais saem da sequência", () => {
  it("sessões juntas contam um atendimento; vale o tempo ajustado, não o do item", () => {
    expect(totaisDoTratamento(itens, { confirmadaEm: "x", sessions: juntas }, true)).toEqual({
      atendimentos: 3,
      sessoes: 4,
      minutos: 150,
      estimativa: false,
    });
  });

  it("o que o cliente desmarcou sai; o atendimento conjunto só some quando esvazia", () => {
    const opcao = { confirmadaEm: "x", sessions: juntas };
    const semA = totaisDoTratamento(itens, opcao, true, new Set(["a"]));
    expect(semA).toMatchObject({ atendimentos: 3, sessoes: 3, minutos: 120 });
    const semAeB = totaisDoTratamento(itens, opcao, true, new Set(["a", "b"]));
    expect(semAeB).toMatchObject({ atendimentos: 2, sessoes: 2, minutos: 90 });
  });

  it("sem confirmação, no plano que ainda se edita, é estimativa", () => {
    expect(totaisDoTratamento(itens, { confirmadaEm: null, sessions: juntas }, true).estimativa).toBe(true);
  });

  it("plano aprovado com a ordem gravada não é estimativa; sem a ordem, é", () => {
    expect(totaisDoTratamento(itens, { confirmadaEm: null, sessions: juntas }, false).estimativa).toBe(false);
    const semOrdem = [sessao("a", 1, 30, null, null)];
    expect(totaisDoTratamento(itens, { confirmadaEm: null, sessions: semOrdem }, false).estimativa).toBe(true);
  });

  it("sem acesso à sequência, cai nos itens e avisa que é estimativa", () => {
    expect(totaisDoTratamento(itens, { confirmadaEm: null, sessions: [] }, false)).toEqual({
      atendimentos: null,
      sessoes: 4,
      minutos: 240,
      estimativa: true,
    });
    expect(totaisDoTratamento(itens, undefined, false, new Set(["c"]))).toMatchObject({
      sessoes: 2,
      minutos: 120,
    });
  });
});

describe("o texto dos totais", () => {
  it("o caso do relato", () => {
    expect(
      textoDosTotais({ atendimentos: 6, sessoes: 19, minutos: 435, estimativa: false })
    ).toBe("6 atendimentos · 19 sessões · 7h15 de cadeira");
  });
  it("diz quando é estimativa e usa o singular", () => {
    expect(textoDosTotais({ atendimentos: 1, sessoes: 1, minutos: 30, estimativa: true })).toBe(
      "1 atendimento · 1 sessão · 30 min de cadeira · estimativa"
    );
  });
  it("nada planejado não vira texto, nem um 'estimativa' solto", () => {
    expect(textoDosTotais({ atendimentos: 0, sessoes: 0, minutos: 0, estimativa: true })).toBeNull();
    expect(textoDosTotais({ atendimentos: null, sessoes: 0, minutos: 0, estimativa: true })).toBeNull();
  });
});

describe("cada item pelo que tem na sequência", () => {
  it("troca sessões e tempo; item sem sessão fica como está", () => {
    const [a, , c] = itensPelaSequencia(itens, [sessao("a", 1, 30, 1), sessao("c", 1, 45, null), sessao("c", 2, 45, null)]);
    expect(a).toMatchObject({ plannedSessions: 1, plannedMinutes: 30 });
    expect(c).toMatchObject({ plannedSessions: 2, plannedMinutes: 90 });
    const [, b] = itensPelaSequencia(itens, [sessao("a", 1, 30, 1)]);
    expect(b).toBe(itens[1]);
  });
  it("sessão sem tempo não apaga o tempo do item", () => {
    const [a] = itensPelaSequencia(itens, [sessao("a", 1, null, null)]);
    expect(a.plannedMinutes).toBe(60);
  });
});

const ler = (c: string) => readFileSync(join(process.cwd(), c), "utf8").replace(/\r\n/g, "\n");

describe("régua: as telas usam o mesmo número", () => {
  it("cartões do plano, resumo do cockpit, negociação e apresentação", () => {
    for (const arquivo of [
      "src/app/(app)/prontuarios/[id]/planning-section.tsx",
      "src/app/(app)/planejamento/[clientId]/treatment-summary.tsx",
      "src/app/(app)/apresentacao/[clientId]/negotiation-panel.tsx",
      "src/app/(app)/apresentacao/[clientId]/presentation-data.ts",
    ]) {
      expect(ler(arquivo), arquivo).toMatch(/totaisDoTratamento\(/);
    }
  });
  it("a negociação recalcula com o que o cliente desmarcou", () => {
    expect(ler("src/app/(app)/apresentacao/[clientId]/negotiation-panel.tsx")).toMatch(
      /totaisDoTratamento\(option\.items, \{ confirmadaEm: null, sessions: option\.sessions \}, false, excluded\)/
    );
  });
  it("para aprovar, a sequência vem aberta e o odontograma aparece sem o preço", () => {
    const secao = ler("src/app/(app)/prontuarios/[id]/planning-section.tsx");
    expect(secao).toMatch(/aberta=\{canReview && plan\.status === "submitted"\}/);
    expect(secao).toMatch(/<ProgramSavings program=\{program\} \/>\n\s+\{odontogramaDaOpcao\}/);
    expect(ler("src/app/(app)/avaliacao/[clientId]/page.tsx")).toMatch(/odonto=\{odontoDoPlano\}/);
  });
  it("a aba Plano da ficha abre para o Consultor que só tem a sequência", () => {
    expect(ler("src/app/(app)/prontuarios/[id]/page.tsx")).toMatch(
      /\(planSummary \|\| canViewPlanning \|\| sequenciaDoConsultor\.length > 0\) && \(\s*<TabPanel id="plano"/
    );
  });
  it("o cockpit comercial conta os procedimentos sem opção principal e diz o que foi substituído", () => {
    const cockpit = ler("src/app/(app)/comercial/[clientId]/page.tsx");
    expect(cockpit).toMatch(/\(p\.options\.find\(\(o\) => o\.isPrimary\) \?\? p\.options\[0\]\)/);
    expect(cockpit).toMatch(/p\.supersededAt \? "Substituído"/);
  });
});
