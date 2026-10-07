// Módulo Risarte Empresarial — cálculo de mensalidade e aplicação de benefício.
// Tudo em CENTAVOS inteiros. Regras: Adendo 01 + Seção 5 do briefing.
import type { BenefitType, DependentPlan } from "./constants";
import { precoDaFaixa, type FaixaDePreco } from "./condicoes-da-proposta";

export type AdhesionPricing = {
  holderFeeCents: number;
  dependentIndividualFeeCents: number;
  dependentFamilyFeeCents: number;
  dependentFamilyExtraFeeCents: number;
  maxInstallments: number;
  /**
   * Quantos dependentes o pacote familiar cobre (1018).
   *
   * Era 3 escrito dentro da função desde a 0097 — número de negócio dentro de
   * código, que é como ele fica errado para a primeira empresa que negociar
   * diferente. Ausente = 3, que preserva o que já acontecia.
   */
  dependentFamilySize?: number;
};

export type SplitRules = {
  firstPaymentRisartePct: number;
  firstPaymentRislifePct: number;
  recurringRisartePct: number;
  recurringRislifePct: number;
};

export const DEFAULT_ADHESION_PRICING: AdhesionPricing = {
  holderFeeCents: 3990,
  dependentIndividualFeeCents: 3990,
  dependentFamilyFeeCents: 5990,
  dependentFamilyExtraFeeCents: 1990,
  maxInstallments: 24,
};

export const DEFAULT_SPLIT_RULES: SplitRules = {
  firstPaymentRisartePct: 0,
  firstPaymentRislifePct: 100,
  recurringRisartePct: 50,
  recurringRislifePct: 50,
};

/** Custo mensal do plano de dependentes de UM titular. */
export function dependentPlanCostCents(
  pricing: AdhesionPricing,
  plan: DependentPlan,
  activeDependentCount: number
): number {
  switch (plan) {
    case "NONE":
      return 0;
    case "INDIVIDUAL":
      return pricing.dependentIndividualFeeCents;
    case "FAMILY":
      return pricing.dependentFamilyFeeCents;
    case "FAMILY_EXTRA": {
      const cobertos = Math.max(1, Math.floor(pricing.dependentFamilySize ?? 3));
      const extras = Math.max(0, activeDependentCount - cobertos);
      return (
        pricing.dependentFamilyFeeCents +
        extras * pricing.dependentFamilyExtraFeeCents
      );
    }
    default:
      return 0;
  }
}

export type MonthlyEmployee = {
  /** Só ACTIVE entra na conta; INACTIVE e DELETED (exclusão lógica) ficam fora. */
  status: "ACTIVE" | "INACTIVE" | "DELETED";
  dependentPlan: DependentPlan;
  activeDependentCount: number;
};

/**
 * Mensalidade da empresa (Seção 5.1): Σ (titular + custo do plano de dependentes)
 * de cada titular ATIVO. Devolve o total e o detalhamento.
 */
/**
 * QUANTO CUSTA CADA TITULAR HOJE, já com a faixa aplicada.
 *
 * ⚠️ EXISTE POR CAUSA DE UMA ARMADILHA REAL. A cobrança mensal chama a conta
 * UM TITULAR POR VEZ, para repartir o valor por CNPJ — e cada chamada veria
 * "1 titular ativo", escolhendo sempre a faixa de 1. Quem precisa somar em
 * partes calcula o preço UMA vez com o total, aqui, e passa o resultado como
 * `holderFeeCents` nas partes.
 */
export function precoDoTitularComFaixa(
  pricing: AdhesionPricing,
  faixas: readonly FaixaDePreco[],
  titularesAtivos: number
): number {
  return precoDaFaixa(faixas, titularesAtivos, pricing.holderFeeCents).precoCents;
}

/**
 * QUANTOS TITULARES A MENSALIDADE COBRA (OC-00090, dono em 07/10/2026).
 *
 * O CONTRATADO É O MÍNIMO. A empresa fechou 7 titulares e mandou os dados de
 * 2: a mensalidade cobra 7 — foi o que se combinou, e o cadastro que falta
 * depende dela, não de nós. Antes a conta olhava só os cadastrados: cobrava 2
 * de 7, e sem nenhum cadastrado recusava gerar.
 *
 * É a mesma base que a implantação usa desde 24/09 (OC-00055/57) e que o termo
 * de inclusão usa como "antes" (AP19). `minimo` é o LIMITE da empresa: o
 * contratado mais os termos de inclusão aceitos. Nulo = contrato sem
 * quantidade fechada — aí só os cadastrados contam, como sempre.
 *
 * `faltamCadastrar` viaja junto porque faz parte do número: cobrar por quem
 * não está na lista sem dizer isso faria a pessoa procurar o erro na conta.
 */
export function titularesDaMensalidade(
  ativos: number,
  minimo: number | null | undefined
): { cobrados: number; faltamCadastrar: number } {
  const a = Math.max(0, Math.floor(Number.isFinite(ativos) ? ativos : 0));
  const m =
    minimo != null && Number.isFinite(minimo) ? Math.max(0, Math.floor(minimo)) : 0;
  const cobrados = Math.max(a, m);
  return { cobrados, faltamCadastrar: cobrados - a };
}

/**
 * ⚠️ AS FAIXAS ENTRAM AQUI (1018), e não na hora do fechamento.
 *
 * A mensalidade é recalculada a cada apuração com a quantidade DAQUELE
 * momento — foi isso que a empresa comprou: "cresça e pague menos". Congelar
 * a faixa no fechamento faria a empresa chegar a 150 titulares pagando o
 * preço de 50, e ninguém entenderia por quê.
 *
 * Sem faixa nenhuma (o caso normal), vale o `holderFeeCents` do cadastro,
 * exatamente como sempre foi.
 */
export function computeMonthlyCents(
  pricing: AdhesionPricing,
  employees: MonthlyEmployee[],
  faixas: readonly FaixaDePreco[] = [],
  /**
   * O limite da empresa (contratado + termos aceitos) — ver
   * `titularesDaMensalidade`. Ausente/nulo = só os cadastrados contam.
   */
  minimoDeTitulares: number | null = null
): {
  totalCents: number;
  /** Titulares CADASTRADOS e ativos (não os cobrados). */
  holdersCount: number;
  holdersCents: number;
  dependentsCents: number;
  /** Quantos titulares a conta cobra: o maior entre cadastrados e contratado. */
  titularesCobrados: number;
  /** Cobrados que ainda não estão cadastrados (0 quando não falta ninguém). */
  faltamCadastrar: number;
  /** O preço de cada titular, já com a faixa da quantidade cobrada. */
  porTitularCents: number;
} {
  const ativos = employees.filter((e) => e.status === "ACTIVE");
  const { cobrados, faltamCadastrar } = titularesDaMensalidade(
    ativos.length,
    minimoDeTitulares
  );
  // A faixa é escolhida pela quantidade COBRADA — os cadastrados ou, se forem
  // menos, o contratado: é sobre ela que o preço foi combinado. Escolher pela
  // faixa de "2" quem contratou 100 cobraria o preço mais caro de quem fechou
  // volume.
  const { precoCents: porTitular } = precoDaFaixa(
    faixas,
    cobrados,
    pricing.holderFeeCents
  );

  // Dependentes: só os de quem já está cadastrado. Ninguém sabe o plano de
  // dependentes de um titular que ainda não tem nome.
  let dependentsCents = 0;
  for (const e of ativos) {
    dependentsCents += dependentPlanCostCents(
      pricing,
      e.dependentPlan,
      e.activeDependentCount
    );
  }
  const holdersCents = porTitular * cobrados;
  return {
    totalCents: holdersCents + dependentsCents,
    holdersCount: ativos.length,
    holdersCents,
    dependentsCents,
    titularesCobrados: cobrados,
    faltamCadastrar,
    porTitularCents: porTitular,
  };
}

export type ProcedureBenefit = {
  benefitType: BenefitType;
  benefitValue: number | null; // % (0-100) p/ PERCENT; centavos p/ AMOUNT
};

/**
 * Aplica o benefício a um preço cheio (centavos). Devolve quanto o cliente paga
 * e quanto economiza. NOT_COVERED = paga cheio; FREE = zero.
 */
export function applyBenefit(
  benefit: ProcedureBenefit | null,
  fullPriceCents: number
): { chargedCents: number; savedCents: number } {
  if (!benefit || benefit.benefitType === "NOT_COVERED") {
    return { chargedCents: fullPriceCents, savedCents: 0 };
  }
  if (benefit.benefitType === "FREE") {
    return { chargedCents: 0, savedCents: fullPriceCents };
  }
  if (benefit.benefitType === "DISCOUNT_PERCENT") {
    const pct = Math.min(100, Math.max(0, benefit.benefitValue ?? 0));
    const saved = Math.round((fullPriceCents * pct) / 100);
    return { chargedCents: fullPriceCents - saved, savedCents: saved };
  }
  // DISCOUNT_AMOUNT
  const saved = Math.min(fullPriceCents, Math.max(0, benefit.benefitValue ?? 0));
  return { chargedCents: fullPriceCents - saved, savedCents: saved };
}

/** Split de um valor conforme o tipo de cobrança (Seção 5.2). */
export function computeSplitCents(
  rules: SplitRules,
  amountCents: number,
  billingType: "IMPLANTATION" | "MONTHLY"
): { risarteCents: number; rislifeCents: number } {
  const risartePct =
    billingType === "IMPLANTATION"
      ? rules.firstPaymentRisartePct
      : rules.recurringRisartePct;
  const risarteCents = Math.round((amountCents * risartePct) / 100);
  return { risarteCents, rislifeCents: amountCents - risarteCents };
}
