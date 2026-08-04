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

    it("só boleto e recorrência correm o risco de perder o benefício", () => {
      expect(methodRunsLateRisk("boleto")).toBe(true);
      expect(methodRunsLateRisk("credito_recorrente")).toBe(true);
      expect(methodRunsLateRisk("cartao_parcelado")).toBe(false);
      expect(methodRunsLateRisk("pix")).toBe(false);
      expect(methodRunsLateRisk(null)).toBe(false);
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
