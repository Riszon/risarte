import { describe, expect, it } from "vitest";
import {
  conquistasDasMetas,
  dataSomada,
  lerMetas,
  mesesCompletos,
  metasDoFormulario,
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

/**
 * AS METAS DO RISO+ SOCIAL (1034; refeitas na 1035, dono em 27/10/2026):
 * uma meta = várias condições "pelo menos", todas ao mesmo tempo; rende uma
 * vez, ou de novo a cada período de N meses.
 */

const BASE: DadosDaEmpresa = {
  titularesAtivos: 45,
  dependentesAtivos: 12,
  mensalidadesVencidas: 0,
  inicio: "2025-01-15",
  hoje: "2026-10-27",
  meses: [],
};

/** O exemplo do dono: 1 indicação com pelo menos 20 titulares e 6 meses. */
const EXEMPLO: MetaSocial = {
  id: "m1",
  indicacoes: 1,
  renovaMeses: null,
  condicoes: [
    { tipo: "EMPLOYEE_COUNT", minimo: 20 },
    { tipo: "TIME_IN_PROGRAM", minimo: 6 },
  ],
};

describe("quem participa (pré-requisito: a empresa paga)", () => {
  it("só quem paga tudo ou parte", () => {
    expect(participaDoSocial("COMPANY_PAYS")).toBe(true);
    expect(participaDoSocial("COMPANY_PARTIAL")).toBe(true);
    expect(participaDoSocial("EMPLOYEE_PAYS")).toBe(false);
    expect(participaDoSocial(null)).toBe(false);
  });
});

describe("contas de calendário", () => {
  it("o dia conta: de 15/01/2025 a 27/10/2026 são 21 meses", () => {
    expect(mesesCompletos("2025-01-15", "2026-10-27")).toBe(21);
    expect(mesesCompletos("2025-01-28", "2025-02-27")).toBe(0);
    expect(mesesCompletos("2025-01-15", "2025-01-10")).toBe(0);
  });

  it("somar meses mantém o dia, e cai no último dia quando falta", () => {
    expect(dataSomada("2025-01-15", 12)).toBe("2026-01-15");
    expect(dataSomada("2025-01-31", 1)).toBe("2025-02-28");
    expect(dataSomada("2026-10-01", -12)).toBe("2025-10-01");
  });
});

describe("uma meta, várias condições", () => {
  it("o exemplo do dono: 45 titulares e 21 meses → cumpre, rende 1", () => {
    const [c] = conquistasDasMetas([EXEMPLO], BASE);
    expect(c.cumpre).toBe(true);
    expect(c.conquistadas).toBe(1);
    expect(c.condicoes.map((x) => x.cumpre)).toEqual([true, true]);
  });

  it("basta UMA condição falhar para não render", () => {
    const [c] = conquistasDasMetas([EXEMPLO], { ...BASE, titularesAtivos: 19 });
    expect(c.cumpre).toBe(false);
    expect(c.conquistadas).toBe(0);
    expect(c.condicoes[0].situacao).toBe("19 titulares ativos (mínimo 20)");
    expect(c.condicoes[1].cumpre).toBe(true);
  });

  it("dependentes ativos e mensalidades em dia", () => {
    const meta: MetaSocial = {
      ...EXEMPLO,
      condicoes: [
        { tipo: "DEPENDENT_COUNT", minimo: 10 },
        { tipo: "FEES_UP_TO_DATE", minimo: 0 },
      ],
    };
    expect(conquistasDasMetas([meta], BASE)[0].cumpre).toBe(true);
    const atrasada = conquistasDasMetas([meta], { ...BASE, mensalidadesVencidas: 2 })[0];
    expect(atrasada.cumpre).toBe(false);
    expect(atrasada.condicoes[1].situacao).toBe("2 mensalidades vencidas sem pagamento");
    expect(conquistasDasMetas([meta], { ...BASE, dependentesAtivos: 9 })[0].cumpre).toBe(false);
  });

  it("gasto: soma desde o início", () => {
    const meta: MetaSocial = {
      ...EXEMPLO,
      condicoes: [{ tipo: "TREATMENT_SPEND", minimo: 10_000_000 }],
    };
    const meses = [
      { mes: "2025-03-01", avaliacoes: 0, comparecimentos: 0, gastoCents: 8_000_000 },
      { mes: "2025-09-01", avaliacoes: 0, comparecimentos: 0, gastoCents: 2_500_000 },
    ];
    expect(conquistasDasMetas([meta], { ...BASE, meses })[0].cumpre).toBe(true);
    expect(conquistasDasMetas([meta], { ...BASE, meses: meses.slice(0, 1) })[0].cumpre).toBe(false);
  });

  it("comparecimento: só os últimos 12 meses FECHADOS, e sem avaliação não vale", () => {
    const meta: MetaSocial = { ...EXEMPLO, condicoes: [{ tipo: "ATTENDANCE", minimo: 80 }] };
    // Hoje 27/10/2026: a janela é out/2025 a set/2026.
    const meses = [
      { mes: "2025-09-01", avaliacoes: 10, comparecimentos: 0, gastoCents: 0 }, // fora (antes)
      { mes: "2025-10-01", avaliacoes: 10, comparecimentos: 9, gastoCents: 0 },
      { mes: "2026-09-01", avaliacoes: 10, comparecimentos: 7, gastoCents: 0 },
      { mes: "2026-10-01", avaliacoes: 10, comparecimentos: 0, gastoCents: 0 }, // mês aberto
    ];
    const [c] = conquistasDasMetas([meta], { ...BASE, meses });
    expect(c.cumpre).toBe(true); // 16 de 20 = 80%
    expect(c.condicoes[0].situacao).toContain("80% de comparecimento em 20 avaliações");
    const [vazio] = conquistasDasMetas([meta], BASE);
    expect(vazio.cumpre).toBe(false);
    expect(vazio.condicoes[0].situacao).toContain("sem avaliações");
  });
});

describe("uma vez ou renovando", () => {
  it("uma vez: liberada uma ficha, nada mais a liberar, para sempre", () => {
    const conquistas = conquistasDasMetas([EXEMPLO], BASE);
    expect(conquistas[0].periodo).toBe("uma vez só");
    const [p] = painelDasMetas(conquistas, [{ metaId: "m1", dia: "2025-08-01" }]);
    expect(p).toMatchObject({ conquistadas: 1, liberadas: 1, aLiberar: 0 });
  });

  it("renova a cada 12 meses: a ficha do período passado não conta neste", () => {
    const meta = { ...EXEMPLO, renovaMeses: 12 };
    const [c] = conquistasDasMetas([meta], BASE);
    // Início 15/01/2025, 21 meses → 2º período, de 15/01/2026 a 14/01/2027.
    expect(c.periodoDesde).toBe("2026-01-15");
    expect(c.periodo).toBe("2º período, de 15/01/2026 a 14/01/2027");
    const antiga = { metaId: "m1", dia: "2025-06-10" };
    expect(painelDasMetas([c], [antiga])[0].aLiberar).toBe(1);
    expect(painelDasMetas([c], [antiga, { metaId: "m1", dia: "2026-02-01" }])[0].aLiberar).toBe(0);
  });

  it("a ficha de outra meta, ou avulsa, não conta nesta", () => {
    const conquistas = conquistasDasMetas([EXEMPLO], BASE);
    const [p] = painelDasMetas(conquistas, [
      { metaId: "outra", dia: "2026-01-01" },
      { metaId: null, dia: "2026-01-01" },
    ]);
    expect(p.aLiberar).toBe(1);
  });

  it("liberada não é recolhida: o que falta nunca é negativo", () => {
    const conquistas = conquistasDasMetas([EXEMPLO], { ...BASE, titularesAtivos: 3 });
    const [p] = painelDasMetas(conquistas, [{ metaId: "m1", dia: "2025-08-01" }]);
    expect(p).toMatchObject({ conquistadas: 0, liberadas: 1, aLiberar: 0 });
  });
});

describe("as metas no banco e na tela", () => {
  const METAS: MetaSocial[] = [
    EXEMPLO,
    {
      id: "m2",
      indicacoes: 2,
      renovaMeses: 12,
      condicoes: [
        { tipo: "ATTENDANCE", minimo: 80 },
        { tipo: "FEES_UP_TO_DATE", minimo: 0 },
      ],
    },
  ];

  it("grava e lê de volta igual", () => {
    expect(lerMetas(metasParaGravar(METAS))).toEqual(METAS);
  });

  it("o formulário manda tudo num campo só", () => {
    const json = JSON.stringify(metasParaGravar(METAS));
    expect(metasDoFormulario((k) => (k === "metas_json" ? json : null))).toEqual(METAS);
    expect(metasDoFormulario(() => "não é json")).toEqual([]);
  });

  it("lê o formato da primeira versão da 1034 como 'pelo menos'", () => {
    expect(lerMetas([{ tipo: "EMPLOYEE_COUNT", a_cada: 20, indicacoes: 1 }])).toEqual([
      { id: "meta-1", indicacoes: 1, renovaMeses: null, condicoes: [{ tipo: "EMPLOYEE_COUNT", minimo: 20 }] },
    ]);
  });

  it("descarta o que não serve na leitura", () => {
    expect(
      lerMetas([
        { id: "a", indicacoes: 1, condicoes: [{ tipo: "OUTRA", minimo: 1 }] },
        { id: "b", indicacoes: 0, condicoes: [{ tipo: "EMPLOYEE_COUNT", minimo: 1 }] },
        null,
      ])
    ).toEqual([]);
    expect(lerMetas("lixo")).toEqual([]);
  });

  it("recusa meta sem condição, condição repetida, mínimo zero e comparecimento fora de 1–100", () => {
    const p = problemasDasMetas([
      { id: "a", indicacoes: 1, renovaMeses: null, condicoes: [] },
      {
        id: "b",
        indicacoes: 1,
        renovaMeses: null,
        condicoes: [
          { tipo: "EMPLOYEE_COUNT", minimo: 20 },
          { tipo: "EMPLOYEE_COUNT", minimo: 10 },
          { tipo: "TIME_IN_PROGRAM", minimo: 0 },
          { tipo: "ATTENDANCE", minimo: 120 },
        ],
      },
      { id: "c", indicacoes: 0, renovaMeses: 0, condicoes: [{ tipo: "FEES_UP_TO_DATE", minimo: 0 }] },
    ]);
    // a: sem condição · b: repetida, mínimo zero, comparecimento · c: sem indicação, renovação 0
    expect(p).toHaveLength(6);
    expect(problemasDasMetas(METAS)).toEqual([]);
  });

  it("a meta em uma frase", () => {
    expect(rotuloDaMeta(EXEMPLO)).toBe(
      "1 indicação uma vez, com pelo menos 20 titulares ativos e pelo menos 6 meses de programa"
    );
    expect(rotuloDaMeta(METAS[1])).toBe(
      "2 indicações a cada 12 meses de contrato em que as condições valerem, com comparecimento de pelo menos 80% às avaliações e reavaliações nos últimos 12 meses e mensalidades do programa em dia"
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
    // O formato antigo da proposta chega à empresa já no formato da 1035.
    expect(c.social_goals).toEqual([
      { id: "meta-1", indicacoes: 1, renova_meses: null, condicoes: [{ tipo: "EMPLOYEE_COUNT", minimo: 20 }] },
    ]);
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
