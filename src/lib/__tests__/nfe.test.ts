import { describe, expect, it } from "vitest";
import {
  invoiceErrors,
  isValidGtin,
  isValidNfeKey,
  matchLines,
  normalize,
  suggestItem,
  toCents,
  type NfeInvoice,
  type NfeLine,
} from "../nfe";

function line(over: Partial<NfeLine> = {}): NfeLine {
  return {
    supplierCode: "1234",
    description: "RESINA COMP Z350XT A2 4G 3M",
    gtin: "",
    unit: "UN",
    quantity: 1,
    unitCostCents: 18000,
    totalCents: 18000,
    ...over,
  };
}

describe("chave da NF-e", () => {
  it("exige 44 dígitos — é a trava contra importar a mesma nota duas vezes", () => {
    expect(isValidNfeKey("3".repeat(44))).toBe(true);
    expect(isValidNfeKey("3".repeat(43))).toBe(false);
    expect(isValidNfeKey("")).toBe(false);
  });

  it("ignora pontuação", () => {
    expect(isValidNfeKey(`NFe${"9".repeat(44)}`)).toBe(true);
  });
});

describe("GTIN", () => {
  it("aceita código de barras válido", () => {
    expect(isValidGtin("7891234567895")).toBe(true); // EAN-13 com DV correto
  });

  it("recusa dígito verificador errado", () => {
    // A NF-e aceita "SEM GTIN" e alguns emissores põem lixo no campo. Um GTIN
    // inválido virando chave amarraria dois produtos diferentes ao mesmo item —
    // o pior erro possível aqui, porque é silencioso.
    expect(isValidGtin("7891234567890")).toBe(false);
  });

  it("recusa tamanho inválido e texto", () => {
    expect(isValidGtin("123")).toBe(false);
    expect(isValidGtin("SEM GTIN")).toBe(false);
  });
});

describe("valores", () => {
  it("converte o decimal do XML para centavos", () => {
    expect(toCents("180.00")).toBe(18000);
    expect(toCents("0.25")).toBe(25);
    expect(toCents(25.7143)).toBe(2571);
  });

  it("valor ilegível vira zero em vez de NaN", () => {
    expect(toCents("")).toBe(0);
    expect(toCents("abc")).toBe(0);
  });
});

describe("casamento por código, nunca por nome", () => {
  it("GTIN vence — vale entre fornecedores diferentes", () => {
    const r = matchLines([line({ gtin: "7891234567895", supplierCode: "999" })], {
      byGtin: { "7891234567895": "item-resina" },
      bySupplierCode: { "999": "item-errado" },
    });
    expect(r[0]).toEqual({
      supplierCode: "999",
      itemId: "item-resina",
      matchedBy: "gtin",
    });
  });

  it("sem GTIN, vale o vínculo daquele fornecedor", () => {
    const r = matchLines([line({ supplierCode: "1234" })], {
      byGtin: {},
      bySupplierCode: { "1234": "item-resina" },
    });
    expect(r[0].matchedBy).toBe("fornecedor");
    expect(r[0].itemId).toBe("item-resina");
  });

  it("GTIN inválido NÃO casa — cai para o vínculo do fornecedor", () => {
    const r = matchLines(
      [line({ gtin: "7891234567890", supplierCode: "1234" })],
      { byGtin: { "7891234567890": "item-qualquer" },
        bySupplierCode: { "1234": "item-certo" } }
    );
    expect(r[0].matchedBy).toBe("fornecedor");
    expect(r[0].itemId).toBe("item-certo");
  });

  it("item desconhecido fica SEM casamento, esperando alguém confirmar", () => {
    const r = matchLines([line({ supplierCode: "novo" })], {
      byGtin: {},
      bySupplierCode: {},
    });
    expect(r[0].itemId).toBeNull();
    expect(r[0].matchedBy).toBeNull();
  });
});

describe("sugestão por descrição — só para a primeira vez", () => {
  it("aponta o candidato mais provável", () => {
    const s = suggestItem("RESINA COMPOSTA A2 SERINGA", [
      { id: "a", name: "Resina composta A2" },
      { id: "b", name: "Adesivo dentinário" },
    ]);
    expect(s?.itemId).toBe("a");
  });

  it("ignora acento e pontuação", () => {
    expect(normalize("ADESIVO DENTINÁRIO 5ML")).toBe("adesivo dentinario 5ml");
  });

  it("não sugere quando a semelhança é fraca — ruído convida a confirmar sem olhar", () => {
    const s = suggestItem("PARAFUSO SEXTAVADO INOX", [
      { id: "a", name: "Resina composta A2" },
      { id: "b", name: "Adesivo dentinário" },
    ]);
    expect(s).toBeNull();
  });

  it("sugestão nunca é casamento: matchLines não usa descrição", () => {
    const r = matchLines([line()], { byGtin: {}, bySupplierCode: {} });
    expect(r[0].itemId).toBeNull();
  });
});

describe("validação da nota", () => {
  function invoice(over: Partial<NfeInvoice> = {}): NfeInvoice {
    return {
      key: "3".repeat(44),
      number: "12345",
      issueDate: "2026-08-12",
      supplierCnpj: "12345678000199",
      supplierName: "Dental Distribuidora",
      totalCents: 18000,
      lines: [line()],
      installments: [{ dueDate: "2026-09-12", amountCents: 18000 }],
      ...over,
    };
  }

  it("nota íntegra passa", () => {
    expect(invoiceErrors(invoice())).toEqual([]);
  });

  it("recusa quando a soma dos itens não bate com o total", () => {
    // Diferença aqui significa que li o arquivo errado — melhor recusar que
    // gravar torto e contaminar o custo médio.
    expect(
      invoiceErrors(invoice({ totalCents: 50000 }))
    ).toContain("A soma dos itens não bate com o total da nota — confira o arquivo.");
  });

  it("tolera centavos de diferença (arredondamento do emissor)", () => {
    expect(invoiceErrors(invoice({ totalCents: 18050 }))).toEqual([]);
  });

  it("exige chave, CNPJ e itens", () => {
    expect(invoiceErrors(invoice({ key: "123" })).length).toBe(1);
    expect(invoiceErrors(invoice({ supplierCnpj: "1" })).length).toBe(1);
    expect(invoiceErrors(invoice({ lines: [], totalCents: 0 })).length).toBe(1);
  });
});
