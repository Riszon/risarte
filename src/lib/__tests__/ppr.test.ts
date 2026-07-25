import { describe, expect, it } from "vitest";
import {
  benefitAvailability,
  bestProgramOffer,
  canAddDependent,
  canManagePpr,
  canSellPpr,
  daysOverdue,
  extraDependentCount,
  installmentDiscountPercent,
  maxDependentsOf,
  maxInstallmentsFor,
  nextAvailableAt,
  pprMonthlyCents,
  pprPriceFor,
  socialPointsFor,
  statusFromCharges,
  type PprBenefit,
  type PprInstallmentTier,
  type PprPlan,
} from "@/lib/ppr/rules";

// Programa de Prevenção Riso+ (docs/PPR.md). Trava as decisões do dono:
// mensalidade sem taxa de adesão, parcela mínima, tabela de desconto por
// parcelas, carência a partir da ativação, 30/90 dias de inadimplência,
// pontos proporcionais ao valor pago e "melhor benefício" entre programas.

const plan = (p: Partial<PprPlan> = {}): PprPlan => ({
  id: "p1",
  name: "Plano Standard",
  monthlyCents: 9990,
  allowsDependents: false,
  includedDependents: 0,
  allowsExtraDependents: false,
  extraDependentCents: 0,
  maxDependents: 0,
  cashDiscountPercent: 10,
  maxInstallments: 18,
  minInstallmentCents: 5000,
  gracePeriodDays: 0,
  socialEnabled: true,
  socialPointsPerCents: 5000,
  ...p,
});

const familiaPlus = plan({
  name: "Plano Família+",
  monthlyCents: 19990,
  allowsDependents: true,
  includedDependents: 2,
  allowsExtraDependents: true,
  extraDependentCents: 5990,
  maxDependents: null,
});

const tiers: PprInstallmentTier[] = [
  { upToInstallments: 6, discountPercent: 15 },
  { upToInstallments: 12, discountPercent: 10 },
  { upToInstallments: 18, discountPercent: 5 },
];

const benefit = (p: Partial<PprBenefit> = {}): PprBenefit => ({
  benefitType: "percent",
  benefitValue: 20,
  gracePeriodDays: 0,
  frequencyMonths: null,
  giftLabel: null,
  ...p,
});

describe("PPR+ — quem vende e quem administra", () => {
  it("consultor comercial vende pelo fluxo comercial", () => {
    expect(canSellPpr(["commercial_consultant"], "comercial")).toBe(true);
  });

  it("recepção, gerente e coordenador vendem pela venda direta", () => {
    expect(canSellPpr(["receptionist"], "venda_direta")).toBe(true);
    expect(canSellPpr(["unit_manager"], "venda_direta")).toBe(true);
    expect(canSellPpr(["clinical_coordinator"], "venda_direta")).toBe(true);
  });

  it("a SDR não vende o PPR+ em nenhum fluxo", () => {
    expect(canSellPpr(["sdr"], "venda_direta")).toBe(false);
    expect(canSellPpr(["sdr"], "comercial")).toBe(false);
  });

  it("recepção não vende pelo fluxo comercial (e vice-versa)", () => {
    expect(canSellPpr(["receptionist"], "comercial")).toBe(false);
    expect(canSellPpr(["commercial_consultant"], "venda_direta")).toBe(false);
  });

  it("cancelar/suspender é do gerente e do admin master", () => {
    expect(canManagePpr(["unit_manager"])).toBe(true);
    expect(canManagePpr(["receptionist"])).toBe(false);
    expect(canManagePpr(["receptionist"], true)).toBe(true);
  });
});

describe("PPR+ — mensalidade e dependentes", () => {
  it("mensalidade é só o valor do plano quando não há extras", () => {
    expect(pprMonthlyCents(plan())).toBe(9990);
  });

  it("Família+ soma R$ 59,90 por dependente extra", () => {
    expect(pprMonthlyCents(familiaPlus, 2)).toBe(19990 + 2 * 5990);
  });

  it("plano sem dependentes extras ignora o parâmetro", () => {
    expect(pprMonthlyCents(plan(), 3)).toBe(9990);
  });

  it("limite de dependentes respeita o plano", () => {
    expect(maxDependentsOf(plan())).toBe(0);
    expect(maxDependentsOf(plan({ allowsDependents: true, includedDependents: 1 }))).toBe(1);
    expect(maxDependentsOf(familiaPlus)).toBeNull();
  });

  it("Família (1 dependente) não aceita o segundo", () => {
    const familia = plan({
      allowsDependents: true,
      includedDependents: 1,
      maxDependents: 1,
    });
    expect(canAddDependent(familia, 0)).toBe(true);
    expect(canAddDependent(familia, 1)).toBe(false);
  });

  it("Família+ conta como extra o que passa dos incluídos", () => {
    expect(extraDependentCount(familiaPlus, 2)).toBe(0);
    expect(extraDependentCount(familiaPlus, 4)).toBe(2);
  });
});

describe("PPR+ — parcelamento e descontos", () => {
  it("desconto do parcelado vem da faixa da tabela", () => {
    expect(installmentDiscountPercent(tiers, 6)).toBe(15);
    expect(installmentDiscountPercent(tiers, 10)).toBe(10);
    expect(installmentDiscountPercent(tiers, 18)).toBe(5);
  });

  it("à vista não usa a tabela do parcelado", () => {
    expect(installmentDiscountPercent(tiers, 1)).toBe(0);
  });

  it("acima da última faixa não há desconto de parcelamento", () => {
    expect(installmentDiscountPercent(tiers, 24)).toBe(0);
  });

  it("parcela mínima reduz o número de parcelas possível", () => {
    // R$ 300,00 com parcela mínima de R$ 50,00 → no máximo 6x.
    expect(maxInstallmentsFor(plan(), 30000)).toBe(6);
    // R$ 5.000,00 cabe no limite do plano (18x).
    expect(maxInstallmentsFor(plan(), 500000)).toBe(18);
  });

  it("valor pequeno nunca fica com menos de 1 parcela", () => {
    expect(maxInstallmentsFor(plan(), 1000)).toBe(1);
  });

  it("à vista aplica o desconto do plano", () => {
    const r = pprPriceFor({ plan: plan(), tiers, benefit: null, baseCents: 100000 });
    expect(r.paymentDiscountCents).toBe(10000);
    expect(r.finalCents).toBe(90000);
  });

  it("procedimento isento zera o valor", () => {
    const r = pprPriceFor({
      plan: plan(),
      tiers,
      benefit: benefit({ benefitType: "free" }),
      baseCents: 20000,
    });
    expect(r.coverageCents).toBe(20000);
    expect(r.finalCents).toBe(0);
  });

  it("cobertura e desconto de pagamento não se anulam", () => {
    // R$ 1.000 − 20% de cobertura = R$ 800; parcelado em 6x = −15% → R$ 680.
    const r = pprPriceFor({
      plan: plan(),
      tiers,
      benefit: benefit({ benefitValue: 20 }),
      baseCents: 100000,
      installments: 6,
    });
    expect(r.coverageCents).toBe(20000);
    expect(r.paymentDiscountCents).toBe(12000);
    expect(r.finalCents).toBe(68000);
    expect(r.installmentCents).toBe(Math.round(68000 / 6));
  });

  it("sem benefício no procedimento, só vale o desconto de pagamento", () => {
    const r = pprPriceFor({
      plan: plan(),
      tiers,
      benefit: benefit({ benefitType: "none" }),
      baseCents: 50000,
      installments: 12,
    });
    expect(r.coverageCents).toBe(0);
    expect(r.appliedPaymentPercent).toBe(10);
    expect(r.finalCents).toBe(45000);
  });
});

describe("PPR+ — carência e frequência", () => {
  const activated = new Date("2026-01-10T00:00:00");

  it("plano aguardando ativação não usa benefício", () => {
    const r = benefitAvailability({
      status: "aguardando_ativacao",
      plan: plan(),
      benefit: benefit(),
      activatedAt: null,
      lastUsedAt: null,
    });
    expect(r.available).toBe(false);
  });

  it("plano suspenso bloqueia o benefício", () => {
    const r = benefitAvailability({
      status: "suspenso",
      plan: plan(),
      benefit: benefit(),
      activatedAt: activated,
      lastUsedAt: null,
    });
    expect(r.available).toBe(false);
    expect(r.reason).toContain("suspenso");
  });

  it("carência conta a partir da ativação", () => {
    const p = plan({ gracePeriodDays: 30 });
    const dentro = benefitAvailability({
      status: "ativo",
      plan: p,
      benefit: benefit(),
      activatedAt: activated,
      lastUsedAt: null,
      now: new Date("2026-01-20T00:00:00"),
    });
    expect(dentro.available).toBe(false);
    const depois = benefitAvailability({
      status: "ativo",
      plan: p,
      benefit: benefit(),
      activatedAt: activated,
      lastUsedAt: null,
      now: new Date("2026-02-15T00:00:00"),
    });
    expect(depois.available).toBe(true);
  });

  it("limpeza a cada 4 meses só libera depois do prazo", () => {
    const b = benefit({ benefitType: "free", frequencyMonths: 4 });
    const usada = new Date("2026-03-01T00:00:00");
    const cedo = benefitAvailability({
      status: "ativo",
      plan: plan(),
      benefit: b,
      activatedAt: activated,
      lastUsedAt: usada,
      now: new Date("2026-05-01T00:00:00"),
    });
    expect(cedo.available).toBe(false);
    const noPrazo = benefitAvailability({
      status: "ativo",
      plan: plan(),
      benefit: b,
      activatedAt: activated,
      lastUsedAt: usada,
      now: new Date("2026-07-02T00:00:00"),
    });
    expect(noPrazo.available).toBe(true);
  });

  it("próxima liberação = uso + meses da frequência", () => {
    const next = nextAvailableAt(new Date("2026-03-10T00:00:00"), 6);
    expect(next?.getMonth()).toBe(8); // setembro
    expect(nextAvailableAt(new Date(), null)).toBeNull();
  });
});

describe("PPR+ — inadimplência e Riso+ Social", () => {
  const settings = { suspendAfterDays: 30, cancelAfterDays: 90 };
  const hoje = new Date("2026-06-01T00:00:00");

  it("sem mensalidade em atraso o plano segue ativo", () => {
    expect(
      statusFromCharges({
        current: "ativo",
        charges: [{ dueDate: "2026-05-25", status: "em_aberto" }],
        settings,
        now: hoje,
      })
    ).toBe("ativo");
  });

  it("30 dias de atraso suspendem", () => {
    expect(
      statusFromCharges({
        current: "ativo",
        charges: [{ dueDate: "2026-05-01", status: "atrasada" }],
        settings,
        now: hoje,
      })
    ).toBe("suspenso");
  });

  it("90 dias de atraso cancelam", () => {
    expect(
      statusFromCharges({
        current: "suspenso",
        charges: [{ dueDate: "2026-03-01", status: "atrasada" }],
        settings,
        now: hoje,
      })
    ).toBe("cancelado");
  });

  it("mensalidade paga não conta como atraso", () => {
    expect(
      daysOverdue([{ dueDate: "2026-01-01", status: "paga" }], hoje)
    ).toBe(0);
  });

  it("adesão aguardando ativação não muda pelas mensalidades", () => {
    expect(
      statusFromCharges({
        current: "aguardando_ativacao",
        charges: [{ dueDate: "2026-01-01", status: "atrasada" }],
        settings,
        now: hoje,
      })
    ).toBe("aguardando_ativacao");
  });

  it("pontos sociais são proporcionais ao valor pago", () => {
    expect(socialPointsFor(plan(), 9990)).toBe(1);
    expect(socialPointsFor(plan(), 19990)).toBe(3);
  });

  it("plano Light não pontua no Riso+ Social", () => {
    expect(socialPointsFor(plan({ socialEnabled: false }), 20000)).toBe(0);
  });
});

describe("PPR+ — convivência com o Risarte Empresarial", () => {
  it("vale o melhor benefício para o cliente", () => {
    const best = bestProgramOffer(
      { program: "ppr", benefitType: "percent", benefitValue: 20 },
      { program: "empresarial", benefitType: "percent", benefitValue: 35 }
    );
    expect(best?.program).toBe("empresarial");
  });

  it("isento ganha de qualquer percentual", () => {
    const best = bestProgramOffer(
      { program: "ppr", benefitType: "free", benefitValue: null },
      { program: "empresarial", benefitType: "percent", benefitValue: 50 }
    );
    expect(best?.program).toBe("ppr");
  });

  it("empate fica com o PPR+", () => {
    const best = bestProgramOffer(
      { program: "ppr", benefitType: "percent", benefitValue: 30 },
      { program: "empresarial", benefitType: "percent", benefitValue: 30 }
    );
    expect(best?.program).toBe("ppr");
  });

  it("cliente só no Empresarial usa o Empresarial", () => {
    const best = bestProgramOffer(null, {
      program: "empresarial",
      benefitType: "percent",
      benefitValue: 15,
    });
    expect(best?.program).toBe("empresarial");
  });
});
