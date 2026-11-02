import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cpfDigitadoInvalido,
  cpfGravadoInvalido,
  cpfsInvalidosDaFicha,
} from "@/lib/cpf-invalido";

// AP90, decisão do dono (02/11/2026): CPF inválido SÓ AVISA no cadastro, e o
// prontuário lembra até alguém corrigir.

const ler = (...p: string[]) =>
  readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("CPF inválido avisa, não barra", () => {
  it("enquanto digita, avisa só com os 11 dígitos e a conta errada", () => {
    expect(cpfDigitadoInvalido("123.456.789-00")).toBe(true);
    expect(cpfDigitadoInvalido("111.111.111-11")).toBe(true);
    expect(cpfDigitadoInvalido("529.982.247-25")).toBe(false);
    expect(cpfDigitadoInvalido("529.982.2")).toBe(false); // ainda digitando
    expect(cpfDigitadoInvalido("")).toBe(false);
    expect(cpfDigitadoInvalido(null)).toBe(false);
  });

  it("gravado, qualquer CPF preenchido que não confere é inválido", () => {
    expect(cpfGravadoInvalido("123.456.789-00")).toBe(true);
    expect(cpfGravadoInvalido("123.456")).toBe(true); // responsável sem os 11
    expect(cpfGravadoInvalido("529.982.247-25")).toBe(false);
    expect(cpfGravadoInvalido("")).toBe(false);
    expect(cpfGravadoInvalido(null)).toBe(false);
  });

  it("a ficha aponta o cliente e cada responsável com CPF inválido", () => {
    expect(
      cpfsInvalidosDaFicha({
        cpf: "123.456.789-00",
        noCpf: false,
        responsaveis: [
          { nome: "Responsável Um", cpf: "529.982.247-25" },
          { nome: "Responsável Dois", cpf: "111.111.111-11" },
          { nome: null, cpf: "000" },
          { nome: "Sem CPF", cpf: null },
        ],
      })
    ).toEqual([
      "do cliente",
      "de Responsável Dois (responsável)",
      "do responsável",
    ]);
  });

  it("cliente marcado sem CPF e tudo certo = nenhum aviso", () => {
    expect(
      cpfsInvalidosDaFicha({ cpf: null, noCpf: true, responsaveis: [] })
    ).toEqual([]);
    expect(
      cpfsInvalidosDaFicha({
        cpf: "529.982.247-25",
        noCpf: false,
        responsaveis: [{ nome: "R", cpf: "111.444.777-35" }],
      })
    ).toEqual([]);
  });

  it("o aviso está nos três campos: cliente, responsável e Risartano", () => {
    const cliente = ler("src", "app", "(app)", "prontuarios", "client-form.tsx");
    expect(cliente).toContain("<AvisoCpfInvalido cpf={cpfDigitado} />");
    expect(cliente).toContain("<AvisoCpfInvalido cpf={guardian.cpf} />");
    const risartano = ler("src", "app", "(app)", "risartanos", "formulario.tsx");
    expect(risartano).toContain("<AvisoCpfInvalido cpf={cpf} />");
  });

  it("o salvar NÃO recusa CPF inválido (só avisar, por enquanto)", () => {
    for (const p of [
      ["src", "app", "(app)", "prontuarios", "actions.ts"],
      ["src", "app", "(app)", "risartanos", "actions.ts"],
    ]) {
      const fonte = ler(...p);
      expect(fonte).not.toContain("isValidCpf");
      expect(fonte).not.toContain("cpf-invalido");
    }
  });

  it("o prontuário conta e mostra o lembrete no painel Precisa de atenção", () => {
    const ficha = ler("src", "app", "(app)", "prontuarios", "[id]", "page.tsx");
    expect(ficha).toContain("(cpfsInvalidos.length > 0 ? 1 : 0)");
    expect(ficha).toMatch(/\{cpfsInvalidos\.length > 0 && \(\s*<AtencaoItem/);
    expect(ficha).toContain('titulo="CPF inválido no cadastro"');
  });
});
