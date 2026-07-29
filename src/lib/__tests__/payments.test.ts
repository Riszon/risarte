import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  buildSchedule,
  redistributeFrom,
  resequenceDatesFrom,
  scheduleErrors,
  scheduleTotalCents,
} from "@/lib/payments";

// I9: entrada + parcelas personalizadas. A soma das cobranças SEMPRE fecha com
// o valor da venda — é o que o Financeiro vai cobrar depois.

describe("datas do plano de pagamento", () => {
  it("soma dias sem cair no fuso", () => {
    expect(addDays("2026-07-28", 30)).toBe("2026-08-27");
  });
  it("soma meses mantendo o dia", () => {
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
  });
  it("dia 31 vira o último dia do mês curto", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("buildSchedule", () => {
  it("entrada + parcelas mensais fecham com o total", () => {
    const s = buildSchedule({
      totalCents: 100000,
      downPaymentCents: 20000,
      installments: 4,
      firstDueDate: "2026-08-05",
    });
    expect(s).toHaveLength(5);
    expect(s[0].kind).toBe("entrada");
    expect(s[0].amountCents).toBe(20000);
    expect(s[1].dueDate).toBe("2026-09-05"); // 1ª parcela um mês após a entrada
    expect(scheduleTotalCents(s)).toBe(100000);
  });

  it("sem entrada, a 1ª parcela vence na data informada", () => {
    const s = buildSchedule({
      totalCents: 90000,
      downPaymentCents: 0,
      installments: 3,
      firstDueDate: "2026-08-10",
    });
    expect(s).toHaveLength(3);
    expect(s[0].kind).toBe("parcela");
    expect(s[0].dueDate).toBe("2026-08-10");
    expect(s.every((e) => e.amountCents === 30000)).toBe(true);
  });

  it("a sobra dos centavos vai para a última parcela", () => {
    const s = buildSchedule({
      totalCents: 10000,
      downPaymentCents: 0,
      installments: 3,
      firstDueDate: "2026-08-01",
    });
    expect(s.map((e) => e.amountCents)).toEqual([3333, 3333, 3334]);
    expect(scheduleTotalCents(s)).toBe(10000);
  });

  it("aceita intervalo em dias (quinzenal etc.)", () => {
    const s = buildSchedule({
      totalCents: 60000,
      downPaymentCents: 0,
      installments: 3,
      firstDueDate: "2026-08-01",
      everyDays: 15,
    });
    expect(s.map((e) => e.dueDate)).toEqual([
      "2026-08-01",
      "2026-08-16",
      "2026-08-31",
    ]);
  });

  it("entrada igual ao total dispensa parcelas", () => {
    const s = buildSchedule({
      totalCents: 50000,
      downPaymentCents: 50000,
      installments: 3,
      firstDueDate: "2026-08-01",
    });
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe("entrada");
  });
});

describe("scheduleErrors", () => {
  const ok = buildSchedule({
    totalCents: 100000,
    downPaymentCents: 20000,
    installments: 4,
    firstDueDate: "2026-08-05",
  });

  it("plano coerente não tem erro", () => {
    expect(scheduleErrors(ok, { totalCents: 100000 })).toEqual([]);
  });

  it("acusa soma diferente do valor da venda", () => {
    const bad = [...ok];
    bad[1] = { ...bad[1], amountCents: bad[1].amountCents + 100 };
    const errs = scheduleErrors(bad, { totalCents: 100000 });
    expect(errs.some((e) => e.includes("fechar com o valor"))).toBe(true);
  });

  it("acusa parcela abaixo do mínimo do meio de pagamento", () => {
    const errs = scheduleErrors(ok, {
      totalCents: 100000,
      minInstallmentCents: 30000,
    });
    expect(errs.some((e) => e.includes("abaixo do mínimo"))).toBe(true);
  });

  it("a entrada não é comparada com o mínimo da parcela", () => {
    const s = buildSchedule({
      totalCents: 100000,
      downPaymentCents: 5000,
      installments: 2,
      firstDueDate: "2026-08-05",
    });
    // Entrada de R$ 50 com mínimo de R$ 400: as parcelas (R$ 475) passam.
    expect(
      scheduleErrors(s, { totalCents: 100000, minInstallmentCents: 40000 })
    ).toEqual([]);
  });

  it("acusa vencimento fora de ordem", () => {
    const bad = [...ok];
    bad[2] = { ...bad[2], dueDate: "2026-01-01" };
    const errs = scheduleErrors(bad, { totalCents: 100000 });
    expect(errs.some((e) => e.includes("ordem crescente"))).toBe(true);
  });

  it("acusa valor zerado e plano vazio", () => {
    expect(scheduleErrors([], { totalCents: 1000 })).toHaveLength(1);
    const zero = [
      { seq: 1, kind: "parcela" as const, dueDate: "2026-08-01", amountCents: 0 },
    ];
    expect(
      scheduleErrors(zero, { totalCents: 0 }).some((e) =>
        e.includes("valor maior que zero")
      )
    ).toBe(true);
  });
});

describe("redistributeFrom — editar uma parcela recalcula as seguintes", () => {
  const plan = buildSchedule({
    totalCents: 176700,
    downPaymentCents: 50000,
    installments: 5,
    firstDueDate: "2026-07-28",
  });

  it("entrada 500 + 2ª de 500 ajusta as demais e fecha o total", () => {
    // Índice 1 = primeira parcela (índice 0 é a entrada).
    const next = redistributeFrom(plan, 1, 50000, 176700);
    expect(next[0].amountCents).toBe(50000); // entrada intacta
    expect(next[1].amountCents).toBe(50000); // a que foi editada
    expect(scheduleTotalCents(next)).toBe(176700);
    // As 4 seguintes dividem o que sobrou (R$ 767,00).
    expect(next.slice(2).map((e) => e.amountCents)).toEqual([
      19175, 19175, 19175, 19175,
    ]);
  });

  it("as cobranças ANTERIORES não são tocadas", () => {
    const next = redistributeFrom(plan, 3, 40000, 176700);
    expect(next.slice(0, 3).map((e) => e.amountCents)).toEqual(
      plan.slice(0, 3).map((e) => e.amountCents)
    );
    expect(scheduleTotalCents(next)).toBe(176700);
  });

  it("editar a última só muda ela (e o plano pode não fechar)", () => {
    const next = redistributeFrom(plan, plan.length - 1, 1, 176700);
    expect(next).toHaveLength(plan.length);
    expect(next.at(-1)?.amountCents).toBe(1);
  });

  it("valor que consome tudo remove as cobranças seguintes", () => {
    const next = redistributeFrom(plan, 1, 126700, 176700);
    expect(next).toHaveLength(2);
    expect(scheduleTotalCents(next)).toBe(176700);
  });

  it("a sobra dos centavos cai na última", () => {
    const s = buildSchedule({
      totalCents: 10000,
      downPaymentCents: 0,
      installments: 3,
      firstDueDate: "2026-08-01",
    });
    const next = redistributeFrom(s, 0, 1, 10000);
    expect(scheduleTotalCents(next)).toBe(10000);
    expect(next.map((e) => e.amountCents)).toEqual([1, 4999, 5000]);
  });
});

describe("resequenceDatesFrom — mudar a data e as seguintes acompanham", () => {
  const plan = buildSchedule({
    totalCents: 150000,
    downPaymentCents: 30000,
    installments: 3,
    firstDueDate: "2026-08-10",
  });
  // Datas originais: entrada 10/08, parcelas 10/09, 10/10, 10/11.

  it("as seguintes viram o mesmo dia dos meses seguintes", () => {
    const next = resequenceDatesFrom(plan, 1, "2026-09-20");
    expect(next.map((e) => e.dueDate)).toEqual([
      "2026-08-10", // entrada intacta
      "2026-09-20", // a editada
      "2026-10-20",
      "2026-11-20",
    ]);
  });

  it("valores não mudam, só as datas", () => {
    const next = resequenceDatesFrom(plan, 1, "2026-09-20");
    expect(next.map((e) => e.amountCents)).toEqual(
      plan.map((e) => e.amountCents)
    );
  });

  it("dia 31 vira o último dia do mês curto", () => {
    const next = resequenceDatesFrom(plan, 1, "2027-01-31");
    expect(next[2].dueDate).toBe("2027-02-28");
    expect(next[3].dueDate).toBe("2027-03-31");
  });

  it("mudar a entrada rearruma o plano inteiro", () => {
    const next = resequenceDatesFrom(plan, 0, "2026-08-25");
    expect(next.map((e) => e.dueDate)).toEqual([
      "2026-08-25",
      "2026-09-25",
      "2026-10-25",
      "2026-11-25",
    ]);
  });
});
