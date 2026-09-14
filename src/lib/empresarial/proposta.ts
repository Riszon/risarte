// Risarte Empresarial — a conta da proposta comercial de um lead.
//
// Puro e testado: nenhuma regra de dinheiro dentro de componente de tela
// (invariante do módulo Financeiro, que vale aqui igual). Tudo em CENTAVOS.
//
// A diferença para `pricing.ts`: lá a mensalidade é somada sobre colaboradores
// que EXISTEM; aqui ainda não existe ninguém — são estimativas do consultor
// para montar a oferta. As duas contas nunca se misturam por isso.

import type { PaymentModel } from "./constants";

export const BILLING_BASES = ["PER_EMPLOYEE", "FIXED_PER_COMPANY"] as const;
export type BillingBasis = (typeof BILLING_BASES)[number];
export const BILLING_BASIS_LABELS: Record<BillingBasis, string> = {
  PER_EMPLOYEE: "Por colaborador (padrão)",
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
  includeDependents: boolean;
  dependentsCount: number;
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
};

export type PropostaResult = {
  mensalidadeCents: number;
  titularesCents: number;
  dependentesCents: number;
  /** `null` quando não há colaborador: dividir por zero não tem resposta. */
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
};

const naoNegativo = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function simularProposta(input: PropostaInput): PropostaResult {
  const colaboradores = Math.floor(naoNegativo(input.employeeCount));
  const dependentes = input.includeDependents
    ? Math.floor(naoNegativo(input.dependentsCount))
    : 0;

  const titularesCents =
    input.basis === "PER_EMPLOYEE"
      ? colaboradores * naoNegativo(input.holderFeeCents)
      : naoNegativo(input.fixedMonthlyCents);

  // No valor fixo por empresa os dependentes já estão dentro do pacote — é o
  // que a regra alternativa significa para sindicato e associação. Cobrá-los
  // por fora transformaria "valor fixo" em valor variável.
  const dependentesCents =
    input.basis === "PER_EMPLOYEE"
      ? dependentes * naoNegativo(input.dependentFeeCents)
      : 0;

  const mensalidadeCents = titularesCents + dependentesCents;

  const implantacaoCents =
    colaboradores * naoNegativo(input.implantationPerEmployeeCents);

  // Quem paga o quê. As duas partes SEMPRE somam a mensalidade: a do
  // colaborador é o resto, nunca uma segunda conta — senão um centavo de
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
      empresaPagaCents = naoNegativo(input.subsidyValue) * colaboradores;
    }
    // A parte da empresa nunca passa do total: bancar mais do que a conta
    // inteira faria o colaborador aparecer com valor negativo a pagar.
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
      colaboradores > 0 ? Math.round(mensalidadeCents / colaboradores) : null,
    implantacaoCents,
    empresaPagaCents,
    colaboradorPagaCents,
    economiaMensalCents,
    economiaAnualCents:
      economiaMensalCents == null ? null : economiaMensalCents * 12,
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
    falta.push("quantos colaboradores entram");
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
