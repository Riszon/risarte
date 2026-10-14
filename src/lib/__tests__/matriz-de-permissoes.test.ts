import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPACIDADES, matrizPadrao, type Capability, type MatrizPermissoes } from "@/lib/permissions";
import { USER_ROLES, type UserRole } from "@/lib/roles";
import {
  alternar,
  casaForaDoPadrao,
  filtrarPermissoes,
  foraDoPadrao,
  fraseDaMudanca,
  mesmoConjunto,
  mudancas,
  normalizar,
  origemDoPadrao,
  padraoEfetivo,
  permissoesParaSalvar,
  quantasPorFuncao,
  quemTem,
  todasForaDoPadrao,
  voltarAoPadrao,
} from "@/lib/matriz-de-permissoes";

// Relato OC-00002: "tornar padrão" o que aparece como fora do padrão, e uma
// tela de permissões que se veja por função ou por permissão.

const CAPS: Capability[] = [
  { id: "menu.a", rotulo: "Relatórios", grupo: "Navegação", descricao: "Os números da unidade.", dependeDoBanco: false, padrao: ["receptionist", "unit_manager"] },
  { id: "menu.b", rotulo: "Agenda", grupo: "Navegação", descricao: "Marcar horários.", dependeDoBanco: false, padrao: ["receptionist"] },
  { id: "acao.c", rotulo: "Lançar dinheiro", grupo: "Ações — Financeiro", descricao: "Contas a pagar e a receber.", dependeDoBanco: true, padrao: [] },
];
const PAPEIS: UserRole[] = ["receptionist", "unit_manager", "dentist"];
const FABRICA: MatrizPermissoes = { "menu.a": ["receptionist", "unit_manager"], "menu.b": ["receptionist"], "acao.c": [] };

describe("o padrão que vale", () => {
  it("sem nada fixado, é o de fábrica", () => {
    expect(padraoEfetivo(FABRICA, {})).toEqual(FABRICA);
    expect(origemDoPadrao("menu.a", {})).toBe("fabrica");
  });
  it("o fixado pelo dono manda — inclusive quando é ninguém", () => {
    const p = padraoEfetivo(FABRICA, {
      "menu.a": { roles: ["dentist"], updatedAt: null },
      "menu.b": { roles: [], updatedAt: null },
    });
    expect(p["menu.a"]).toEqual(["dentist"]);
    expect(p["menu.b"]).toEqual([]); // fixado VAZIO não volta para o de fábrica
    expect(p["acao.c"]).toEqual([]);
    expect(origemDoPadrao("menu.b", { "menu.b": { roles: [], updatedAt: null } })).toBe("fixado");
  });
  it("padrão fixado de permissão que saiu do catálogo não aparece", () => {
    const p = padraoEfetivo(FABRICA, { "menu.velho": { roles: ["dentist"], updatedAt: null } });
    expect(Object.keys(p).sort()).toEqual(["acao.c", "menu.a", "menu.b"]);
  });
  it("o padrão não é a mesma lista do de fábrica (mexer num não mexe no outro)", () => {
    const p = padraoEfetivo(FABRICA, {});
    p["menu.a"].push("dentist");
    expect(FABRICA["menu.a"]).toEqual(["receptionist", "unit_manager"]);
  });
});

describe("fora do padrão", () => {
  it("compara o CONJUNTO, não a ordem", () => {
    expect(mesmoConjunto(["a", "b"], ["b", "a"])).toBe(true);
    expect(mesmoConjunto(["a", "b"], ["a"])).toBe(false);
    expect(mesmoConjunto(["a"], ["a", "b"])).toBe(false);
    expect(mesmoConjunto([], [])).toBe(true);
  });
  it("a permissão e a casinha", () => {
    const matriz: MatrizPermissoes = { ...FABRICA, "menu.a": ["unit_manager", "dentist"] };
    expect(foraDoPadrao(matriz, FABRICA, "menu.a")).toBe(true);
    expect(foraDoPadrao(matriz, FABRICA, "menu.b")).toBe(false);
    expect(casaForaDoPadrao(matriz, FABRICA, "menu.a", "dentist")).toBe(true);
    expect(casaForaDoPadrao(matriz, FABRICA, "menu.a", "receptionist")).toBe(true);
    expect(casaForaDoPadrao(matriz, FABRICA, "menu.a", "unit_manager")).toBe(false);
  });
  it("depois de tornar padrão, o selo some", () => {
    const matriz: MatrizPermissoes = { ...FABRICA, "menu.a": ["dentist"] };
    expect(foraDoPadrao(matriz, FABRICA, "menu.a")).toBe(true);
    const novo = padraoEfetivo(FABRICA, { "menu.a": { roles: ["dentist"], updatedAt: null } });
    expect(foraDoPadrao(matriz, novo, "menu.a")).toBe(false);
  });
  it("'Tornar tudo padrão' pega exatamente as que diferem", () => {
    const matriz: MatrizPermissoes = { "menu.a": ["dentist"], "menu.b": ["receptionist"], "acao.c": ["unit_manager"] };
    expect(todasForaDoPadrao(matriz, FABRICA, CAPS)).toEqual(["menu.a", "acao.c"]);
  });
});

describe("rascunho e barra de alterações", () => {
  it("alternar liga e desliga sem mexer na matriz de antes", () => {
    const um = alternar(FABRICA, "menu.b", "dentist");
    expect(um["menu.b"]).toEqual(["receptionist", "dentist"]);
    expect(FABRICA["menu.b"]).toEqual(["receptionist"]);
    expect(alternar(um, "menu.b", "dentist")["menu.b"]).toEqual(["receptionist"]);
    expect(alternar(FABRICA, "menu.nova", "dentist")["menu.nova"]).toEqual(["dentist"]);
  });
  it("as mudanças saem na ordem da tela, com o sentido certo", () => {
    let r = alternar(FABRICA, "acao.c", "dentist");
    r = alternar(r, "menu.a", "receptionist");
    expect(mudancas(FABRICA, r, CAPS, PAPEIS)).toEqual([
      { capacidade: "menu.a", papel: "receptionist", passa: "perde" },
      { capacidade: "acao.c", papel: "dentist", passa: "ganha" },
    ]);
  });
  it("marcar e desmarcar de volta não é mudança", () => {
    const r = alternar(alternar(FABRICA, "menu.a", "dentist"), "menu.a", "dentist");
    expect(mudancas(FABRICA, r, CAPS, PAPEIS)).toEqual([]);
    expect(permissoesParaSalvar(FABRICA, r, CAPS)).toEqual([]);
  });
  it("grava a permissão INTEIRA (o conjunto é o valor), só das que mudaram", () => {
    const r = alternar(FABRICA, "menu.a", "dentist");
    expect(permissoesParaSalvar(FABRICA, r, CAPS)).toEqual([
      { capacidade: "menu.a", papeis: ["receptionist", "unit_manager", "dentist"] },
    ]);
  });
  it("voltar ao padrão põe o padrão no rascunho — e não grava nada sozinho", () => {
    const gravado: MatrizPermissoes = { ...FABRICA, "menu.a": ["dentist"] };
    const r = voltarAoPadrao(gravado, FABRICA, "menu.a");
    expect(r["menu.a"]).toEqual(["receptionist", "unit_manager"]);
    expect(gravado["menu.a"]).toEqual(["dentist"]);
    expect(permissoesParaSalvar(gravado, r, CAPS)).toHaveLength(1);
  });
  it("a frase que a barra mostra", () => {
    expect(fraseDaMudanca({ capacidade: "menu.a", papel: "dentist", passa: "ganha" }, CAPS)).toBe(
      "Dentista passa a ter “Relatórios”"
    );
    expect(fraseDaMudanca({ capacidade: "menu.b", papel: "receptionist", passa: "perde" }, CAPS)).toBe(
      "Recepcionista perde “Agenda”"
    );
  });
});

describe("filtros", () => {
  it("busca sem acento e sem caixa, por nome, descrição ou grupo", () => {
    expect(normalizar("  Relatórios ")).toBe("relatorios");
    expect(filtrarPermissoes(CAPS, { busca: "relatorio" }, FABRICA, FABRICA).map((c) => c.id)).toEqual(["menu.a"]);
    expect(filtrarPermissoes(CAPS, { busca: "HORÁRIOS" }, FABRICA, FABRICA).map((c) => c.id)).toEqual(["menu.b"]);
    expect(filtrarPermissoes(CAPS, { busca: "financeiro" }, FABRICA, FABRICA).map((c) => c.id)).toEqual(["acao.c"]);
    expect(filtrarPermissoes(CAPS, { busca: "contas pagar" }, FABRICA, FABRICA).map((c) => c.id)).toEqual(["acao.c"]);
    expect(filtrarPermissoes(CAPS, { busca: "nada disso" }, FABRICA, FABRICA)).toEqual([]);
  });
  it("por grupo e só as fora do padrão", () => {
    expect(filtrarPermissoes(CAPS, { grupo: "Navegação" }, FABRICA, FABRICA).map((c) => c.id)).toEqual(["menu.a", "menu.b"]);
    const matriz: MatrizPermissoes = { ...FABRICA, "menu.b": [] };
    expect(filtrarPermissoes(CAPS, { soForaDoPadrao: true }, matriz, FABRICA).map((c) => c.id)).toEqual(["menu.b"]);
    expect(filtrarPermissoes(CAPS, {}, matriz, FABRICA)).toHaveLength(3);
  });
});

describe("por função e por permissão", () => {
  it("quantas permissões cada função tem", () => {
    expect(quantasPorFuncao(FABRICA, CAPS, PAPEIS)).toEqual({ receptionist: 2, unit_manager: 1, dentist: 0 });
  });
  it("quem tem e quem não tem, na ordem das funções", () => {
    expect(quemTem(FABRICA, "menu.a", PAPEIS)).toEqual({ com: ["receptionist", "unit_manager"], sem: ["dentist"] });
    expect(quemTem(FABRICA, "acao.c", PAPEIS)).toEqual({ com: [], sem: PAPEIS });
  });
});

describe("o catálogo de verdade", () => {
  it("o padrão de fábrica da tela é o do catálogo", () => {
    const fabrica = matrizPadrao();
    expect(padraoEfetivo(fabrica, {})).toEqual(fabrica);
    expect(todasForaDoPadrao(fabrica, fabrica, CAPACIDADES)).toEqual([]);
    expect(quantasPorFuncao(fabrica, CAPACIDADES, [...USER_ROLES])).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// A tela e as ações usam ESTA conta, e o padrão é sempre o que está gravado
// ---------------------------------------------------------------------------
describe("a tela de permissões", () => {
  const pasta = join(process.cwd(), "src/app/(app)/admin/permissoes");
  const pagina = readFileSync(join(pasta, "page.tsx"), "utf8");
  const acoes = readFileSync(join(pasta, "actions.ts"), "utf8");
  const tela = readFileSync(join(pasta, "permissions-matrix.tsx"), "utf8");
  const migracao = readFileSync(
    join(process.cwd(), "supabase/migrations/0292_padrao_das_permissoes.sql"),
    "utf8"
  );

  it("o selo compara com o padrão EFETIVO (fixado ou de fábrica), não só com o código", () => {
    expect(pagina).toMatch(/\.from\("permission_defaults"\)/);
    expect(pagina).toMatch(/padraoEfetivo\(/);
  });
  it("'Tornar padrão' copia o que está GRAVADO, no banco — nunca o rascunho da tela", () => {
    expect(acoes).toMatch(/\.rpc\("fix_permission_defaults"/);
    expect(migracao).toMatch(/from public\.permission_matrix m\s+where m\.capability = c\.cap and m\.allowed/);
  });
  it("nada se salva sem a barra de alterações: a tela não chama salvar ao marcar", () => {
    // Uma definição e UM uso — o botão Salvar da barra. Qualquer outro caminho
    // (marcar, voltar ao padrão) que chamasse o salvar gravaria sem a pessoa ver.
    expect(tela.match(/salvarTudo/g)).toHaveLength(2);
    expect(tela).toMatch(/onClick=\{salvarTudo\}/);
    expect(tela.match(/salvarPermissoes\(/g)).toHaveLength(1);
    expect(tela).toMatch(/permissoesParaSalvar\(/);
  });
  it("o padrão nunca se apaga: a migração não tem porta de exclusão", () => {
    expect(migracao).not.toMatch(/delete\s+from\s+public\.permission_defaults/i);
    expect(migracao).not.toMatch(/for\s+(all|delete)\s+to/i);
  });
});
