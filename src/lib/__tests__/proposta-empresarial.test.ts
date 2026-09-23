import { describe, expect, it } from "vitest";
import {
  camposDaEmpresa,
  faltaParaContrato,
  faltaParaProposta,
  rotuloDaEconomia,
  simularProposta,
  type PropostaInput,
} from "@/lib/empresarial/proposta";

const BASE: PropostaInput = {
  basis: "PER_EMPLOYEE",
  employeeCount: 50,
  holderFeeCents: 3990,
  includeDependents: false,
  dependentsCount: 0,
  dependentFeeCents: 3990,
  fixedMonthlyCents: 0,
  implantationPerEmployeeCents: 0,
  paymentModel: "COMPANY_PAYS",
  subsidyType: null,
  subsidyValue: 0,
  currentPlanMonthlyCents: null,
};

describe("mensalidade por colaborador", () => {
  it("soma titular × quantidade", () => {
    const r = simularProposta(BASE);
    expect(r.titularesCents).toBe(50 * 3990);
    expect(r.mensalidadeCents).toBe(199_500);
    expect(r.porColaboradorCents).toBe(3990);
  });

  it("dependentes entram quando marcados", () => {
    const r = simularProposta({
      ...BASE,
      includeDependents: true,
      dependentsCount: 20,
      dependentFeeCents: 2990,
    });
    expect(r.dependentesCents).toBe(20 * 2990);
    expect(r.mensalidadeCents).toBe(50 * 3990 + 20 * 2990);
  });

  it("dependentes NÃO entram quando a fase ainda não os inclui", () => {
    const r = simularProposta({
      ...BASE,
      includeDependents: false,
      dependentsCount: 20,
    });
    expect(r.dependentesCents).toBe(0);
  });

  it("implantação é por colaborador", () => {
    const r = simularProposta({ ...BASE, implantationPerEmployeeCents: 1990 });
    expect(r.implantacaoCents).toBe(50 * 1990);
  });
});

describe("valor fixo por empresa (sindicato, associação)", () => {
  it("o fixo é o total, independente da quantidade", () => {
    const r = simularProposta({
      ...BASE,
      basis: "FIXED_PER_COMPANY",
      fixedMonthlyCents: 500_000,
    });
    expect(r.mensalidadeCents).toBe(500_000);
    expect(r.titularesCents).toBe(500_000);
  });

  it("no fixo, dependente NÃO é cobrado por fora", () => {
    // Cobrar por fora transformaria "valor fixo" em valor variável — que é
    // exatamente o que a regra alternativa existe para não ser.
    const r = simularProposta({
      ...BASE,
      basis: "FIXED_PER_COMPANY",
      fixedMonthlyCents: 500_000,
      includeDependents: true,
      dependentsCount: 30,
      dependentFeeCents: 2990,
    });
    expect(r.dependentesCents).toBe(0);
    expect(r.mensalidadeCents).toBe(500_000);
  });

  it("o fixo ainda mostra quanto sai por cabeça", () => {
    const r = simularProposta({
      ...BASE,
      basis: "FIXED_PER_COMPANY",
      fixedMonthlyCents: 500_000,
      employeeCount: 40,
    });
    expect(r.porColaboradorCents).toBe(12_500);
  });
});

describe("quem paga o quê", () => {
  it("empresa integral: colaborador não paga nada", () => {
    const r = simularProposta(BASE);
    expect(r.empresaPagaCents).toBe(199_500);
    expect(r.colaboradorPagaCents).toBe(0);
  });

  it("colaborador paga: empresa não paga nada", () => {
    const r = simularProposta({ ...BASE, paymentModel: "EMPLOYEE_PAYS" });
    expect(r.empresaPagaCents).toBe(0);
    expect(r.colaboradorPagaCents).toBe(199_500);
  });

  it("parcial em porcentagem", () => {
    const r = simularProposta({
      ...BASE,
      paymentModel: "COMPANY_PARTIAL",
      subsidyType: "PERCENT",
      subsidyValue: 60,
    });
    expect(r.empresaPagaCents).toBe(119_700);
    expect(r.colaboradorPagaCents).toBe(79_800);
  });

  it("parcial em reais é POR COLABORADOR", () => {
    // É como as empresas falam: "eu banco R$ 20 por funcionário".
    const r = simularProposta({
      ...BASE,
      paymentModel: "COMPANY_PARTIAL",
      subsidyType: "AMOUNT",
      subsidyValue: 2000,
    });
    expect(r.empresaPagaCents).toBe(50 * 2000);
    expect(r.colaboradorPagaCents).toBe(199_500 - 100_000);
  });

  it("AS DUAS PARTES SEMPRE SOMAM O TOTAL, mesmo com centavo quebrado", () => {
    // A parte do colaborador é o RESTO, nunca uma segunda conta — senão o
    // centavo do arredondamento sumiria entre as duas.
    for (const pct of [33, 50, 61, 77, 99]) {
      const r = simularProposta({
        ...BASE,
        employeeCount: 7,
        holderFeeCents: 3333,
        paymentModel: "COMPANY_PARTIAL",
        subsidyType: "PERCENT",
        subsidyValue: pct,
      });
      expect(r.empresaPagaCents + r.colaboradorPagaCents).toBe(r.mensalidadeCents);
    }
  });

  it("a empresa nunca banca mais que a conta inteira", () => {
    // Sem o teto, o colaborador apareceria com valor NEGATIVO a pagar.
    const r = simularProposta({
      ...BASE,
      paymentModel: "COMPANY_PARTIAL",
      subsidyType: "AMOUNT",
      subsidyValue: 99_999,
    });
    expect(r.empresaPagaCents).toBe(r.mensalidadeCents);
    expect(r.colaboradorPagaCents).toBe(0);
  });

  it("parcial sem tipo de subsídio não inventa valor", () => {
    const r = simularProposta({ ...BASE, paymentModel: "COMPANY_PARTIAL" });
    expect(r.empresaPagaCents).toBe(0);
  });
});

describe("comparação com o convênio atual", () => {
  it("mostra a economia quando se sabe o que a empresa paga", () => {
    const r = simularProposta({ ...BASE, currentPlanMonthlyCents: 250_000 });
    expect(r.economiaMensalCents).toBe(50_500);
    expect(r.economiaAnualCents).toBe(606_000);
    expect(rotuloDaEconomia(r)).toMatch(/Economia por mês/);
  });

  it("SEM saber o que paga hoje, a resposta é NULO, não zero", () => {
    // "Economia de R$ 0,00" é uma afirmação — e seria falsa.
    const r = simularProposta(BASE);
    expect(r.economiaMensalCents).toBeNull();
    expect(r.economiaAnualCents).toBeNull();
    expect(rotuloDaEconomia(r)).toMatch(/Não sabemos/);
  });

  it("ECONOMIA NEGATIVA APARECE", () => {
    // Esconder faria a proposta só provar o que ela quer provar.
    const r = simularProposta({ ...BASE, currentPlanMonthlyCents: 150_000 });
    expect(r.economiaMensalCents).toBe(-49_500);
    expect(rotuloDaEconomia(r)).toMatch(/Custa MAIS/);
  });

  it("empatar tem texto próprio", () => {
    const r = simularProposta({ ...BASE, currentPlanMonthlyCents: 199_500 });
    expect(rotuloDaEconomia(r)).toMatch(/mesmo que o convênio atual/);
  });
});

describe("entrada estragada não vira número estranho", () => {
  it("quantidade negativa conta como zero", () => {
    const r = simularProposta({ ...BASE, employeeCount: -10 });
    expect(r.mensalidadeCents).toBe(0);
  });

  it("sem colaborador, o valor por cabeça é NULO", () => {
    // Dividir por zero não tem resposta; mostrar "R$ 0,00 por colaborador"
    // seria inventar uma.
    const r = simularProposta({ ...BASE, employeeCount: 0 });
    expect(r.porColaboradorCents).toBeNull();
  });

  it("quantidade quebrada é arredondada para baixo — meia pessoa não existe", () => {
    const r = simularProposta({ ...BASE, employeeCount: 10.9 });
    expect(r.titularesCents).toBe(10 * 3990);
  });
});

describe("o que ainda falta perguntar", () => {
  const vazio = {
    employeeCount: null,
    paymentModel: null,
    billingBasis: null,
    legalName: null,
    responsibleName: null,
    responsibleCpf: null,
    responsibleEmail: null,
    cnpj: null,
  };

  it("lista o que falta, em vez de só dizer não", () => {
    expect(faltaParaProposta(vazio)).toEqual([
      "quantos colaboradores entram",
      "quem paga o programa",
      "como será cobrado",
    ]);
  });

  it("com tudo preenchido, a proposta não tem pendência", () => {
    expect(
      faltaParaProposta({
        ...vazio,
        employeeCount: 30,
        paymentModel: "COMPANY_PAYS",
        billingBasis: "PER_EMPLOYEE",
      })
    ).toEqual([]);
  });

  it("o contrato exige mais que a proposta", () => {
    const comProposta = {
      ...vazio,
      employeeCount: 30,
      paymentModel: "COMPANY_PAYS" as const,
      billingBasis: "PER_EMPLOYEE" as const,
    };
    expect(faltaParaContrato(comProposta)).toContain("razão social");
    expect(faltaParaContrato(comProposta)).toContain("CNPJ completo");
    expect(faltaParaContrato(comProposta)).toContain("quem assina pela empresa");
  });

  it("CNPJ pela metade não passa por completo", () => {
    const quase = {
      ...vazio,
      employeeCount: 30,
      paymentModel: "COMPANY_PAYS" as const,
      billingBasis: "PER_EMPLOYEE" as const,
      legalName: "Bom Sabor Alimentos LTDA",
      cnpj: "11222333",
      responsibleName: "Marta",
      responsibleCpf: "12345678901",
      responsibleEmail: "marta@bomsabor.com",
    };
    expect(faltaParaContrato(quase)).toEqual(["CNPJ completo"]);
  });

  it("CNPJ com máscara conta como completo", () => {
    expect(
      faltaParaContrato({
        employeeCount: 30,
        paymentModel: "COMPANY_PAYS",
        billingBasis: "PER_EMPLOYEE",
        legalName: "Bom Sabor Alimentos LTDA",
        cnpj: "11.222.333/0001-81",
        responsibleName: "Marta",
        responsibleCpf: "123.456.789-01",
        responsibleEmail: "marta@bomsabor.com",
      })
    ).toEqual([]);
  });
});

describe("o levantamento vira o cadastro da empresa", () => {
  const cheio = {
    legal_name: "Metalúrgica Aurora Indústria LTDA",
    category: "empresa_privada",
    billing_model: "por_cnpj",
    payment_model: "COMPANY_PARTIAL" as const,
    subsidy_type: "PERCENT" as const,
    subsidy_value: 60,
    employee_count: 50,
    responsible_name: "Marta da Silva",
    responsible_role: "Diretora de RH",
    responsible_cpf: "12345678901",
    responsible_email: "marta@aurora.com.br",
    responsible_phone: "(43) 99999-0000",
    notes: "Dependentes só no segundo mês.",
  };
  const lead = { company_name: "Aurora", cnpj: "55666777000188" };

  it("carrega tudo o que o consultor já levantou", () => {
    // Sem isto, ele digitaria de novo — e é na segunda digitação que os dados
    // divergem entre a proposta e o cadastro.
    const c = camposDaEmpresa(cheio, lead);
    expect(c.legal_name).toBe("Metalúrgica Aurora Indústria LTDA");
    expect(c.payment_model).toBe("COMPANY_PARTIAL");
    expect(c.company_subsidy_type).toBe("PERCENT");
    expect(c.company_subsidy_value).toBe(60);
    expect(c.employee_count).toBe(50);
    expect(c.billing_model).toBe("por_cnpj");
    expect(c.responsible_cpf).toBe("12345678901");
    expect(c.responsible_email).toBe("marta@aurora.com.br");
    expect(c.notes).toBe("Dependentes só no segundo mês.");
  });

  it("A CARÊNCIA NEGOCIADA VIAJA para o cadastro da empresa (1014)", () => {
    // Antes ela só nascia no cadastro, com o padrão 0: o que tinha sido
    // combinado na proposta era redigitado depois, e podia sair diferente do
    // que foi VENDIDO — cliente cobrando um prazo e o sistema aplicando outro.
    const c = camposDaEmpresa(
      { ...cheio, company_grace_days: 30, employee_grace_days: 15 },
      lead
    );
    expect(c.grace_period_days).toBe(30);
    expect(c.employee_grace_period_days).toBe(15);
  });

  it("carência NÃO negociada não inventa prazo — cai no padrão de sempre", () => {
    // Nulo significa "não foi combinado nada", e aí vale o que a coluna já
    // fazia: zero. Inventar 30 dias aqui criaria carência que ninguém vendeu.
    const c = camposDaEmpresa(cheio, lead);
    expect(c.grace_period_days).toBe(0);
    expect(c.employee_grace_period_days).toBe(0);
  });

  it("carência ZERO é uma decisão, e não se confunde com ausência", () => {
    const c = camposDaEmpresa({ ...cheio, company_grace_days: 0 }, lead);
    expect(c.grace_period_days).toBe(0);
  });

  it("FICHA EM BRANCO NÃO IMPEDE O FECHAMENTO", () => {
    // Quem acertou tudo por fora fecha do mesmo jeito: o levantamento é ajuda,
    // não pedágio. Os padrões antigos continuam valendo.
    const c = camposDaEmpresa(null, lead);
    expect(c.legal_name).toBe("Aurora");
    expect(c.payment_model).toBe("EMPLOYEE_PAYS");
    expect(c.category).toBe("empresa_privada");
    expect(c.billing_model).toBe("unico");
    expect(c.company_subsidy_value).toBeNull();
  });

  it("razão social vazia cai para o nome do lead, não para vazio", () => {
    const c = camposDaEmpresa({ ...cheio, legal_name: "   " }, lead);
    expect(c.legal_name).toBe("Aurora");
  });

  it("o nome fantasia continua sendo o do lead", () => {
    // É por ele que a equipe conhece a empresa; trocar pela razão social faria
    // a lista ficar irreconhecível de um dia para o outro.
    expect(camposDaEmpresa(cheio, lead).trade_name).toBe("Aurora");
  });

  it("o CNPJ vem do lead, nunca do levantamento", () => {
    // O CNPJ é a chave única da empresa e já foi validado antes de fechar.
    expect(camposDaEmpresa(cheio, lead).cnpj).toBe("55666777000188");
  });
});
