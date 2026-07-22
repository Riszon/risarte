import { describe, expect, it } from "vitest";
import { formatCep, formatCnpj, formatCpf, formatPhone } from "@/lib/masks";

// As máscaras normalizam qualquer entrada (colada, sem formato) no formato
// canônico — a MESMA função roda no navegador e no servidor antes de salvar.

describe("formatCpf", () => {
  it("formata 11 dígitos", () => {
    expect(formatCpf("12345678901")).toBe("123.456.789-01");
  });
  it("ignora o que não é dígito e corta o excesso", () => {
    expect(formatCpf("123.456.789-01xyz9")).toBe("123.456.789-01");
  });
  it("formata parcialmente enquanto digita", () => {
    expect(formatCpf("1234")).toBe("123.4");
    expect(formatCpf("1234567")).toBe("123.456.7");
  });
  it("vazio permanece vazio", () => {
    expect(formatCpf("")).toBe("");
  });
});

describe("formatCnpj", () => {
  it("formata 14 dígitos", () => {
    expect(formatCnpj("12345678000199")).toBe("12.345.678/0001-99");
  });
});

describe("formatPhone", () => {
  it("celular (11 dígitos)", () => {
    expect(formatPhone("44999998888")).toBe("(44) 99999-8888");
  });
  it("fixo (10 dígitos)", () => {
    expect(formatPhone("4433334444")).toBe("(44) 3333-4444");
  });
  it("corta além de 11 dígitos", () => {
    expect(formatPhone("449999988885555")).toBe("(44) 99999-8888");
  });
});

describe("formatCep", () => {
  it("formata 8 dígitos", () => {
    expect(formatCep("86181000")).toBe("86181-000");
  });
});
