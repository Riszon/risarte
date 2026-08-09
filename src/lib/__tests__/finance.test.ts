import { describe, expect, it } from "vitest";
import {
  allocateProportional,
  percentOf,
  roundHalfEven,
  roundHalfUp,
  splitAmount,
  sumCents,
} from "@/lib/finance/money";
import {
  computeLateCharges,
  daysBetween,
  daysLate,
  lateLabel,
  type LateFeeTerms,
} from "@/lib/finance/late-fees";
import {
  allocateReceipt,
  countByFilter,
  inPeriod,
  matchesFilter,
  methodRunsLateRisk,
  nextDay,
  periodLabel,
  resolvePeriod,
  summarizeReceipts,
  summarizeReceivables,
  viewInstallment,
  receiptErrors,
  type Installment,
  type ReceiptEntry,
} from "@/lib/finance/receivables";
import {
  cancellationErrors,
  contractRatio,
  settleCancellation,
} from "@/lib/finance/cancellation";
import {
  payoutRateErrors,
  resolvePayoutRate,
  summarizePayouts,
  type PayoutRate,
} from "@/lib/finance/payout";
import { computeMargin, marginLostByDiscount } from "@/lib/finance/margin";
import { isoDateIn } from "@/lib/dates";
import {
  acquirerAppliesTo,
  addBusinessDays,
  addDays,
  chargesFeeAtReceipt,
  computeSettlement,
  daysUntilSettlement,
  hasInstallmentRange,
  modalityOf,
  pickAcquirer,
  rateErrors,
  resolveRate,
  type AcquirerRate,
} from "@/lib/finance/acquirers";
import {
  parseAmountCents,
  parseCsv,
  parseDate,
  parseOfx,
  parseStatement,
  suggestMatches,
  summarizeReconciliation,
  type LedgerEntry,
} from "@/lib/finance/reconciliation";
import {
  matchesPayableFilter,
  payableErrors,
  payablePaymentErrors,
  requiresApproval,
  resolveApproval,
  summarizePayables,
  viewPayable,
  type ApprovalRule,
  type Payable,
  type PayablePaymentEntry,
} from "@/lib/finance/payables";
import {
  canRenegotiateInstallment,
  financedPlan,
  priceInstallmentCents,
  renegotiationBase,
  renegotiationErrors,
  renegotiationOutcome,
} from "@/lib/finance/renegotiation";
import {
  accountLevel,
  buildCostCenterTree,
  canBeParentOfUnitCenter,
  compareAccountCodes,
  isValidAccountCode,
  parentAccountCode,
  postableAccounts,
  sortAccounts,
  type ChartAccount,
  type CostCenter,
} from "@/lib/finance/accounts";

// FIN0 — dinheiro não pode depender de acerto visual. Toda regra aqui.

describe("arredondamento", () => {
  it("meio para cima (política padrão da rede)", () => {
    expect(roundHalfUp(10.5)).toBe(11);
    expect(roundHalfUp(10.4)).toBe(10);
    expect(roundHalfUp(0.5)).toBe(1);
  });

  it("meio para cima trata negativo pelo valor absoluto", () => {
    // Math.round(-0.5) é 0 no JS: seria -0 centavos numa devolução.
    expect(roundHalfUp(-10.5)).toBe(-11);
    expect(roundHalfUp(-0.5)).toBe(-1);
  });

  it("meio par (bancário) puxa para o vizinho par", () => {
    expect(roundHalfEven(10.5)).toBe(10);
    expect(roundHalfEven(11.5)).toBe(12);
    expect(roundHalfEven(10.6)).toBe(11);
  });

  it("percentual sobre centavos", () => {
    expect(percentOf(100000, 2)).toBe(2000); // 2% de R$ 1.000,00
    expect(percentOf(15733, 1)).toBe(157); // 1% de R$ 157,33
    expect(percentOf(100000, 0)).toBe(0);
    expect(percentOf(0, 10)).toBe(0);
  });
});

describe("divisão de valores — a última parcela absorve o resíduo", () => {
  it("divisão exata", () => {
    expect(splitAmount(90000, 3)).toEqual([30000, 30000, 30000]);
  });

  it("resíduo de centavos cai na última", () => {
    const parts = splitAmount(10000, 3);
    expect(parts).toEqual([3333, 3333, 3334]);
    expect(sumCents(parts)).toBe(10000);
  });

  it("a soma SEMPRE fecha com o total (casos fixos)", () => {
    const casos = [
      [176700, 5],
      [100000, 7],
      [1, 3],
      [99999, 11],
      [578000, 6],
    ] as const;
    for (const [total, partes] of casos) {
      expect(sumCents(splitAmount(total, partes))).toBe(total);
    }
  });

  it("uma parte só devolve o total; zero partes devolve vazio", () => {
    expect(splitAmount(12345, 1)).toEqual([12345]);
    expect(splitAmount(12345, 0)).toEqual([]);
  });
});

describe("rateio proporcional", () => {
  it("distribui conforme os pesos e fecha o total", () => {
    const out = allocateProportional(10000, [1, 1, 2]);
    expect(sumCents(out)).toBe(10000);
    expect(out[2]).toBeGreaterThan(out[0]);
  });

  it("resíduo vai para quem tem maior fração", () => {
    const out = allocateProportional(1000, [1, 1, 1]);
    expect(sumCents(out)).toBe(1000);
    expect(out).toEqual([334, 333, 333]);
  });

  it("sem pesos válidos, divide igual", () => {
    expect(allocateProportional(900, [0, 0, 0])).toEqual([300, 300, 300]);
  });
});

describe("dias de atraso", () => {
  it("conta dias inteiros entre datas", () => {
    expect(daysBetween("2026-07-01", "2026-07-31")).toBe(30);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1); // 2026 não é bissexto
  });

  it("vencimento hoje NÃO está em atraso; ontem = 1 dia", () => {
    expect(daysLate("2026-07-31", "2026-07-31")).toBe(0);
    expect(daysLate("2026-07-30", "2026-07-31")).toBe(1);
  });

  it("carência desconta do atraso", () => {
    expect(daysLate("2026-07-25", "2026-07-31", 3)).toBe(3);
    expect(daysLate("2026-07-29", "2026-07-31", 3)).toBe(0);
  });

  it("rótulo em pt-BR", () => {
    expect(lateLabel(0)).toBe("Em dia");
    expect(lateLabel(1)).toBe("1 dia em atraso");
    expect(lateLabel(12)).toBe("12 dias em atraso");
  });
});

describe("multa e juros — tabela de casos fixos", () => {
  const rede: LateFeeTerms = {
    lateFeePercent: 2,
    monthlyInterestPercent: 1,
    graceDays: 0,
  };

  it("em dia não cobra nada", () => {
    const r = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-07-31",
      referenceDate: "2026-07-31",
      terms: rede,
    });
    expect(r).toEqual({
      daysLate: 0,
      lateFeeCents: 0,
      interestCents: 0,
      totalCents: 100000,
    });
  });

  it("R$ 1.000,00 com 30 dias de atraso = multa 20,00 + juros 10,00", () => {
    const r = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-06-30",
      referenceDate: "2026-07-30",
      terms: rede,
    });
    expect(r.daysLate).toBe(30);
    expect(r.lateFeeCents).toBe(2000);
    expect(r.interestCents).toBe(1000);
    expect(r.totalCents).toBe(103000);
  });

  it("R$ 1.000,00 com 1 dia de atraso = multa cheia + juros de 1 dia", () => {
    const r = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-07-30",
      referenceDate: "2026-07-31",
      terms: rede,
    });
    expect(r.daysLate).toBe(1);
    expect(r.lateFeeCents).toBe(2000);
    expect(r.interestCents).toBe(33); // 1000,00 × (1%/30) × 1
    expect(r.totalCents).toBe(102033);
  });

  it("R$ 253,40 com 15 dias (valor real de parcelamento)", () => {
    const r = computeLateCharges({
      principalCents: 25340,
      dueDate: "2026-07-16",
      referenceDate: "2026-07-31",
      terms: rede,
    });
    expect(r.daysLate).toBe(15);
    expect(r.lateFeeCents).toBe(507); // 2% de 253,40 = 5,068 → 5,07
    expect(r.interestCents).toBe(127); // 253,40 × (1%/30) × 15 = 1,267 → 1,27
    expect(r.totalCents).toBe(25974);
  });

  it("carência de 5 dias: dentro dela não cobra", () => {
    const comCarencia: LateFeeTerms = { ...rede, graceDays: 5 };
    const dentro = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-07-28",
      referenceDate: "2026-07-31",
      terms: comCarencia,
    });
    expect(dentro.totalCents).toBe(100000);
    expect(dentro.daysLate).toBe(0);
  });

  it("taxas CONGELADAS: a mesma parcela com taxas antigas dá o valor antigo", () => {
    const antigas: LateFeeTerms = {
      lateFeePercent: 1,
      monthlyInterestPercent: 0.5,
      graceDays: 0,
    };
    const r = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-06-30",
      referenceDate: "2026-07-30",
      terms: antigas,
    });
    expect(r.lateFeeCents).toBe(1000);
    expect(r.interestCents).toBe(500);
    // Mudar a configuração da rede não pode reescrever o passado.
    expect(r.totalCents).toBe(101500);
  });

  it("multa zero configurada = só juros", () => {
    const semMulta: LateFeeTerms = { ...rede, lateFeePercent: 0 };
    const r = computeLateCharges({
      principalCents: 100000,
      dueDate: "2026-06-30",
      referenceDate: "2026-07-30",
      terms: semMulta,
    });
    expect(r.lateFeeCents).toBe(0);
    expect(r.interestCents).toBe(1000);
  });
});

describe("plano de contas", () => {
  it("valida o formato do código", () => {
    expect(isValidAccountCode("1")).toBe(true);
    expect(isValidAccountCode("1.1.01")).toBe(true);
    expect(isValidAccountCode("1.")).toBe(false);
    expect(isValidAccountCode("1.a")).toBe(false);
    expect(isValidAccountCode("")).toBe(false);
  });

  it("nível e pai", () => {
    expect(accountLevel("1")).toBe(1);
    expect(accountLevel("1.1.01")).toBe(3);
    expect(parentAccountCode("1.1.01")).toBe("1.1");
    expect(parentAccountCode("1")).toBeNull();
  });

  it("ordena hierarquicamente, não como texto", () => {
    // Como texto puro, "1.10" viria antes de "1.9" — e "2" antes de "1.9.03".
    const codes = ["2", "1.10", "1.9", "1.9.03", "1", "1.1"];
    const sorted = sortAccounts(codes.map((code) => ({ code }))).map(
      (a) => a.code
    );
    expect(sorted).toEqual(["1", "1.1", "1.9", "1.9.03", "1.10", "2"]);
  });

  it("compara códigos numericamente", () => {
    expect(compareAccountCodes("1.9", "1.10")).toBeLessThan(0);
    expect(compareAccountCodes("2", "1.9.03")).toBeGreaterThan(0);
    expect(compareAccountCodes("1.1", "1.1")).toBe(0);
  });

  it("só conta analítica, ativa e do escopo certo recebe lançamento", () => {
    const contas: ChartAccount[] = [
      {
        code: "1",
        name: "Receitas",
        parentCode: null,
        kind: "revenue",
        nature: "operational",
        costBehavior: "none",
        scope: "both",
        isAnalytic: false, // grupo sintético
        fiscalAccountCode: null,
        active: true,
      },
      {
        code: "1.1.01",
        name: "Procedimentos",
        parentCode: "1.1",
        kind: "revenue",
        nature: "operational",
        costBehavior: "none",
        scope: "unit",
        isAnalytic: true,
        fiscalAccountCode: null,
        active: true,
      },
      {
        code: "1.3.01",
        name: "Royalties",
        parentCode: "1.3",
        kind: "revenue",
        nature: "intercompany",
        costBehavior: "none",
        scope: "franchisor",
        isAnalytic: true,
        fiscalAccountCode: null,
        active: true,
      },
      {
        code: "3.9.99",
        name: "Conta desativada",
        parentCode: "3",
        kind: "expense",
        nature: "operational",
        costBehavior: "fixed",
        scope: "both",
        isAnalytic: true,
        fiscalAccountCode: null,
        active: false,
      },
    ];
    expect(postableAccounts(contas, "unit").map((a) => a.code)).toEqual([
      "1.1.01",
    ]);
    expect(postableAccounts(contas, "franchisor").map((a) => a.code)).toEqual([
      "1.3.01",
    ]);
  });
});

describe("centros de custo", () => {
  const centros: CostCenter[] = [
    { id: "cli", code: "CLI", name: "Clínico", parentId: null, scope: "network", clinicId: null, active: true },
    { id: "com", code: "COM", name: "Comercial", parentId: null, scope: "network", clinicId: null, active: true },
    { id: "orto", code: "CLI-ORT", name: "Sala de orto", parentId: "cli", scope: "unit", clinicId: "u1", active: true },
  ];

  it("monta a árvore com os filhos no pai certo", () => {
    const tree = buildCostCenterTree(centros);
    expect(tree.map((n) => n.code)).toEqual(["CLI", "COM"]);
    expect(tree[0].children.map((n) => n.code)).toEqual(["CLI-ORT"]);
    expect(tree[1].children).toEqual([]);
  });

  it("centro de unidade só pendura em centro da REDE", () => {
    expect(canBeParentOfUnitCenter(centros[0])).toBe(true); // network
    expect(canBeParentOfUnitCenter(centros[2])).toBe(false); // unit
    expect(canBeParentOfUnitCenter(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FIN1 — contas a receber
// ---------------------------------------------------------------------------
describe("contas a receber", () => {
  const rede = { lateFeePercent: 2, monthlyInterestPercent: 1, graceDays: 0 };

  const base: Installment = {
    id: "i1",
    seq: 1,
    kind: "parcela",
    dueDate: "2026-07-10",
    amountCents: 50000,
    benefitDiscountCents: 0,
    paidAmountCents: 0,
    paidBenefitCents: 0,
    paidFeeCents: 0,
    paidInterestCents: 0,
    status: "em_aberto",
    paymentMethod: "boleto",
    terms: rede,
    origin: "negotiation",
    sourceId: null,
    sourceCode: null,
    renegotiatedById: null,
    wasOverdue: false,
  };

  it("parcela em dia: sem multa, saldo cheio", () => {
    const v = viewInstallment({ ...base, dueDate: "2026-08-10" }, "2026-07-31");
    expect(v.isLate).toBe(false);
    expect(v.balanceCents).toBe(50000);
    expect(v.updatedBalanceCents).toBe(50000);
  });

  it("parcela vencida: multa + juros", () => {
    const v = viewInstallment(base, "2026-08-09"); // 30 dias
    expect(v.daysLate).toBe(30);
    expect(v.lateFeeCents).toBe(1000); // 2% de 500,00
    expect(v.interestCents).toBe(500); // 1% ao mês
    expect(v.updatedBalanceCents).toBe(51500);
  });

  // O bug relatado pelo dono em 04/08/2026: receber metade estava cortando a
  // multa e os juros pela metade — desconto disfarçado.
  it("BAIXA PARCIAL abate o principal, mas multa e juros ficam INTEGRAIS", () => {
    const v = viewInstallment(
      { ...base, paidAmountCents: 20000, status: "parcial" },
      "2026-08-09"
    );
    expect(v.balanceCents).toBe(30000);
    // Base da multa e dos juros continua sendo os R$ 500,00 cheios.
    expect(v.lateFeeCents).toBe(1000);
    expect(v.interestCents).toBe(500);
    expect(v.updatedBalanceCents).toBe(31500);
  });

  it("caso exato do print: R$ 1.000 com 5 dias de atraso, metade recebida", () => {
    const mil: Installment = {
      ...base,
      amountCents: 100000,
      dueDate: "2026-07-30",
    };
    const cheia = viewInstallment(mil, "2026-08-04");
    expect(cheia.daysLate).toBe(5);
    expect(cheia.updatedBalanceCents).toBe(102167); // 1.021,67

    const metade = viewInstallment(
      { ...mil, paidAmountCents: 50000, status: "parcial" },
      "2026-08-04"
    );
    // Antes dava 51.083 (multa e juros pela metade). Agora fica integral.
    expect(metade.updatedBalanceCents).toBe(52167);
  });

  it("multa e juros já pagos abatem do que falta", () => {
    const v = viewInstallment(
      { ...base, paidFeeCents: 1000, paidInterestCents: 200, status: "parcial" },
      "2026-08-09"
    );
    expect(v.lateFeeRemCents).toBe(0);
    expect(v.interestRemCents).toBe(300);
    expect(v.updatedBalanceCents).toBe(50300);
  });

  // -------------------------------------------------------------------------
  // Perda do benefício por falta de pontualidade (0188)
  // -------------------------------------------------------------------------
  describe("benefício perdido por atraso", () => {
    // Exemplo do dono: parcela de R$ 120 que, sem o benefício, vale R$ 150.
    const parcela: Installment = {
      ...base,
      amountCents: 12000,
      benefitDiscountCents: 3000,
      paymentMethod: "boleto",
    };

    it("em dia o cliente mantém o benefício", () => {
      const v = viewInstallment(parcela, "2026-07-10");
      expect(v.isLate).toBe(false);
      expect(v.benefitDueCents).toBe(0);
      expect(v.updatedBalanceCents).toBe(12000);
    });

    it("atrasou: volta para R$ 150 e a multa incide sobre esse valor", () => {
      const v = viewInstallment(parcela, "2026-07-11"); // 1 dia
      expect(v.benefitDueCents).toBe(3000);
      expect(v.lateFeeCents).toBe(300); // 2% de 150,00 (não de 120,00)
      expect(v.interestCents).toBe(5);
      expect(v.updatedBalanceCents).toBe(15305);
    });

    it("procedimento gratuito nunca volta a ser cobrado", () => {
      // Item 100% coberto nem entra em benefitDiscountCents (o banco filtra).
      const semRisco = { ...parcela, benefitDiscountCents: 0 };
      const v = viewInstallment(semRisco, "2026-07-11");
      expect(v.benefitDueCents).toBe(0);
      expect(v.updatedBalanceCents).toBe(12000 + 240 + 4);
    });

    // 0192: a regra era pelo RÓTULO (só boleto/recorrência) e deixava passar
    // PIX parcelado com vencimentos futuros — o mesmo risco de um boleto.
    it("toda promessa de pagamento corre risco; só o cartão não", () => {
      expect(methodRunsLateRisk("boleto")).toBe(true);
      expect(methodRunsLateRisk("credito_recorrente")).toBe(true);
      expect(methodRunsLateRisk("pix")).toBe(true);
      expect(methodRunsLateRisk("deposito_avista")).toBe(true);
      expect(methodRunsLateRisk("dinheiro")).toBe(true);
      // A adquirente já garantiu o dinheiro: não há inadimplência possível.
      expect(methodRunsLateRisk("cartao")).toBe(false);
      expect(methodRunsLateRisk("cartao_parcelado")).toBe(false);
    });
  });

  it("ordem de abatimento: principal → benefício → multa → juros", () => {
    const v = viewInstallment(
      { ...base, amountCents: 12000, benefitDiscountCents: 3000 },
      "2026-07-11"
    );
    // Recebimento parcial cobre só parte do principal.
    expect(allocateReceipt(v, 5000)).toEqual({
      principalCents: 5000,
      benefitCents: 0,
      lateFeeCents: 0,
      interestCents: 0,
    });
    // Quitação: cada real cai na sua natureza.
    expect(allocateReceipt(v, 15305)).toEqual({
      principalCents: 12000,
      benefitCents: 3000,
      lateFeeCents: 300,
      interestCents: 5,
    });
  });

  it("parcela paga, cancelada ou renegociada não cobra nada", () => {
    for (const status of ["paga", "cancelada", "renegociada"] as const) {
      const v = viewInstallment(
        { ...base, status, paidAmountCents: status === "paga" ? 50000 : 0 },
        "2026-12-31"
      );
      expect(v.isOpen).toBe(false);
      expect(v.isLate).toBe(false);
      expect(v.updatedBalanceCents).toBe(v.balanceCents);
    }
  });

  it("taxas CONGELADAS da parcela valem, não as da rede hoje", () => {
    const antiga = { ...base, terms: { ...rede, lateFeePercent: 1, monthlyInterestPercent: 0.5 } };
    const v = viewInstallment(antiga, "2026-08-09");
    expect(v.lateFeeCents).toBe(500);
    expect(v.interestCents).toBe(250);
  });

  it("resumo separa em aberto, atraso e recebido no período", () => {
    const views = [
      viewInstallment(base, "2026-08-09"), // vencida
      viewInstallment(
        { ...base, id: "i2", seq: 2, dueDate: "2026-09-10" },
        "2026-08-09"
      ), // a vencer
      viewInstallment(
        { ...base, id: "i3", seq: 3, status: "paga", paidAmountCents: 50000 },
        "2026-08-09"
      ),
      viewInstallment(
        { ...base, id: "i4", seq: 4, status: "cancelada" },
        "2026-08-09"
      ),
    ];
    const s = summarizeReceivables(views, 50000);
    expect(s.openCents).toBe(100000); // duas em aberto
    expect(s.lateCount).toBe(1);
    expect(s.lateCents).toBe(51500); // com multa e juros
    expect(s.receivedCents).toBe(50000);
    // Cancelada não entra no contratado.
    expect(s.contractedCents).toBe(150000);
    expect(s.latePercent).toBeCloseTo(51.5, 1);

    // Filtros da aba: vencida sai de "em aberto" e vira "em atraso".
    const c = countByFilter(views);
    expect(c.todas).toBe(4);
    expect(c.em_aberto).toBe(1);
    expect(c.em_atraso).toBe(1);
    expect(c.paga).toBe(1);
    expect(c.cancelada).toBe(1);
    expect(c.renegociada).toBe(0);
    expect(matchesFilter(views[0], "em_aberto")).toBe(false);
  });

  it("cliente sem nada em aberto tem inadimplência zero (não divide por zero)", () => {
    const s = summarizeReceivables([], 0);
    expect(s.latePercent).toBe(0);
    expect(s.openCents).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Período e composição do recebido
  // -------------------------------------------------------------------------
  describe("período", () => {
    const hoje = "2026-08-04";

    it("resolve mês, mês passado, ano e intervalo específico", () => {
      expect(resolvePeriod("tudo", hoje)).toBeNull();
      expect(resolvePeriod("mes", hoje)).toEqual({
        start: "2026-08-01",
        end: "2026-09-01",
      });
      expect(resolvePeriod("mes_passado", hoje)).toEqual({
        start: "2026-07-01",
        end: "2026-08-01",
      });
      expect(resolvePeriod("ano", hoje)).toEqual({
        start: "2026-01-01",
        end: "2027-01-01",
      });
      // O intervalo da tela é inclusivo; o fim vira exclusivo.
      expect(
        resolvePeriod("custom", hoje, { start: "2026-03-10", end: "2026-03-20" })
      ).toEqual({ start: "2026-03-10", end: "2026-03-21" });
    });

    it("vira o ano em dezembro e em janeiro", () => {
      expect(resolvePeriod("mes", "2026-12-15")).toEqual({
        start: "2026-12-01",
        end: "2027-01-01",
      });
      expect(resolvePeriod("mes_passado", "2026-01-15")).toEqual({
        start: "2025-12-01",
        end: "2026-01-01",
      });
      expect(nextDay("2026-12-31")).toBe("2027-01-01");
    });

    it("inPeriod tem fim exclusivo e 'tudo' aceita qualquer data", () => {
      const p = resolvePeriod("mes", hoje);
      expect(inPeriod("2026-08-01", p)).toBe(true);
      expect(inPeriod("2026-08-31", p)).toBe(true);
      expect(inPeriod("2026-09-01", p)).toBe(false);
      expect(inPeriod("2026-07-31", p)).toBe(false);
      expect(inPeriod("1999-01-01", null)).toBe(true);
    });

    it("rótulo do período", () => {
      expect(periodLabel("tudo", null)).toBe("no total");
      expect(periodLabel("mes", resolvePeriod("mes", hoje))).toBe("em 08/2026");
      expect(periodLabel("ano", resolvePeriod("ano", hoje))).toBe("em 2026");
      expect(
        periodLabel(
          "custom",
          resolvePeriod("custom", hoje, {
            start: "2026-03-10",
            end: "2026-03-20",
          })
        )
      ).toBe("de 10/03/2026 a 20/03/2026");
    });

    it("recebido separa parcela de multa e juros e ignora estorno", () => {
      const rec: ReceiptEntry[] = [
        {
          receivedAt: "2026-08-04",
          amountCents: 20427,
          principalCents: 20000,
          benefitCents: 0,
          lateFeeCents: 400,
          interestCents: 27,
          reversed: false,
          reversalOf: null,
        },
        {
          receivedAt: "2026-08-01",
          amountCents: 31000,
          principalCents: 31000,
          benefitCents: 0,
          lateFeeCents: 0,
          interestCents: 0,
          reversed: false,
          reversalOf: null,
        },
        // Estornada e o próprio estorno: nenhum dos dois conta.
        {
          receivedAt: "2026-08-02",
          amountCents: 5000,
          principalCents: 5000,
          benefitCents: 0,
          lateFeeCents: 0,
          interestCents: 0,
          reversed: true,
          reversalOf: null,
        },
        {
          receivedAt: "2026-08-02",
          amountCents: 5000,
          principalCents: 5000,
          benefitCents: 0,
          lateFeeCents: 0,
          interestCents: 0,
          reversed: true,
          reversalOf: "r3",
        },
        // Fora do mês.
        {
          receivedAt: "2026-07-20",
          amountCents: 9900,
          principalCents: 9900,
          benefitCents: 0,
          lateFeeCents: 0,
          interestCents: 0,
          reversed: false,
          reversalOf: null,
        },
      ];
      const t = summarizeReceipts(rec, resolvePeriod("mes", hoje));
      expect(t.totalCents).toBe(51427);
      expect(t.principalCents).toBe(51000);
      expect(t.chargesCents).toBe(427); // multa 4,00 + juros 0,27
      expect(t.count).toBe(2);

      // Sem período, entra também o de julho.
      expect(summarizeReceipts(rec, null).totalCents).toBe(61327);
    });
  });

  it("recusa baixa maior que o total devido, valor zerado e data futura", () => {
    expect(
      receiptErrors({ amountCents: 60000, payoffCents: 51500, receivedAt: "2026-07-31", today: "2026-07-31" })
    ).toContain("O valor é maior que o total devido nesta cobrança.");
    // Receber a parcela COM multa e juros é válido (era o bug do dono).
    expect(
      receiptErrors({ amountCents: 51500, payoffCents: 51500, receivedAt: "2026-07-31", today: "2026-07-31" })
    ).toEqual([]);
    expect(
      receiptErrors({ amountCents: 0, payoffCents: 50000, receivedAt: "2026-07-31", today: "2026-07-31" })
    ).toContain("Informe o valor recebido.");
    expect(
      receiptErrors({ amountCents: 1000, payoffCents: 50000, receivedAt: "2026-08-05", today: "2026-07-31" })
    ).toContain("A data do recebimento não pode ser no futuro.");
    expect(
      receiptErrors({ amountCents: 1000, payoffCents: 50000, receivedAt: "2026-07-30", today: "2026-07-31" })
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FIN2 — renegociação
// ---------------------------------------------------------------------------
describe("renegociação", () => {
  const rede = { lateFeePercent: 2, monthlyInterestPercent: 1, graceDays: 0 };
  const parcela: Installment = {
    id: "r1",
    seq: 1,
    kind: "parcela",
    dueDate: "2026-07-10",
    amountCents: 50000,
    benefitDiscountCents: 0,
    paidAmountCents: 0,
    paidBenefitCents: 0,
    paidFeeCents: 0,
    paidInterestCents: 0,
    status: "em_aberto",
    paymentMethod: "boleto",
    terms: rede,
    origin: "negotiation",
    sourceId: null,
    sourceCode: null,
    renegotiatedById: null,
    wasOverdue: false,
  };

  it("a dívida apurada é TUDO o que falta hoje", () => {
    const views = [
      // Vencida há 30 dias, com benefício a perder.
      viewInstallment(
        { ...parcela, benefitDiscountCents: 5000 },
        "2026-08-09"
      ),
      // A vencer, intacta.
      viewInstallment(
        { ...parcela, id: "r2", seq: 2, dueDate: "2026-09-10" },
        "2026-08-09"
      ),
    ];
    const b = renegotiationBase(views);
    expect(b.count).toBe(2);
    expect(b.lateCount).toBe(1);
    expect(b.principalCents).toBe(100000);
    expect(b.benefitCents).toBe(5000);
    // Multa e juros sobre 550,00 (parcela + benefício perdido).
    expect(b.lateFeeCents).toBe(1100);
    expect(b.interestCents).toBe(550);
    expect(b.totalCents).toBe(106650);
  });

  it("cobrança paga, cancelada ou renegociada não entra na apuração", () => {
    for (const status of ["paga", "cancelada", "renegociada"] as const) {
      const v = viewInstallment({ ...parcela, status }, "2026-08-09");
      expect(canRenegotiateInstallment(v)).toBe(false);
      expect(renegotiationBase([v]).count).toBe(0);
    }
    const aberta = viewInstallment(parcela, "2026-08-09");
    const parcial = viewInstallment(
      { ...parcela, status: "parcial", paidAmountCents: 10000 },
      "2026-08-09"
    );
    expect(canRenegotiateInstallment(aberta)).toBe(true);
    expect(canRenegotiateInstallment(parcial)).toBe(true);
  });

  it("desconto dentro do teto: o Gerente aplica direto", () => {
    const o = renegotiationOutcome({
      originalCents: 100000,
      newCents: 90000,
      maxDiscountPercent: 15,
      isManager: true,
    });
    expect(o.discountCents).toBe(10000);
    expect(o.discountPercent).toBe(10);
    expect(o.needsAuthorization).toBe(false);
  });

  it("desconto acima do teto exige autorização, mesmo do Gerente", () => {
    const o = renegotiationOutcome({
      originalCents: 100000,
      newCents: 70000,
      maxDiscountPercent: 15,
      isManager: true,
    });
    expect(o.discountPercent).toBe(30);
    expect(o.needsAuthorization).toBe(true);
  });

  it("quem não é Gerente não perdoa sozinho — qualquer desconto vai a autorização", () => {
    const o = renegotiationOutcome({
      originalCents: 100000,
      newCents: 99000,
      maxDiscountPercent: 15,
      isManager: false,
    });
    expect(o.discountPercent).toBe(1);
    expect(o.needsAuthorization).toBe(true);
    // Sem desconto nenhum, o Financeiro aplica direto.
    expect(
      renegotiationOutcome({
        originalCents: 100000,
        newCents: 100000,
        maxDiscountPercent: 15,
        isManager: false,
      }).needsAuthorization
    ).toBe(false);
  });

  it("parcelar por mais que a dívida é ACRÉSCIMO, não desconto", () => {
    const o = renegotiationOutcome({
      originalCents: 100000,
      newCents: 112000,
      maxDiscountPercent: 15,
      isManager: false,
    });
    expect(o.discountCents).toBe(-12000);
    expect(o.discountPercent).toBe(0);
    expect(o.needsAuthorization).toBe(false);
  });

  it("recusa renegociação sem cobrança escolhida ou sem parcelamento", () => {
    expect(
      renegotiationErrors({
        selectedCount: 0,
        originalCents: 0,
        newCents: 0,
        scheduleErrors: [],
      })
    ).toContain("Escolha ao menos uma cobrança para renegociar.");
    expect(
      renegotiationErrors({
        selectedCount: 1,
        originalCents: 50000,
        newCents: 0,
        scheduleErrors: [],
      })
    ).toContain("O novo parcelamento precisa somar mais que zero.");
    // Erros do editor de cobranças vêm junto.
    expect(
      renegotiationErrors({
        selectedCount: 1,
        originalCents: 50000,
        newCents: 50000,
        scheduleErrors: ["Só pode haver uma entrada."],
      })
    ).toEqual(["Só pode haver uma entrada."]);
  });
});

describe("juros do parcelamento na renegociação (Tabela Price)", () => {
  it("sem juros o cliente paga exatamente a dívida", () => {
    const p = financedPlan(120000, 0, 6);
    expect(p.financedTotalCents).toBe(120000);
    expect(p.interestCents).toBe(0);
  });

  it("com juros, a parcela é fixa e o total passa da dívida", () => {
    // R$ 1.000,00 em 10x a 2% ao mês.
    const p = financedPlan(100000, 2, 10);
    expect(p.installmentCents).toBe(11133); // Price: 1000 × i/(1−(1+i)^−10)
    expect(p.financedTotalCents).toBe(111330);
    expect(p.interestCents).toBe(11330);
  });

  it("quanto mais tempo para quitar, mais juros — o pedido do dono", () => {
    const curto = financedPlan(100000, 2, 6);
    const longo = financedPlan(100000, 2, 24);
    expect(longo.interestCents).toBeGreaterThan(curto.interestCents);
    // E a parcela do prazo longo é menor, que é o que o cliente enxerga.
    expect(longo.installmentCents).toBeLessThan(curto.installmentCents);
  });

  it("taxa negativa ou dívida zero não quebram a conta", () => {
    expect(financedPlan(0, 5, 10).financedTotalCents).toBe(0);
    expect(financedPlan(100000, -3, 10).interestCents).toBe(0);
    expect(priceInstallmentCents(100000, 2, 0)).toBe(priceInstallmentCents(100000, 2, 1));
  });

  it("os juros do parcelamento entram como ACRÉSCIMO, não como desconto", () => {
    const p = financedPlan(100000, 2, 10);
    const o = renegotiationOutcome({
      originalCents: 100000,
      newCents: p.financedTotalCents,
      maxDiscountPercent: 15,
      isManager: false,
    });
    expect(o.discountCents).toBe(-11330);
    expect(o.needsAuthorization).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FIN3 — contas a pagar
// ---------------------------------------------------------------------------
describe("alçada das contas a pagar", () => {
  const rules: ApprovalRule[] = [
    // Padrão da rede: livre até R$ 2.000,00.
    { clinicId: null, accountCode: null, mode: "sem_autorizacao", thresholdCents: 200000 },
    // A rede exige liberação para equipamentos, em qualquer valor.
    { clinicId: null, accountCode: "5.1.01", mode: "com_autorizacao", thresholdCents: null },
    // Aluguel é contratado: nunca pede nada.
    { clinicId: null, accountCode: "3.2.01", mode: "automatica", thresholdCents: null },
    // A unidade aperta o próprio teto geral.
    { clinicId: "u1", accountCode: null, mode: "sem_autorizacao", thresholdCents: 50000 },
  ];

  it("a cascata pega o mais específico: unidade+conta > rede+conta > unidade > rede", () => {
    expect(resolveApproval(rules, "u1", "9.9.99").thresholdCents).toBe(50000);
    expect(resolveApproval(rules, "u2", "9.9.99").thresholdCents).toBe(200000);
    expect(resolveApproval(rules, "u1", "5.1.01").mode).toBe("com_autorizacao");
    expect(resolveApproval(rules, "u1", "3.2.01").mode).toBe("automatica");
  });

  it("sem nenhuma regra, passa sem autorização e sem teto", () => {
    const r = resolveApproval([], "u1", "3.3.01");
    expect(r.mode).toBe("sem_autorizacao");
    expect(r.thresholdCents).toBeNull();
    expect(requiresApproval(r, 99999999)).toBe(false);
  });

  it("o teto só vale no modo sem autorização", () => {
    const unidade = resolveApproval(rules, "u1", "3.3.01"); // teto 500,00
    expect(requiresApproval(unidade, 49999)).toBe(false);
    expect(requiresApproval(unidade, 50000)).toBe(false); // no teto, não passa dele
    expect(requiresApproval(unidade, 50001)).toBe(true);
  });

  it("automática é despesa contratada: nunca pede, nem olha o teto", () => {
    const aluguel = resolveApproval(rules, "u1", "3.2.01");
    expect(requiresApproval(aluguel, 100000000)).toBe(false);
    // Mesmo com teto configurado por engano, o modo automático ignora.
    expect(
      requiresApproval({ mode: "automatica", thresholdCents: 100 }, 999999)
    ).toBe(false);
  });

  it("com autorização exige liberação em qualquer valor", () => {
    const equip = resolveApproval(rules, "u1", "5.1.01");
    expect(requiresApproval(equip, 1)).toBe(true);
  });
});

describe("situação da conta a pagar", () => {
  const base: Payable = {
    id: "p1",
    clinicId: "u1",
    supplierId: null,
    supplierName: null,
    accountCode: "2.2",
    accountName: "Materiais",
    costCenterId: null,
    costCenterName: null,
    description: "Resina",
    documentNumber: null,
    accrualDate: "2026-07-01",
    dueDate: "2026-07-10",
    amountCents: 50000,
    paidAmountCents: 0,
    paidFeeCents: 0,
    paidInterestCents: 0,
    status: "aberta",
    approvalMode: "sem_autorizacao",
    requiresApproval: false,
    approvedByName: null,
    approvalNote: null,
    cancelReason: null,
    createdByName: null,
    createdById: null,
    notes: null,
    recurrenceId: null,
  };

  it("a vencer não está vencida", () => {
    const v = viewPayable({ ...base, dueDate: "2026-08-10" }, "2026-07-31");
    expect(v.isOpen).toBe(true);
    expect(v.isOverdue).toBe(false);
    expect(v.balanceCents).toBe(50000);
  });

  it("vencida conta os dias", () => {
    const v = viewPayable(base, "2026-07-31");
    expect(v.isOverdue).toBe(true);
    expect(v.daysLate).toBe(21);
  });

  it("pagamento parcial deixa saldo e o desembolso soma multa e juros", () => {
    const v = viewPayable(
      {
        ...base,
        status: "parcial",
        paidAmountCents: 20000,
        paidFeeCents: 400,
        paidInterestCents: 100,
      },
      "2026-07-31"
    );
    expect(v.balanceCents).toBe(30000);
    expect(v.paidTotalCents).toBe(20500);
  });

  it("paga, cancelada e recusada não ficam abertas nem vencidas", () => {
    for (const status of ["paga", "cancelada", "recusada"] as const) {
      const v = viewPayable({ ...base, status }, "2026-12-31");
      expect(v.isOpen).toBe(false);
      expect(v.isOverdue).toBe(false);
    }
  });

  // Conta esperando autorização já pode estar vencida — e é o que precisa
  // gritar na tela, senão o prazo passa esperando liberação.
  it("conta a autorizar aparece como vencida quando o prazo passou", () => {
    const v = viewPayable(
      { ...base, status: "aguardando_autorizacao" },
      "2026-07-31"
    );
    expect(v.isOverdue).toBe(true);
    expect(matchesPayableFilter(v, "a_autorizar")).toBe(true);
    expect(matchesPayableFilter(v, "vencidas")).toBe(true);
    // Mas não entra em "a vencer": ela já venceu.
    expect(matchesPayableFilter(v, "a_vencer")).toBe(false);
  });

  it("resumo separa aberto, vencido, a autorizar e pago no período", () => {
    const views = [
      viewPayable(base, "2026-07-31"), // vencida
      viewPayable({ ...base, id: "p2", dueDate: "2026-08-10" }, "2026-07-31"),
      viewPayable(
        { ...base, id: "p3", status: "aguardando_autorizacao", amountCents: 90000 },
        "2026-07-31"
      ),
      viewPayable({ ...base, id: "p4", status: "cancelada" }, "2026-07-31"),
    ];
    const pagamentos: PayablePaymentEntry[] = [
      {
        paidAt: "2026-07-15",
        amountCents: 10000,
        feeCents: 200,
        interestCents: 50,
        reversed: false,
        reversalOf: null,
      },
      // Estornado não conta.
      {
        paidAt: "2026-07-16",
        amountCents: 30000,
        feeCents: 0,
        interestCents: 0,
        reversed: true,
        reversalOf: null,
      },
      // Fora do período.
      {
        paidAt: "2026-06-10",
        amountCents: 70000,
        feeCents: 0,
        interestCents: 0,
        reversed: false,
        reversalOf: null,
      },
    ];
    const s = summarizePayables(
      views,
      pagamentos,
      resolvePeriod("mes", "2026-07-20")
    );
    expect(s.overdueCount).toBe(2); // a vencida e a que espera autorização
    expect(s.awaitingCount).toBe(1);
    expect(s.awaitingCents).toBe(90000);
    expect(s.paidCents).toBe(10250); // com multa e juros, sem o estornado
    // Cancelada não entra em nada.
    expect(s.openCents).toBe(190000);
  });

  it("recusa lançar sem descrição, sem conta, sem valor ou sem vencimento", () => {
    expect(
      payableErrors({ description: "", accountCode: "2.2", amountCents: 100, dueDate: "2026-07-10" })
    ).toContain("Descreva a despesa.");
    expect(
      payableErrors({ description: "x", accountCode: "", amountCents: 100, dueDate: "2026-07-10" })
    ).toContain("Escolha a conta do plano de contas.");
    expect(
      payableErrors({ description: "x", accountCode: "2.2", amountCents: 0, dueDate: "2026-07-10" })
    ).toContain("Informe um valor maior que zero.");
    expect(
      payableErrors({ description: "x", accountCode: "2.2", amountCents: 100, dueDate: "" })
    ).toContain("Informe o vencimento.");
    expect(
      payableErrors({ description: "x", accountCode: "2.2", amountCents: 100, dueDate: "2026-07-10" })
    ).toEqual([]);
  });

  it("recusa pagar mais que o saldo e data no futuro", () => {
    expect(
      payablePaymentErrors({ amountCents: 60000, balanceCents: 50000, paidAt: "2026-07-31", today: "2026-07-31" })
    ).toContain("O valor é maior que o saldo desta conta.");
    expect(
      payablePaymentErrors({ amountCents: 100, balanceCents: 50000, paidAt: "2026-08-05", today: "2026-07-31" })
    ).toContain("A data do pagamento não pode ser no futuro.");
    expect(
      payablePaymentErrors({ amountCents: 50000, balanceCents: 50000, paidAt: "2026-07-30", today: "2026-07-31" })
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FIN4a — conciliação bancária
// ---------------------------------------------------------------------------
describe("leitura de valores do extrato", () => {
  it("formato brasileiro e americano", () => {
    expect(parseAmountCents("1.234,56")).toBe(123456);
    expect(parseAmountCents("1,234.56")).toBe(123456);
    expect(parseAmountCents("-150.00")).toBe(-15000);
    expect(parseAmountCents("90,00")).toBe(9000);
    expect(parseAmountCents("R$ 1.500,00")).toBe(150000);
  });

  it("milhar sem decimal não vira centavo", () => {
    // O erro clássico: 1.234 lido como 1,234 → R$ 1,23 em vez de R$ 1.234,00.
    expect(parseAmountCents("1.234")).toBe(123400);
    expect(parseAmountCents("1234")).toBe(123400);
  });

  it("parênteses são saída (padrão contábil)", () => {
    expect(parseAmountCents("(150,00)")).toBe(-15000);
  });

  it("texto sem número devolve nulo", () => {
    expect(parseAmountCents("SALDO")).toBeNull();
    expect(parseAmountCents("")).toBeNull();
  });

  it("datas em dd/mm/aaaa, aaaa-mm-dd e OFX", () => {
    expect(parseDate("04/08/2026")).toBe("2026-08-04");
    expect(parseDate("2026-08-04")).toBe("2026-08-04");
    expect(parseDate("20260804120000[-3:BRT]")).toBe("2026-08-04");
    expect(parseDate("qualquer coisa")).toBeNull();
  });
});

describe("extrato OFX", () => {
  const ofx = `
OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260804120000[-3:BRT]
<TRNAMT>-150.00
<FITID>202608040001
<MEMO>PAGAMENTO FORNECEDOR
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260805
<TRNAMT>1021.67
<FITID>202608050002
<MEMO>PIX RECEBIDO
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("lê lançamentos com identificador do banco", () => {
    const r = parseOfx(ofx);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0]).toEqual({
      fitId: "202608040001",
      postedAt: "2026-08-04",
      amountCents: -15000,
      description: "PAGAMENTO FORNECEDOR",
      kind: "debit",
    });
    expect(r.transactions[1].amountCents).toBe(102167);
    expect(r.transactions[1].kind).toBe("credit");
  });

  it("arquivo sem lançamento avisa em vez de aceitar calado", () => {
    const r = parseOfx("<OFX></OFX>");
    expect(r.transactions).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("parseStatement reconhece OFX pelo conteúdo, não pela extensão", () => {
    expect(parseStatement(ofx).format).toBe("ofx");
  });
});

describe("extrato CSV", () => {
  it("ponto e vírgula com cabeçalho em português", () => {
    const csv = [
      "Data;Historico;Valor",
      "04/08/2026;PAGAMENTO FORNECEDOR;-150,00",
      "05/08/2026;PIX RECEBIDO;1.021,67",
    ].join("\n");
    const r = parseCsv(csv);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0].amountCents).toBe(-15000);
    expect(r.transactions[1].amountCents).toBe(102167);
    expect(r.transactions[0].fitId).toBeNull();
  });

  it("colunas separadas de crédito e débito", () => {
    const csv = [
      "Data;Descricao;Credito;Debito",
      "04/08/2026;ALUGUEL;;1.500,00",
      "05/08/2026;RECEBIMENTO;900,00;",
    ].join("\n");
    const r = parseCsv(csv);
    expect(r.transactions[0].amountCents).toBe(-150000);
    expect(r.transactions[1].amountCents).toBe(90000);
  });

  it("linha de saldo e total é ignorada, e o usuário é avisado", () => {
    const csv = [
      "Data;Historico;Valor",
      "04/08/2026;PAGAMENTO;-150,00",
      "SALDO ANTERIOR;;1.000,00",
      ";;",
    ].join("\n");
    const r = parseCsv(csv);
    expect(r.transactions).toHaveLength(1);
    expect(r.skipped).toBeGreaterThan(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("sem cabeçalho, assume data · descrição · valor", () => {
    const csv = "04/08/2026;COMPRA;-99,90";
    const r = parseCsv(csv);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].description).toBe("COMPRA");
  });

  it("aspas com o separador dentro não quebram a linha", () => {
    const csv = [
      "Data;Historico;Valor",
      '04/08/2026;"LAB PROTESE; NF 123";-150,00',
    ].join("\n");
    const r = parseCsv(csv);
    expect(r.transactions[0].description).toBe("LAB PROTESE; NF 123");
  });
});

describe("casamento com o razão", () => {
  const entries: LedgerEntry[] = [
    {
      id: "e1",
      amountCents: -15000,
      cashDate: "2026-08-04",
      description: "Pagamento laboratório",
      accountCode: "2.3",
      reconciled: false,
    },
    {
      id: "e2",
      amountCents: -15000,
      cashDate: "2026-08-02",
      description: "Outro pagamento",
      accountCode: "2.2",
      reconciled: false,
    },
    {
      id: "e3",
      amountCents: -20000,
      cashDate: "2026-08-04",
      description: "Valor diferente",
      accountCode: "2.2",
      reconciled: false,
    },
    {
      id: "e4",
      amountCents: -15000,
      cashDate: "2026-08-04",
      description: "Já conciliado",
      accountCode: "2.2",
      reconciled: true,
    },
  ];

  const tx = {
    amountCents: -15000,
    postedAt: "2026-08-04",
    description: "PAGAMENTO LABORATORIO",
  };

  it("o valor tem de bater exatamente — conciliação não aproxima", () => {
    const found = suggestMatches(tx, entries);
    expect(found.every((c) => c.entry.amountCents === -15000)).toBe(true);
    expect(found.map((c) => c.entry.id)).not.toContain("e3");
  });

  it("lançamento já conciliado não é sugerido de novo", () => {
    expect(suggestMatches(tx, entries).map((c) => c.entry.id)).not.toContain(
      "e4"
    );
  });

  it("mesmo dia vem primeiro; dias de diferença perdem pontos", () => {
    const found = suggestMatches(tx, entries);
    expect(found[0].entry.id).toBe("e1");
    expect(found[0].sameDay).toBe(true);
    expect(found[1].entry.id).toBe("e2");
    expect(found[0].score).toBeGreaterThan(found[1].score);
  });

  it("fora da janela de dias não é sugerido", () => {
    const distante = suggestMatches(
      { ...tx, postedAt: "2026-08-20" },
      entries
    );
    expect(distante).toHaveLength(0);
  });
});

describe("resumo da conciliação", () => {
  it("banco menos sistema é a diferença; ignorado fica de fora do banco", () => {
    const s = summarizeReconciliation({
      openingBalanceCents: 100000,
      transactions: [
        { amountCents: -15000, status: "conciliado" },
        { amountCents: 50000, status: "pendente" },
        { amountCents: 99999, status: "ignorado" },
      ],
      entries: [
        {
          id: "e1",
          amountCents: -15000,
          cashDate: "2026-08-04",
          description: "x",
          accountCode: "2.3",
          reconciled: true,
        },
      ],
    });
    expect(s.bankBalanceCents).toBe(135000); // 1000 − 150 + 500
    expect(s.systemBalanceCents).toBe(85000); // 1000 − 150
    expect(s.differenceCents).toBe(50000); // o PIX que ninguém lançou
    expect(s.pendingCount).toBe(1);
    expect(s.reconciledCount).toBe(1);
    expect(s.ignoredCount).toBe(1);
    expect(s.unmatchedEntryCount).toBe(0);
  });

  it("tudo conciliado fecha em zero", () => {
    const s = summarizeReconciliation({
      openingBalanceCents: 0,
      transactions: [{ amountCents: -15000, status: "conciliado" }],
      entries: [
        {
          id: "e1",
          amountCents: -15000,
          cashDate: "2026-08-04",
          description: "x",
          accountCode: "2.3",
          reconciled: true,
        },
      ],
    });
    expect(s.differenceCents).toBe(0);
  });
});

describe("de qual conta é o extrato (trava do extrato trocado)", () => {
  // O bug do dono (05/08/2026): o MESMO extrato importado em duas contas
  // duplicou o dinheiro. O OFX diz de qual conta ele é — é isso que trava.
  const comConta = `
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM>
<BANKID>341
<BRANCHID>1234
<ACCTID>56789-0
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260804
<TRNAMT>-150.00
<FITID>A1
<MEMO>PAGAMENTO
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("lê o número da conta do próprio arquivo, só os dígitos", () => {
    expect(parseOfx(comConta).statementAccountId).toBe("567890");
  });

  it("não confunde o número da conta com o do lançamento", () => {
    const r = parseOfx(comConta);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].fitId).toBe("A1");
  });

  it("OFX sem identificação de conta não inventa", () => {
    const semConta = `<OFX><STMTTRN>
<DTPOSTED>20260804
<TRNAMT>-150.00
<FITID>A1
<MEMO>X
</STMTTRN></OFX>`;
    expect(parseOfx(semConta).statementAccountId).toBeNull();
  });

  it("CSV não identifica a conta — a trava fica por conta do banco de dados", () => {
    const r = parseCsv("Data;Historico;Valor\n04/08/2026;X;-150,00");
    expect(r.statementAccountId).toBeNull();
    expect(r.transactions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// FIN4b — adquirentes (taxa do cartão e liquidação D+n)
// ---------------------------------------------------------------------------
describe("adquirentes", () => {
  const rates: AcquirerRate[] = [
    {
      id: "r1",
      acquirerId: "a1",
      modality: "debito",
      minInstallments: 1,
      maxInstallments: 1,
      feePercent: 1.5,
      fixedFeeCents: 0,
      settlementDays: 1,
      settlementBusinessDays: false,
      freeMonthlyCount: null,
      feeChargedOn: "pagamento",
      validFrom: "2026-01-01",
      validTo: null,
    },
    {
      id: "r2",
      acquirerId: "a1",
      modality: "credito_avista",
      minInstallments: 1,
      maxInstallments: 1,
      feePercent: 3.2,
      fixedFeeCents: 0,
      settlementDays: 30,
      settlementBusinessDays: false,
      freeMonthlyCount: null,
      feeChargedOn: "pagamento",
      validFrom: "2026-01-01",
      validTo: null,
    },
    {
      id: "r3",
      acquirerId: "a1",
      modality: "credito_parcelado",
      minInstallments: 2,
      maxInstallments: 6,
      feePercent: 4.5,
      fixedFeeCents: 0,
      settlementDays: 30,
      settlementBusinessDays: false,
      freeMonthlyCount: null,
      feeChargedOn: "pagamento",
      validFrom: "2026-01-01",
      validTo: null,
    },
    {
      id: "r4",
      acquirerId: "a1",
      modality: "credito_parcelado",
      minInstallments: 7,
      maxInstallments: 12,
      feePercent: 5.9,
      fixedFeeCents: 0,
      settlementDays: 30,
      settlementBusinessDays: false,
      freeMonthlyCount: null,
      feeChargedOn: "pagamento",
      validFrom: "2026-01-01",
      validTo: null,
    },
    // Taxa renegociada: vale a partir de agosto.
    {
      id: "r5",
      acquirerId: "a1",
      modality: "credito_avista",
      minInstallments: 1,
      maxInstallments: 1,
      feePercent: 2.5,
      fixedFeeCents: 0,
      settlementDays: 30,
      settlementBusinessDays: false,
      freeMonthlyCount: null,
      feeChargedOn: "pagamento",
      validFrom: "2026-08-01",
      validTo: null,
    },
  ];

  it("acha a faixa de parcelas certa", () => {
    const base = { acquirerId: "a1", date: "2026-07-15" } as const;
    expect(
      resolveRate(rates, { ...base, modality: "credito_parcelado", installments: 3 })
        ?.feePercent
    ).toBe(4.5);
    expect(
      resolveRate(rates, { ...base, modality: "credito_parcelado", installments: 10 })
        ?.feePercent
    ).toBe(5.9);
    expect(
      resolveRate(rates, { ...base, modality: "debito", installments: 1 })
        ?.settlementDays
    ).toBe(1);
  });

  // O ponto da vigência: renegociar a taxa NÃO reescreve o que já passou.
  it("usa a taxa vigente NA DATA, não a de hoje", () => {
    const antes = resolveRate(rates, {
      acquirerId: "a1",
      modality: "credito_avista",
      installments: 1,
      date: "2026-07-15",
    });
    const depois = resolveRate(rates, {
      acquirerId: "a1",
      modality: "credito_avista",
      installments: 1,
      date: "2026-08-15",
    });
    expect(antes?.feePercent).toBe(3.2);
    expect(depois?.feePercent).toBe(2.5);
  });

  it("fora da faixa ou de outra adquirente não acha nada", () => {
    expect(
      resolveRate(rates, {
        acquirerId: "a1",
        modality: "credito_parcelado",
        installments: 18,
        date: "2026-07-15",
      })
    ).toBeNull();
    expect(
      resolveRate(rates, {
        acquirerId: "outra",
        modality: "debito",
        installments: 1,
        date: "2026-07-15",
      })
    ).toBeNull();
  });

  it("o cliente paga o bruto; a clínica recebe o líquido", () => {
    const s = computeSettlement({
      grossCents: 100000,
      rate: { feePercent: 3.2, settlementDays: 30 },
      paidAt: "2026-08-04",
    });
    expect(s.grossCents).toBe(100000);
    expect(s.feeCents).toBe(3200);
    expect(s.netCents).toBe(96800);
    expect(s.settlementDate).toBe("2026-09-03");
  });

  it("débito cai em D+1; crédito em D+30", () => {
    expect(
      computeSettlement({
        grossCents: 50000,
        rate: { feePercent: 1.5, settlementDays: 1 },
        paidAt: "2026-08-04",
      }).settlementDate
    ).toBe("2026-08-05");
    expect(daysUntilSettlement("2026-08-04", "2026-09-03")).toBe(30);
  });

  it("taxa zero (PIX na maquininha) não inventa desconto", () => {
    const s = computeSettlement({
      grossCents: 100000,
      rate: { feePercent: 0, settlementDays: 0 },
      paidAt: "2026-08-04",
    });
    expect(s.feeCents).toBe(0);
    expect(s.netCents).toBe(100000);
    expect(s.settlementDate).toBe("2026-08-04");
  });

  it("arredondamento meio para cima, como o resto do módulo", () => {
    // 2,5% de R$ 253,40 = R$ 6,335 → R$ 6,34
    expect(
      computeSettlement({
        grossCents: 25340,
        rate: { feePercent: 2.5, settlementDays: 30 },
        paidAt: "2026-08-04",
      }).feeCents
    ).toBe(634);
  });

  it("a modalidade sai do meio de pagamento da venda", () => {
    expect(modalityOf("cartao", 1)).toBe("credito_avista");
    expect(modalityOf("cartao", 4)).toBe("credito_parcelado");
    expect(modalityOf("cartao_parcelado", 6)).toBe("credito_parcelado");
    expect(modalityOf("credito_recorrente", 12)).toBe("recorrente");
    // Desde a 0198 boleto e PIX também têm custo e viraram modalidade.
    expect(modalityOf("boleto", 1)).toBe("boleto");
    expect(modalityOf("pix", 1)).toBe("pix");
    expect(modalityOf(null, 1)).toBeNull();
    expect(modalityOf("deposito_avista", 1)).toBeNull();
  });

  it("recusa taxa e faixa impossíveis", () => {
    expect(
      rateErrors({
        feePercent: 45,
        settlementDays: 30,
        minInstallments: 1,
        maxInstallments: 1,
      })
    ).toContain("Taxa acima de 30% — confira se não digitou errado.");
    expect(
      rateErrors({
        feePercent: 3,
        settlementDays: 30,
        minInstallments: 6,
        maxInstallments: 2,
      })
    ).toContain("A faixa de parcelas está invertida.");
    expect(
      rateErrors({
        feePercent: 0,
        settlementDays: 0,
        minInstallments: 1,
        maxInstallments: 1,
      })
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FIN4b.1 — taxa fixa, franquia mensal e dias úteis (tabela real do Asaas)
// ---------------------------------------------------------------------------
describe("taxa fixa e franquia (tabela do Asaas)", () => {
  // "2,39% + R$ 0,29 à vista · Recebimento em 32 dias"
  const creditoAvista = {
    feePercent: 2.39,
    fixedFeeCents: 29,
    settlementDays: 32,
    settlementBusinessDays: false,
    freeMonthlyCount: null,
  };
  // "R$ 1,99 por boleto pago · Recebimento em 1 dia útil"
  const boleto = {
    feePercent: 0,
    fixedFeeCents: 199,
    settlementDays: 1,
    settlementBusinessDays: true,
    freeMonthlyCount: null,
  };
  // "R$ 1,49 por cobrança recebida · 100 recebimentos gratuitos por mês"
  const pix = {
    feePercent: 0,
    fixedFeeCents: 149,
    settlementDays: 0,
    settlementBusinessDays: false,
    freeMonthlyCount: 100,
  };

  it("percentual MAIS taxa fixa", () => {
    const s = computeSettlement({
      grossCents: 100000,
      rate: creditoAvista,
      paidAt: "2026-08-04",
    });
    expect(s.percentFeeCents).toBe(2390);
    expect(s.fixedFeeCents).toBe(29);
    expect(s.feeCents).toBe(2419);
    expect(s.netCents).toBe(97581);
  });

  // O motivo de a taxa fixa existir no modelo: numa cobrança pequena ela é a
  // maior parte do custo, e o percentual sozinho subestimaria feio.
  it("na cobrança pequena a taxa fixa pesa muito mais", () => {
    const grande = computeSettlement({
      grossCents: 100000,
      rate: creditoAvista,
      paidAt: "2026-08-04",
    });
    const pequena = computeSettlement({
      grossCents: 5000,
      rate: creditoAvista,
      paidAt: "2026-08-04",
    });
    // R$ 1.000 → 2,42% do valor; R$ 50 → 2,97%.
    expect((grande.feeCents / grande.grossCents) * 100).toBeCloseTo(2.42, 1);
    expect((pequena.feeCents / pequena.grossCents) * 100).toBeCloseTo(2.97, 1);
  });

  it("boleto: só taxa fixa, sem percentual", () => {
    const s = computeSettlement({
      grossCents: 30000,
      rate: boleto,
      paidAt: "2026-08-04",
    });
    expect(s.percentFeeCents).toBe(0);
    expect(s.feeCents).toBe(199);
    expect(s.netCents).toBe(29801);
  });

  it("1 dia útil na sexta cai na segunda, não no sábado", () => {
    // 07/08/2026 é uma sexta-feira.
    expect(addBusinessDays("2026-08-07", 1)).toBe("2026-08-10");
    // 3 dias úteis a partir de quinta → terça.
    expect(addBusinessDays("2026-08-06", 3)).toBe("2026-08-11");
    // Dias corridos ignoram o fim de semana e caem no sábado.
    expect(addDays("2026-08-07", 1)).toBe("2026-08-08");
  });

  it("franquia mensal: os primeiros são grátis, o seguinte paga", () => {
    const dentro = computeSettlement({
      grossCents: 20000,
      rate: pix,
      paidAt: "2026-08-04",
      usedThisMonth: 99,
    });
    expect(dentro.waived).toBe(true);
    expect(dentro.feeCents).toBe(0);
    expect(dentro.netCents).toBe(20000);

    const fora = computeSettlement({
      grossCents: 20000,
      rate: pix,
      paidAt: "2026-08-04",
      usedThisMonth: 100,
    });
    expect(fora.waived).toBe(false);
    expect(fora.feeCents).toBe(149);
  });

  it("sem franquia configurada, a taxa fixa sempre é cobrada", () => {
    const s = computeSettlement({
      grossCents: 20000,
      rate: boleto,
      paidAt: "2026-08-04",
      usedThisMonth: 0,
    });
    expect(s.waived).toBe(false);
    expect(s.feeCents).toBe(199);
  });

  it("boleto e PIX agora entram como modalidade (antes eram tratados como grátis)", () => {
    expect(modalityOf("boleto", 1)).toBe("boleto");
    expect(modalityOf("pix", 1)).toBe("pix");
    // Só o crédito parcelado tem faixa de parcelas.
    expect(hasInstallmentRange("credito_parcelado")).toBe(true);
    expect(hasInstallmentRange("boleto")).toBe(false);
    expect(hasInstallmentRange("pix")).toBe(false);
  });

  it("faixas do Asaas: 13 a 21 parcelas tem taxa maior", () => {
    const rates: AcquirerRate[] = [
      {
        id: "x1",
        acquirerId: "a1",
        modality: "credito_parcelado",
        minInstallments: 2,
        maxInstallments: 12,
        feePercent: 2.39,
        fixedFeeCents: 29,
        settlementDays: 32,
        settlementBusinessDays: false,
        freeMonthlyCount: null,
        feeChargedOn: "pagamento",
        validFrom: "2026-01-01",
        validTo: null,
      },
      {
        id: "x2",
        acquirerId: "a1",
        modality: "credito_parcelado",
        minInstallments: 13,
        maxInstallments: 21,
        feePercent: 4.29,
        fixedFeeCents: 29,
        settlementDays: 32,
        settlementBusinessDays: false,
        freeMonthlyCount: null,
        feeChargedOn: "pagamento",
        validFrom: "2026-01-01",
        validTo: null,
      },
    ];
    expect(
      resolveRate(rates, {
        acquirerId: "a1",
        modality: "credito_parcelado",
        installments: 10,
        date: "2026-08-04",
      })?.feePercent
    ).toBe(2.39);
    expect(
      resolveRate(rates, {
        acquirerId: "a1",
        modality: "credito_parcelado",
        installments: 18,
        date: "2026-08-04",
      })?.feePercent
    ).toBe(4.29);
  });

  it("recusa franquia quebrada e taxa fixa negativa", () => {
    expect(
      rateErrors({
        feePercent: 2,
        fixedFeeCents: -1,
        settlementDays: 30,
        minInstallments: 1,
        maxInstallments: 1,
      })
    ).toContain("A taxa fixa não pode ser negativa.");
    expect(
      rateErrors({
        feePercent: 2,
        fixedFeeCents: 29,
        settlementDays: 30,
        minInstallments: 1,
        maxInstallments: 1,
        freeMonthlyCount: 0,
      })
    ).toContain("A franquia mensal é um número inteiro de transações.");
    // Meio de pagamento realmente gratuito continua podendo ser cadastrado.
    expect(
      rateErrors({
        feePercent: 0,
        fixedFeeCents: 0,
        settlementDays: 0,
        minInstallments: 1,
        maxInstallments: 1,
      })
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FIN4b.2 — abrangência da adquirente e o momento da cobrança da taxa
// ---------------------------------------------------------------------------
describe("adquirente: abrangência (rede × unidade)", () => {
  const A = "clinica-a";
  const B = "clinica-b";
  const base = { isDefault: false, active: true };

  it("cadastro da unidade só vale para ela", () => {
    const own = {
      ...base,
      id: "1",
      clinicId: A,
      scope: "unidade" as const,
      name: "Stone",
    };
    expect(acquirerAppliesTo(own, A)).toBe(true);
    expect(acquirerAppliesTo(own, B)).toBe(false);
  });

  it("cadastro da rede vale para qualquer unidade, inclusive as futuras", () => {
    const net = {
      ...base,
      id: "2",
      clinicId: null,
      scope: "rede" as const,
      name: "Asaas",
    };
    expect(acquirerAppliesTo(net, A)).toBe(true);
    expect(acquirerAppliesTo(net, "unidade-que-ainda-nao-existia")).toBe(true);
  });

  it("cadastro para unidades específicas vale só para as marcadas", () => {
    const some = {
      ...base,
      id: "3",
      clinicId: null,
      scope: "unidades" as const,
      name: "Cielo",
      clinicIds: [A],
    };
    expect(acquirerAppliesTo(some, A)).toBe(true);
    expect(acquirerAppliesTo(some, B)).toBe(false);
  });

  it("o cadastro próprio da unidade ganha do padrão da rede", () => {
    const escolhida = pickAcquirer(
      [
        {
          ...base,
          id: "net",
          clinicId: null,
          scope: "rede" as const,
          name: "Asaas",
          isDefault: true,
        },
        {
          ...base,
          id: "own",
          clinicId: A,
          scope: "unidade" as const,
          name: "Stone",
        },
      ],
      A
    );
    // Quem tem contrato próprio é quem paga aquela taxa.
    expect(escolhida?.id).toBe("own");
  });

  it("sem cadastro próprio, a unidade usa o padrão da rede", () => {
    const escolhida = pickAcquirer(
      [
        {
          ...base,
          id: "net1",
          clinicId: null,
          scope: "rede" as const,
          name: "Zeta",
        },
        {
          ...base,
          id: "net2",
          clinicId: null,
          scope: "rede" as const,
          name: "Asaas",
          isDefault: true,
        },
      ],
      A
    );
    expect(escolhida?.id).toBe("net2");
  });

  it("adquirente inativa ou de outra unidade não é escolhida", () => {
    expect(
      pickAcquirer(
        [
          {
            ...base,
            id: "off",
            clinicId: A,
            scope: "unidade" as const,
            name: "Stone",
            active: false,
          },
          {
            ...base,
            id: "outra",
            clinicId: B,
            scope: "unidade" as const,
            name: "Cielo",
          },
        ],
        A
      )
    ).toBeNull();
  });
});

describe("adquirente: quando a taxa é cobrada", () => {
  it("no pagamento (padrão), a baixa cobra a taxa", () => {
    expect(chargesFeeAtReceipt({ rate: { feeChargedOn: "pagamento" } })).toBe(
      true
    );
    // Faixa antiga, sem o campo, continua se comportando como antes.
    expect(chargesFeeAtReceipt({ rate: {} })).toBe(true);
  });

  it("na emissão, a baixa NUNCA cobra — nem se a emissão não foi registrada", () => {
    // Trava de dupla cobrança: deixar de lançar um custo é erro menor que
    // lançar o mesmo custo duas vezes.
    expect(chargesFeeAtReceipt({ rate: { feeChargedOn: "emissao" } })).toBe(
      false
    );
  });

  it("boleto já emitido zera a cobrança na baixa", () => {
    expect(
      chargesFeeAtReceipt({
        rate: { feeChargedOn: "pagamento" },
        alreadyIssued: true,
      })
    ).toBe(false);
  });

  it("a prévia avisa que o custo é da emissão", () => {
    const s = computeSettlement({
      grossCents: 20000,
      rate: {
        feePercent: 0,
        fixedFeeCents: 199,
        settlementDays: 1,
        settlementBusinessDays: true,
        feeChargedOn: "emissao",
      },
      paidAt: "2026-08-06",
    });
    expect(s.chargedAtIssue).toBe(true);
    expect(s.feeCents).toBe(199);
  });

  it("cobrança na emissão só vale para boleto e PIX", () => {
    expect(
      rateErrors({
        feePercent: 2.39,
        fixedFeeCents: 29,
        settlementDays: 30,
        minInstallments: 1,
        maxInstallments: 1,
        modality: "credito_avista",
        feeChargedOn: "emissao",
      })
    ).toContain(
      "Cobrança na emissão só vale para boleto e PIX — no cartão não há documento a emitir."
    );
    expect(
      rateErrors({
        feePercent: 0,
        fixedFeeCents: 199,
        settlementDays: 1,
        minInstallments: 1,
        maxInstallments: 1,
        modality: "boleto",
        feeChargedOn: "emissao",
      })
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fuso: "hoje" é data civil brasileira, não UTC
// ---------------------------------------------------------------------------
describe("data de hoje no Brasil", () => {
  it("depois das 21h, UTC já virou o dia — o Brasil não", () => {
    // Foi exatamente este instante que gravou uma baixa de 06/08 como 07/08.
    const instante = new Date("2026-08-07T00:39:58Z");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-08-07");
    expect(isoDateIn(instante)).toBe("2026-08-06");
  });

  it("no meio do dia os dois coincidem", () => {
    const instante = new Date("2026-08-06T15:00:00Z");
    expect(isoDateIn(instante)).toBe("2026-08-06");
  });

  it("à meia-noite e um do Brasil ainda é o mesmo dia", () => {
    // 00h01 em Brasília = 03h01 UTC.
    expect(isoDateIn(new Date("2026-08-06T03:01:00Z"))).toBe("2026-08-06");
  });

  it("23h59 do Brasil ainda não virou", () => {
    expect(isoDateIn(new Date("2026-08-07T02:59:00Z"))).toBe("2026-08-06");
  });
});

// ---------------------------------------------------------------------------
// FIN4c — a taxa segue o meio da BAIXA, não o meio da venda
// ---------------------------------------------------------------------------
describe("taxa da adquirente na baixa", () => {
  const rates: AcquirerRate[] = [
    {
      id: "r-boleto",
      acquirerId: "acq",
      modality: "boleto",
      minInstallments: 1,
      maxInstallments: 1,
      feePercent: 0,
      fixedFeeCents: 199,
      settlementDays: 1,
      settlementBusinessDays: true,
      freeMonthlyCount: null,
      feeChargedOn: "pagamento",
      validFrom: "2026-01-01",
      validTo: null,
    },
    {
      id: "r-pix",
      acquirerId: "acq",
      modality: "pix",
      minInstallments: 1,
      maxInstallments: 1,
      feePercent: 0,
      fixedFeeCents: 149,
      settlementDays: 0,
      settlementBusinessDays: false,
      freeMonthlyCount: null,
      feeChargedOn: "pagamento",
      validFrom: "2026-01-01",
      validTo: null,
    },
  ];

  it("parcela de boleto paga por PIX custa a taxa do PIX", () => {
    // Quem custou foi o meio que o dinheiro realmente usou.
    const modality = modalityOf("pix", 1);
    expect(modality).toBe("pix");
    const rate = resolveRate(rates, {
      acquirerId: "acq",
      modality: modality!,
      installments: 1,
      date: "2026-08-06",
    });
    const s = computeSettlement({
      grossCents: 50000,
      rate: rate!,
      paidAt: "2026-08-06",
    });
    expect(s.feeCents).toBe(149);
    expect(s.netCents).toBe(50000 - 149);
    // PIX cai no mesmo dia; boleto cairia em D+1 útil.
    expect(s.settlementDate).toBe("2026-08-06");
  });

  it("a mesma parcela paga em boleto custa a taxa do boleto", () => {
    const rate = resolveRate(rates, {
      acquirerId: "acq",
      modality: modalityOf("boleto", 1)!,
      installments: 1,
      date: "2026-08-06",
    });
    const s = computeSettlement({
      grossCents: 50000,
      rate: rate!,
      paidAt: "2026-08-06",
    });
    expect(s.feeCents).toBe(199);
    // 06/08/2026 é quinta — D+1 útil é sexta.
    expect(s.settlementDate).toBe("2026-08-07");
  });

  it("meio sem taxa cadastrada não gera cobrança nenhuma", () => {
    // Dinheiro em espécie não passa por adquirente.
    expect(modalityOf("dinheiro", 1)).toBeNull();
    expect(
      resolveRate(rates, {
        acquirerId: "acq",
        modality: "credito_avista",
        installments: 1,
        date: "2026-08-06",
      })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cancelamento de plano — o acerto de contas do termo
// ---------------------------------------------------------------------------
describe("cancelamento: acerto de contas", () => {
  // Plano de R$ 10.000 de tabela fechado por R$ 8.000 (20% de desconto).
  const base = {
    contractCents: 800000,
    listTotalCents: 1000000,
    penaltyPercent: 0,
  };

  it("o realizado é cobrado COM o desconto que o cliente tinha", () => {
    // Metade do plano executada: R$ 5.000 de tabela viram R$ 4.000.
    const s = settleCancellation({
      ...base,
      executedListCents: 500000,
      paidCents: 0,
    });
    expect(s.executedCents).toBe(400000);
    expect(s.pendingCents).toBe(400000);
    expect(s.dueCents).toBe(400000);
    expect(s.clientOwesCents).toBe(400000);
    expect(s.clinicRefundsCents).toBe(0);
  });

  it("quem pagou mais do que consumiu recebe de volta", () => {
    const s = settleCancellation({
      ...base,
      executedListCents: 500000,
      paidCents: 600000, // pagou R$ 6.000, consumiu R$ 4.000
    });
    expect(s.clinicRefundsCents).toBe(200000);
    expect(s.clientOwesCents).toBe(0);
  });

  it("a multa incide sobre o NÃO executado, não sobre o contrato", () => {
    const s = settleCancellation({
      ...base,
      penaltyPercent: 10,
      executedListCents: 500000,
      paidCents: 0,
    });
    // 10% sobre os R$ 4.000 que a clínica deixou de faturar.
    expect(s.penaltyCents).toBe(40000);
    expect(s.dueCents).toBe(440000);
  });

  it("multa zero (padrão) não cria linha nenhuma", () => {
    const s = settleCancellation({
      ...base,
      executedListCents: 250000,
      paidCents: 0,
    });
    expect(s.penaltyCents).toBe(0);
    expect(s.dueCents).toBe(s.executedCents);
  });

  it("plano inteiro executado não cobra mais que o contrato", () => {
    // Arredondamento não pode fazer o total passar do que foi contratado.
    const s = settleCancellation({
      ...base,
      executedListCents: 1000000,
      paidCents: 800000,
    });
    expect(s.executedCents).toBe(800000);
    expect(s.pendingCents).toBe(0);
    expect(s.clientOwesCents).toBe(0);
    expect(s.clinicRefundsCents).toBe(0);
  });

  it("nada executado e nada pago zera o acerto", () => {
    const s = settleCancellation({
      ...base,
      executedListCents: 0,
      paidCents: 0,
    });
    expect(s.executedCents).toBe(0);
    expect(s.dueCents).toBe(0);
    expect(s.clientOwesCents).toBe(0);
  });

  it("sem total de tabela, cobra o preço cheio em vez de dividir por zero", () => {
    expect(contractRatio({ contractCents: 5000, listTotalCents: 0 })).toBe(1);
  });

  it("acompanhamento sem data de retorno não gera termo", () => {
    // Sem data ninguém sabe quando ligar — o caso some do radar da unidade.
    expect(
      cancellationErrors({
        reason: "Mudou de cidade",
        destination: "follow_up",
        returnDate: null,
        wasClosed: true,
      })
    ).toContain("Informe a data de retorno do acompanhamento.");
    expect(
      cancellationErrors({
        reason: "Mudou de cidade",
        destination: "follow_up",
        returnDate: "2026-12-01",
        wasClosed: true,
      })
    ).toEqual([]);
  });

  it("motivo é obrigatório sempre; destino só quando a venda fechou", () => {
    expect(
      cancellationErrors({
        reason: "",
        destination: null,
        returnDate: null,
        wasClosed: false,
      })
    ).toEqual(["Escreva o motivo do cancelamento."]);
    // Negociação não fechada: o cliente segue na Fase 4, sem pergunta.
    expect(
      cancellationErrors({
        reason: "Desistiu antes de assinar",
        destination: null,
        returnDate: null,
        wasClosed: false,
      })
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FIN5 — repasse ao dentista e margem da venda
// ---------------------------------------------------------------------------
describe("repasse: a tabela vigente na data do procedimento", () => {
  const rates: PayoutRate[] = [
    {
      id: "nivel-antigo",
      procedureId: "proc-1",
      levelId: "pleno",
      providerId: null,
      amountCents: 10000,
      validFrom: "2026-01-01",
      validTo: "2026-06-30",
    },
    {
      id: "nivel-novo",
      procedureId: "proc-1",
      levelId: "pleno",
      providerId: null,
      amountCents: 12000,
      validFrom: "2026-07-01",
      validTo: null,
    },
    {
      id: "individual",
      procedureId: "proc-1",
      levelId: null,
      providerId: "dr-ana",
      amountCents: 15000,
      validFrom: "2026-07-01",
      validTo: null,
    },
  ];

  it("reajuste NÃO recalcula o que já foi produzido", () => {
    // Procedimento feito em maio usa a tabela de maio, mesmo consultando hoje.
    const maio = resolvePayoutRate(rates, {
      procedureId: "proc-1",
      levelId: "pleno",
      providerId: "dr-bruno",
      date: "2026-05-10",
    });
    expect(maio?.amountCents).toBe(10000);

    const agosto = resolvePayoutRate(rates, {
      procedureId: "proc-1",
      levelId: "pleno",
      providerId: "dr-bruno",
      date: "2026-08-10",
    });
    expect(agosto?.amountCents).toBe(12000);
  });

  it("valor individual vence o do nível", () => {
    const r = resolvePayoutRate(rates, {
      procedureId: "proc-1",
      levelId: "pleno",
      providerId: "dr-ana",
      date: "2026-08-10",
    });
    expect(r?.amountCents).toBe(15000);
  });

  it("sem tabela para o procedimento, devolve nulo em vez de inventar", () => {
    // Inventar valor faria o dentista receber errado sem ninguém notar.
    expect(
      resolvePayoutRate(rates, {
        procedureId: "proc-sem-tabela",
        levelId: "pleno",
        providerId: "dr-ana",
        date: "2026-08-10",
      })
    ).toBeNull();
  });

  it("o bônus incide sobre o TOTAL do período, não por procedimento", () => {
    const linhas = [
      { providerId: "a", providerName: "Dra. Ana", amountCents: 10000, accrualDate: "2026-08-03" },
      { providerId: "a", providerName: "Dra. Ana", amountCents: 15000, accrualDate: "2026-08-10" },
      { providerId: "b", providerName: "Dr. Bruno", amountCents: 20000, accrualDate: "2026-08-05" },
    ];
    const [primeiro, segundo] = summarizePayouts(linhas, 10);
    // Quem produziu mais aparece primeiro: Ana (R$ 250) na frente de Bruno (R$ 200).
    expect(primeiro.providerId).toBe("a");
    expect(segundo.providerId).toBe("b");
    const somaAna = summarizePayouts(linhas, 10).find((s) => s.providerId === "a")!;
    expect(somaAna.count).toBe(2);
    expect(somaAna.fixedCents).toBe(25000);
    expect(somaAna.bonusCents).toBe(2500);
    expect(somaAna.totalCents).toBe(27500);
  });

  it("uma linha vale para um nível OU para uma pessoa, nunca ambos", () => {
    expect(
      payoutRateErrors({
        procedureId: "p",
        levelId: "pleno",
        providerId: "dr-ana",
        amountCents: 100,
        validFrom: "2026-01-01",
      })
    ).toContain(
      "A linha vale para um nível OU para um profissional, não ambos."
    );
  });
});

describe("margem: o desconto sai inteiro da clínica", () => {
  it("mostra a conta completa da venda", () => {
    const m = computeMargin(
      {
        priceCents: 800000,
        payoutCents: 320000,
        materialCents: 90000,
        acquirerFeeCents: 19000,
      },
      30
    );
    expect(m.costCents).toBe(429000);
    expect(m.marginCents).toBe(371000);
    expect(m.marginPercent).toBe(46.38);
    expect(m.belowMinimum).toBe(false);
    expect(m.negative).toBe(false);
  });

  it("avisa quando a margem cai abaixo do mínimo", () => {
    const m = computeMargin(
      { priceCents: 500000, payoutCents: 320000, acquirerFeeCents: 12000 },
      40
    );
    // Sobra 33,6% de margem — acima de zero, mas abaixo do mínimo de 40%.
    expect(m.belowMinimum).toBe(true);
    expect(m.negative).toBe(false);
  });

  it("margem negativa é venda com prejuízo direto", () => {
    const m = computeMargin({ priceCents: 200000, payoutCents: 320000 }, 30);
    expect(m.negative).toBe(true);
    expect(m.marginCents).toBe(-120000);
  });

  it("declara que materiais ainda não entram na conta", () => {
    // O Estoque vem depois do FIN5 — apresentar margem incompleta como
    // completa é pior que não mostrar.
    const m = computeMargin({ priceCents: 100000, payoutCents: 40000 });
    expect(m.materialsPending).toBe(true);
  });

  it("com repasse fixo, cada real de desconto é um real de margem", () => {
    const perda = marginLostByDiscount({
      discountCents: 80000,
      marginBeforeDiscountCents: 371000,
    });
    expect(perda.lostCents).toBe(80000);
    // 10% de desconto no preço come 21,6% da margem — é isso que o consultor
    // precisa ver antes de conceder.
    expect(perda.percentOfMargin).toBe(21.56);
  });

  it("preço zero não divide por zero", () => {
    const m = computeMargin({ priceCents: 0, payoutCents: 0 }, 30);
    expect(m.marginPercent).toBe(0);
    expect(m.belowMinimum).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 0210 — os QUATRO DEGRAUS do repasse (uma fonte só, precedência declarada)
// ---------------------------------------------------------------------------
describe("repasse: precedência entre nível e cadastro do procedimento", () => {
  const doNivel: PayoutRate[] = [
    {
      id: "n1",
      procedureId: "p1",
      levelId: "pleno",
      providerId: null,
      amountCents: 12000,
      validFrom: "2026-01-01",
      validTo: null,
    },
  ];

  it("o nível vence o valor do cadastro do procedimento", () => {
    const r = resolvePayoutRate(doNivel, {
      procedureId: "p1",
      levelId: "pleno",
      providerId: "dr-ana",
      date: "2026-08-08",
      procedureFixedCents: 9000,
    });
    expect(r?.amountCents).toBe(12000);
    expect(r?.source).toBe("nivel");
  });

  it("sem nível cadastrado, cai no valor fixo do procedimento", () => {
    // Isto é o que o dono já tinha preenchido desde a 0039 — não se perde.
    const r = resolvePayoutRate([], {
      procedureId: "p1",
      levelId: null,
      providerId: "dr-ana",
      date: "2026-08-08",
      procedureFixedCents: 9000,
    });
    expect(r?.amountCents).toBe(9000);
    expect(r?.source).toBe("procedimento_fixo");
  });

  it("sem fixo, usa o percentual sobre o preço do procedimento", () => {
    const r = resolvePayoutRate([], {
      procedureId: "p1",
      levelId: null,
      providerId: "dr-ana",
      date: "2026-08-08",
      procedureFixedCents: 0,
      procedurePercent: 30,
      procedurePriceCents: 50000,
    });
    expect(r?.amountCents).toBe(15000);
    expect(r?.source).toBe("procedimento_percentual");
  });

  it("o fixo vence o percentual quando os dois existem", () => {
    const r = resolvePayoutRate([], {
      procedureId: "p1",
      levelId: null,
      providerId: "dr-ana",
      date: "2026-08-08",
      procedureFixedCents: 9000,
      procedurePercent: 30,
      procedurePriceCents: 50000,
    });
    expect(r?.amountCents).toBe(9000);
  });

  it("nenhum degrau: devolve nulo em vez de inventar valor", () => {
    expect(
      resolvePayoutRate([], {
        procedureId: "p1",
        levelId: null,
        providerId: "dr-ana",
        date: "2026-08-08",
      })
    ).toBeNull();
  });
});
