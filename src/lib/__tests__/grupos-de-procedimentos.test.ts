import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DenteDaReferencia, RegraDoPlano } from "@/lib/odontograma/plano";
import {
  MAXIMO_NO_GRUPO,
  MINIMO_NO_GRUPO,
  QUANTIDADE_MAXIMA,
  baseDaLinha,
  mensagemDoGrupo,
  montarLancamento,
  oQueEntra,
  totalDoLancamento,
  validarGrupo,
  type GrupoDeProcedimentos,
} from "@/lib/procedimentos/grupos";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const regra = (over: Partial<RegraDoPlano>): RegraDoPlano => ({
  nivel: "tooth",
  facesMin: null,
  facesMax: null,
  facesFixas: [],
  denticao: "both",
  grupos: [],
  impede: [],
  exige: [],
  efeito: null,
  ...over,
});

const REGRAS: Record<string, RegraDoPlano> = {
  implante: regra({ efeito: "RZ-IMPLANTE" }),
  protese: regra({ exige: ["RZ-IMPLANTE"], efeito: "RZ-COROA" }),
  canal: regra({ efeito: "RZ-ENDO" }),
  restauracao: regra({ nivel: "face", facesMin: 1, facesMax: 3 }),
  faceta: regra({ nivel: "face", facesMin: 1, facesMax: 1 }),
  enxerto: regra({ nivel: "region" }),
  consulta: regra({ nivel: "none" }),
};
const NOMES: Record<string, string> = {
  implante: "Implante",
  protese: "Prótese sobre implante",
  canal: "Canal",
  restauracao: "Restauração",
  enxerto: "Enxerto",
  consulta: "Consulta",
  faceta: "Faceta",
  semRegra: "Novo, sem regra",
};
const REF: Record<string, DenteDaReferencia> = {
  "36": { dentition: "permanent", group: "molar" },
  "46": { dentition: "permanent", group: "molar" },
};
const FACES = { "36": ["V", "M", "D", "O", "L"], "46": ["V", "M", "D", "O", "L"] };

function montar(
  ids: string[],
  lugar: Partial<{ dentes: string[]; facesPorProcedimento: Record<string, string[]>; regiaoPorProcedimento: Record<string, string> }> = {},
  extra: Partial<Parameters<typeof montarLancamento>[0]> = {}
) {
  return montarLancamento({
    itens: ids.map((id) => ({ procedureId: id, quantidade: id === "consulta" ? 2 : 1, nome: NOMES[id] })),
    regras: REGRAS,
    lugar: { dentes: [], facesPorProcedimento: {}, regiaoPorProcedimento: {}, ...lugar },
    referencia: REF,
    facesPorDente: FACES,
    atuaisPorDente: {},
    itensDaOpcao: [],
    nomeDaSituacao: (c) => c,
    ...extra,
  });
}

describe("o grupo no plano: dente a dente, na ordem do grupo", () => {
  it("implante + prótese em dois dentes = quatro itens, cada dente com os seus", () => {
    const m = montar(["implante", "protese"], { dentes: ["36", "46"] });
    expect(m.linhas.map((l) => `${l.tooth}:${l.procedureId}`)).toEqual([
      "36:implante",
      "36:protese",
      "46:implante",
      "46:protese",
    ]);
    expect(m.problemas).toEqual([]);
    expect(m.conflitos).toEqual([]);
    expect(m.linhas.every((l) => l.quantidade === 1)).toBe(true);
  });

  it("⚠️ a ORDEM importa: prótese antes do implante pede motivo (o banco também)", () => {
    const m = montar(["protese", "implante"], { dentes: ["36"] });
    expect(m.conflitos).toHaveLength(1);
    expect(m.conflitos[0]).toContain("Prótese sobre implante");
  });

  it("o implante que JÁ está na opção vale para a prótese do grupo", () => {
    const m = montar(["protese", "canal"], { dentes: ["36"] }, {
      itensDaOpcao: [{ id: "x", procedureId: "implante", toothCode: "36" }],
    });
    expect(m.conflitos).toEqual([]);
  });

  it("face: as faces de cada procedimento de face, as mesmas em todos os dentes", () => {
    const m = montar(["canal", "restauracao"], { dentes: ["36", "46"], facesPorProcedimento: { restauracao: ["O", "M"] } });
    expect(m.linhas.filter((l) => l.procedureId === "restauracao").map((l) => l.faces)).toEqual([
      ["M", "O"],
      ["M", "O"],
    ]);
    expect(m.linhas.find((l) => l.procedureId === "canal")?.faces).toEqual([]);
  });

  it("dois procedimentos de face: cada um com as SUAS faces", () => {
    const m = montar(["restauracao", "faceta"], {
      dentes: ["36"],
      facesPorProcedimento: { restauracao: ["O", "M"], faceta: ["V"] },
    });
    expect(m.problemas).toEqual([]);
    expect(m.linhas.map((l) => `${l.procedureId}:${l.faces.join("")}`)).toEqual(["restauracao:MO", "faceta:V"]);
  });

  it("face sem faces escolhidas: o problema diz QUAL procedimento", () => {
    const m = montar(["canal", "restauracao"], { dentes: ["36"] });
    expect(m.problemas.some((p) => p.startsWith("Restauração:"))).toBe(true);
    expect(m.linhas.map((l) => l.procedureId)).toEqual(["canal"]);
  });

  it("sem dente escolhido: pede o dente e não monta nenhum item de dente", () => {
    const m = montar(["implante", "protese"]);
    expect(m.pedeDente).toBe(true);
    expect(m.problemas).toEqual(["Escolha o(s) dente(s) no desenho."]);
    expect(m.linhas).toEqual([]);
  });

  it("região pede a região; sem marcação entra com a quantidade do grupo", () => {
    const sem = montar(["enxerto", "consulta"]);
    expect(sem.problemas).toEqual(["Enxerto: escolha a região."]);
    const com = montar(["enxerto", "consulta"], { regiaoPorProcedimento: { enxerto: "S1" } });
    expect(com.problemas).toEqual([]);
    expect(com.linhas).toEqual([
      { procedureId: "enxerto", quantidade: 1, tooth: null, faces: [], regionCode: "S1" },
      { procedureId: "consulta", quantidade: 2, tooth: null, faces: [], regionCode: null },
    ]);
    expect(com.pedeDente).toBe(false);
  });

  it("procedimento sem regra (cadastrado depois da 0308) entra sem lugar", () => {
    const m = montar(["semRegra", "consulta"]);
    expect(m.linhas.map((l) => l.procedureId)).toEqual(["semRegra", "consulta"]);
  });

  it("odontograma não carregou: tudo sem lugar, com a quantidade do grupo", () => {
    const m = montar(["implante", "consulta"], {}, { regras: null });
    expect(m.pedeDente).toBe(false);
    expect(m.linhas.every((l) => l.tooth === null && l.regionCode === null)).toBe(true);
    expect(m.linhas.find((l) => l.procedureId === "consulta")?.quantidade).toBe(2);
  });

  it("situação que impede: conflito (pede motivo), mas o item segue montado", () => {
    const m = montar(["canal", "implante"], { dentes: ["36"] }, {
      regras: { ...REGRAS, canal: regra({ impede: ["A"] }) },
      atuaisPorDente: { "36": ["A"] },
    });
    expect(m.conflitos).toHaveLength(1);
    expect(m.linhas).toHaveLength(2);
  });
});

describe("o que entra e quanto soma", () => {
  const grupo: GrupoDeProcedimentos = {
    id: "g",
    nome: "Implante + prótese",
    descricao: null,
    ativo: true,
    ajustePercent: 0,
    itens: [
      { procedureId: "implante", quantidade: 1, nome: "Implante", ativo: true },
      { procedureId: "velho", quantidade: 1, nome: "Procedimento desativado", ativo: false },
      { procedureId: "outraUnidade", quantidade: 1, nome: "Fora do catálogo daqui", ativo: true },
      { procedureId: "protese", quantidade: 1, nome: "Prótese", ativo: true },
    ],
  };

  it("só entra o que está no catálogo; o resto é NOMEADO, não some calado", () => {
    const r = oQueEntra(grupo, [{ id: "implante" }, { id: "protese" }, { id: "velho" }]);
    expect(r.entram.map((e) => e.procedureId)).toEqual(["implante", "protese"]);
    expect(r.ficamDeFora).toEqual(["Procedimento desativado", "Fora do catálogo daqui"]);
  });

  it("total pelo preço do catálogo × quantidade; base do protocolo × quantidade", () => {
    const linhas = [
      { procedureId: "a", quantidade: 1, tooth: "36", faces: [], regionCode: null },
      { procedureId: "b", quantidade: 3, tooth: null, faces: [], regionCode: null },
    ];
    expect(totalDoLancamento(linhas, (id) => (id === "a" ? 300000 : 15000))).toBe(345000);
    expect(baseDaLinha(linhas[1], { count: 2, minutes: 40 })).toEqual({ sessoes: 6, minutos: 120 });
    expect(baseDaLinha(linhas[0], null)).toEqual({ sessoes: null, minutos: null });
  });
});

describe("cadastro do grupo", () => {
  const dois = [
    { procedureId: "a", quantidade: 1 },
    { procedureId: "b", quantidade: 2 },
  ];

  it("aceita o grupo certo", () => {
    expect(validarGrupo("Implante + prótese", dois)).toBeNull();
  });

  it("recusa nome curto, um procedimento só, repetido e quantidade fora da faixa", () => {
    expect(validarGrupo("ab", dois)).toMatch(/nome/);
    expect(validarGrupo("Grupo", [dois[0]])).toMatch(/pelo menos 2/);
    expect(validarGrupo("Grupo", [dois[0], dois[0]])).toMatch(/duas vezes/);
    expect(validarGrupo("Grupo", [dois[0], { procedureId: "b", quantidade: 0 }])).toMatch(/quantidade/);
    expect(validarGrupo("Grupo", [dois[0], { procedureId: "b", quantidade: 21 }])).toMatch(/quantidade/);
    expect(validarGrupo("Grupo", Array.from({ length: 31 }, (_, i) => ({ procedureId: `p${i}`, quantidade: 1 })))).toMatch(/no máximo/);
  });

  it("⚠️ a régua da tela é a MESMA do banco (0324)", () => {
    const sql = ler("supabase/migrations/0324_grupos_de_procedimentos.sql");
    expect(sql).toContain(`jsonb_array_length(p_items) < ${MINIMO_NO_GRUPO}`);
    expect(sql).toContain(`jsonb_array_length(p_items) > ${MAXIMO_NO_GRUPO}`);
    expect(sql).toContain(`quantity between 1 and ${QUANTIDADE_MAXIMA}`);
    expect(sql).toContain(`v_qtd not between 1 and ${QUANTIDADE_MAXIMA}`);
  });

  it("os códigos do banco viram frase; o que não é deles, não", () => {
    for (const codigo of [
      "NOT_ALLOWED",
      "NAME_REQUIRED",
      "GROUP_NEEDS_TWO",
      "GROUP_TOO_BIG",
      "GROUP_NAME_TAKEN",
      "PROCEDURE_NOT_ACTIVE",
      "PROCEDURE_REPEATED",
      "INVALID_QUANTITY",
      "GROUP_NOT_FOUND",
      "GROUP_IN_USE",
    ]) {
      expect(mensagemDoGrupo(`ERROR: ${codigo}`)).toBeTruthy();
      // todo código que a tela traduz existe de verdade na migração
      expect(ler("supabase/migrations/0324_grupos_de_procedimentos.sql")).toContain(`'${codigo}'`);
    }
    expect(mensagemDoGrupo("Could not find the function public.save_procedure_group")).toMatch(/0324/);
    expect(mensagemDoGrupo("algo inesperado")).toBeNull();
  });
});

describe("o lançamento no plano (ação do servidor)", () => {
  const acoes = ler("src/app/(app)/prontuarios/[id]/planning-actions.ts");
  const corpo = acoes.slice(acoes.indexOf("export async function addProcedureGroup"), acoes.indexOf("export async function editBudgetItem"));

  it("confere que cada linha é DO grupo e que o grupo está ativo", () => {
    expect(corpo).toContain("!doGrupo.has(l.procedureId)");
    expect(corpo).toContain("!grupo.is_active");
  });

  it("grava tudo numa gravação só (ou entram todas, ou nenhuma) e com a etiqueta", () => {
    expect(corpo.match(/\.insert\(/g)).toHaveLength(1);
    expect(corpo).toContain(".insert(linhas)");
    expect(corpo).toContain("procedure_group_id: grupo.id");
  });

  it("o preço NÃO vem da tela: quem põe é o banco (0306)", () => {
    expect(corpo).toContain("unit_price_cents: 0");
    expect(corpo).toContain("requirePlanner()");
  });
});
