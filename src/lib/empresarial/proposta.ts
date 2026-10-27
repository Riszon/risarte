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
  precoDaFaixa,
  type FaixaDePreco,
} from "./condicoes-da-proposta";
import { fixoDoFechamento } from "./mensalidade";
import { estimativaDaProposta } from "./dependentes-da-proposta";
import { lerMetas, metasParaGravar } from "./riso-social";

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
   * Servem para a tela dizer que haverá dependentes e para a régua dos
   * limites de adesão. O VALOR deles entra pela `dependentesEstimadosCents`
   * (1032) — só quando a proposta escolhe calcular.
   */
  includeDependents: boolean;
  dependentsCount: number;
  /** Valor do dependente individual — vai na TABELA do documento. */
  dependentFeeCents: number;
  /** Só vale quando a base é valor fixo por empresa. */
  fixedMonthlyCents: number;
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

  // ---- 1032: os dependentes ENTRAM na conta quando a proposta escolhe -------
  /**
   * O que os dependentes somam por mês (`estimativaDosDependentes`). Ausente
   * ou nulo = a proposta escolheu não calcular, e a conta é só dos titulares,
   * como era desde 24/09.
   */
  dependentesEstimadosCents?: number | null;
  /** A implantação (1º pagamento) cobra também os dependentes. */
  implantacaoComDependentes?: boolean;
};

export type PropostaResult = {
  mensalidadeCents: number;
  titularesCents: number;
  dependentesCents: number;
  /** `null` quando não há titular: dividir por zero não tem resposta. */
  porColaboradorCents: number | null;
  /** O 1º pagamento — é a mesma conta da mensalidade (AP18). */
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

  // ⚠️ OS DEPENDENTES ENTRAM QUANDO A PROPOSTA ESCOLHE (dono, 26/10/2026 —
  // 1032), revendo a decisão de 24/09.
  //
  // Em 24/09 a proposta deixou de somar dependente porque a estimativa era
  // "dividir por igual entre os titulares", e a primeira fatura não batia.
  // Agora quem monta informa o QUADRO (quantos titulares com quantos
  // dependentes), e o preço de cada família sai da mesma régua do boleto.
  // Sem o quadro, a proposta pode calcular como individual ou não calcular —
  // e "não calcular" é o que vale quando ninguém escolheu nada.
  const dependentesCents = naoNegativo(input.dependentesEstimadosCents ?? 0);

  const mensalidadeCents = titularesCents + dependentesCents;

  // ⚠️ A IMPLANTAÇÃO É O 1º PAGAMENTO (dono, 27/09/2026 — AP18). Desde a
  // 1032 ela tem opção: só os titulares (o padrão) ou titulares e
  // dependentes — e a cobrança da implantação segue a mesma opção.
  const implantacaoCents =
    titularesCents + (input.implantacaoComDependentes ? dependentesCents : 0);

  // Quem paga o quê. As duas partes SEMPRE somam a mensalidade: a do
  // titular é o resto, nunca uma segunda conta — senão um centavo de
  // arredondamento sumiria entre as duas.
  //
  // ⚠️ A PARTE DA EMPRESA VALE SÓ SOBRE OS TITULARES (dono, 26/10/2026): os
  // dependentes ficam por conta do titular.
  let empresaPagaCents = 0;
  if (input.paymentModel === "COMPANY_PAYS") {
    empresaPagaCents = titularesCents;
  } else if (input.paymentModel === "COMPANY_PARTIAL") {
    if (input.subsidyType === "PERCENT") {
      empresaPagaCents = Math.round(
        (titularesCents * naoNegativo(input.subsidyValue)) / 100
      );
    } else if (input.subsidyType === "AMOUNT") {
      empresaPagaCents = naoNegativo(input.subsidyValue) * titulares;
    }
    // A parte da empresa nunca passa dos titulares: bancar mais do que a
    // conta deles faria o titular aparecer com valor negativo a pagar.
    empresaPagaCents = Math.min(empresaPagaCents, titularesCents);
  }
  const colaboradorPagaCents = mensalidadeCents - empresaPagaCents;

  const hoje = input.currentPlanMonthlyCents;
  const economiaMensalCents =
    hoje == null || !Number.isFinite(hoje) ? null : hoje - mensalidadeCents;

  return {
    mensalidadeCents,
    titularesCents,
    dependentesCents,
    // O preço do TITULAR — com dependentes na conta, dividir o total pelos
    // titulares daria um "por titular" que nenhum titular paga.
    porColaboradorCents:
      titulares > 0 ? Math.round(titularesCents / titulares) : null,
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
  // ---- 1032: como os dependentes entram na conta e na implantação ----------
  dependent_mode?: "PER_DEPENDENT" | "FAMILY_PACKAGE" | null;
  dependents_calc_mode?: "DISTRIBUTION" | "AS_INDIVIDUAL" | "NONE" | null;
  dependents_distribution?: unknown;
  implantation_includes_dependents?: boolean | null;
  // ---- 1034: pagamento do tratamento e Riso+ Social ------------------------
  treatment_payment_methods?: string[] | null;
  treatment_max_installments?: number | null;
  social_participates?: boolean | null;
  social_goals?: unknown;
  main_clinic_id?: string | null;
  includes_dependents?: boolean | null;
  dependents_estimate?: number | null;
  excess_mode?: "NEW_FIXED" | "PER_ADHESION" | null;
  excess_fixed_cents?: number | null;
  excess_holder_fee_cents?: number | null;
  excess_dependent_fee_cents?: number | null;
  // ---- AP18 (1024): a base do acordo e o valor fixo ---------------------------
  billing_basis?: "PER_EMPLOYEE" | "FIXED_PER_COMPANY" | null;
  fixed_monthly_cents?: number | null;
  // ---- 1027: o que o contrato pediu e também é do cadastro ------------------
  /** O endereço da sede (mesma forma de `companies.address`). */
  address?: Record<string, string | undefined> | null;
  /** Dia de vencimento combinado. Nulo = o padrão do programa, dia 5. */
  due_day?: number | null;
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
  lead: { company_name: string; cnpj: string },
  /** As faixas da proposta — no valor fixo, elas trocam o valor pelo tamanho. */
  faixas: readonly FaixaDePreco[] = []
) {
  // ⚠️ AP18 (1024): o ACORDO DE VALOR FIXO viaja para a empresa. Antes ele
  // ficava na proposta, e a empresa seria cobrada por titular. O valor vai JÁ
  // COM A FAIXA — o número que a empresa leu — e fica congelado aqui.
  const fixo =
    qual?.billing_basis === "FIXED_PER_COMPANY" && qual.fixed_monthly_cents != null
      ? fixoDoFechamento(qual.fixed_monthly_cents, faixas, qual.employee_count ?? 0)
      : null;
  return {
    billing_basis: fixo != null ? ("FIXED_PER_COMPANY" as const) : ("PER_EMPLOYEE" as const),
    fixed_monthly_cents: fixo,
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
    // ⚠️ O ENDEREÇO E O VENCIMENTO DO CONTRATO VIAJAM JUNTO (1027). O contrato
    // assinado diz "vencem todo dia 10"; se o cadastro nascesse com o dia 5
    // de sempre, a primeira cobrança sairia em data diferente da combinada.
    address: qual?.address ?? null,
    due_day: qual?.due_day ?? 5,
    // ⚠️ A REGRA DA IMPLANTAÇÃO VIAJA JUNTO (1032). Com "titulares e
    // dependentes", a estimativa que a empresa leu na proposta fica congelada
    // aqui: é o que a 1ª implantação cobra dos dependentes enquanto os
    // cadastros não estão completos — como a quantidade contratada faz com os
    // titulares. Sem estimativa (não calculou), não há o que cobrar deles.
    ...implantacaoDosDependentes(qual),
    // ⚠️ 1034: O PAGAMENTO DO TRATAMENTO E O RISO+ SOCIAL VIAJAM JUNTO. Antes
    // toda empresa nascia com boleto, Pix e cartão em 24x, qualquer que fosse
    // a negociação. Nulo = a proposta não definiu, e vale o padrão de sempre.
    payment_methods:
      qual?.treatment_payment_methods && qual.treatment_payment_methods.length > 0
        ? qual.treatment_payment_methods
        : ["BOLETO", "PIX", "CARD"],
    default_max_installments: qual?.treatment_max_installments ?? 24,
    social_participates: qual?.social_participates ?? true,
    social_goals:
      qual?.social_participates === false ? null : metasParaGravar(lerMetas(qual?.social_goals)),
  };
}

function implantacaoDosDependentes(qual: QualificacaoDoLead | null) {
  const inclui = Boolean(qual?.implantation_includes_dependents && qual?.includes_dependents);
  const estimativa = inclui ? estimativaDaProposta(qual) : null;
  return {
    implantation_includes_dependents: inclui,
    implantation_dependents_cents: estimativa ? estimativa.totalCents : null,
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
