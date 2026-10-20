import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  conferirForma,
  conflitosDeSituacao,
  itensDoPlanoVigente,
  itensPorDente,
  marcasDoPlano,
  mensagemDoPlano,
  previstosNoDente,
  regioesDoProcedimento,
  rotuloDoLocal,
  type RegraDoPlano,
} from "@/lib/odontograma/plano";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const R = (p: Partial<RegraDoPlano>): RegraDoPlano => ({
  nivel: "tooth",
  facesMin: null,
  facesMax: null,
  facesFixas: [],
  denticao: "both",
  grupos: [],
  impede: [],
  exige: [],
  efeito: null,
  ...p,
});
// As regras de verdade do catálogo (0308), usadas no ensaio da 0311.
const SELANTE = R({ nivel: "face", facesMin: 1, facesMax: 1, facesFixas: ["O"], grupos: ["premolar", "molar", "deciduous_molar"], impede: ["A", "RZ-IMPLANTE", "RZ-COROA"] });
const IMPLANTE = R({ exige: ["A", "E"], impede: ["RZ-IMPLANTE"], efeito: "RZ-IMPLANTE" });
const REABERTURA = R({ exige: ["RZ-IMPLANTE"] });
const COROA_DECIDUO = R({ denticao: "deciduous" });
const RESTAURACAO_2F = R({ nivel: "face", facesMin: 2, facesMax: 2 });

const REF = {
  "11": { dentition: "permanent" as const, group: "incisor" },
  "16": { dentition: "permanent" as const, group: "molar" },
  "36": { dentition: "permanent" as const, group: "molar" },
  "55": { dentition: "deciduous" as const, group: "deciduous_molar" },
};
const FACES = { "11": ["V", "M", "D", "I", "P"], "16": ["V", "M", "D", "O", "P"], "36": ["V", "M", "D", "O", "L"], "55": ["V", "M", "D", "O", "P"] };

describe("plano por dente — FORMA (F1: o banco recusa; a tela avisa antes)", () => {
  it("selante: 1 face, a oclusal, só em posterior", () => {
    expect(conferirForma(SELANTE, "16", REF["16"], ["O"], FACES["16"])).toBeNull();
    expect(conferirForma(SELANTE, "16", REF["16"], ["O", "M"], FACES["16"])).toContain("1 face");
    expect(conferirForma(SELANTE, "16", REF["16"], ["M"], FACES["16"])).toContain("face O");
    expect(conferirForma(SELANTE, "16", REF["16"], [], FACES["16"])).toContain("1 face");
    expect(conferirForma(SELANTE, "11", REF["11"], ["I"], FACES["11"])).toContain("grupo de dentes");
  });
  it("face que o dente não tem; dente inteiro sem face; dentição", () => {
    expect(conferirForma(RESTAURACAO_2F, "36", REF["36"], ["O", "P"], FACES["36"])).toContain("não tem a face P");
    expect(conferirForma(IMPLANTE, "36", REF["36"], ["O"], FACES["36"])).toContain("não leva face");
    expect(conferirForma(COROA_DECIDUO, "16", REF["16"], [], FACES["16"])).toContain("decíduo");
    expect(conferirForma(COROA_DECIDUO, "55", REF["55"], [], FACES["55"])).toBeNull();
    expect(conferirForma(IMPLANTE, "99", undefined, [], [])).toContain("não existe");
  });
  it("F4: vários dentes = um item por dente; o que não cabe vira problema", () => {
    const r = itensPorDente(SELANTE, ["16", "36", "11"], ["O"], REF, FACES);
    expect(r.itens).toEqual([
      { tooth: "16", faces: ["O"] },
      { tooth: "36", faces: ["O"] },
    ]);
    expect(r.problemas).toHaveLength(1);
    expect(itensPorDente(IMPLANTE, [], [], REF, FACES).problemas).toEqual(["Escolha o(s) dente(s) no desenho."]);
    // procedimento de dente inteiro: as faces escolhidas não vão
    expect(itensPorDente(IMPLANTE, ["36"], ["O"], REF, FACES).itens).toEqual([{ tooth: "36", faces: [] }]);
  });
});

describe("plano por dente — SITUAÇÃO (F1: passa com motivo)", () => {
  it("impede: selante em dente ausente", () => {
    expect(conflitosDeSituacao(SELANTE, ["A"], [])).toEqual({ impede: ["A"], falta: [] });
    expect(conflitosDeSituacao(SELANTE, ["C"], [])).toEqual({ impede: [], falta: [] });
  });
  it("exige: vale o que EXISTE ou o que a mesma opção já PLANEJA", () => {
    expect(conflitosDeSituacao(IMPLANTE, [], []).falta).toEqual(["A", "E"]);
    expect(conflitosDeSituacao(IMPLANTE, ["A"], []).falta).toEqual([]);
    const regras = { imp: IMPLANTE, reab: REABERTURA };
    const itens = [{ id: "1", procedureId: "imp", toothCode: "36" }];
    expect(previstosNoDente(itens, regras, "36")).toEqual(["RZ-IMPLANTE"]);
    expect(previstosNoDente(itens, regras, "46")).toEqual([]);
    expect(previstosNoDente(itens, regras, "36", "1")).toEqual([]); // o próprio item não conta
    expect(conflitosDeSituacao(REABERTURA, [], previstosNoDente(itens, regras, "36")).falta).toEqual([]);
    expect(conflitosDeSituacao(REABERTURA, [], previstosNoDente(itens, regras, "46")).falta).toEqual(["RZ-IMPLANTE"]);
  });
});

describe("plano por dente — região, rótulo, desenho e o plano que vale", () => {
  const regioes = [{ code: "AS" }, { code: "AI" }, { code: "ASAI" }, { code: "S1" }, { code: "LIN" }];
  it("arcada só oferece as arcadas; região, as demais (inclusive tecido)", () => {
    expect(regioesDoProcedimento(R({ nivel: "arch" }), regioes).map((r) => r.code)).toEqual(["AS", "AI", "ASAI"]);
    expect(regioesDoProcedimento(R({ nivel: "region" }), regioes).map((r) => r.code)).toEqual(["S1", "LIN"]);
    expect(regioesDoProcedimento(R({ nivel: "tooth" }), regioes)).toEqual([]);
  });
  it("rótulo do lugar", () => {
    expect(rotuloDoLocal({ toothCode: "16", faceCodes: ["M", "O"], regionCode: null })).toBe("16 (M, O)");
    expect(rotuloDoLocal({ toothCode: "36", faceCodes: [], regionCode: null })).toBe("Dente 36");
    expect(rotuloDoLocal({ toothCode: null, faceCodes: [], regionCode: "S1" }, () => "Sextante 1")).toBe("Sextante 1");
    expect(rotuloDoLocal({ toothCode: null, faceCodes: [], regionCode: null })).toBeNull();
  });
  it("o vermelho: o que a opção planeja, com o símbolo do efeito", () => {
    const situacoes = [{ code: "RZ-IMPLANTE", name: "Implante", appliesTo: "root" as const, usage: "both" as const, symbol: "IM", isActive: true, sortOrder: 1 }];
    const m = marcasDoPlano(
      [
        { toothCode: "36", faceCodes: [], procedureId: "imp", description: "Implante" },
        { toothCode: "16", faceCodes: ["O"], procedureId: "sel", description: "Selante" },
        { toothCode: null, faceCodes: [], procedureId: "cons", description: "Consulta" },
      ],
      { imp: IMPLANTE, sel: SELANTE },
      situacoes
    );
    expect(m.map((x) => [x.dente, x.local, x.situacao, x.simbolo])).toEqual([
      ["36", "root", "planejado", "IM"],
      ["16", "face", "planejado", "P"],
    ]);
  });
  it("D4: o plano que vale é a versão aprovada não substituída; dele, a principal aprovada", () => {
    const planos = [
      { status: "draft", supersededAt: null, createdAt: "2026-10-22", options: [{ isPrimary: true, reviewStatus: "pending", items: ["rascunho"] }] },
      { status: "approved", supersededAt: null, createdAt: "2026-10-21", options: [
        { isPrimary: false, reviewStatus: "approved", items: ["alternativa"] },
        { isPrimary: true, reviewStatus: "approved", items: ["v2-principal"] },
      ] },
      { status: "approved", supersededAt: "2026-10-21", createdAt: "2026-10-20", options: [{ isPrimary: true, reviewStatus: "approved", items: ["v1"] }] },
    ];
    expect(itensDoPlanoVigente(planos)).toEqual(["v2-principal"]);
    expect(itensDoPlanoVigente([planos[0]])).toEqual(["rascunho"]);
    expect(itensDoPlanoVigente([planos[2]])).toEqual([]);
  });
});

describe("0311 — as travas estão no BANCO", () => {
  const sql = ler("supabase/migrations/0311_odontograma_plano_por_dente.sql");
  it("todo recado novo tem tradução (desconhecido não vira chute)", () => {
    const daFuncaoAntiga = new Set(["PLAN_NOT_FOUND", "NOT_ALLOWED", "WRONG_PHASE", "DIAGNOSIS_REQUIRED", "OPTIONS_REQUIRED", "OPTION_NEEDS_ITEMS", "UNKNOWN_CONDITION"]);
    const codigos = [...new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]))].filter((c) => !daFuncaoAntiga.has(c));
    expect(codigos.length).toBeGreaterThan(15);
    for (const c of codigos) expect(mensagemDoPlano(c), c).not.toBeNull();
    expect(mensagemDoPlano("qualquer")).toBeNull();
  });
  it("as travas de plano rodam como QUEM CHAMA (security invoker) e só valem pela API", () => {
    for (const f of ["plan_item_lock", "plan_option_lock", "treatment_plan_lock"]) {
      const corpo = sql.slice(sql.indexOf(`function public.${f}()`));
      expect(corpo.slice(0, 200), f).toContain("security invoker");
      expect(corpo.slice(0, 600), f).toContain("current_user <> 'authenticated'");
    }
  });
  it("E2 e F3 no envio: diagnóstico definido, lugar de cada item, preço do dia", () => {
    const envio = sql.slice(sql.indexOf("function public.submit_treatment_plan"));
    expect(envio).toContain("raise exception 'DIAGNOSIS_PENDING_SUGGESTIONS'");
    expect(envio).toContain("raise exception 'DIAGNOSIS_NOT_FINALIZED'");
    expect(envio).toContain("raise exception 'ITEM_LOCATION_REQUIRED'");
    expect(envio).toContain("set unit_price_cents = public.catalog_price_for(i.clinic_id, i.procedure_id)");
    expect(envio).toContain("prices_frozen_at = now()");
  });
  it("F2: a anterior fica substituída quando a NOVA é aprovada", () => {
    expect(sql).toContain("if new.status = 'approved' and old.status is distinct from 'approved'\n     and new.previous_plan_id is not null then");
    expect(sql).toContain("after update of status on public.treatment_plans");
  });
  it("F4 e F1 na conferência do item", () => {
    expect(sql).toContain("if new.quantity is distinct from 1 then raise exception 'ITEM_ONE_PER_TOOTH'; end if;");
    expect(sql).toContain("if v_conflito and length(btrim(coalesce(new.situation_override_reason, ''))) < 5 then\n      raise exception 'SITUATION_CONFLICT';");
  });
});

describe("OD3 — nas telas", () => {
  it("D4: o antigo 'Reabrir' saiu; a cópia virou nova versão", () => {
    const acoes = ler("src/app/(app)/prontuarios/[id]/planning-actions.ts");
    expect(acoes).not.toContain("export async function reopenTreatmentPlan");
    expect(acoes).toContain("...(copyFromPlanId ? { previous_plan_id: copyFromPlanId } : {}),");
    const plano = ler("src/app/(app)/prontuarios/[id]/planning-section.tsx");
    expect(plano).toContain("Criar nova versão");
    expect(plano).not.toContain("Criar cópia para revisar");
  });
  it("F4: vários dentes viram um item por dente, numa gravação só", () => {
    const acoes = ler("src/app/(app)/prontuarios/[id]/planning-actions.ts");
    expect(acoes).toContain("dentes.map((d, i) => ({ ...base, ...comMotivo, quantity: 1, tooth_code: d.tooth, face_codes: d.faces, sort_order: ordem + i }))");
    expect(acoes).toContain('await supabase.from("treatment_plan_option_items").insert(linhas);');
  });
  it("a janela antes da migração: colunas novas lidas À PARTE e só gravadas com valor", () => {
    const loader = ler("src/app/(app)/prontuarios/[id]/plan-loader.ts");
    expect(loader).toContain('.select("id, tooth_code, face_codes, region_code, situation_override_reason")');
    expect(loader).toContain("if (!locErro) for (const l of locRows ?? []) localPorItem.set(l.id, l);");
    const acoes = ler("src/app/(app)/prontuarios/[id]/planning-actions.ts");
    expect(acoes).toContain("...(regiao ? { region_code: regiao } : {})");
  });
  it("D7: o Gerente vê o preço por item; o Coordenador só os totais (inclusive na Apresentação)", () => {
    const ficha = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(ficha).toContain('const podeVerPrecosDoPlano = await hasRoleWithScopeForClinic(session, client.clinic_id, ["unit_manager"]);');
    expect(ler("src/app/(app)/prontuarios/[id]/planning-section.tsx")).toContain("const canSeePrices = canEdit || podeVerPrecos;");
    const ap = ler("src/app/(app)/apresentacao/[clientId]/presentation-data.ts");
    expect(ap).toContain('!(await hasRoleWithScopeForClinic(session, client.clinic_id, ["commercial_consultant", "unit_manager"]))');
    expect(ap).toContain("!veApenasTotais && it.unitPriceCents > 0");
  });
  it("AP60: a Apresentação usa a versão aprovada que vale, não a mais nova de qualquer situação", () => {
    const ap = ler("src/app/(app)/apresentacao/[clientId]/presentation-data.ts");
    expect(ap).toContain('const planRow = vigentes.find((p) => p.status === "approved") ?? vigentes[0] ?? planRows?.[0];');
  });
});
