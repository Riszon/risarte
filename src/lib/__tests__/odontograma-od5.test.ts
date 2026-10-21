import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { marcasDoDesenho, type Achado, type SituacaoDoDente } from "@/lib/odontograma/diagnostico";
import type { RegraDoPlano } from "@/lib/odontograma/plano";
import {
  achadosTratados,
  itensFeitos,
  localDaSessao,
  marcasDosFeitos,
  procedimentosFeitos,
  rotuloDaSessao,
  type ProcedimentoFeito,
  type SessaoDoOdontograma,
} from "@/lib/odontograma/execucao";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const sit = (code: string, appliesTo: SituacaoDoDente["appliesTo"], aTratar = false): SituacaoDoDente => ({
  code, name: code, appliesTo, usage: "both", symbol: code, isActive: true, sortOrder: 1, aTratar,
});
const situacoes = [
  sit("C", "face", true), sit("R", "face"), sit("E", "whole_tooth", true), sit("RZ-ENDOINS", "root", true),
  sit("RZ-FRATCOROA", "crown", true), sit("A", "whole_tooth"), sit("RZ-SELANTE", "face"), sit("RZ-ENDO", "root"),
  sit("RZ-COROA", "crown"), sit("RZ-IMPLANTE", "root"), sit("RZ-PFPILAR", "crown"), sit("RZ-PFPONTICO", "whole_tooth"),
];
const regra = (efeito: string | null, efeitoSeAusente: string | null = null): RegraDoPlano => ({
  nivel: "tooth", facesMin: null, facesMax: null, facesFixas: [], denticao: "both", grupos: [], impede: [], exige: [], efeito, efeitoSeAusente,
});
const regras: Record<string, RegraDoPlano> = {
  selante: regra("RZ-SELANTE"), canal: regra("RZ-ENDO"), coroa: regra("RZ-COROA"), exodontia: regra("A"),
  implante: regra("RZ-IMPLANTE"), ponte: regra("RZ-PFPILAR", "RZ-PFPONTICO"), radiografia: regra(null),
};
const sessao = (p: Partial<SessaoDoOdontograma>): SessaoDoOdontograma => ({
  sessionId: Math.random().toString(36).slice(2), itemId: "i1", procedureId: "selante", status: "done",
  doneAt: "2026-10-20T12:00:00Z", toothCode: "16", faceCodes: ["O"], regionCode: null, ...p,
});
const achado = (p: Partial<Achado>): Achado => ({
  id: Math.random().toString(36).slice(2), evaluationId: "r1", dente: "16", faces: ["O"], situacao: "C", acao: "mark",
  retira: null, origem: "direct", adendo: false, motivoDoAdendo: null, status: "defined", ajustadoDe: null,
  observacao: null, criadoPor: null, criadoEm: "2026-10-01T10:00:00Z", decididoPor: null,
  decididoEm: "2026-10-01T10:00:00Z", motivoDaDecisao: null, ...p,
});
const feito = (p: Partial<ProcedimentoFeito>): ProcedimentoFeito => ({
  itemId: "i1", dente: "16", faces: ["O"], efeito: "RZ-SELANTE", feitoEm: "2026-10-20T12:00:00Z", ...p,
});

describe("H1 — o procedimento conta como feito na ÚLTIMA sessão", () => {
  it("item de 2 sessões: com 1 feita não conta; com as 2, conta no dia da última", () => {
    const uma = [sessao({ itemId: "imp", doneAt: "2026-10-10T10:00:00Z" }), sessao({ itemId: "imp", status: "scheduled", doneAt: null })];
    expect(itensFeitos(uma).has("imp")).toBe(false);
    const duas = [sessao({ itemId: "imp", doneAt: "2026-10-10T10:00:00Z" }), sessao({ itemId: "imp", doneAt: "2026-10-18T10:00:00Z" })];
    expect(itensFeitos(duas).get("imp")).toBe("2026-10-18T10:00:00Z");
  });
  it("sessão cancelada não conta; item só com canceladas não é feito; sessão sem item fica de fora", () => {
    expect(itensFeitos([sessao({ itemId: "x" }), sessao({ itemId: "x", status: "cancelled", doneAt: null })]).has("x")).toBe(true);
    expect(itensFeitos([sessao({ itemId: "y", status: "cancelled", doneAt: null })]).has("y")).toBe(false);
    expect(itensFeitos([sessao({ itemId: null })]).size).toBe(0);
  });
  it("o efeito vem da regra; sem dente ou sem efeito não entra", () => {
    const f = procedimentosFeitos(
      [
        sessao({ itemId: "a", procedureId: "selante" }),
        sessao({ itemId: "b", procedureId: "radiografia", toothCode: "17" }),
        sessao({ itemId: "c", procedureId: "selante", toothCode: null, regionCode: "AS" }),
      ],
      regras,
      []
    );
    expect(f.map((x) => [x.itemId, x.efeito])).toEqual([["a", "RZ-SELANTE"]]);
  });
  it("prótese fixa em dente ausente vira pôntico (0308); com o dente presente, pilar", () => {
    const s = [sessao({ itemId: "p", procedureId: "ponte", toothCode: "46", faceCodes: [] })];
    expect(procedimentosFeitos(s, regras, [])[0].efeito).toBe("RZ-PFPILAR");
    expect(procedimentosFeitos(s, regras, [achado({ dente: "46", faces: [], situacao: "A" })])[0].efeito).toBe("RZ-PFPONTICO");
    // ausente retirado não conta
    const a = achado({ dente: "46", faces: [], situacao: "A" });
    const ret = achado({ acao: "remove", retira: a.id, dente: "46", situacao: "A", faces: [] });
    expect(procedimentosFeitos(s, regras, [a, ret])[0].efeito).toBe("RZ-PFPILAR");
  });
});

describe("H2 — o feito resolve o achado 'a tratar' do mesmo lugar", () => {
  it("mesma face: resolve; outra face: não", () => {
    const c = achado({ faces: ["O"] }), m = achado({ faces: ["M"] });
    const t = achadosTratados([c, m], [feito({})], situacoes);
    expect(t.has(c.id)).toBe(true);
    expect(t.has(m.id)).toBe(false);
  });
  it("achado decidido DEPOIS do feito continua valendo", () => {
    const depois = achado({ decididoEm: "2026-10-25T10:00:00Z" });
    expect(achadosTratados([depois], [feito({})], situacoes).size).toBe(0);
  });
  it("o que não pede tratamento (Restaurado) não sai", () => {
    expect(achadosTratados([achado({ situacao: "R" })], [feito({})], situacoes).size).toBe(0);
  });
  it("sem face, pelo alcance do efeito: dente inteiro → tudo; coroa → face e coroa; raiz → raiz", () => {
    const naFace = achado({ faces: ["O"] }), naCoroa = achado({ faces: [], situacao: "RZ-FRATCOROA" }),
      naRaiz = achado({ faces: [], situacao: "RZ-ENDOINS" }), dente = achado({ faces: [], situacao: "E" });
    const todos = [naFace, naCoroa, naRaiz, dente];
    const ids = (f: ProcedimentoFeito) => [...achadosTratados(todos, [f], situacoes).keys()].sort();
    expect(ids(feito({ faces: [], efeito: "A" }))).toEqual([naFace.id, naCoroa.id, naRaiz.id, dente.id].sort());
    expect(ids(feito({ faces: [], efeito: "RZ-COROA" }))).toEqual([naFace.id, naCoroa.id].sort());
    expect(ids(feito({ faces: [], efeito: "RZ-ENDO" }))).toEqual([naRaiz.id]);
  });
  it("outro dente não", () => {
    expect(achadosTratados([achado({ dente: "26" })], [feito({})], situacoes).size).toBe(0);
  });
});

describe("O desenho com a execução", () => {
  it("a cárie tratada sai; o efeito entra (azul, com símbolo e o dia)", () => {
    const m = marcasDoDesenho([achado({})], situacoes, "todos", [feito({})]);
    expect(m.map((x) => x.codigo)).toEqual(["RZ-SELANTE"]);
    expect(m[0]).toMatchObject({ situacao: "existente", feito: true, faces: ["O"], local: "face" });
    expect(m[0].nome).toContain("feito em 20/10/2026");
  });
  it("na mesma face, a cárie que AINDA vale vem antes do feito; o resto do diagnóstico depois", () => {
    const nova = achado({ decididoEm: "2026-10-25T10:00:00Z" }), r = achado({ situacao: "R", faces: ["M"] });
    expect(marcasDoDesenho([r, nova], situacoes, "todos", [feito({})]).map((x) => x.codigo)).toEqual(["C", "RZ-SELANTE", "R"]);
  });
  it("sem feitos, nada muda (as chamadas antigas)", () => {
    expect(marcasDoDesenho([achado({})], situacoes).map((x) => x.codigo)).toEqual(["C"]);
  });
  it("'Só sugestões' não mostra o feito", () => {
    expect(marcasDoDesenho([], situacoes, "sugestoes", [feito({})])).toEqual([]);
  });
  it("efeito de raiz e de dente inteiro marcam no lugar certo", () => {
    const [imp, ext] = marcasDosFeitos([feito({ faces: [], efeito: "RZ-IMPLANTE" }), feito({ faces: [], efeito: "A" })], situacoes);
    expect(imp.local).toBe("root");
    expect(ext.local).toBe("whole_tooth");
  });
});

describe("O dente na sessão", () => {
  it("rótulo do lugar e o nome da sessão com o lugar", () => {
    expect(localDaSessao({ toothCode: "16", faceCodes: ["O"], regionCode: null })).toBe("16 (O)");
    expect(localDaSessao({ toothCode: "46", faceCodes: [], regionCode: null })).toBe("Dente 46");
    expect(localDaSessao({ toothCode: null, faceCodes: [], regionCode: "AS" }, () => "Arcada superior")).toBe("Arcada superior");
    expect(localDaSessao({ toothCode: null, faceCodes: [], regionCode: null })).toBeNull();
    expect(rotuloDaSessao("Implante — Sessão 2 de 3", "Dente 46")).toBe("Implante — Dente 46 · Sessão 2 de 3");
    expect(rotuloDaSessao("Implante — Sessão 2 de 3", null)).toBe("Implante — Sessão 2 de 3");
  });
});

describe("O que está escrito no banco e nas telas", () => {
  const sql = ler("supabase/migrations/0314_odontograma_execucao.sql");
  it("H1 no banco: todas as sessões não canceladas concluídas", () => {
    expect(sql).toContain("and s.status <> 'cancelled'");
    expect(sql).toContain("having count(*) > 0 and bool_and(s.status = 'done')");
  });
  it("H2 no banco: só o a tratar, decidido antes do feito, no mesmo lugar", () => {
    expect(sql).toContain("where not (a.needs_treatment and exists (");
    expect(sql).toContain("where a.decided_at <= e.done_at");
  });
  it("AP65: as guardas não deixam o nulo passar", () => {
    expect(sql.match(/if not coalesce\(/g)).toHaveLength(2);
  });
  it("D6: nenhuma regra nova de evolução aceita o Admin sozinho", () => {
    const evolucao = sql.slice(sql.indexOf("-- 6) H4 + D6"));
    expect(evolucao).not.toContain("is_admin_master");
  });
  it("na tela: evolução e baixa seguem o titular, não o Admin", () => {
    const acoes = ler("src/app/(app)/prontuarios/[id]/clinical-progress-actions.ts");
    expect(acoes).toContain("Boolean(session.isOwner) ||");
    expect(acoes).not.toMatch(/const canWrite =\s*session\.isAdminMaster/);
    const painel = ler("src/app/(app)/atendimento/attendance-panel.tsx");
    expect(painel).toContain("canConcludeSessions(a) ? (");
    expect(painel).not.toContain("canConclude(a) && (isDentist || isAdmin)");
    const ficha = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(ficha).toContain("const escreveEvolucaoPeloPapel =\n    Boolean(session.isOwner) ||");
  });
  it("o achado lê a sessão (H3)", () => {
    expect(ler("src/lib/odontograma/diagnostico.ts")).toContain("treatment_session_id, tooth_code");
  });
});
