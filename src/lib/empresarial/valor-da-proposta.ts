// Risarte Empresarial — O VALOR DA PROPOSTA GRAVADA (OC-00011, 30/10/2026).
//
// Relato: *"cada proposta deve aparecer no card o valor da proposta, e na etapa
// do funil mostrar a somatória de todas as propostas"*. O funil só conhecia o
// "Valor estimado" digitado no cadastro do lead: a Cooperativa tinha proposta
// de R$ 524,40 por mês e a etapa somava R$ 0,00.
//
// ⚠️ A CONTA É UMA SÓ: o documento da proposta e o funil leem daqui. Calculado
// na leitura, e não copiado para o lead, porque cópia envelhece: a proposta
// mudaria e o funil continuaria com o preço antigo.

import type { PaymentModel } from "./constants";
import type { FaixaDePreco } from "./condicoes-da-proposta";
import {
  estimativaDaProposta,
  type PropostaDosDependentes,
} from "./dependentes-da-proposta";
import { DEFAULT_ADHESION_PRICING } from "./pricing";
import {
  simularProposta,
  type BillingBasis,
  type PropostaResult,
  type SubsidyType,
} from "./proposta";

/** As colunas de `lead_qualification` que a conta lê. */
export const COLUNAS_DO_VALOR_DA_PROPOSTA =
  "lead_id, billing_basis, employee_count, holder_fee_cents, fixed_monthly_cents, includes_dependents, dependents_estimate, dependent_fee_cents, dependent_mode, dependent_family_fee_cents, dependent_family_extra_fee_cents, dependent_family_size, dependents_calc_mode, dependents_distribution, implantation_includes_dependents, payment_model, subsidy_type, subsidy_value, dental_plan_monthly_cents";

export type PropostaGravada = PropostaDosDependentes & {
  billing_basis: BillingBasis | null;
  employee_count: number | null;
  holder_fee_cents: number | null;
  fixed_monthly_cents: number | null;
  implantation_includes_dependents: boolean | null;
  payment_model: PaymentModel | null;
  subsidy_type: SubsidyType | null;
  subsidy_value: number | null;
  dental_plan_monthly_cents: number | null;
};

/** A conta completa da proposta gravada — a que o documento imprime. */
export function contaDaPropostaGravada(
  q: PropostaGravada,
  faixas: readonly FaixaDePreco[]
): PropostaResult {
  const estimativa = estimativaDaProposta(q);
  return simularProposta({
    basis: q.billing_basis ?? "PER_EMPLOYEE",
    dependentesEstimadosCents: estimativa?.totalCents ?? null,
    implantacaoComDependentes:
      Boolean(q.implantation_includes_dependents) && estimativa != null,
    employeeCount: q.employee_count ?? 0,
    holderFeeCents: q.holder_fee_cents ?? DEFAULT_ADHESION_PRICING.holderFeeCents,
    includeDependents: Boolean(q.includes_dependents),
    dependentsCount: estimativa?.dependentes ?? q.dependents_estimate ?? 0,
    dependentFeeCents:
      q.dependent_fee_cents ?? DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents,
    fixedMonthlyCents: q.fixed_monthly_cents ?? 0,
    paymentModel: q.payment_model ?? "EMPLOYEE_PAYS",
    subsidyType: q.subsidy_type,
    subsidyValue: q.subsidy_value ?? 0,
    currentPlanMonthlyCents: q.dental_plan_monthly_cents,
    faixas,
  });
}

/**
 * A MENSALIDADE QUE O FUNIL MOSTRA. Nula quando ainda não há proposta com valor.
 *
 * ⚠️ O PREÇO PRECISA TER SIDO GRAVADO. O documento cai no preço padrão quando o
 * campo está vazio; aqui isso inventaria uma proposta para todo lead que só tem
 * o levantamento preenchido, e a soma da etapa passaria a contar negócio que
 * ninguém ofereceu.
 */
export function valorDaPropostaGravada(
  q: PropostaGravada | null | undefined,
  faixas: readonly FaixaDePreco[]
): number | null {
  if (!q) return null;
  const fixo = q.billing_basis === "FIXED_PER_COMPANY";
  if ((fixo ? q.fixed_monthly_cents : q.holder_fee_cents) == null) return null;
  const { mensalidadeCents } = contaDaPropostaGravada(q, faixas);
  return mensalidadeCents > 0 ? mensalidadeCents : null;
}

/** O valor do lead no funil: o da proposta; sem ela, o estimado no cadastro. */
export function valorNoFunil(
  valorDaPropostaCents: number | null | undefined,
  estimadoCents: number | null | undefined
): number | null {
  return valorDaPropostaCents ?? estimadoCents ?? null;
}
