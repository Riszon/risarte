import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Achado, SituacaoDoDente } from "@/lib/odontograma/diagnostico";
import type { RegraDoPlano } from "@/lib/odontograma/plano";
import { achadosAte, sessoesNoDia, type SessaoComHistorico } from "@/lib/odontograma/execucao";
import { fimDoDia, marcasNoDia } from "@/lib/odontograma/historico";
import { agruparAdendos, anotacaoTrancada } from "@/lib/prontuario/evolucao";
import { ordenarLinhaDoTempo, porDia, prontuarioVencido, type EventoClinico } from "@/lib/prontuario/linha-do-tempo";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("J1 — a evolução tranca", () => {
  const nota = (p: Partial<{ id: string; appointmentId: string | null; createdAt: string; addendumOf: string | null }>) => ({
    id: "n", appointmentId: null, createdAt: "2026-10-21T13:00:00Z", addendumOf: null, ...p,
  });
  it("do atendimento: tranca quando ele é concluído (e só então)", () => {
    expect(anotacaoTrancada(nota({ appointmentId: "a1" }), new Set(["a1"]), "2026-10-21")).toBe(true);
    expect(anotacaoTrancada(nota({ appointmentId: "a1" }), new Set(), "2026-10-30")).toBe(false);
  });
  it("sem atendimento: corrige no dia (do Brasil), tranca no seguinte", () => {
    expect(anotacaoTrancada(nota({}), new Set(), "2026-10-21")).toBe(false);
    expect(anotacaoTrancada(nota({}), new Set(), "2026-10-22")).toBe(true);
    // 23h30 de 21/10 no Brasil = 02h30Z de 22/10: ainda é o dia 21
    expect(anotacaoTrancada(nota({ createdAt: "2026-10-22T02:30:00Z" }), new Set(), "2026-10-21")).toBe(false);
    // …e no dia 22 ela já está trancada (em UTC pareceria escrita "hoje")
    expect(anotacaoTrancada(nota({ createdAt: "2026-10-22T02:30:00Z" }), new Set(), "2026-10-22")).toBe(true);
  });
  it("o adendo nasce trancado", () => {
    expect(anotacaoTrancada(nota({ addendumOf: "x" }), new Set(), "2026-10-21")).toBe(true);
  });
  it("os adendos vão para baixo da original, em ordem; os órfãos ficam de fora", () => {
    const g = agruparAdendos([
      nota({ id: "o1", createdAt: "2026-10-20T10:00:00Z" }),
      nota({ id: "a2", addendumOf: "o1", createdAt: "2026-10-21T12:00:00Z" }),
      nota({ id: "a1", addendumOf: "o1", createdAt: "2026-10-21T11:00:00Z" }),
      nota({ id: "o2" }),
      nota({ id: "orfao", addendumOf: "sumiu" }),
    ]);
    expect(g.map((x) => [x.original.id, x.adendos.map((a) => a.id)])).toEqual([["o1", ["a1", "a2"]], ["o2", []]]);
  });
});

describe("J2 — o odontograma de um dia do passado", () => {
  const sit = (code: string, appliesTo: SituacaoDoDente["appliesTo"], aTratar = false): SituacaoDoDente => ({
    code, name: code, appliesTo, usage: "both", symbol: code, isActive: true, sortOrder: 1, aTratar,
  });
  const situacoes = [sit("C", "face", true), sit("RZ-SELANTE", "face")];
  const regras: Record<string, RegraDoPlano> = {
    sel: { nivel: "face", facesMin: 1, facesMax: 1, facesFixas: [], denticao: "both", grupos: [], impede: [], exige: [], efeito: "RZ-SELANTE" },
  };
  const carie: Achado = {
    id: "c", evaluationId: "r", dente: "16", faces: ["O"], situacao: "C", acao: "mark", retira: null, origem: "direct",
    adendo: false, motivoDoAdendo: null, status: "defined", ajustadoDe: null, observacao: null, criadoPor: null,
    criadoEm: "2026-10-01T12:00:00Z", decididoPor: null, decididoEm: "2026-10-01T12:00:00Z", motivoDaDecisao: null,
  };
  const sessao = (p: Partial<SessaoComHistorico>): SessaoComHistorico => ({
    sessionId: "s", itemId: "i", procedureId: "sel", status: "done", doneAt: "2026-10-10T15:00:00Z",
    toothCode: "16", faceCodes: ["O"], regionCode: null, createdAt: "2026-10-05T12:00:00Z", registrosFeita: [], ...p,
  });
  it("o fim do dia é 23:59:59 no Brasil", () => {
    expect(fimDoDia("2026-10-10")).toBe("2026-10-11T02:59:59.999Z");
  });
  it("antes de existir o achado, nada; depois, a cárie; depois do selante, o selante (e a cárie tratada sai)", () => {
    const h = [sessao({})];
    expect(marcasNoDia("2026-09-30", [carie], situacoes, h, regras)).toEqual([]);
    expect(marcasNoDia("2026-10-05", [carie], situacoes, h, regras).map((m) => m.codigo)).toEqual(["C"]);
    expect(marcasNoDia("2026-10-10", [carie], situacoes, h, regras).map((m) => m.codigo)).toEqual(["RZ-SELANTE"]);
  });
  it("sessão que ainda não existia não conta; a que existia e não estava feita deixa o item por fazer", () => {
    expect(sessoesNoDia([sessao({ createdAt: "2026-10-20T00:00:00Z" })], fimDoDia("2026-10-10"))).toEqual([]);
    const [s] = sessoesNoDia([sessao({})], fimDoDia("2026-10-08"));
    expect(s).toMatchObject({ status: "pending", doneAt: null });
  });
  it("a refação apagou a data da sessão: o registro do atendimento ainda prova que foi feita naquele dia", () => {
    const refeita = sessao({ status: "pending", doneAt: null, registrosFeita: ["2026-10-10T15:00:00Z"] });
    expect(marcasNoDia("2026-10-12", [carie], situacoes, [refeita], regras).map((m) => m.codigo)).toEqual(["RZ-SELANTE"]);
    // e hoje (sem novo "feita") ela não conta como feita pela data da sessão — só pelo registro
    expect(sessoesNoDia([refeita], fimDoDia("2026-10-09"))[0].status).toBe("pending");
  });
  it("cancelada continua cancelada", () => {
    expect(sessoesNoDia([sessao({ status: "cancelled" })], fimDoDia("2026-10-30"))[0].status).toBe("cancelled");
  });
  it("os achados até o dia", () => {
    expect(achadosAte([carie], fimDoDia("2026-09-30"))).toEqual([]);
    expect(achadosAte([carie], fimDoDia("2026-10-01"))).toHaveLength(1);
  });
});

describe("J2 — a linha do tempo", () => {
  const e = (quando: string, titulo: string): EventoClinico => ({ quando, tipo: "evolucao", titulo });
  it("mais novo primeiro, empate na ordem de chegada, data inválida fora", () => {
    const l = ordenarLinhaDoTempo([e("2026-10-01T10:00:00Z", "a"), e("2026-10-02T10:00:00Z", "b"), e("x", "ruim"), e("2026-10-02T10:00:00Z", "c")]);
    expect(l.map((x) => x.titulo)).toEqual(["b", "c", "a"]);
  });
  it("por dia do Brasil", () => {
    const d = porDia([e("2026-10-02T01:00:00Z", "noite de 1º"), e("2026-10-02T12:00:00Z", "dia 2")]);
    expect(d.map((x) => [x.dia, x.eventos.map((y) => y.titulo)])).toEqual([["2026-10-02", ["dia 2"]], ["2026-10-01", ["noite de 1º"]]]);
  });
});

describe("J3 — o prontuário completo", () => {
  it("o link vale 24 horas", () => {
    expect(prontuarioVencido("2026-10-21T10:00:00Z", new Date("2026-10-22T09:59:00Z"))).toBe(false);
    expect(prontuarioVencido("2026-10-21T10:00:00Z", new Date("2026-10-22T10:01:00Z"))).toBe(true);
  });
  it("no banco: só Admin e Gerente geram, com motivo; o registro não muda", () => {
    const sql = ler("supabase/migrations/0315_prontuario_adendo_e_historico.sql");
    expect(sql).toContain("or public.has_role_in_clinic(v_clinic, array['unit_manager']::public.user_role[]),");
    expect(sql).toContain("raise exception 'EXPORT_NOTE_REQUIRED';");
    expect(sql).toContain("raise exception 'EXPORT_LOCKED';");
    expect(sql).toContain("select public.audit_attach_all();");
  });
  it("na tela: o link carrega só o id do registro; a auditoria leva só o código do motivo", () => {
    const acao = ler("src/app/(app)/prontuarios/[id]/prontuario-completo-actions.ts");
    expect(acao).toContain('details: { client_id: input.clientId, motivo: input.motivo }');
    const botao = ler("src/app/(app)/prontuarios/[id]/prontuario-completo-botao.tsx");
    expect(botao).toContain("const url = `/prontuario-completo/${r.id}`;");
    expect(botao).not.toMatch(/prontuario-completo\/\$\{[^}]*\}\?/);
  });
});

describe("J1 no banco e na tela", () => {
  const sql = ler("supabase/migrations/0315_prontuario_adendo_e_historico.sql");
  it("a tranca e o adendo", () => {
    expect(sql).toContain("(select a.attendance = 'done' from public.appointments a where a.id = p_appointment), false)");
    expect(sql).toContain("raise exception 'NOTE_STILL_OPEN';");
    expect(sql).toContain("addendum_of is null\n    and addendum_reason is null");
  });
  it("documento e anamnese não mudam", () => {
    expect(sql).toContain("drop policy if exists \"clinical_documents_update\" on public.clinical_documents;");
    expect(sql).toContain("raise exception 'ANAMNESIS_LOCKED';");
  });
  it("a ficha lê as colunas novas à parte (o código chega antes da 0315)", () => {
    const ficha = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(ficha).toContain('.select("id, addendum_of, addendum_reason")');
    expect(ficha).toContain("trancada: com0315 ? anotacaoTrancada(r, concluidos, hojeBr) : false,");
  });
});
