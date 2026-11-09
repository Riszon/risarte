import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isValidCnpj } from "@/lib/masks";
import {
  EMPTY_SUPPLIER,
  SUPPLIER_COLUMNS,
  avisoDoDocumento,
  codigoDoTipo,
  descreverAbrangencia,
  faltaNaFicha,
  opcoesDeTipo,
  supplierToPayload,
  tipoDePessoa,
  valeNaUnidade,
} from "@/lib/fornecedores";

const MIGRACAO = readFileSync(
  "supabase/migrations/0371_fornecedores_ficha_abrangencia_historico.sql",
  "utf8"
).replace(/\r\n/g, "\n");

const completo = {
  ...EMPTY_SUPPLIER,
  name: "Lab Sorriso",
  document: "11222333000181",
  kind: "laboratorio",
  scope: "unidades" as const,
  clinicIds: ["a"],
};

describe("CNPJ", () => {
  it("confere os dígitos verificadores", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
  });
  it("documento errado só avisa", () => {
    expect(avisoDoDocumento("11222333000182")).toMatch(/CNPJ/);
    expect(avisoDoDocumento("11222333000181")).toBeNull();
    expect(avisoDoDocumento("52998224725")).toBeNull();
    expect(avisoDoDocumento("52998224726")).toMatch(/CPF/);
  });
  it("pessoa jurídica × física pelo tamanho", () => {
    expect(tipoDePessoa("11.222.333/0001-81")).toBe("Pessoa jurídica");
    expect(tipoDePessoa("529.982.247-25")).toBe("Pessoa física");
    expect(tipoDePessoa("123")).toBeNull();
  });
});

describe("obrigatórios (nome, CNPJ/CPF, tipo, abrangência)", () => {
  it("ficha completa passa", () => {
    expect(faltaNaFicha(completo)).toBeNull();
  });
  it("cada falta é dita", () => {
    expect(faltaNaFicha({ ...completo, name: " " })).toMatch(/nome/);
    expect(faltaNaFicha({ ...completo, document: "" })).toMatch(/CNPJ/);
    expect(faltaNaFicha({ ...completo, document: "1234567890" })).toMatch(/CNPJ/);
    expect(faltaNaFicha({ ...completo, kind: "" })).toMatch(/tipo/);
    expect(faltaNaFicha({ ...completo, clinicIds: [] })).toMatch(/unidade/);
  });
  it("rede e Franqueadora não pedem unidade", () => {
    expect(faltaNaFicha({ ...completo, scope: "rede", clinicIds: [] })).toBeNull();
    expect(faltaNaFicha({ ...completo, scope: "franqueadora", clinicIds: [] })).toBeNull();
  });
});

describe("onde vale (espelho de supplier_serves_clinic)", () => {
  it("rede vale em todas; Franqueadora só nela; unidades só nas escolhidas", () => {
    expect(valeNaUnidade("rede", [], "x", false)).toBe(true);
    expect(valeNaUnidade("franqueadora", [], "x", false)).toBe(false);
    expect(valeNaUnidade("franqueadora", [], "f", true)).toBe(true);
    expect(valeNaUnidade("unidades", ["a", "b"], "b", false)).toBe(true);
    expect(valeNaUnidade("unidades", ["a"], "b", false)).toBe(false);
  });
  it("descreve a abrangência", () => {
    const nomes = new Map([["a", "Londrina"], ["b", "Cambé"]]);
    expect(descreverAbrangencia("rede", [], nomes)).toBe("Todas as unidades");
    expect(descreverAbrangencia("franqueadora", [], nomes)).toBe("Só a Franqueadora");
    expect(descreverAbrangencia("unidades", ["a", "b"], nomes)).toBe("Cambé, Londrina");
  });
  it("a conta do banco tem as três abrangências", () => {
    expect(MIGRACAO).toMatch(/when 'rede' then true/);
    expect(MIGRACAO).toMatch(/when 'franqueadora' then exists/);
    expect(MIGRACAO).toMatch(/from public\.supplier_clinics sc\n\s+where sc\.supplier_id = p_supplier_id and sc\.clinic_id = p_clinic_id/);
  });
});

describe("tipos", () => {
  it("código a partir do nome", () => {
    expect(codigoDoTipo("TI e software")).toBe("ti_e_software");
    expect(codigoDoTipo("  Água, luz & telefone ")).toBe("agua_luz_telefone");
  });
  it("tipo desativado só aparece para quem já o usa", () => {
    const kinds = [
      { code: "b", label: "B", sortOrder: 20, active: true },
      { code: "a", label: "A", sortOrder: 10, active: true },
      { code: "velho", label: "Velho", sortOrder: 5, active: false },
    ];
    expect(opcoesDeTipo(kinds, "").map((k) => k.code)).toEqual(["a", "b"]);
    expect(opcoesDeTipo(kinds, "velho").map((k) => k.code)).toEqual(["velho", "a", "b"]);
  });
});

describe("a tela e o banco falam dos mesmos campos", () => {
  const corpo = MIGRACAO.slice(
    MIGRACAO.indexOf("create or replace function public.save_supplier"),
    MIGRACAO.indexOf("revoke execute on function public.save_supplier")
  );
  const lidosPeloBanco = new Set(
    [...corpo.matchAll(/p ->> '([a-z_]+)'|p -> '([a-z_]+)'/g)].map((m) => m[1] ?? m[2])
  );

  it("a porta lê algum campo (régua que não acha nada grita)", () => {
    expect(lidosPeloBanco.size).toBeGreaterThan(30);
  });
  it("todo campo que a tela manda o banco lê, e vice-versa", () => {
    const enviados = new Set(Object.keys(supplierToPayload(completo, "a")));
    expect([...enviados].filter((k) => !lidosPeloBanco.has(k))).toEqual([]);
    expect([...lidosPeloBanco].filter((k) => !enviados.has(k))).toEqual([]);
  });
  it("as colunas que a ficha lê existem (0194 + 0371)", () => {
    const base = readFileSync("supabase/migrations/0194_payables.sql", "utf8");
    const todas = base + MIGRACAO;
    for (const c of SUPPLIER_COLUMNS.split(",").map((s) => s.trim())) {
      expect(todas, c).toMatch(new RegExp(`\\b${c}\\b`));
    }
  });
});

describe("nenhuma tela volta a ler fornecedor só pela unidade onde foi cadastrado", () => {
  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? arquivos(p) : /\.tsx?$/.test(n) ? [p] : [];
    });
  }
  const telas = arquivos("src/app");

  it("a varredura achou as telas", () => {
    expect(telas.length).toBeGreaterThan(100);
  });
  it("`.from(\"suppliers\")` seguido de `.eq(\"clinic_id\"` reprova", () => {
    const culpadas = telas.filter((p) =>
      /\.from\("suppliers"\)[\s\S]{0,200}?\.eq\("clinic_id"/.test(readFileSync(p, "utf8"))
    );
    expect(culpadas).toEqual([]);
  });
  it("Contas a pagar, Estoque e Bens usam a lista que vale na unidade", () => {
    for (const p of [
      "src/app/(app)/financeiro/contas-a-pagar/page.tsx",
      "src/app/(app)/estoque/page.tsx",
      "src/app/(app)/financeiro/bens/page.tsx",
    ]) {
      expect(readFileSync(p, "utf8"), p).toMatch(/fornecedoresDaUnidade(<[^>]*>)?\(/);
    }
  });
});
