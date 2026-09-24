// Risarte Empresarial — a conta da proposta comercial de um lead.
//
// Puro e testado: nenhuma regra de dinheiro dentro de componente de tela
// (invariante do módulo Financeiro, que vale aqui igual). Tudo em CENTAVOS.
//
// A diferença para `pricing.ts`: lá a mensalidade é somada sobre titulares
// que EXISTEM; aqui ainda não existe ninguém — são estimativas do consultor
// para montar a oferta. As duas contas nunca se misturam por isso.

import type { PaymentModel } from "./constants";
import {
  custoDaImplantacao,
  precoDaFaixa,
  type FaixaDePreco,
} from "./condicoes-da-proposta";

export const BILLING_BASES = ["PER_EMPLOYEE", "FIXED_PER_COMPANY"] as const;
export type BillingBasis = (typeof BILLING_BASES)[number];
export const BILLING_BASIS_LABELS: Record<BillingBasis, string> = {
  PER_EMPLOYEE: "Por titular (padrão)",
  FIXED_PER_COMPANY: "Valor fixo por empresa",
};

export const INTEREST_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type InterestLevel = (typeof INTEREST_LEVELS)[number];
export const INTEREST_LEVEL_LABELS: Record<InterestLevel, string> = {
  LOW: "Baixo",
  MEDIUM: "Médio",
  HIGH: "Alto",
};

export type SubsidyType = "PERCENT" | "AMOUNT";

export type PropostaInput = {
  basis: BillingBasis;
  employeeCount: number;
  holderFeeCents: number;
  /**
   * Dependentes entram no programa nesta fase, e quantos se estima.
   *
   * ⚠️ NÃO ENTRAM NA CONTA da proposta (decisão do dono, 24/09/2026) — servem
   * para a tela dizer que haverá dependentes e para a régua dos limites de
   * adesão. O VALOR deles só existe depois da implantação.
   */
  includeDependents: boolean;
  dependentsCount: number;
  /** Valor do dependente individual — vai na TABELA, não na conta. */
  dependentFeeCents: number;
  /** Só vale quando a base é valor fixo por empresa. */
  fixedMonthlyCents: number;
  implantationPerEmployeeCents: number;
  paymentModel: PaymentModel;
  subsidyType: SubsidyType | null;
  /** % na base 100, ou centavos POR COLABORADOR, conforme o tipo. */
  subsidyValue: number;
  /** O que a empresa paga hoje de convênio, no total. `null` = não se sabe. */
  currentPlanMonthlyCents: number | null;

  // ---- H3 (1017): tudo OPCIONAL, e por um motivo ----------------------------
  // Ausente = esta negociação não combinou nada disso, e a conta é exatamente
  // a que já era. Proposta antiga não muda de preço por causa de campo novo.
  /** Faixas de preço por quantidade. Vazio = sem regra de quantidade. */
  faixas?: readonly FaixaDePreco[];
  /** `FIXED` = um valor pela empresa; ausente/`PER_ADHESION` = por titular. */
  implantationMode?: "PER_ADHESION" | "FIXED" | null;
  implantationFixedCents?: number;
};

export type PropostaResult = {
  mensalidadeCents: number;
  titularesCents: number;
  dependentesCents: number;
  /** `null` quando não há titular: dividir por zero não tem resposta. */
  porColaboradorCents: number | null;
  implantacaoCents: number;
  empresaPagaCents: number;
  colaboradorPagaCents: number;
  /**
   * `null` quando não se sabe o que a empresa paga hoje.
   *
   * ⚠️ NUNCA zero nesse caso: "economia de R$ 0,00" é uma afirmação, e a
   * afirmação seria falsa. E economia NEGATIVA aparece — esconder faria a
   * proposta só provar o que ela quer provar.
   */
  economiaMensalCents: number | null;
  economiaAnualCents: number | null;

  // ---- H3 ------------------------------------------------------------------
  /** A faixa que valeu, quando alguma valeu — a tela mostra qual. */
  faixaAplicada: FaixaDePreco | null;
};

const naoNegativo = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function simularProposta(input: PropostaInput): PropostaResult {
  const titulares = Math.floor(naoNegativo(input.employeeCount));

  // ⚠️ A FAIXA ENTRA AQUI, antes de tudo. Ela troca o PREÇO UNITÁRIO (por
  // titular) ou o VALOR FIXO da empresa, conforme a base — e a faixa do total
  // vale para todos, que é a decisão do dono.
  const faixas = input.faixas ?? [];
  const porTitular = input.basis === "PER_EMPLOYEE";
  const { precoCents: precoUnitario, faixa: faixaAplicada } = precoDaFaixa(
    faixas,
    // Na cobrança fixa a faixa é escolhida pelo tamanho da empresa, que é o
    // número de titulares — cobrar "por empresa" não faz a quantidade sumir.
    titulares,
    porTitular ? naoNegativo(input.holderFeeCents) : naoNegativo(input.fixedMonthlyCents)
  );

  const titularesCents = porTitular
    ? titulares * naoNegativo(precoUnitario)
    : naoNegativo(precoUnitario);

  // ⚠️ A PROPOSTA NÃO CALCULA O VALOR DOS DEPENDENTES (decisão do dono,
  // 24/09/2026, corrigindo o que eu tinha feito em H3).
  //
  // Na hora de contratar ninguém sabe quantos dependentes vão entrar, nem como
  // eles se distribuem entre os titulares — e o pacote familiar é POR TITULAR.
  // Eu tinha resolvido isso com uma estimativa declarada; ele cortou pela
  // raiz, e está certo: número estimado num documento de venda vira
  // expectativa, e a primeira fatura (calculada família a família) não bate.
  //
  // O que a proposta mostra é a TABELA DE VALORES do dependente. O total sai
  // depois da implantação, quando os cadastros existem — e é só então que a
  // cobrança dos dependentes é gerada.
  const dependentesCents = 0;

  const mensalidadeCents = titularesCents + dependentesCents;

  const implantacaoCents = custoDaImplantacao(
    input.implantationMode ?? null,
    naoNegativo(input.implantationPerEmployeeCents),
    naoNegativo(input.implantationFixedCents ?? 0),
    titulares
  );

  // Quem paga o quê. As duas partes SEMPRE somam a mensalidade: a do
  // titular é o resto, nunca uma segunda conta — senão um centavo de
  // arredondamento sumiria entre as duas.
  let empresaPagaCents = 0;
  if (input.paymentModel === "COMPANY_PAYS") {
    empresaPagaCents = mensalidadeCents;
  } else if (input.paymentModel === "COMPANY_PARTIAL") {
    if (input.subsidyType === "PERCENT") {
      empresaPagaCents = Math.round(
        (mensalidadeCents * naoNegativo(input.subsidyValue)) / 100
      );
    } else if (input.subsidyType === "AMOUNT") {
      empresaPagaCents = naoNegativo(input.subsidyValue) * titulares;
    }
    // A parte da empresa nunca passa do total: bancar mais do que a conta
    // inteira faria o titular aparecer com valor negativo a pagar.
    empresaPagaCents = Math.min(empresaPagaCents, mensalidadeCents);
  }
  const colaboradorPagaCents = mensalidadeCents - empresaPagaCents;

  const hoje = input.currentPlanMonthlyCents;
  const economiaMensalCents =
    hoje == null || !Number.isFinite(hoje) ? null : hoje - mensalidadeCents;

  return {
    mensalidadeCents,
    titularesCents,
    dependentesCents,
    porColaboradorCents:
      titulares > 0 ? Math.round(mensalidadeCents / titulares) : null,
    implantacaoCents,
    empresaPagaCents,
    colaboradorPagaCents,
    economiaMensalCents,
    economiaAnualCents:
      economiaMensalCents == null ? null : economiaMensalCents * 12,
    faixaAplicada,
  };
}

/**
 * O texto que explica a comparação — ou diz que ela não existe.
 *
 * Régua vazia grita: sem saber o que a empresa paga hoje, a resposta é "não
 * sabemos", não "economiza R$ 0,00".
 */
export function rotuloDaEconomia(r: PropostaResult): string {
  if (r.economiaMensalCents == null) {
    return "Não sabemos o que a empresa paga hoje — pergunte no levantamento.";
  }
  if (r.economiaMensalCents === 0) return "Custa o mesmo que o convênio atual.";
  return r.economiaMensalCents > 0
    ? "Economia por mês em relação ao convênio atual."
    : "Custa MAIS que o convênio atual — o argumento aqui é a cobertura, não o preço.";
}

/**
 * O que ainda falta para gerar proposta e contrato.
 *
 * Lista o que falta em vez de só bloquear: o consultor precisa saber o que
 * perguntar na próxima conversa, não descobrir no clique que não dá.
 */
export type DadosDaProposta = {
  employeeCount: number | null;
  paymentModel: PaymentModel | null;
  billingBasis: BillingBasis | null;
  legalName: string | null;
  responsibleName: string | null;
  responsibleCpf: string | null;
  responsibleEmail: string | null;
  cnpj: string | null;
};

export function faltaParaProposta(d: DadosDaProposta): string[] {
  const falta: string[] = [];
  if (!d.employeeCount || d.employeeCount <= 0)
    falta.push("quantos titulares entram");
  if (!d.paymentModel) falta.push("quem paga o programa");
  if (!d.billingBasis) falta.push("como será cobrado");
  return falta;
}

// -----------------------------------------------------------------------------
// O levantamento vira cadastro da empresa
// -----------------------------------------------------------------------------

export type QualificacaoDoLead = {
  legal_name: string | null;
  category: string | null;
  billing_model: string | null;
  payment_model: PaymentModel | null;
  subsidy_type: SubsidyType | null;
  subsidy_value: number | null;
  employee_count: number | null;
  responsible_name: string | null;
  responsible_role: string | null;
  responsible_cpf: string | null;
  responsible_email: string | null;
  responsible_phone: string | null;
  notes: string | null;
  /** Carência negociada na proposta (1014). Nulo = não foi combinada. */
  company_grace_days?: number | null;
  employee_grace_days?: number | null;
  // ---- H3/H4 (1017, 1018): o que o fechamento leva para o cadastro ---------
  // Todos opcionais: nulo é "esta negociação não combinou isso", e aí vale o
  // padrão de sempre.
  min_adhesions?: number | null;
  max_adhesions?: number | null;
  adhesion_limit_target?: "HOLDERS" | "DEPENDENTS" | "BOTH" | null;
  holder_fee_cents?: number | null;
  dependent_fee_cents?: number | null;
  dependent_family_fee_cents?: number | null;
  dependent_family_extra_fee_cents?: number | null;
  dependent_family_size?: number | null;
};

/**
 * Os campos da empresa nova, a partir do levantamento do lead.
 *
 * Existe como função pura por um motivo prático: é a regra que evita o
 * consultor digitar tudo duas vezes, e é na segunda digitação que os dados
 * divergem. Testá-la exige poder chamá-la — dentro da server action ela só
 * seria exercitada por um clique.
 *
 * ⚠️ FICHA EM BRANCO NÃO IMPEDE O FECHAMENTO. Quem acertou tudo por fora
 * fecha do mesmo jeito, com os padrões antigos; o levantamento é ajuda, não
 * pedágio.
 */
export function camposDaEmpresa(
  qual: QualificacaoDoLead | null,
  lead: { company_name: string; cnpj: string }
) {
  return {
    cnpj: lead.cnpj,
    legal_name: qual?.legal_name?.trim() || lead.company_name,
    trade_name: lead.company_name,
    payment_model: qual?.payment_model ?? "EMPLOYEE_PAYS",
    company_subsidy_type: qual?.subsidy_type ?? null,
    company_subsidy_value: qual?.subsidy_value ?? null,
    employee_count: qual?.employee_count ?? null,
    category: qual?.category ?? "empresa_privada",
    billing_model: qual?.billing_model ?? "unico",
    responsible_name: qual?.responsible_name ?? null,
    responsible_role: qual?.responsible_role ?? null,
    responsible_cpf: qual?.responsible_cpf ?? null,
    responsible_email: qual?.responsible_email ?? null,
    responsible_phone: qual?.responsible_phone ?? null,
    notes: qual?.notes ?? null,
    // ⚠️ A CARÊNCIA NEGOCIADA VIAJA JUNTO (1014). Antes ela só nascia no
    // cadastro da empresa, com o padrão 0 — então o que tinha sido combinado
    // na proposta precisava ser redigitado depois, e podia sair diferente do
    // que foi VENDIDO. Nulo aqui significa "não foi negociado"; aí vale o
    // padrão da coluna, que é o mesmo de sempre.
    grace_period_days: qual?.company_grace_days ?? 0,
    employee_grace_period_days: qual?.employee_grace_days ?? 0,
  };
}

export function faltaParaContrato(d: DadosDaProposta): string[] {
  const falta = faltaParaProposta(d);
  if (!d.legalName?.trim()) falta.push("razão social");
  if ((d.cnpj ?? "").replace(/\D/g, "").length !== 14) falta.push("CNPJ completo");
  if (!d.responsibleName?.trim()) falta.push("quem assina pela empresa");
  if ((d.responsibleCpf ?? "").replace(/\D/g, "").length !== 11)
    falta.push("CPF de quem assina");
  if (!d.responsibleEmail?.trim()) falta.push("e-mail de quem assina");
  return falta;
}
