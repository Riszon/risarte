import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  descricaoDoAchado,
  diagnosticoADefinir,
  marcasAtuais,
  marcasDoDesenho,
  mensagemDoDiagnostico,
  montarItens,
  pendentes,
  podeDefinirOdontograma,
  podeFinalizar,
  podeSugerirOdontograma,
  situacoesQueCabem,
  denticaoDoBanco,
  denticaoParaOBanco,
  type Achado,
  type SituacaoDoDente,
} from "@/lib/odontograma/diagnostico";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const S = (code: string, appliesTo: SituacaoDoDente["appliesTo"], usage: SituacaoDoDente["usage"] = "finding", isActive = true): SituacaoDoDente => ({
  code,
  name: code,
  appliesTo,
  usage,
  symbol: code.slice(0, 2),
  isActive,
  sortOrder: 0,
});
const SITUACOES = [
  S("C", "face"),
  S("R", "face", "both"),
  S("A", "whole_tooth", "both"),
  S("RZ-ENDO", "root", "both"),
  S("RZ-COROA", "crown", "both"),
  S("RZ-EFEITO", "crown", "effect"),
  S("RZ-OFF", "face", "finding", false),
];

let seq = 0;
const A = (p: Partial<Achado>): Achado => ({
  id: p.id ?? `f${++seq}`,
  evaluationId: "r1",
  dente: "16",
  faces: [],
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

describe("diagnóstico — a situação atual é CÁLCULO", () => {
  const def = A({ id: "m1", status: "defined", decididoEm: "2026-10-20T12:00:00Z", faces: ["O"] });
  const rej = A({ id: "m2", status: "rejected", decididoEm: "2026-10-20T12:00:00Z" });
  const pend = A({ id: "m3" });
  const ret = A({ id: "m4", acao: "remove", retira: "m1", status: "defined", decididoEm: "2026-10-25T09:00:00Z", origem: "direct" });

  it("vale só o definido (não o pendente, o rejeitado, o ajustado, o desfeito)", () => {
    expect(marcasAtuais([def, rej, pend]).map((a) => a.id)).toEqual(["m1"]);
    expect(pendentes([def, rej, pend]).map((a) => a.id)).toEqual(["m3"]);
  });

  it("a retirada definida tira a marca — a partir da data dela (o passado fica)", () => {
    expect(marcasAtuais([def, ret])).toEqual([]);
    expect(marcasAtuais([def, ret], "2026-10-21T00:00:00Z").map((a) => a.id)).toEqual(["m1"]);
    expect(marcasAtuais([def, ret], "2026-10-19T00:00:00Z")).toEqual([]); // antes de definida
  });

  it("retirada ainda pendente não tira nada", () => {
    expect(marcasAtuais([def, { ...ret, status: "suggested", decididoEm: null }]).map((a) => a.id)).toEqual(["m1"]);
  });

  it("o desenho: definida = existente; sugestão = tracejada; o filtro separa", () => {
    const todos = marcasDoDesenho([def, pend], SITUACOES);
    expect(todos.map((m) => `${m.situacao}`)).toEqual(["existente", "sugerido"]);
    expect(marcasDoDesenho([def, pend], SITUACOES, "definidos").map((m) => m.situacao)).toEqual(["existente"]);
    expect(marcasDoDesenho([def, pend], SITUACOES, "sugestoes").map((m) => m.situacao)).toEqual(["sugerido"]);
    // retirada pendente não vira marca no desenho
    expect(marcasDoDesenho([A({ acao: "remove", retira: "m1" })], SITUACOES)).toEqual([]);
  });
});

describe("diagnóstico — o que cabe no dente", () => {
  it("com face: só situações de face que são achado e estão ativas", () => {
    expect(situacoesQueCabem(SITUACOES, true).map((s) => s.code)).toEqual(["C", "R"]);
  });
  it("sem face: dente, coroa e raiz — nunca efeito puro", () => {
    expect(situacoesQueCabem(SITUACOES, false).map((s) => s.code).sort()).toEqual(["A", "RZ-COROA", "RZ-ENDO"]);
  });

  const faces = { "11": ["V", "M", "D", "I", "P"], "16": ["V", "M", "D", "O", "P"], "36": ["V", "M", "D", "O", "L"] };
  it("vários dentes: cada um fica com as faces que TEM", () => {
    const r = montarItens(["16", "36"], ["O", "P"], SITUACOES[0], faces);
    expect(r.problemas).toEqual([]);
    expect(r.itens).toEqual([
      { tooth: "16", faces: ["O", "P"], condition: "C", note: undefined },
      { tooth: "36", faces: ["O"], condition: "C", note: undefined },
    ]);
  });
  it("dente que não fica com face nenhuma vira problema (não grava calado)", () => {
    const r = montarItens(["11", "16"], ["O"], SITUACOES[0], faces);
    expect(r.itens.map((i) => i.tooth)).toEqual(["16"]);
    expect(r.problemas).toEqual(["O dente 11 não tem a face O."]);
  });
  it("situação do dente inteiro vai sem face", () => {
    expect(montarItens(["11"], ["V"], SITUACOES[2], faces).itens).toEqual([
      { tooth: "11", faces: [], condition: "A", note: undefined },
    ]);
  });
  it("sem dente, sem face", () => {
    expect(montarItens([], [], SITUACOES[0], faces).problemas).toEqual(["Escolha pelo menos um dente."]);
    expect(montarItens(["16"], [], SITUACOES[0], faces).problemas[0]).toContain("escolha a face");
  });
});

describe("diagnóstico — finalizar e o aviso do plano (E2)", () => {
  it("só finaliza sem pendente NAQUELA rodada", () => {
    const ach = [A({ evaluationId: "r1" }), A({ evaluationId: "r2", status: "defined", decididoEm: "x" })];
    expect(podeFinalizar(ach, { id: "r1", finalizadoEm: null })).toBe(false);
    expect(podeFinalizar(ach, { id: "r2", finalizadoEm: null })).toBe(true);
    expect(podeFinalizar(ach, { id: "r2", finalizadoEm: "2026-10-20" })).toBe(false);
  });
  it("a definir = pendente OU nada finalizado", () => {
    expect(diagnosticoADefinir([], [{ id: "r1", finalizadoEm: null }]).aDefinir).toBe(true);
    expect(diagnosticoADefinir([], [{ id: "r1", finalizadoEm: "2026" }]).aDefinir).toBe(false);
    expect(diagnosticoADefinir([A({})], [{ id: "r1", finalizadoEm: "2026" }])).toEqual({
      pendentes: 1,
      algumFinalizado: true,
      aDefinir: true,
    });
  });
});

describe("diagnóstico — quem faz (D6: o Admin que não é o titular só vê)", () => {
  it("sugere: Coordenador de uma unidade do cliente, ou o titular", () => {
    expect(podeSugerirOdontograma({ rolesByClinic: { u1: ["clinical_coordinator"] } }, ["u1"])).toBe(true);
    expect(podeSugerirOdontograma({ rolesByClinic: { u2: ["clinical_coordinator"] } }, ["u1"])).toBe(false);
    expect(podeSugerirOdontograma({ rolesByClinic: { u1: ["dentist"] } }, ["u1"])).toBe(false);
    expect(podeSugerirOdontograma({ rolesByClinic: {} }, ["u1"])).toBe(false); // Admin não titular
    expect(podeSugerirOdontograma({ isOwner: true, rolesByClinic: {} }, ["u1"])).toBe(true);
  });
  it("define: Planner ou titular", () => {
    expect(podeDefinirOdontograma({ rolesByClinic: {} }, true)).toBe(true);
    expect(podeDefinirOdontograma({ rolesByClinic: {} }, false)).toBe(false);
    expect(podeDefinirOdontograma({ isOwner: true, rolesByClinic: {} }, false)).toBe(true);
  });
});

describe("diagnóstico — textos", () => {
  it("dentição: banco em inglês, tela em português, ida e volta", () => {
    for (const d of ["permanente", "decidua", "mista"] as const) expect(denticaoDoBanco(denticaoParaOBanco(d))).toBe(d);
    expect(denticaoDoBanco(null)).toBeNull();
    expect(denticaoDoBanco("lixo")).toBeNull();
  });
  it("descrição da marca", () => {
    expect(descricaoDoAchado(A({ faces: ["O", "M"] }), "Cariado")).toBe("16 · Cariado (O, M)");
    expect(descricaoDoAchado(A({ acao: "remove" }), "Ausente")).toBe("16 · Retirar: Ausente");
  });
  it("todo recado da 0310 tem tradução; desconhecido não vira chute", () => {
    const sql = ler("supabase/migrations/0310_odontograma_diagnostico.sql");
    const codigos = [...new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]))];
    expect(codigos.length).toBeGreaterThan(15); // a régua achou o que conferir
    for (const c of codigos) expect(mensagemDoDiagnostico(c), c).not.toBeNull();
    expect(mensagemDoDiagnostico("erro qualquer")).toBeNull();
  });
});

describe("0310 — as travas estão no BANCO", () => {
  const sql = ler("supabase/migrations/0310_odontograma_diagnostico.sql");
  it("finalizar recusa com sugestão pendente na rodada", () => {
    expect(sql).toContain(
      "if exists (select 1 from public.tooth_findings\n              where evaluation_id = p_evaluation and status = 'suggested') then\n    raise exception 'PENDING_SUGGESTIONS';"
    );
  });
  it("marca não se apaga (só em cascata) e só a decisão de uma pendente muda", () => {
    expect(sql).toContain("if pg_trigger_depth() > 1 then return old; end if;\n    raise exception 'FINDING_NOT_DELETABLE';");
    expect(sql).toContain("if old.status <> 'suggested' then raise exception 'FINDING_LOCKED'; end if;");
    expect(sql).toContain("before update or delete on public.tooth_findings");
  });
  it("E1: rodada finalizada tranca considerações e mídias", () => {
    expect(sql).toContain("before insert or update or delete on public.clinical_notes");
    expect(sql).toContain("before insert or update or delete on public.clinical_media");
    expect(sql).toContain("before insert or update or delete on public.clinical_evaluations");
  });
  it("finalizar é só pela função (gravação direta na rodada recusa)", () => {
    expect(sql).toContain("coalesce(current_setting('risarte.odontogram_finalize', true), '') = 'on'");
    expect(sql).toContain("perform set_config('risarte.odontogram_finalize', 'on', true);");
  });
  it("D6 e quem sugere: titular ou Coordenador DA UNIDADE do cliente; define: titular ou Planner", () => {
    expect(sql).toContain("and p_clinic in (select public._client_clinic_ids(p_client))");
    expect(sql).toContain("select (select auth.uid()) is not null and (public.is_owner() or public.is_planner());");
    // o Admin Master sozinho não entra em nenhuma das duas
    const sugerir = sql.slice(sql.indexOf("function public._can_suggest_findings"), sql.indexOf("function public._can_define_findings"));
    expect(sugerir).not.toContain("is_admin_master");
  });
  it("D8: quem vê não inclui o Assistente comercial", () => {
    const ver = sql.slice(sql.indexOf("function public.can_view_odontogram"), sql.indexOf("function public._can_suggest_findings"));
    expect(ver).toContain("'clinical_coordinator', 'dentist', 'unit_manager', 'commercial_consultant'");
    expect(ver).not.toContain("commercial_assistant");
  });
  it("as tabelas novas entram na auditoria", () => {
    expect(sql.trimEnd().endsWith("select public.audit_attach_all();")).toBe(true);
  });
});

describe("OD2 — nas telas", () => {
  it("apagar mídia confere a trava ANTES de remover o arquivo (senão o arquivo some e a linha fica)", () => {
    const acoes = ler("src/app/(app)/prontuarios/[id]/clinical-actions.ts");
    const corpo = acoes.slice(acoes.indexOf("export async function deleteClinicalMedia"));
    const trava = corpo.indexOf("if (await rodadaTrancada(media.evaluation_id))");
    const remove = corpo.indexOf(".storage.from(CLINICAL_BUCKET).remove");
    expect(trava).toBeGreaterThan(0);
    expect(remove).toBeGreaterThan(trava);
  });
  it("editar consideração confere a trava ANTES de gravar a revisão", () => {
    const acoes = ler("src/app/(app)/prontuarios/[id]/clinical-actions.ts");
    const corpo = acoes.slice(acoes.indexOf("export async function editClinicalNote"));
    expect(corpo.indexOf("if (await rodadaTrancada(note.evaluation_id))")).toBeGreaterThan(0);
    expect(corpo.indexOf('from("clinical_note_revisions")')).toBeGreaterThan(
      corpo.indexOf("if (await rodadaTrancada(note.evaluation_id))")
    );
  });
  it("os botões de editar/apagar somem na rodada trancada", () => {
    expect(ler("src/app/(app)/prontuarios/[id]/media-gallery.tsx").match(/canEdit && !m\.locked/g)).toHaveLength(3);
    expect(ler("src/app/(app)/prontuarios/[id]/clinical-section.tsx")).toContain("{canEdit && !n.locked && (");
    expect(ler("src/app/(app)/avaliacao/[clientId]/clinical-tools.tsx")).toContain("{canEdit && !n.locked && (");
  });
  it("o Coordenador sugere só na avaliação/reavaliação; o Planner define; a ficha só lê", () => {
    expect(ler("src/app/(app)/avaliacao/[clientId]/page.tsx")).toContain(
      "const podeSugerir = Boolean(flowKind) && podeSugerirOdontograma(session, [clinicId]);"
    );
    expect(ler("src/app/(app)/planejamento/[clientId]/page.tsx")).toContain('modo={podeDefinir ? "definir" : "leitura"}');
    const ficha = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(ficha).toContain('modo="leitura"\n                  dados={odontograma}');
  });
  it("E4: a fila tem o selo e o filtro, e some quando a leitura falha", () => {
    const fila = ler("src/app/(app)/planejamento/page.tsx");
    expect(fila).toContain('.eq("status", "suggested")');
    expect(fila).toContain("{leSug.ok && (");
    expect(fila).toContain("(!soSugestoes || sugestoesPorCliente.has(x.client.id))");
  });
});
