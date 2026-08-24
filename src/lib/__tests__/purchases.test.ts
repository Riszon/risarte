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
  orderStatusAfter,
  pendingQuantity,
  priceDiffCents,
  receiptTotals,
  suggestInstallments,
  type ReceiptLine,
  deliveryRate,
  leakagePercent,
  leakageTotals,
  savingsTotals,
  type LeakageRow,
  type SavingsRow,
  type SupplierRow,
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

describe("recebimento (C3b)", () => {
  const line = (
    ordered: number,
    already: number,
    quantity: number,
    orderedUnit: number,
    invoiced: number | null = null
  ): ReceiptLine => ({
    orderItemId: `i${ordered}-${already}-${quantity}`,
    description: "item",
    orderedQuantity: ordered,
    alreadyReceived: already,
    quantity,
    orderedUnitCents: orderedUnit,
    invoicedUnitCents: invoiced,
  });

  it("o que falta chegar nunca é negativo", () => {
    expect(pendingQuantity({ orderedQuantity: 10, alreadyReceived: 4 })).toBe(6);
    // Veio mais do que se pediu: não falta nada, e não sobra "menos dois".
    expect(pendingQuantity({ orderedQuantity: 10, alreadyReceived: 12 })).toBe(0);
  });

  it("a nota cobrando mais dá diferença positiva", () => {
    // 10 embalagens: pedido a R$ 5,00, nota a R$ 5,50 → R$ 5,00 a mais.
    expect(priceDiffCents(line(10, 0, 10, 500, 550))).toBe(500);
  });

  it("a nota cobrando menos dá diferença negativa", () => {
    expect(priceDiffCents(line(10, 0, 10, 500, 450))).toBe(-500);
  });

  it("sem preço na nota, vale o do pedido e não há diferença", () => {
    // Zero entraria no estoque como material de graça.
    expect(priceDiffCents(line(10, 0, 10, 500, null))).toBe(0);
  });

  it("soma o recebimento pelo preço da NOTA", () => {
    const t = receiptTotals([
      line(10, 0, 10, 500, 550),
      line(4, 0, 4, 1_000, null),
    ]);
    expect(t.itemsCents).toBe(5_500 + 4_000);
    expect(t.priceDiffCents).toBe(500);
  });

  it("conta as linhas que vieram em quantidade diferente", () => {
    const t = receiptTotals([
      line(10, 0, 10, 500), // exatamente o que faltava
      line(10, 0, 8, 500), // faltaram 2
      line(10, 0, 12, 500), // vieram 2 a mais
    ]);
    expect(t.quantityDivergences).toBe(2);
  });

  it("linha zerada não entra em nada", () => {
    const t = receiptTotals([line(10, 0, 0, 500, 900)]);
    expect(t.itemsCents).toBe(0);
    expect(t.priceDiffCents).toBe(0);
    expect(t.quantityDivergences).toBe(0);
  });
});

describe("situação do pedido depois de receber", () => {
  it("nada recebido continua aberto", () => {
    expect(
      orderStatusAfter([{ orderedQuantity: 10, alreadyReceived: 0 }])
    ).toBe("aberto");
  });

  it("parte recebida fica em parte", () => {
    expect(
      orderStatusAfter([{ orderedQuantity: 10, alreadyReceived: 8 }])
    ).toBe("recebido_parcial");
  });

  it("tudo recebido fecha", () => {
    expect(
      orderStatusAfter([
        { orderedQuantity: 10, alreadyReceived: 10 },
        { orderedQuantity: 4, alreadyReceived: 4 },
      ])
    ).toBe("recebido");
  });

  it("sobra num item NÃO compensa falta em outro", () => {
    // Compensar esconderia a pendência com o fornecedor justamente onde ela
    // precisa aparecer.
    expect(
      orderStatusAfter([
        { orderedQuantity: 10, alreadyReceived: 12 },
        { orderedQuantity: 10, alreadyReceived: 8 },
      ])
    ).toBe("recebido_parcial");
  });
});

describe("parcelas sugeridas", () => {
  it("a última absorve o resíduo", () => {
    const p = suggestInstallments(10_000, 3, "2026-09-10");
    expect(p.map((x) => x.amountCents)).toEqual([3_333, 3_333, 3_334]);
    expect(p.reduce((s, x) => s + x.amountCents, 0)).toBe(10_000);
  });

  it("uma parcela é o total", () => {
    expect(suggestInstallments(10_000, 1, "2026-09-10")).toEqual([
      { amountCents: 10_000, dueDate: "2026-09-10" },
    ]);
  });

  it("avança um mês por parcela, e dia 31 vira o último do mês curto", () => {
    const p = suggestInstallments(300, 3, "2026-01-31");
    expect(p.map((x) => x.dueDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("total zerado não gera parcela", () => {
    expect(suggestInstallments(0, 3, "2026-09-10")).toEqual([]);
  });
});

describe("dashboard: a economia da negociação", () => {
  const round = (
    estimated: number,
    awarded: number,
    pending = 0
  ): SavingsRow => ({
    roundId: `r${estimated}`,
    roundCode: "RC",
    roundName: "",
    closedAt: null,
    itemsAwarded: 1,
    itemsPending: pending,
    estimatedCents: estimated,
    awardedCents: awarded,
    savedCents: estimated - awarded,
  });

  it("acumula a economia e o percentual", () => {
    const t = savingsTotals([round(100_000, 90_000), round(50_000, 45_000)]);
    expect(t.savedCents).toBe(15_000);
    expect(t.percent).toBeCloseTo(0.1, 4);
    expect(t.rounds).toBe(2);
  });

  it("negociação PIOR que a previsão dá economia negativa", () => {
    // Precisa aparecer, não ser escondida: é o caso que derruba a tese.
    const t = savingsTotals([round(100_000, 120_000)]);
    expect(t.savedCents).toBe(-20_000);
    expect(t.percent).toBeCloseTo(-0.2, 4);
  });

  it("sem previsão não inventa percentual", () => {
    const t = savingsTotals([round(0, 50_000)]);
    expect(t.percent).toBeNull();
  });

  it("soma os itens que ficaram sem cotação", () => {
    expect(savingsTotals([round(100, 90, 3), round(100, 90, 2)]).itemsPending)
      .toBe(5);
  });
});

describe("dashboard: o vazamento", () => {
  const leak = (
    network: number,
    local: number,
    name = "u"
  ): LeakageRow => ({
    clinicId: name,
    clinicName: name,
    networkCents: network,
    localCents: local,
    localPurchases: local > 0 ? 1 : 0,
    declaredLocalRequests: 0,
  });

  it("mede a fração comprada por fora", () => {
    expect(leakagePercent(leak(75_000, 25_000))).toBeCloseTo(0.25, 4);
  });

  it("sem compra nenhuma, não é 0% de vazamento — é sem informação", () => {
    // Mostrar 0% faria uma unidade que não comprou nada parecer exemplar.
    expect(leakagePercent(leak(0, 0))).toBeNull();
  });

  it("tudo por fora é 100%", () => {
    expect(leakagePercent(leak(0, 40_000))).toBe(1);
  });

  it("conta quantas unidades compraram por fora", () => {
    const t = leakageTotals([
      leak(100_000, 0, "a"),
      leak(50_000, 10_000, "b"),
      leak(0, 5_000, "c"),
    ]);
    expect(t.clinicsLeaking).toBe(2);
    expect(t.localCents).toBe(15_000);
    expect(t.percent).toBeCloseTo(15_000 / 165_000, 4);
  });
});

describe("dashboard: fornecedores", () => {
  const sup = (ordered: number, received: number): SupplierRow => ({
    supplierId: "s",
    supplierName: "Fornecedor",
    orders: 1,
    orderedCents: ordered,
    receivedCents: received,
    priceDiffCents: 0,
    avgDeliveryDays: null,
  });

  it("mede o quanto já foi entregue", () => {
    expect(deliveryRate(sup(100_000, 80_000))).toBeCloseTo(0.8, 4);
  });

  it("nada entregue ainda não é 0% — é cedo demais para julgar", () => {
    expect(deliveryRate(sup(100_000, 0))).toBeNull();
  });

  it("sem pedido não há taxa", () => {
    expect(deliveryRate(sup(0, 0))).toBeNull();
  });
});
