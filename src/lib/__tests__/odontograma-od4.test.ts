import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { corDaMarca, descricaoDoDente, type MarcaNoDente } from "@/lib/odontograma/desenho";
import type { RegraDoPlano } from "@/lib/odontograma/plano";
import {
  alternarDente,
  itensDoDente,
  localDoItem,
  marcasDoAceite,
  planoDaNegociacao,
  porDente,
  type ItemComLocal,
} from "@/lib/odontograma/aceite";
import {
  VALIDADE_PADRAO_DIAS,
  diaBr,
  numerosDoOrcamento,
  somarDias,
  validadeDoOrcamento,
} from "@/lib/orcamento";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const regra = (nivel: RegraDoPlano["nivel"], efeito: string | null = null): RegraDoPlano => ({
  nivel, facesMin: null, facesMax: null, facesFixas: [], denticao: "both", grupos: [], impede: [], exige: [], efeito,
});
const regras: Record<string, RegraDoPlano> = {
  selante: regra("face", "SEL"),
  implante: regra("tooth", "IMP"),
  ajuste: regra("arch"),
};
const situacoes = [
  { code: "SEL", name: "Selante", appliesTo: "face" as const, usage: "effect" as const, symbol: "S", isActive: true, sortOrder: 1 },
  { code: "IMP", name: "Implante", appliesTo: "root" as const, usage: "effect" as const, symbol: "I", isActive: true, sortOrder: 2 },
];
const existente: MarcaNoDente = { dente: "11", faces: [], local: "crown", situacao: "existente", codigo: "R", simbolo: "R", nome: "Restauração" };
const odonto = { regras, situacoes, existentes: [existente] };

const itens: ItemComLocal[] = [
  { id: "a", description: "Implante", procedureId: "implante", toothCode: "46" },
  { id: "b", description: "Selante", procedureId: "selante", toothCode: "16", faceCodes: ["O"] },
  { id: "c", description: "Selante", procedureId: "selante", toothCode: "26", faceCodes: ["O"] },
  { id: "d", description: "Ajuste oclusal", procedureId: "ajuste", regionCode: "AS" },
  { id: "e", description: "Orientação de higiene" },
];

describe("OD4 — o desenho do aceite", () => {
  it("aceito = vermelho; fora = cinza tracejado SEM o X de ausente; o diagnóstico por baixo", () => {
    const m = marcasDoAceite(itens, ["c"], odonto);
    const doDente = (d: string) => m.filter((x) => x.dente === d);
    expect(doDente("16")[0]).toMatchObject({ situacao: "planejado", faces: ["O"], simbolo: "S" });
    expect(doDente("46")[0]).toMatchObject({ situacao: "planejado", local: "root", simbolo: "I" });
    expect(doDente("26")[0].situacao).toBe("fora");
    expect(corDaMarca(doDente("26")[0])).toEqual({ classe: "fora", tracejado: true });
    expect(doDente("11")[0].situacao).toBe("existente");
    // A ordem: o plano antes do diagnóstico (na mesma face vale a primeira).
    expect(m[m.length - 1]).toBe(existente);
    // Item de região ou sem lugar não vira marca de dente.
    expect(m.filter((x) => x.situacao !== "existente")).toHaveLength(3);
  });
  it("o leitor de tela diz que o cliente não quis agora", () => {
    const m = marcasDoAceite(itens, ["c"], odonto);
    expect(descricaoDoDente("26", "primeiro molar", m)).toContain("o cliente não quis agora");
  });
  it("tocar no dente: tira todos os itens dele; tocar de novo devolve; dente sem item não muda", () => {
    const dois: ItemComLocal[] = [...itens, { id: "f", description: "Restauração", procedureId: "selante", toothCode: "16", faceCodes: ["M"] }];
    expect(itensDoDente(dois, "16").sort()).toEqual(["b", "f"]);
    const tirou = alternarDente(dois, [], "16");
    expect(tirou.sort()).toEqual(["b", "f"]);
    expect(alternarDente(dois, tirou, "16")).toEqual([]);
    // Um aceito e outro fora: o toque tira o que faltava (não inverte cada um).
    expect(alternarDente(dois, ["b"], "16").sort()).toEqual(["b", "f"]);
    expect(alternarDente(dois, ["x"], "21")).toEqual(["x"]);
  });
});

describe("OD4 — a lista por dente (slide e orçamento)", () => {
  it("dentes em ordem FDI, depois regiões, depois o que não tem lugar", () => {
    const r = porDente(itens, [{ code: "AS", name: "Arcada superior" }]);
    expect(r.map((x) => x.item.id)).toEqual(["b", "c", "a", "d", "e"]);
    expect(r.map((x) => x.local)).toEqual(["16 (O)", "26 (O)", "Dente 46", "Arcada superior", null]);
  });
  it("o rótulo do lugar", () => {
    expect(localDoItem(itens[0])).toBe("Dente 46");
    expect(localDoItem(itens[3])).toBe("Região AS");
  });
});

describe("OD4 — o plano da negociação (o furo da OD3)", () => {
  const p = (id: string, createdAt: string, supersededAt: string | null, negociacao: string | null) => ({ id, createdAt, supersededAt, negociacao });
  it("a versão nova aprovada vence a substituída", () => {
    expect(planoDaNegociacao([p("v1", "2026-10-01", "2026-10-10", "substituida"), p("v2", "2026-10-05", null, null)])).toBe("v2");
  });
  it("substituída que NÃO foi vendida não volta, mesmo se fosse a mais nova", () => {
    expect(planoDaNegociacao([p("v1", "2026-10-09", "2026-10-10", "substituida"), p("v2", "2026-10-05", null, null)])).toBe("v2");
    expect(planoDaNegociacao([p("v1", "2026-10-09", "2026-10-10", null)])).toBeNull();
  });
  it("o que foi vendido vale (aceita, ou cancelada depois de fechada)", () => {
    expect(planoDaNegociacao([p("v1", "2026-10-01", "2026-10-10", "aceita")])).toBe("v1");
    expect(planoDaNegociacao([p("v1", "2026-10-01", "2026-10-10", "cancelada")])).toBe("v1");
  });
});

describe("OD4 — o orçamento impresso", () => {
  const base = { quantity: 1, plannedSessions: 1, programDiscountCents: 0 };
  const it_ = (id: string, cents: number, included: boolean, programDiscountCents = 0) => ({
    ...base, id, description: id, unitPriceCents: cents, included, programDiscountCents,
  });
  it("subtotal do que entrou − benefício + desconto = o total salvo", () => {
    const n = numerosDoOrcamento([it_("a", 100000, true, 10000), it_("b", 50000, true), it_("c", 30000, false)], {
      adjustmentCents: -5000,
      finalCents: 135000,
    });
    expect(n).toMatchObject({ subtotalCents: 150000, beneficioCents: 10000, descontoCents: -5000, totalCents: 135000, bate: true });
    expect(n.excluidos.map((i) => i.id)).toEqual(["c"]);
  });
  it("conta que não fecha com o total salvo é denunciada (não imprime dois números que não batem)", () => {
    expect(numerosDoOrcamento([it_("a", 100000, true)], { adjustmentCents: 0, finalCents: 90000 }).bate).toBe(false);
  });
  it("o total nunca fica negativo — a mesma conta do banco (0182)", () => {
    expect(numerosDoOrcamento([it_("a", 1000, true)], { adjustmentCents: -5000, finalCents: 0 }).bate).toBe(true);
  });
  it("G2: validade em cascata (unidade > rede > 15) e a data no calendário", () => {
    expect(VALIDADE_PADRAO_DIAS).toBe(15);
    expect(validadeDoOrcamento([], "u1")).toBe(15);
    expect(validadeDoOrcamento([{ clinic_id: null, budget_validity_days: 30 }], "u1")).toBe(30);
    expect(validadeDoOrcamento([{ clinic_id: null, budget_validity_days: 30 }, { clinic_id: "u1", budget_validity_days: 7 }], "u1")).toBe(7);
    expect(validadeDoOrcamento([{ clinic_id: null, budget_validity_days: 30 }, { clinic_id: "u1", budget_validity_days: null }], "u1")).toBe(30);
    expect(somarDias("2026-10-20", 15)).toBe("2026-11-04");
    expect(somarDias("2026-12-25", 15)).toBe("2027-01-09");
    expect(diaBr("2026-11-04")).toBe("04/11/2026");
  });
});

describe("OD4 — o que está escrito no código e no banco", () => {
  const sql = ler("supabase/migrations/0313_odontograma_orcamento_e_versoes.sql");
  it("a 0313 encerra só a negociação ABERTA do plano substituído", () => {
    expect(sql).toContain("and status in ('em_negociacao', 'aguardando_autorizacao', 'devolvida')");
    expect(sql).toContain("after update of superseded_at on public.treatment_plans");
  });
  it("as sessões sem venda não saem de plano substituído (as duas funções)", () => {
    expect(sql.match(/status = 'approved' and superseded_at is null/g)).toHaveLength(3);
  });
  it("G4: a apresentação não lê mais as anotações clínicas do Coordenador", () => {
    const dados = ler("src/app/(app)/apresentacao/[clientId]/presentation-data.ts");
    expect(dados).not.toContain('.from("clinical_notes")');
    const gamma = ler("src/app/(app)/apresentacao/[clientId]/actions.ts");
    expect(gamma).not.toContain("considerations");
  });
  it("G1: a apresentação carrega TODAS as opções aprovadas (antes: limit 1)", () => {
    const dados = ler("src/app/(app)/apresentacao/[clientId]/presentation-data.ts");
    expect(dados).toContain("alternatives: options.slice(1)");
    expect(dados).not.toMatch(/\.order\("sort_order"\)\s*\.limit\(1\)/);
  });
  it("o painel de negociação escolhe o plano pela regra (não 'o aprovado mais novo')", () => {
    const loader = ler("src/app/(app)/apresentacao/[clientId]/negotiation-loader.ts");
    expect(loader).toContain("planoDaNegociacao(");
    expect(loader).not.toContain(".limit(1);\n  const planId");
  });
  it("o orçamento não abre para o Coordenador (D7/F4: preço item a item)", () => {
    const pagina = ler("src/app/orcamentos/[id]/page.tsx");
    expect(pagina).toContain('"commercial_consultant",\n      "commercial_assistant",\n      "unit_manager",');
    expect(pagina).not.toContain("clinical_coordinator");
  });
});
