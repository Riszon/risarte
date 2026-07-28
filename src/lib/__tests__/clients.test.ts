import { describe, expect, it } from "vitest";
import {
  isMinorOn,
  isRegistrationComplete,
  missingClientFields,
  missingSummary,
  type ClientRegistrationFields,
} from "@/lib/clients";

// I4: "cadastro completo" = o mesmo que o formulário de novo cliente exige
// (decisão do dono). A régua vale para o selo, o filtro e a trava do
// agendamento — e está espelhada no banco (migração 0173).

const complete = (
  p: Partial<ClientRegistrationFields> = {}
): ClientRegistrationFields => ({
  fullName: "Maria da Silva",
  cpf: "123.456.789-00",
  noCpf: false,
  birthDate: "1990-05-10",
  phone: "(43) 99999-0000",
  email: "maria@exemplo.com",
  zipCode: "86000-000",
  address: "Rua das Flores",
  addressNumber: "100",
  neighborhood: "Centro",
  city: "Londrina",
  state: "PR",
  guardianCount: 0,
  ...p,
});

describe("cadastro completo", () => {
  it("cadastro cheio não tem pendência", () => {
    expect(missingClientFields(complete())).toEqual([]);
    expect(isRegistrationComplete(complete())).toBe(true);
  });

  it("pré-cadastro do Empresarial (nome, CPF e telefone) está incompleto", () => {
    const pre = complete({
      birthDate: null,
      email: null,
      zipCode: null,
      address: null,
      addressNumber: null,
      neighborhood: null,
      city: null,
      state: null,
    });
    expect(isRegistrationComplete(pre)).toBe(false);
    expect(missingClientFields(pre)).toContain("Data de nascimento");
    expect(missingClientFields(pre)).toContain("CEP");
  });

  it("campo só com espaços conta como vazio", () => {
    expect(missingClientFields(complete({ email: "   " }))).toEqual(["E-mail"]);
  });

  it("complemento não é exigido", () => {
    // Não existe "Complemento" na lista de pendências.
    expect(missingClientFields(complete())).not.toContain("Complemento");
  });

  it("sem CPF só é aceito quando marcado 'cliente sem CPF'", () => {
    expect(missingClientFields(complete({ cpf: null }))).toEqual(["CPF"]);
    expect(missingClientFields(complete({ cpf: null, noCpf: true }))).toEqual([]);
  });

  it("menor de 18 anos exige responsável", () => {
    const birth = new Date();
    birth.setFullYear(birth.getFullYear() - 10);
    const minor = complete({ birthDate: birth.toISOString().slice(0, 10) });
    expect(missingClientFields(minor)).toEqual(["Responsável (menor de 18 anos)"]);
    expect(
      missingClientFields({ ...minor, guardianCount: 1 })
    ).toEqual([]);
  });

  it("maior de idade não precisa de responsável", () => {
    expect(isMinorOn("1990-05-10")).toBe(false);
    expect(missingClientFields(complete({ guardianCount: 0 }))).toEqual([]);
  });

  it("resume as pendências para o selo", () => {
    expect(missingSummary([])).toBe("Cadastro completo");
    expect(missingSummary(["CEP"])).toBe("Faltam: CEP");
    expect(missingSummary(["CEP", "E-mail", "Cidade", "UF", "Número"])).toBe(
      "Faltam: CEP, E-mail, Cidade e mais 2"
    );
  });
});
