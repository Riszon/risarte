import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ehFinanceiroDaFranqueadora, unidadesDoEscopoFinanceiro } from "@/lib/finance/escopo";

// OC-00120: o Financeiro da Franqueadora só via a Franqueadora no "Trabalhar
// na clínica" — e o financeiro é por unidade ativa. A regra (escopo de
// unidades) e o banco (0185) sempre deixaram; faltava a tela.

const clinicas = [
  { id: "fq", type: "franchisor", is_active: true },
  { id: "u1", type: "franchise_unit", is_active: true },
  { id: "u2", type: "franchise_unit", is_active: true },
  { id: "u3", type: "franchise_unit", is_active: false },
];

describe("OC-00120 — as unidades do escopo no seletor do Financeiro da Franqueadora", () => {
  it("quem tem a função", () => {
    expect(ehFinanceiroDaFranqueadora({ fq: ["finance_franchisor"] })).toBe(true);
    expect(ehFinanceiroDaFranqueadora({ fq: ["franchisor_staff"], u1: ["unit_manager"] })).toBe(false);
  });
  it("entram as unidades ativas do escopo, sem repetir a que já está na lista", () => {
    expect(unidadesDoEscopoFinanceiro(clinicas, ["fq", "u1", "u2", "u3"], ["fq"]).map((c) => c.id)).toEqual(["u1", "u2"]);
  });
  it("escopo de unidades específicas: só elas", () => {
    expect(unidadesDoEscopoFinanceiro(clinicas, ["fq", "u2"], ["fq"]).map((c) => c.id)).toEqual(["u2"]);
  });
  it("unidade inativa fica de fora; a Franqueadora não entra por aqui", () => {
    expect(unidadesDoEscopoFinanceiro(clinicas, ["u3", "fq"], []).map((c) => c.id)).toEqual([]);
  });
  it("na sessão: só para quem tem a função, e as unidades entram SEM função nelas", () => {
    const auth = readFileSync("src/lib/auth.ts", "utf8").replace(/\r\n/g, "\n");
    expect(auth).toContain("if (!isAdminMaster && ambientes.sistema && ehFinanceiroDaFranqueadora(rolesByClinic)) {");
    const bloco = auth.slice(auth.indexOf("ehFinanceiroDaFranqueadora(rolesByClinic)"), auth.indexOf("let clinics: Clinic[];"));
    expect(bloco).toContain("memberClinics.set(c.id, c);");
    expect(bloco).not.toContain("rolesByClinic[");
  });
});
