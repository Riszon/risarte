import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  anotacaoDoPedido,
  mensagemDoPedido,
  pendenciasDoPedido,
  type DadosDoPedido,
} from "@/lib/empresarial/pedido-de-informacoes";
import { faltaParaContrato } from "@/lib/empresarial/proposta";

const vazio: DadosDoPedido = {
  employeeCount: null,
  paymentModel: null,
  billingBasis: null,
  legalName: null,
  responsibleName: null,
  responsibleCpf: null,
  responsibleEmail: null,
  cnpj: null,
};

const completo: DadosDoPedido = {
  employeeCount: 11,
  paymentModel: "COMPANY_PAYS",
  billingBasis: "PER_EMPLOYEE",
  legalName: "Cooperativa Recicla Brasil",
  responsibleName: "Franciele Brito da Silva",
  responsibleCpf: "123.456.789-09",
  responsibleEmail: "f@exemplo.com",
  cnpj: "23.902.493/0001-50",
};

describe("o que pedir à empresa (09/11/2026)", () => {
  it("decisão nossa NUNCA vai na mensagem: quem paga e como cobra ficam na tela", () => {
    const p = pendenciasDoPedido(vazio);
    expect(p.nossas).toEqual(["quem paga o programa", "como será cobrado"]);
    expect(p.daEmpresa.join(" ")).not.toMatch(/quem paga|como será cobrado/i);
  });

  it("cada pendência da régua comum vira pedido ou fica conosco — nenhuma se perde", () => {
    const p = pendenciasDoPedido(vazio);
    expect(p.daEmpresa.length + p.nossas.length).toBe(faltaParaContrato(vazio).length);
    expect(p.daEmpresa).toContain("CNPJ da empresa");
    expect(p.daEmpresa).toContain("Quantos colaboradores (titulares) vão entrar no programa");
  });

  it("os campos só do contrato entram quando a tela os conhece e estão vazios", () => {
    expect(pendenciasDoPedido(completo)).toEqual({ daEmpresa: [], nossas: [] });
    const p = pendenciasDoPedido({
      ...completo,
      responsibleRole: "Presidente",
      address: null,
      responsibleRg: "",
      responsibleNationality: null,
      dueDay: null,
    });
    expect(p.daEmpresa).toEqual([
      "RG de quem vai assinar",
      "Nacionalidade de quem vai assinar",
      "Endereço completo da sede, com CEP",
      "Dia preferido para o vencimento da mensalidade (de 1 a 28)",
    ]);
  });

  it("endereço sem rua ou sem cidade conta como faltando", () => {
    const p = pendenciasDoPedido({ ...completo, address: { street: "Rua A", number: "1" } });
    expect(p.daEmpresa).toEqual(["Endereço completo da sede, com CEP"]);
  });
});

describe("a mensagem", () => {
  it("cumprimenta pelo primeiro nome, lista e assina", () => {
    const m = mensagemDoPedido({
      contato: "Franciele Brito da Silva",
      empresa: "Cooperativa Recicla Brasil",
      consultor: "Jeferson",
      perguntas: ["RG de quem vai assinar", "E-mail de quem vai assinar"],
    });
    expect(m.startsWith("Olá, Franciele! Tudo bem?")).toBe(true);
    expect(m).toContain("para a Cooperativa Recicla Brasil");
    expect(m).toContain("• RG de quem vai assinar\n• E-mail de quem vai assinar");
    expect(m.endsWith("Jeferson — Risarte Empresarial")).toBe(true);
  });

  it("sem nome nem consultor", () => {
    const m = mensagemDoPedido({ contato: null, empresa: "X", consultor: null, perguntas: ["a"] });
    expect(m.startsWith("Olá! Tudo bem?")).toBe(true);
    expect(m.endsWith("Risarte Empresarial")).toBe(true);
  });

  it("a anotação do Histórico diz o que foi pedido", () => {
    expect(
      anotacaoDoPedido(["RG de quem vai assinar", "CNPJ da empresa", "Razão social da empresa"])
    ).toBe(
      "Pedido de informações enviado pelo WhatsApp: RG de quem vai assinar; CNPJ da empresa; razão social da empresa."
    );
  });
});

describe("o botão segue as telas", () => {
  it("a aba Proposta e o contrato usam a mesma régua", () => {
    for (const f of [
      "src/app/(app)/empresarial/funil/[leadId]/page.tsx",
      "src/app/(app)/empresarial/funil/[leadId]/contrato/page.tsx",
    ]) {
      expect(readFileSync(f, "utf8")).toContain("pendenciasDoPedido(");
    }
  });
});
