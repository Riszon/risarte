import { describe, expect, it } from "vitest";
import {
  applyCampaign,
  campaignCoversFee,
  campaignErrors,
  isCampaignLive,
  ruleErrors,
  simulateMonth,
  slugifyFeeKey,
  splitAmountCents,
  totalFixedCents,
  totalPercent,
  type NetworkFeeRule,
} from "@/lib/finance/network-fees";

const rule = (
  fee: string,
  kind: NetworkFeeRule["kind"],
  percent: number,
  amountCents = 0,
  active = true
): NetworkFeeRule => ({
  fee,
  label: fee,
  kind,
  percent,
  amountCents,
  dueDay: 10,
  active,
  isOverride: false,
  note: "",
  campaignName: null,
});

describe("o valor de uma baixa", () => {
  it("percentual sobre o recebido, arredondando meio para cima", () => {
    // R$ 1.000,00 a 2,5% = R$ 25,00
    expect(splitAmountCents(100_000, rule("royalty", "percent", 2.5))).toBe(2_500);
    // R$ 333,33 a 2,5% = R$ 8,33325 → 8,33
    expect(splitAmountCents(33_333, rule("royalty", "percent", 2.5))).toBe(833);
  });

  it("taxa desligada não cobra nada", () => {
    expect(
      splitAmountCents(100_000, rule("royalty", "percent", 5, 0, false))
    ).toBe(0);
  });

  it("percentual zerado não gera linha de R$ 0,00", () => {
    expect(splitAmountCents(100_000, rule("royalty", "percent", 0))).toBe(0);
  });

  it("taxa fixa não incide sobre a baixa", () => {
    // A taxa de sistema é mensal: cobrá-la a cada recebimento multiplicaria
    // o valor pelo número de baixas do mês.
    expect(splitAmountCents(100_000, rule("sistema", "fixed", 0, 50_000))).toBe(0);
  });

  it("recebimento zero ou negativo não gera taxa", () => {
    expect(splitAmountCents(0, rule("royalty", "percent", 5))).toBe(0);
    expect(splitAmountCents(-100, rule("royalty", "percent", 5))).toBe(0);
  });
});

describe("o que incide sobre cada real", () => {
  const rules = [
    rule("royalty", "percent", 5),
    rule("fundo", "percent", 2),
    rule("planejamento", "percent", 3),
    rule("comercial", "percent", 4, 0, false), // desligada nesta unidade
    rule("sistema", "fixed", 0, 50_000),
    rule("sdr", "fixed", 0, 30_000),
  ];

  it("soma só os percentuais ligados", () => {
    expect(totalPercent(rules)).toBe(10);
  });

  it("soma só as fixas ligadas", () => {
    expect(totalFixedCents(rules)).toBe(80_000);
  });

  it("simula o mês somando as duas naturezas", () => {
    // Recebeu R$ 50.000: 10% = R$ 5.000, mais R$ 800 de fixas.
    const s = simulateMonth(rules, 5_000_000);
    expect(s.percentCents).toBe(500_000);
    expect(s.fixedCents).toBe(80_000);
    expect(s.totalCents).toBe(580_000);
  });

  it("mês sem receber ainda paga as fixas", () => {
    // É a diferença que o franqueado precisa enxergar antes de assinar.
    const s = simulateMonth(rules, 0);
    expect(s.percentCents).toBe(0);
    expect(s.totalCents).toBe(80_000);
  });
});

describe("campanhas", () => {
  const base = { kind: "percent" as const, percent: 5, amountCents: 100_000 };

  it("sem campanha, o valor combinado não muda", () => {
    expect(applyCampaign(base, null)).toEqual({
      percent: 5,
      amountCents: 100_000,
    });
  });

  it("modo VALOR troca o percentual", () => {
    expect(
      applyCampaign(base, {
        mode: "valor",
        percent: 3,
        amountCents: null,
        discountPercent: null,
      }).percent
    ).toBe(3);
  });

  it("isenção é valor zero, não campanha ausente", () => {
    // Zero precisa sobreviver ao coalesce: `percent ?? base` com 0 daria 0,
    // mas com null daria 5 — e a unidade continuaria pagando.
    expect(
      applyCampaign(base, {
        mode: "valor",
        percent: 0,
        amountCents: null,
        discountPercent: null,
      }).percent
    ).toBe(0);
  });

  it("modo VALOR sem informar o campo mantém o que estava", () => {
    expect(
      applyCampaign(base, {
        mode: "valor",
        percent: null,
        amountCents: null,
        discountPercent: null,
      })
    ).toEqual({ percent: 5, amountCents: 100_000 });
  });

  it("modo DESCONTO corta um pedaço do valor vigente", () => {
    const r = applyCampaign(base, {
      mode: "desconto",
      percent: null,
      amountCents: null,
      discountPercent: 50,
    });
    expect(r.percent).toBe(2.5);
    expect(r.amountCents).toBe(50_000);
  });

  it("desconto de 100% zera, mas não inverte o sinal", () => {
    const r = applyCampaign(base, {
      mode: "desconto",
      percent: null,
      amountCents: null,
      discountPercent: 100,
    });
    expect(r.percent).toBe(0);
    expect(r.amountCents).toBe(0);
  });

  it("vale só dentro do período", () => {
    const c = { startsOn: "2026-09-01", endsOn: "2026-10-31", active: true };
    expect(isCampaignLive(c, "2026-08-31")).toBe(false);
    expect(isCampaignLive(c, "2026-09-01")).toBe(true);
    expect(isCampaignLive(c, "2026-10-31")).toBe(true);
    expect(isCampaignLive(c, "2026-11-01")).toBe(false);
  });

  it("campanha desligada não vale nem dentro do período", () => {
    expect(
      isCampaignLive(
        { startsOn: "2026-09-01", endsOn: "2026-10-31", active: false },
        "2026-09-15"
      )
    ).toBe(false);
  });
});

describe("validação", () => {
  it("recusa percentual fora da faixa", () => {
    expect(
      ruleErrors({ kind: "percent", percent: -1, amountCents: 0, dueDay: 10 })
    ).toHaveLength(1);
    expect(
      ruleErrors({ kind: "percent", percent: 101, amountCents: 0, dueDay: 10 })
    ).toHaveLength(1);
  });

  it("recusa vencimento depois do dia 28", () => {
    // Fevereiro existe: dia 30 não cai em fevereiro nenhum.
    expect(
      ruleErrors({ kind: "fixed", percent: 0, amountCents: 100, dueDay: 30 })
    ).toContain("O dia do vencimento precisa estar entre 1 e 28.");
    expect(
      ruleErrors({ kind: "fixed", percent: 0, amountCents: 100, dueDay: 28 })
    ).toHaveLength(0);
  });

  it("campanha precisa de nome e de período coerente", () => {
    expect(
      campaignErrors({
        name: "",
        startsOn: "2026-09-01",
        endsOn: "2026-10-31",
        mode: "valor",
        percent: 3,
        discountPercent: null,
      })
    ).toContain("Dê um nome à campanha.");

    expect(
      campaignErrors({
        name: "Campanha",
        startsOn: "2026-10-01",
        endsOn: "2026-09-01",
        mode: "valor",
        percent: 3,
        discountPercent: null,
      })
    ).toContain("O fim da campanha não pode ser antes do início.");
  });

  it("campanha de desconto precisa de um desconto de verdade", () => {
    expect(
      campaignErrors({
        name: "Campanha",
        startsOn: "2026-09-01",
        endsOn: "2026-10-31",
        mode: "desconto",
        percent: null,
        discountPercent: 0,
      })
    ).toContain("O desconto precisa ser maior que zero.");
  });

  it("campanha válida não reclama", () => {
    expect(
      campaignErrors({
        name: "Isenção de implantação",
        startsOn: "2026-09-01",
        endsOn: "2026-11-30",
        mode: "valor",
        percent: 0,
        discountPercent: null,
      })
    ).toEqual([]);
  });
});

describe("chave da taxa nova", () => {
  it("tira acento, espaço e maiúscula", () => {
    expect(slugifyFeeKey("Taxa de Inovação")).toBe("taxa_de_inovacao");
    expect(slugifyFeeKey("  Marketing Local  ")).toBe("marketing_local");
    expect(slugifyFeeKey("Suporte 24/7")).toBe("suporte_24_7");
  });
});

describe("quais taxas a campanha alcança", () => {
  const covers = (fees: string[] | null, key: string) =>
    campaignCoversFee({ fees }, key);

  it("lista nula alcança todas", () => {
    expect(covers(null, "royalty")).toBe(true);
    expect(covers(null, "sdr")).toBe(true);
  });

  it("lista VAZIA também alcança todas", () => {
    // É o mesmo significado de nulo. Por isso o banco recusa apagar uma taxa
    // que está em campanha: esvaziar a lista viraria "todas" sem ninguém pedir.
    expect(covers([], "royalty")).toBe(true);
  });

  it("lista com taxas alcança só as escolhidas", () => {
    expect(covers(["royalty", "fundo"], "royalty")).toBe(true);
    expect(covers(["royalty", "fundo"], "fundo")).toBe(true);
    expect(covers(["royalty", "fundo"], "comercial")).toBe(false);
    expect(covers(["royalty", "fundo"], "sdr")).toBe(false);
  });

  it("uma taxa só continua funcionando", () => {
    expect(covers(["sistema"], "sistema")).toBe(true);
    expect(covers(["sistema"], "sdr")).toBe(false);
  });
});
