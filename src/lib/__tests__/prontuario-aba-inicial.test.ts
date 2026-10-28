import { describe, expect, it } from "vitest";
import { abaInicialDoProntuario } from "@/lib/prontuario/aba-inicial";

// Reorganização do prontuário (28/10/2026): cada papel cai na aba do seu
// trabalho; o aviso (`?aba=`) continua mandando.
describe("a aba em que o prontuário abre", () => {
  const base = { abaPedida: null, isAdminMaster: false, isPlannerAnywhere: false };

  it("o aviso manda, seja quem for", () => {
    expect(
      abaInicialDoProntuario({ ...base, abaPedida: "pedidos", rolesNaUnidade: ["dentist"] })
    ).toBe("pedidos");
  });

  it("o dentista cai no Desenvolvimento Clínico", () => {
    expect(abaInicialDoProntuario({ ...base, rolesNaUnidade: ["dentist"] })).toBe("desenvolvimento");
  });

  it("o Coordenador cai no Clínico, mesmo que também atenda", () => {
    expect(
      abaInicialDoProntuario({ ...base, rolesNaUnidade: ["dentist", "clinical_coordinator"] })
    ).toBe("clinico");
  });

  it("o Planner cai no Plano, inclusive quando é Planner em outra unidade", () => {
    expect(abaInicialDoProntuario({ ...base, rolesNaUnidade: ["planner_dentist"] })).toBe("plano");
    expect(
      abaInicialDoProntuario({ ...base, rolesNaUnidade: ["dentist"], isPlannerAnywhere: true })
    ).toBe("plano");
  });

  it("recepção, gerente, comercial e o Admin caem no Cadastro", () => {
    expect(abaInicialDoProntuario({ ...base, rolesNaUnidade: ["receptionist"] })).toBe("cadastro");
    expect(abaInicialDoProntuario({ ...base, rolesNaUnidade: ["unit_manager"] })).toBe("cadastro");
    expect(abaInicialDoProntuario({ ...base, rolesNaUnidade: [] })).toBe("cadastro");
    expect(
      abaInicialDoProntuario({ ...base, isAdminMaster: true, rolesNaUnidade: ["dentist"] })
    ).toBe("cadastro");
  });
});
