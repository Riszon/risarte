import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { montarRegras, type DadosDasRegras } from "@/lib/empresarial/regras-combinadas";

// Pedido do dono (18/11/2026): "quando criada a empresa deve ter como
// visualizar todas as regras combinadas, faixa de pagamento etc." — e a
// importada parecia "configurada para não pagar implantação" porque a ficha
// não mostrava regra nenhuma de implantação.

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const rede = {
  holder_fee_cents: 3500,
  dependent_individual_fee_cents: 3990,
  dependent_family_fee_cents: 5990,
  dependent_family_extra_fee_cents: 1990,
  dependent_family_size: 3,
  dependent_mode: "FAMILY_PACKAGE",
  max_installments: 24,
};

function dados(extra: Partial<DadosDasRegras> = {}, empresa: Partial<DadosDasRegras["empresa"]> = {}): DadosDasRegras {
  return {
    empresa: {
      payment_model: "COMPANY_PAYS",
      company_subsidy_type: null,
      company_subsidy_value: null,
      due_day: 10,
      billing_model: "unico",
      payment_methods: ["BOLETO", "PIX"],
      default_max_installments: 12,
      contract_started_at: "2026-03-01",
      grace_period_days: 30,
      employee_grace_period_days: 0,
      special_agreements: null,
      min_adhesions: null,
      max_adhesions: null,
      adhesion_limit_target: null,
      origin_lead_id: null,
      contracted_holders: 40,
      contracted_dependents: null,
      excess_mode: null,
      excess_fixed_cents: null,
      excess_holder_fee_cents: null,
      excess_dependent_fee_cents: null,
      billing_basis: "PER_EMPLOYEE",
      fixed_monthly_cents: null,
      implantation_includes_dependents: false,
      implantation_dependents_cents: null,
      social_participates: true,
      ...empresa,
    },
    precoDaEmpresa: null,
    precoDaRede: rede,
    faixas: [],
    termosAceitos: [],
    limiteDeTitulares: 40,
    implantacoes: [],
    beneficiosProprios: 0,
    beneficiosDaRede: 12,
    vantagens: [],
    unidadePrincipal: "Londrina",
    unidades: [],
    divisaoDaEmpresa: null,
    divisaoDaRede: null,
    proposta: null,
    ...extra,
  };
}

const bloco = (d: DadosDasRegras, chave: string) => montarRegras(d).find((b) => b.chave === chave)!;
// formatBRL usa o espaço que não quebra depois do "R$"; aqui vira espaço comum.
const linha = (d: DadosDasRegras, chave: string, rotulo: string) => {
  const l = bloco(d, chave).linhas.find((x) => x.rotulo === rotulo);
  return l && { ...l, valor: l.valor.replace(/ /g, " ") };
};

describe("as regras combinadas", () => {
  it("mostra os oito blocos, na ordem da tela", () => {
    expect(montarRegras(dados()).map((b) => b.chave)).toEqual([
      "origem",
      "preco",
      "quantidade",
      "implantacao",
      "cobranca",
      "carencias",
      "beneficios",
      "unidades",
    ]);
  });

  it("empresa importada sem implantação: diz a regra e avisa antes do botão cobrar inteira", () => {
    const d = dados();
    expect(linha(d, "implantacao", "Regra")?.valor).toContain("Um mês dos titulares");
    expect(linha(d, "implantacao", "Situação")?.valor).toBe("Nenhuma implantação gerada no sistema");
    expect(bloco(d, "implantacao").aviso).toContain("já pagou fora do sistema");
    // A que veio do funil não recebe o aviso da importação.
    expect(bloco(dados({ proposta: { contratoAssinadoEm: null, prazoMinimoMeses: null, multaDeSaidaCents: null } }, { origin_lead_id: "x" }), "implantacao").aviso).toBeUndefined();
  });

  it("implantação já gerada: quantas, quanto e quantos titulares cobertos", () => {
    const d = dados({
      implantacoes: [
        { status: "PAID", total_amount_cents: 140000, holders_covered: 40 },
        { status: "PENDING", total_amount_cents: 35000, holders_covered: 10 },
      ],
    });
    expect(linha(d, "implantacao", "Situação")?.valor).toBe("2 implantações (R$ 1.750,00): 1 paga(s), 1 em aberto");
    expect(linha(d, "implantacao", "Titulares já cobertos")?.valor).toBe("50");
    expect(bloco(d, "implantacao").aviso).toBeUndefined();
  });

  it("sem preço próprio, marca o padrão da rede; com preço próprio, não", () => {
    expect(linha(dados(), "preco", "Preço por titular")).toMatchObject({ valor: "R$ 35,00", padraoDaRede: true });
    const proprio = dados({ precoDaEmpresa: { ...rede, holder_fee_cents: 2990 } });
    expect(linha(proprio, "preco", "Preço por titular")).toMatchObject({ valor: "R$ 29,90", padraoDaRede: false });
  });

  it("as faixas aparecem em ordem; o valor fixo não mostra faixa nem preço por titular", () => {
    const d = dados({
      faixas: [
        { min_quantity: 100, price_cents: 2500 },
        { min_quantity: 50, price_cents: 3000 },
      ],
    });
    expect(linha(d, "preco", "Faixas por quantidade")?.valor).toBe("a partir de 50: R$ 30,00 · a partir de 100: R$ 25,00");
    const fixo = dados({}, { billing_basis: "FIXED_PER_COMPANY", fixed_monthly_cents: 500000 });
    expect(linha(fixo, "preco", "Valor fixo mensal")?.valor).toBe("R$ 5.000,00");
    expect(linha(fixo, "preco", "Preço por titular")).toBeUndefined();
    expect(linha(fixo, "preco", "Faixas por quantidade")).toBeUndefined();
  });

  it("dependentes: o pacote familiar com o tamanho combinado, ou por dependente", () => {
    expect(linha(dados(), "preco", "Dependentes")?.valor).toBe(
      "Plano familiar: 1 dependente R$ 39,90; pacote de até 3 R$ 59,90; cada extra R$ 19,90"
    );
    const por = dados({ precoDaEmpresa: { ...rede, dependent_mode: "PER_DEPENDENT" } });
    expect(linha(por, "preco", "Dependentes")?.valor).toBe("Por dependente: R$ 39,90 cada");
  });

  it("quantidade: contratado, termos aceitos e limites de adesão", () => {
    const d = dados(
      { termosAceitos: [{ holders: 5, dependents: 2 }, { holders: 1, dependents: 0 }], limiteDeTitulares: 46 },
      { max_adhesions: 60, adhesion_limit_target: "BOTH" }
    );
    expect(linha(d, "quantidade", "Termos de inclusão aceitos")?.valor).toBe("2 (+6 titulares, +2 dependentes)");
    expect(linha(d, "quantidade", "Limite de titulares hoje")?.valor).toBe("46");
    expect(linha(d, "quantidade", "Limites de adesão")?.valor).toBe("máximo 60 (titulares e dependentes)");
  });

  it("fidelidade e multa vêm da proposta; sem proposta, 'não combinado'", () => {
    expect(linha(dados(), "origem", "Prazo mínimo (fidelidade)")?.valor).toBe("Não combinado");
    const funil = dados(
      { proposta: { contratoAssinadoEm: "2026-10-05T12:00:00Z", prazoMinimoMeses: 12, multaDeSaidaCents: 100000 } },
      { origin_lead_id: "lead" }
    );
    expect(linha(funil, "origem", "Contrato de adesão")?.valor).toBe("Assinado em 05/10/2026");
    expect(linha(funil, "origem", "Prazo mínimo (fidelidade)")?.valor).toBe("12 meses");
    expect(linha(funil, "origem", "Multa de saída antecipada")?.valor).toBe("R$ 1.000,00");
  });

  it("cobrança e carências em português", () => {
    const d = dados({}, { payment_model: "COMPANY_PARTIAL", company_subsidy_type: "PERCENT", company_subsidy_value: 50 });
    expect(linha(d, "cobranca", "Quem paga")?.valor).toBe("Empresa paga parcial (a empresa paga 50%)");
    expect(linha(d, "cobranca", "Tratamento: formas de pagamento")?.valor).toBe("Boleto, Pix");
    expect(linha(d, "carencias", "Do colaborador (a partir da entrada)")?.valor).toBe("Sem carência");
    expect(linha(d, "carencias", "Da empresa (a partir do início do contrato)")?.valor).toBe("30 dias");
  });

  it("a aba existe na ficha da empresa e lê o banco sem fingir regra quando a leitura falha", () => {
    const pagina = ler("src/app/(app)/empresarial/[companyId]/page.tsx");
    expect(pagina).toContain(`{ key: "regras", label: "Regras combinadas" }`);
    expect(pagina).toContain(`{aba === "regras" && <RegrasCombinadas companyId={companyId} />}`);
    const tela = ler("src/app/(app)/empresarial/[companyId]/regras-combinadas.tsx");
    expect(tela).toContain("Não foi possível ler as regras combinadas");
  });
});
