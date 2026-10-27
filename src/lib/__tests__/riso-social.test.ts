import { describe, expect, it } from "vitest";
import {
  conquistasDasMetas,
  lerMetas,
  mesesCompletos,
  metasParaGravar,
  painelDasMetas,
  participaDoSocial,
  problemasDasMetas,
  rotuloDaMeta,
  textoDoPagamento,
  type DadosDaEmpresa,
  type MetaSocial,
} from "@/lib/empresarial/riso-social";
import { camposDaEmpresa } from "@/lib/empresarial/proposta";

/** AS METAS DO RISO+ SOCIAL (1034, dono em 26/10/2026). */

const BASE: DadosDaEmpresa = {
  titularesAtivos: 45,
  inicio: "2025-01-15",
  hoje: "2026-10-27",
  meses: [],
};

describe("quem participa", () => {
  it("só quem paga tudo ou parte", () => {
    expect(participaDoSocial("COMPANY_PAYS")).toBe(true);
    expect(participaDoSocial("COMPANY_PARTIAL")).toBe(true);
    expect(participaDoSocial("EMPLOYEE_PAYS")).toBe(false);
    expect(participaDoSocial(null)).toBe(false);
  });
});

describe("meses completos", () => {
  it("o dia conta: de 15/01/2025 a 27/10/2026 são 21 meses", () => {
    expect(mesesCompletos("2025-01-15", "2026-10-27")).toBe(21);
    expect(mesesCompletos("2025-01-28", "2025-02-27")).toBe(0);
    expect(mesesCompletos("2025-01-15", "2025-01-10")).toBe(0);
  });
});

describe("as quatro metas", () => {
  it("titulares: 45 ativos, a cada 20 → 2 vezes × 1", () => {
    const [c] = conquistasDasMetas([{ tipo: "EMPLOYEE_COUNT", aCada: 20, indicacoes: 1 }], BASE);
    expect(c.conquistadas).toBe(2);
  });

  it("tempo: 21 meses, a cada 12 → 1 vez × 2", () => {
    const [c] = conquistasDasMetas([{ tipo: "TIME_IN_PROGRAM", aCada: 12, indicacoes: 2 }], BASE);
    expect(c.conquistadas).toBe(2);
  });

  it("gasto: R$ 125.000 fechados, a cada R$ 50.000 → 2", () => {
    const [c] = conquistasDasMetas([{ tipo: "TREATMENT_SPEND", aCada: 5_000_000, indicacoes: 1 }], {
      ...BASE,
      meses: [
        { mes: "2025-03-01", avaliacoes: 0, comparecimentos: 0, gastoCents: 10_000_000 },
        { mes: "2025-09-01", avaliacoes: 0, comparecimentos: 0, gastoCents: 2_500_000 },
      ],
    });
    expect(c.conquistadas).toBe(2);
  });

  it("comparecimento: só períodos FECHADOS, e só os que bateram o percentual", () => {
    // Início 15/01/2025, períodos de 6 meses: jan–jun/25, jul–dez/25, jan–jun/26
    // (fechados em 27/10/2026: 21 meses → 3 períodos).
    const [c] = conquistasDasMetas(
      [{ tipo: "ATTENDANCE", aCada: 6, indicacoes: 1, percentual: 80 }],
      {
        ...BASE,
        meses: [
          { mes: "2025-02-01", avaliacoes: 10, comparecimentos: 9, gastoCents: 0 }, // 90% ✓
          { mes: "2025-08-01", avaliacoes: 10, comparecimentos: 7, gastoCents: 0 }, // 70% ✗
          // jan–jun/26 sem avaliação nenhuma: não rende.
          { mes: "2026-08-01", avaliacoes: 5, comparecimentos: 5, gastoCents: 0 }, // período aberto
        ],
      }
    );
    expect(c.conquistadas).toBe(1);
    expect(c.explicacao).toContain("1 de 3");
  });

  it("o painel: liberadas não são recolhidas e o que falta nunca é negativo", () => {
    const conquistas = conquistasDasMetas(
      [{ tipo: "EMPLOYEE_COUNT", aCada: 20, indicacoes: 1 }],
      { ...BASE, titularesAtivos: 25 }
    );
    expect(painelDasMetas(conquistas, { EMPLOYEE_COUNT: 3 })[0]).toMatchObject({
      conquistadas: 1,
      liberadas: 3,
      aLiberar: 0,
    });
    expect(painelDasMetas(conquistas, {})[0].aLiberar).toBe(1);
  });
});

describe("as metas no banco e na tela", () => {
  const METAS: MetaSocial[] = [
    { tipo: "EMPLOYEE_COUNT", aCada: 20, indicacoes: 1, percentual: null },
    { tipo: "ATTENDANCE", aCada: 12, indicacoes: 1, percentual: 80 },
  ];

  it("grava e lê de volta igual", () => {
    expect(lerMetas(metasParaGravar(METAS))).toEqual(METAS);
  });

  it("descarta o que não serve na leitura", () => {
    expect(lerMetas([{ tipo: "OUTRA", a_cada: 1, indicacoes: 1 }, { tipo: "EMPLOYEE_COUNT", a_cada: 0, indicacoes: 1 }, null])).toEqual([]);
    expect(lerMetas("lixo")).toEqual([]);
  });

  it("recusa meta repetida e comparecimento sem percentual", () => {
    expect(
      problemasDasMetas([
        { tipo: "EMPLOYEE_COUNT", aCada: 20, indicacoes: 1 },
        { tipo: "EMPLOYEE_COUNT", aCada: 10, indicacoes: 1 },
        { tipo: "ATTENDANCE", aCada: 12, indicacoes: 1, percentual: 0 },
      ])
    ).toHaveLength(2);
    expect(problemasDasMetas(METAS)).toEqual([]);
  });

  it("a meta em uma frase", () => {
    expect(rotuloDaMeta(METAS[0])).toBe("1 indicação a cada 20 titulares ativos");
    expect(rotuloDaMeta({ tipo: "TREATMENT_SPEND", aCada: 5_000_000, indicacoes: 2 })).toMatch(
      /^2 indicações a cada R\$\s?50\.000,00 em tratamentos fechados$/
    );
  });
});

describe("o pagamento do tratamento em uma frase", () => {
  it("o combinado, ou o padrão quando a proposta não definiu", () => {
    expect(textoDoPagamento(["BOLETO", "CARD"], 12)).toBe("Boleto e cartão, com parcelamento em até 12x");
    expect(textoDoPagamento(null, null)).toBe("Boleto, Pix e cartão, com parcelamento em até 24x");
    expect(textoDoPagamento(["PIX"], 1)).toBe("Pix, à vista");
  });
});

describe("o fechamento leva o pagamento e o Riso+ Social (1034)", () => {
  const LEAD = { company_name: "Acme", cnpj: "12345678000190" };
  const campos = (q: Record<string, unknown> | null) =>
    camposDaEmpresa(q as Parameters<typeof camposDaEmpresa>[0], LEAD);

  it("o que a proposta combinou chega à empresa", () => {
    const c = campos({
      treatment_payment_methods: ["BOLETO"],
      treatment_max_installments: 12,
      social_participates: true,
      social_goals: [{ tipo: "EMPLOYEE_COUNT", a_cada: 20, indicacoes: 1 }],
    });
    expect(c.payment_methods).toEqual(["BOLETO"]);
    expect(c.default_max_installments).toBe(12);
    expect(c.social_participates).toBe(true);
    expect(c.social_goals).toEqual([{ tipo: "EMPLOYEE_COUNT", a_cada: 20, indicacoes: 1 }]);
  });

  it("sem definir, vale o padrão de sempre (os três meios, 24x, participa)", () => {
    const c = campos(null);
    expect(c.payment_methods).toEqual(["BOLETO", "PIX", "CARD"]);
    expect(c.default_max_installments).toBe(24);
    expect(c.social_participates).toBe(true);
    expect(c.social_goals).toEqual([]);
  });

  it("não participar leva as metas vazias", () => {
    const c = campos({
      social_participates: false,
      social_goals: [{ tipo: "EMPLOYEE_COUNT", a_cada: 20, indicacoes: 1 }],
    });
    expect(c.social_participates).toBe(false);
    expect(c.social_goals).toBeNull();
  });
});
