import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mensagemDoOdontograma,
  validarRegra,
  validarSituacao,
  type RegraDoProcedimento,
} from "@/lib/odontograma/referencia";

// Odontograma, OD1 (0308, 19/10/2026): a referência TUSS, as situações da
// Risarte e as regras clínicas dos 370 procedimentos — vindas das planilhas
// que o dono revisou — e a tela do Admin para ajustar (pedido do dono).

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const M = ler("supabase/migrations/0308_odontograma_referencia_e_regras.sql");

const base: RegraDoProcedimento = {
  level: "face", faceCountMin: 2, faceCountMax: 2, fixedFaces: [], dentition: "both",
  toothGroups: [], blockedConditions: ["A"], requiredConditions: [], effectCondition: "R", effectWhenAbsent: null,
};

describe("a régua da regra (a mesma do banco)", () => {
  it("face exige o número de faces, de 1 a 5, mínimo ≤ máximo", () => {
    expect("regra" in validarRegra(base)).toBe(true);
    expect("erro" in validarRegra({ ...base, faceCountMin: null })).toBe(true);
    expect("erro" in validarRegra({ ...base, faceCountMin: 1.5 })).toBe(true);
    expect("erro" in validarRegra({ ...base, faceCountMin: 3, faceCountMax: 2 })).toBe(true);
    expect("erro" in validarRegra({ ...base, faceCountMax: 6 })).toBe(true);
    expect("erro" in validarRegra({ ...base, faceCountMax: 1, faceCountMin: 1, fixedFaces: ["V", "O"] })).toBe(true);
  });

  it("nos outros níveis as faces somem (o banco recusaria)", () => {
    const r = validarRegra({ ...base, level: "tooth", fixedFaces: ["V"] });
    expect("regra" in r && r.regra).toMatchObject({ faceCountMin: null, faceCountMax: null, fixedFaces: [] });
  });

  it("a mesma situação não é exigida e impedida ao mesmo tempo", () => {
    expect("erro" in validarRegra({ ...base, requiredConditions: ["A"] })).toBe(true);
  });

  it("situação nova: código RZ-, nome e símbolo de 1 a 3 letras", () => {
    const ok = { code: "rz-selante2", name: "Selante 2", appliesTo: "face", usage: "both", symbol: "s2" };
    expect(validarSituacao(ok, true)).toEqual({ valores: { ...ok, code: "RZ-SELANTE2", symbol: "S2" } });
    expect("erro" in validarSituacao({ ...ok, code: "SELANTE" }, true)).toBe(true);
    expect("erro" in validarSituacao({ ...ok, symbol: "ABCD" }, true)).toBe(true);
  });

  it("os recados do banco em português; o desconhecido não vira chute", () => {
    expect(mensagemDoOdontograma("TUSS_LOCKED")).toMatch(/TUSS é oficial/);
    expect(mensagemDoOdontograma("ALGO_NOVO")).toBeNull();
  });
});

describe("o banco (0308)", () => {
  it("regra de face sem nº de faces é recusada — o vazio NÃO passa no check", () => {
    expect(M).toContain("then coalesce(face_count_min between 1 and 5");
    expect(M).toContain("<= face_count_max, false)");
  });

  it("TUSS: código e nome travados; nada se apaga; só a Risarte cria", () => {
    expect(M).toContain("  if old.source = 'tuss' and new.name is distinct from old.name then\n    raise exception 'TUSS_LOCKED';");
    expect(M).toContain("  if new.code is distinct from old.code or new.source is distinct from old.source then");
    expect(M).toContain("raise exception 'CONDITION_CODE_LOCKED';");
    expect(M).toContain("raise exception 'CONDITION_NOT_DELETABLE';");
    expect(M).toContain("with check (public.is_admin_master() and source = 'risarte');");
    expect(M).not.toMatch(/for delete to authenticated/);
  });

  it("as listas da regra só aceitam códigos que existem", () => {
    expect(M).toContain("raise exception 'UNKNOWN_CONDITION';");
    expect(M).toContain("raise exception 'UNKNOWN_FACE';");
  });

  it("as trocas de faces e de região: só o Admin, e não abrem sem login", () => {
    for (const f of ["set_tooth_faces", "set_region_teeth"]) {
      expect(M).toContain(`revoke execute on function public.${f}(text, text[]) from public, anon, authenticated;`);
    }
    expect(M.match(/if \(select auth\.uid\(\)\) is null or not public\.is_admin_master\(\) then raise exception 'NOT_ALLOWED'; end if;/g)).toHaveLength(2);
    expect(M).toContain("select public.audit_attach_all();");
  });

  it("a semente: 60 dentes, 7 faces, 61 regiões, 38 situações (5 TUSS) e 370 regras", () => {
    const bloco = (inicio: string) => M.slice(M.indexOf(inicio), M.indexOf(";", M.indexOf(inicio)));
    const linhas = (inicio: string) => bloco(inicio).split("\n").filter((l) => l.startsWith("  (") || l.startsWith("    (")).length;
    expect(linhas("insert into public.dental_teeth (")).toBe(60);
    expect(linhas("insert into public.dental_faces (")).toBe(7);
    expect(linhas("insert into public.dental_regions (")).toBe(61);
    expect(linhas("insert into public.dental_conditions (")).toBe(38);
    expect(bloco("insert into public.dental_conditions (").match(/'tuss'/g)).toHaveLength(5);
    expect(linhas("insert into public.procedure_dental_rules (")).toBe(370);
  });

  it("toda situação citada numa regra existe na semente", () => {
    const sem = M.slice(M.indexOf("insert into public.dental_conditions ("));
    const existentes = new Set([...sem.slice(0, sem.indexOf(";")).matchAll(/^\s+\('([^']+)'/gm)].map((m) => m[1]));
    const regras = M.slice(M.indexOf("insert into public.procedure_dental_rules ("));
    const citadas = new Set([...regras.matchAll(/'(RZ-[A-Z0-9]+|[HCRAE])'/g)].map((m) => m[1]));
    expect(citadas.size).toBeGreaterThan(5);
    for (const c of citadas) expect(existentes, c).toContain(c);
  });

  it("exemplos das planilhas: resina 2 faces e implante", () => {
    expect(M).toContain("('85100200', 'face', 2, 2, '{}'::text[], 'both', '{}'::text[], array['A', 'RZ-IMPLANTE', 'RZ-COROA']::text[], '{}'::text[], 'R', null, 'high')");
    expect(M).toContain("('82000980', 'tooth', null::smallint, null::smallint, '{}'::text[], 'both', '{}'::text[], array['RZ-IMPLANTE']::text[], array['A', 'E']::text[], 'RZ-IMPLANTE', null, 'high')");
  });
});

describe("a tela do Admin", () => {
  it("só o Admin Master abre e grava", () => {
    expect(ler("src/app/(app)/admin/odontograma/page.tsx")).toContain("await requireAdminMaster();");
    const acoes = ler("src/app/(app)/admin/odontograma/actions.ts");
    expect(acoes.match(/const quem = await soAdmin\(\);/g)).toHaveLength(4);
    expect(acoes).toContain("if (!session.isAdminMaster) return { error:");
  });

  it("está no menu da Administração e tem nome na lista de quem está online", () => {
    expect(ler("src/components/app-sidebar.tsx")).toContain('{ href: "/admin/odontograma", label: "Odontograma", icon: Smile }');
    expect(ler("src/lib/quem-esta-online.ts")).toContain('odontograma: "Odontograma",');
  });

  it("leitura que falha não vira tela vazia", () => {
    const pagina = ler("src/app/(app)/admin/odontograma/page.tsx");
    expect(pagina).toContain("if (falhou) {");
    expect(pagina).toContain("Não foi possível ler os procedimentos agora. Nada foi alterado.");
  });
});
