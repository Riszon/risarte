import { describe, expect, it } from "vitest";
import { categorizeNotification } from "@/lib/notifications";

// A central de notificações classifica pelo TÍTULO gravado pelas funções do
// banco. Estes testes garantem que os títulos reais caem na categoria certa.

describe("categorizeNotification", () => {
  it("aniversários", () => {
    expect(categorizeNotification("Aniversariantes do dia")).toBe("aniversario");
  });

  it("plano de tratamento (título começa com 'Plano')", () => {
    expect(categorizeNotification("Plano aprovado")).toBe("plano");
    expect(categorizeNotification("Plano devolvido para revisão")).toBe("plano");
  });

  it("comercial (apresentação)", () => {
    expect(categorizeNotification("Agendar apresentação comercial")).toBe(
      "comercial"
    );
  });

  it("compartilhamento entre unidades", () => {
    expect(
      categorizeNotification("Cliente compartilhado com a sua unidade")
    ).toBe("compartilhamento");
  });

  it("'Fechamento de agenda' é AGENDA, não início de tratamento", () => {
    expect(categorizeNotification("Fechamento de agenda")).toBe("agenda");
  });

  it("'Fechamento!' (venda) é início de tratamento", () => {
    expect(
      categorizeNotification("Fechamento! Agendar início de tratamento")
    ).toBe("inicio_tratamento");
  });

  it("transferência de cliente", () => {
    expect(
      categorizeNotification("Cliente transferido para outra unidade")
    ).toBe("transferencia");
  });

  it("o que não casa com nada cai em 'outras'", () => {
    expect(categorizeNotification("Novo procedimento para refazer")).toBe(
      "outras"
    );
    expect(categorizeNotification("")).toBe("outras");
  });
});
