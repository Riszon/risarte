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

  it("venda direta na unidade (VD)", () => {
    expect(categorizeNotification("Venda direta na unidade — R$ 150,00")).toBe(
      "vendas_diretas"
    );
    expect(
      categorizeNotification("ATENÇÃO: venda direta lançada APÓS o atendimento")
    ).toBe("vendas_diretas");
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

describe("categorizeNotification — PPR+", () => {
  it("adesão ao PPR+ vai para a categoria do programa", () => {
    expect(categorizeNotification("PPR+ — nova adesão ao Plano Família")).toBe(
      "ppr"
    );
  });

  it("aviso do Riso+ também é do programa", () => {
    expect(categorizeNotification("Riso+ Social — pontos do mês")).toBe("ppr");
  });
});

describe("categorizeNotification — alertas do Financeiro (FIN7.3)", () => {
  it("os quatro alertas caem em 'financeiro'", () => {
    expect(categorizeNotification("Orçamento estourando — Mídia paga")).toBe(
      "financeiro"
    );
    expect(categorizeNotification("Caixa negativo previsto para 12/09")).toBe(
      "financeiro"
    );
    expect(
      categorizeNotification("Faturamento atrás do ponto de equilíbrio")
    ).toBe("financeiro");
    expect(categorizeNotification("Atraso a receber acima do limite")).toBe(
      "financeiro"
    );
  });

  it("orçamento de TRATAMENTO continua sendo do plano", () => {
    // A palavra "orçamento" sozinha não basta: o alerta financeiro casa pela
    // frase inteira, senão todo aviso do comercial viraria financeiro.
    expect(categorizeNotification("Plano aprovado — orçamento assinado")).toBe(
      "plano"
    );
  });
});
