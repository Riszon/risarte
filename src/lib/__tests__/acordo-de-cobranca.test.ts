import { describe, expect, it } from "vitest";
import { validarAcordo, type AcordoDigitado } from "@/lib/empresarial/acordo-de-cobranca";

const VAZIO: AcordoDigitado = {
  base: "PER_EMPLOYEE",
  fixoCents: null,
  titularesContratados: null,
  dependentesContratados: null,
  modoDoExcedente: null,
  excedenteFixoCents: null,
  excedenteTitularCents: null,
  excedenteDependenteCents: null,
};

describe("o acordo de cobrança editado na empresa (AP19)", () => {
  it("por titular NÃO escreve valor fixo nem excedente — o que estava gravado fica", () => {
    const r = validarAcordo({ ...VAZIO, fixoCents: 500_000, modoDoExcedente: "NEW_FIXED" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valores).toEqual({
      billing_basis: "PER_EMPLOYEE",
      contracted_holders: null,
      contracted_dependents: null,
    });
    expect("fixed_monthly_cents" in r.valores).toBe(false);
    expect("excess_mode" in r.valores).toBe(false);
  });

  it("quantidade contratada vazia é SEM TRAVA, não zero", () => {
    const r = validarAcordo({ ...VAZIO, titularesContratados: 100 });
    expect(r.ok && r.valores.contracted_holders).toBe(100);
    expect(r.ok && r.valores.contracted_dependents).toBeNull();
  });

  it("valor fixo exige o valor", () => {
    const r = validarAcordo({ ...VAZIO, base: "FIXED_PER_COMPANY" });
    expect(r.ok).toBe(false);
  });

  it("novo valor fixo tem de ser MAIOR que o atual (o termo cobra a diferença)", () => {
    const base = { ...VAZIO, base: "FIXED_PER_COMPANY", fixoCents: 500_000, modoDoExcedente: "NEW_FIXED" };
    expect(validarAcordo({ ...base, excedenteFixoCents: 500_000 }).ok).toBe(false);
    const r = validarAcordo({ ...base, excedenteFixoCents: 600_000 });
    expect(r.ok && r.valores.excess_fixed_cents).toBe(600_000);
    // Os campos do outro modo são limpos.
    expect(r.ok && r.valores.excess_holder_fee_cents).toBeNull();
  });

  it("por adesão exige o preço do titular; o do dependente é opcional", () => {
    const base = { ...VAZIO, base: "FIXED_PER_COMPANY", fixoCents: 500_000, modoDoExcedente: "PER_ADHESION" };
    expect(validarAcordo(base).ok).toBe(false);
    const r = validarAcordo({ ...base, excedenteTitularCents: 4500 });
    expect(r.ok && r.valores.excess_holder_fee_cents).toBe(4500);
    expect(r.ok && r.valores.excess_dependent_fee_cents).toBeNull();
    expect(r.ok && r.valores.excess_fixed_cents).toBeNull();
  });

  it("valor fixo sem regra do excedente é permitido (não combinado)", () => {
    const r = validarAcordo({ ...VAZIO, base: "FIXED_PER_COMPANY", fixoCents: 500_000 });
    expect(r.ok && r.valores.excess_mode).toBeNull();
  });
});
