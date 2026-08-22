import { describe, expect, it } from "vitest";
import {
  allocate,
  bestQuote,
  roundSavings,
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

describe("C2 — a melhor cotação", () => {
  it("escolhe o menor preço", () => {
    expect(
      bestQuote([
        { supplierId: "A", unitCents: 2_500 },
        { supplierId: "B", unitCents: 2_100 },
        { supplierId: "C", unitCents: 3_000 },
      ])?.supplierId
    ).toBe("B");
  });

  it("quem NÃO cotou não concorre", () => {
    // Em branco não é zero: tratado como zero, o fornecedor que não respondeu
    // ganharia a comparação e o pedido nasceria sem preço.
    expect(
      bestQuote([
        { supplierId: "A", unitCents: null },
        { supplierId: "B", unitCents: 2_100 },
      ])?.supplierId
    ).toBe("B");
  });

  it("ninguém cotou devolve nulo", () => {
    expect(
      bestQuote([
        { supplierId: "A", unitCents: null },
        { supplierId: "B", unitCents: null },
      ])
    ).toBeNull();
    expect(bestQuote([])).toBeNull();
  });

  it("preço zero é um preço de verdade e concorre", () => {
    // Brinde/bonificação existe. O que não existe é "não cotou = zero".
    expect(
      bestQuote([
        { supplierId: "A", unitCents: 0 },
        { supplierId: "B", unitCents: 2_100 },
      ])?.supplierId
    ).toBe("A");
  });
});

describe("C2 — o rateio da quantidade", () => {
  it("divide proporcionalmente ao que cada unidade pediu", () => {
    const r = allocate(30, [
      { key: "A", requested: 20 },
      { key: "B", requested: 10 },
    ]);
    expect(r.get("A")).toBe(20);
    expect(r.get("B")).toBe(10);
  });

  it("a sobra do arredondamento vai para quem mais pediu", () => {
    // 10 unidades para 3 que pediram 7, 5 e 3 (15): 4,66 / 3,33 / 2 → 4/3/2 = 9.
    // Sobra 1, e ela vai para a maior.
    const r = allocate(10, [
      { key: "A", requested: 7 },
      { key: "B", requested: 5 },
      { key: "C", requested: 3 },
    ]);
    expect(r.get("A")).toBe(5);
    expect(r.get("B")).toBe(3);
    expect(r.get("C")).toBe(2);
    // A soma das partes bate com o total comprado — é o ponto da regra.
    expect((r.get("A") ?? 0) + (r.get("B") ?? 0) + (r.get("C") ?? 0)).toBe(10);
  });

  it("comprar MENOS que o pedido continua fechando a conta", () => {
    const r = allocate(45, [
      { key: "A", requested: 30 },
      { key: "B", requested: 17 },
    ]);
    expect((r.get("A") ?? 0) + (r.get("B") ?? 0)).toBe(45);
  });

  it("comprar MAIS que o pedido também fecha", () => {
    const r = allocate(60, [
      { key: "A", requested: 30 },
      { key: "B", requested: 17 },
    ]);
    expect((r.get("A") ?? 0) + (r.get("B") ?? 0)).toBe(60);
  });

  it("total zero não distribui nada, e não quebra", () => {
    const r = allocate(0, [{ key: "A", requested: 10 }]);
    expect(r.get("A")).toBe(0);
  });

  it("ninguém pediu não divide por zero", () => {
    const r = allocate(10, [{ key: "A", requested: 0 }]);
    expect(r.get("A")).toBe(0);
  });
});

describe("C2 — a economia da rodada", () => {
  it("compara o negociado contra a previsão", () => {
    const s = roundSavings([
      { estimatedTotalCents: 100_000, awardedTotalCents: 85_000, awarded: true },
      { estimatedTotalCents: 50_000, awardedTotalCents: 45_000, awarded: true },
    ]);
    expect(s.savedCents).toBe(20_000);
    expect(s.percent).toBeCloseTo(0.1333, 4);
    expect(s.itemsAwarded).toBe(2);
  });

  it("item SEM cotação não entra na conta da economia", () => {
    // Contá-lo contra zero mostraria uma economia de 100% que não existe.
    const s = roundSavings([
      { estimatedTotalCents: 100_000, awardedTotalCents: 85_000, awarded: true },
      { estimatedTotalCents: 90_000, awardedTotalCents: 0, awarded: false },
    ]);
    expect(s.estimatedCents).toBe(100_000);
    expect(s.savedCents).toBe(15_000);
    expect(s.itemsPending).toBe(1);
  });

  it("negociação PIOR que a previsão aparece como economia negativa", () => {
    // Esconder isso seria fazer o indicador só provar o que se quer provar.
    const s = roundSavings([
      { estimatedTotalCents: 100_000, awardedTotalCents: 120_000, awarded: true },
    ]);
    expect(s.savedCents).toBe(-20_000);
  });

  it("sem previsão nenhuma, não inventa percentual", () => {
    const s = roundSavings([
      { estimatedTotalCents: 0, awardedTotalCents: 50_000, awarded: true },
    ]);
    expect(s.percent).toBeNull();
  });
});
