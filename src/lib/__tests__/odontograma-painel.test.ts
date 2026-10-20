import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O painel chama ações do servidor e o roteador do Next: aqui só se DESENHA.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/(app)/prontuarios/[id]/odontograma-actions", () => ({
  decidirSugestoes: vi.fn(),
  desfazerSugestao: vi.fn(),
  finalizarDiagnostico: vi.fn(),
  guardarDenticao: vi.fn(),
  marcarNoOdontograma: vi.fn(),
  sugerirNoOdontograma: vi.fn(),
}));

const { PainelDoDiagnostico } = await import("@/components/odontograma/painel-do-diagnostico");
type Dados = Parameters<typeof PainelDoDiagnostico>[0]["dados"];
type Achado = NonNullable<Dados["achados"]>[number];

const achado = (p: Partial<Achado>): Achado => ({
  id: "a1",
  evaluationId: "r1",
  dente: "16",
  faces: ["O"],
  situacao: "C",
  acao: "mark",
  retira: null,
  origem: "suggestion",
  adendo: false,
  motivoDoAdendo: null,
  status: "suggested",
  ajustadoDe: null,
  observacao: null,
  criadoPor: "coord",
  criadoEm: "2026-10-20T10:00:00Z",
  decididoPor: null,
  decididoEm: null,
  motivoDaDecisao: null,
  ...p,
});

const dados = (achados: Achado[] | null, finalizadoEm: string | null = null): Dados => ({
  nomes: { "16": "Primeiro Molar Superior Direito" },
  dentes: { "16": { dentition: "permanent", group: "molar" } },
  faces: { "16": ["V", "M", "D", "O", "P"] },
  situacoes: [
    { code: "C", name: "Cariado", appliesTo: "face", usage: "finding", symbol: "C", isActive: true, sortOrder: 1 },
  ],
  regioes: [],
  denticao: "permanente",
  motivoDaDenticao: "Dentição sugerida pela idade (30 anos).",
  achados,
  rodadas: [
    { id: "r1", rotulo: "Avaliação 1", clinicId: "u1", clinicName: "Unidade", aberta: !finalizadoEm, finalizadoEm, finalizadoPor: finalizadoEm ? "Planner" : null },
  ],
  pessoas: { coord: "Coordenador de Teste" },
});

const desenhar = (modo: "sugerir" | "definir" | "leitura", d: Dados, euId = "coord") =>
  renderToStaticMarkup(
    createElement(PainelDoDiagnostico, { clientId: "c1", modo, clinicId: "u1", dados: d, euId, podeMudarDenticao: modo !== "leitura" })
  );

describe("o painel do diagnóstico — o que cada modo mostra", () => {
  it("definir: a pendente traz Aceitar / Ajustar / Rejeitar, e Finalizar fica DESABILITADO", () => {
    const html = desenhar("definir", dados([achado({})]), "planner");
    expect(html).toContain("Sugestões a definir (1)");
    expect(html).toContain("Aceitar todas");
    for (const b of ["Aceitar", "Ajustar", "Rejeitar"]) expect(html).toContain(b);
    expect(html).toContain("sugerido por Coordenador de Teste");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Finalizar diagnóstico<\/button>/);
    expect(html).toContain("Para finalizar, decida as 1 sugestões pendentes desta rodada.");
  });

  it("definir sem pendente: Finalizar habilitado", () => {
    const html = desenhar("definir", dados([achado({ status: "defined", decididoEm: "2026-10-20T11:00:00Z" })]), "planner");
    expect(html).not.toContain("Sugestões a definir");
    // (a classe do botão tem "disabled:opacity-50": procura o ATRIBUTO)
    const botao = html.match(/<button[^>]*>Finalizar diagnóstico<\/button>/)?.[0] ?? "";
    expect(botao).not.toBe("");
    expect(botao).not.toContain('disabled=""');
  });

  it("retirada pendente: aceita ou rejeita — não se ajusta", () => {
    const html = desenhar("definir", dados([achado({ acao: "remove", retira: "x" })]), "planner");
    expect(html).toContain("Rejeitar");
    expect(html).not.toContain("Ajustar");
  });

  it("rodada finalizada mostra quem e quando, e não oferece Finalizar", () => {
    const html = desenhar("definir", dados([], "2026-10-20T19:06:00Z"), "planner");
    expect(html).toContain("Finalizado em");
    expect(html).toContain("por Planner");
    expect(html).not.toContain("Finalizar diagnóstico");
  });

  it("sugerir: só as MINHAS pendentes, com Desfazer; nada de decidir", () => {
    const html = desenhar("sugerir", dados([achado({}), achado({ id: "a2", criadoPor: "outro" })]));
    expect(html).toContain("Minhas sugestões esperando o Planner (1)");
    expect(html).toContain("Desfazer");
    expect(html).not.toContain("Aceitar");
    expect(html).not.toContain("Finalizar diagnóstico");
  });

  it("leitura: nem toque nos dentes, nem botão de gravar", () => {
    const html = desenhar("leitura", dados([achado({})]));
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("Desfazer");
    expect(html).not.toContain("Aceitar");
    expect(html).not.toContain("Toque nos dentes");
  });

  it("banco sem a 0310: diz que não está disponível em vez de desenhar vazio como se não houvesse nada", () => {
    expect(desenhar("leitura", dados(null))).toContain("ainda não está disponível neste ambiente");
  });
});
