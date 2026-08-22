import { describe, expect, it } from "vitest";
import {
  estimateLabel,
  estimateTrust,
  isEstimateStale,
  lineTotalCents,
  requestTotals,
  sendBlock,
  sendBlockMessage,
  statusLabel,
  type PurchaseRequestItem,
} from "@/lib/purchases";

const item = (
  over: Partial<PurchaseRequestItem> = {}
): PurchaseRequestItem => ({
  id: "1",
  itemId: "i1",
  description: "Resina A2",
  accountCode: null,
  quantity: 2,
  purchaseUnit: "caixa",
  estimatedUnitCents: 2_500,
  estimatedTotalCents: 5_000,
  estimateSource: "unidade",
  estimateDate: "2026-08-01",
  notes: "",
  ...over,
});

describe("a origem da previsão", () => {
  it("cada degrau tem nome em pt-BR", () => {
    expect(estimateLabel("unidade")).toBe("última compra desta unidade");
    expect(estimateLabel("rede")).toBe("última compra da rede");
    expect(estimateLabel("medio")).toBe("custo médio atual");
    expect(estimateLabel("sem_referencia")).toBe("sem referência de preço");
  });

  it("a confiança cai conforme o degrau", () => {
    // É o que decide a cor na tela: o gerente precisa ver de relance se o
    // número é da casa dele ou um chute do sistema.
    expect(estimateTrust("unidade")).toBe("boa");
    expect(estimateTrust("manual")).toBe("boa");
    expect(estimateTrust("rede")).toBe("razoavel");
    expect(estimateTrust("medio")).toBe("fraca");
    expect(estimateTrust("sem_referencia")).toBe("fraca");
  });
});

describe("previsão velha", () => {
  it("preço de mais de seis meses é lembrança, não referência", () => {
    expect(isEstimateStale("2026-01-01", "2026-08-21")).toBe(true);
    expect(isEstimateStale("2026-06-01", "2026-08-21")).toBe(false);
  });

  it("o limite é ajustável", () => {
    expect(isEstimateStale("2026-06-01", "2026-08-21", 30)).toBe(true);
  });

  it("sem data não é velha — é sem data", () => {
    // O custo médio não tem data de compra; marcá-lo como velho seria inventar
    // um defeito que ele não tem.
    expect(isEstimateStale(null, "2026-08-21")).toBe(false);
  });

  it("exatamente no limite ainda vale", () => {
    expect(isEstimateStale("2026-02-22", "2026-08-21", 180)).toBe(false);
  });
});

describe("os totais da lista", () => {
  it("soma e conta o que está sem preço", () => {
    const t = requestTotals([
      item(),
      item({ id: "2", estimatedTotalCents: 12_000 }),
      item({
        id: "3",
        estimateSource: "sem_referencia",
        estimatedUnitCents: 0,
        estimatedTotalCents: 0,
      }),
    ]);
    expect(t.items).toBe(3);
    expect(t.estimatedCents).toBe(17_000);
    expect(t.withoutEstimate).toBe(1);
  });

  it("linha com origem mas preço zero também conta como sem previsão", () => {
    const t = requestTotals([
      item({ estimateSource: "medio", estimatedUnitCents: 0 }),
    ]);
    expect(t.withoutEstimate).toBe(1);
  });

  it("lista vazia não quebra", () => {
    expect(requestTotals([]).estimatedCents).toBe(0);
  });
});

describe("o total da linha", () => {
  it("multiplica e arredonda", () => {
    expect(lineTotalCents(2_500, 3)).toBe(7_500);
    expect(lineTotalCents(333, 3)).toBe(999);
  });

  it("sem preço ou sem quantidade, zero", () => {
    expect(lineTotalCents(0, 5)).toBe(0);
    expect(lineTotalCents(2_500, 0)).toBe(0);
  });
});

describe("o que impede enviar", () => {
  it("lista vazia não vai", () => {
    const b = sendBlock({ status: "rascunho" }, []);
    expect(b.can).toBe(false);
    expect(sendBlockMessage(b)).toContain("vazia");
  });

  it("lista já enviada não vai de novo", () => {
    const b = sendBlock({ status: "enviada" }, [item()]);
    expect(b.can).toBe(false);
    expect(sendBlockMessage(b)).toContain("já foi enviada");
  });

  it("linha SEM preço não impede o envio", () => {
    // A franqueadora vai cotar de qualquer jeito; exigir previsão travaria
    // justamente a primeira compra de um item novo.
    const b = sendBlock({ status: "rascunho" }, [
      item({ estimateSource: "sem_referencia", estimatedUnitCents: 0 }),
    ]);
    expect(b.can).toBe(true);
    expect(sendBlockMessage(b)).toBeNull();
  });
});

describe("rótulos de situação", () => {
  it("traduz os estados", () => {
    expect(statusLabel("rascunho")).toBe("Rascunho");
    expect(statusLabel("em_negociacao")).toBe("Em negociação");
  });
});
