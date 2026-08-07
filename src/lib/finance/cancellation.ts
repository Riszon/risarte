// Cancelamento de plano de tratamento — o ACERTO DE CONTAS.
//
// Cancelar um tratamento no meio é a hora mais delicada da relação com o
// paciente: ele já pagou alguma coisa, já fez alguma coisa, e alguém vai
// terminar devendo. O termo existe para que esse número seja o mesmo para os
// dois lados, calculado por uma regra escrita antes da briga.
//
// Regras travadas pelo dono (07/08/2026):
//   • O que foi realizado é cobrado COM O MESMO DESCONTO que o cliente tinha.
//     Retirar o desconto já concedido é o tipo de cláusula que o CDC olha com
//     rigor — e, na prática, é o que transforma cancelamento em processo.
//   • Multa de rescisão é PERCENTUAL CONFIGURÁVEL, começando em zero. Incide
//     sobre o que a clínica deixou de faturar (o não executado), não sobre o
//     contrato inteiro: a multa compensa a agenda perdida, não pune o que já
//     foi entregue e pago.
//   • Cliente pagou mais do que consumiu → a clínica DEVOLVE, e a forma de
//     devolver é decidida no Financeiro (nunca estorno automático em cartão,
//     que depende da adquirente e nem sempre é possível).

import { roundHalfUp } from "./money";

export type CancellationInput = {
  /** Valor fechado na venda (já com benefício e desconto aplicados). */
  contractCents: number;
  /** Soma dos itens da venda a preço de tabela, antes de desconto. */
  listTotalCents: number;
  /** Itens já executados, somados a PREÇO DE TABELA. */
  executedListCents: number;
  /** Multa de rescisão vigente na unidade (cascata rede→unidade). */
  penaltyPercent: number;
  /** Baixas ativas (já descontados os estornos). */
  paidCents: number;
};

export type CancellationSettlement = {
  contractCents: number;
  /** O realizado trazido para o preço negociado. */
  executedCents: number;
  /** O que ficou por fazer, a preço negociado. */
  pendingCents: number;
  penaltyPercent: number;
  penaltyCents: number;
  /** Realizado + multa: o total que o cliente deve pelo que houve. */
  dueCents: number;
  paidCents: number;
  /** Positivo = o cliente ainda deve. */
  clientOwesCents: number;
  /** Positivo = a clínica devolve. */
  clinicRefundsCents: number;
};

/**
 * O desconto do contrato, como proporção. Um plano de R$ 10.000 fechado por
 * R$ 8.000 tem razão 0,8 — e todo procedimento executado entra por 80% da
 * tabela, exatamente o que o cliente contratou.
 *
 * Sem total de tabela (dado antigo ou plano sem itens), a razão é 1: melhor
 * cobrar o preço cheio do que dividir por zero e produzir número absurdo.
 */
export function contractRatio(input: {
  contractCents: number;
  listTotalCents: number;
}): number {
  if (input.listTotalCents <= 0) return 1;
  return input.contractCents / input.listTotalCents;
}

/** O acerto completo. É este número que vai para o termo assinado. */
export function settleCancellation(
  input: CancellationInput
): CancellationSettlement {
  const contract = Math.max(0, Math.round(input.contractCents));
  const ratio = contractRatio({
    contractCents: contract,
    listTotalCents: input.listTotalCents,
  });

  // O realizado nunca passa do contrato: se todos os itens foram executados,
  // o devido é o contrato, sem sobra por arredondamento.
  const executed = Math.min(
    contract,
    roundHalfUp(Math.max(0, input.executedListCents) * ratio)
  );
  const pending = Math.max(0, contract - executed);

  const percent = Math.max(0, input.penaltyPercent || 0);
  // A multa incide sobre o NÃO EXECUTADO — é o que a clínica deixou de faturar.
  const penalty = percent > 0 ? roundHalfUp((pending * percent) / 100) : 0;

  const due = executed + penalty;
  const paid = Math.max(0, Math.round(input.paidCents));
  const diff = due - paid;

  return {
    contractCents: contract,
    executedCents: executed,
    pendingCents: pending,
    penaltyPercent: percent,
    penaltyCents: penalty,
    dueCents: due,
    paidCents: paid,
    clientOwesCents: diff > 0 ? diff : 0,
    clinicRefundsCents: diff < 0 ? -diff : 0,
  };
}

/** Para onde o cliente vai depois do cancelamento (decisão do dono). */
export const CANCELLATION_DESTINATIONS = [
  "reevaluation",
  "follow_up",
] as const;
export type CancellationDestination =
  (typeof CANCELLATION_DESTINATIONS)[number];

export const CANCELLATION_DESTINATION_LABELS: Record<
  CancellationDestination,
  string
> = {
  reevaluation: "Reavaliação com o Coordenador Clínico",
  follow_up: "Acompanhamento, com data de retorno",
};

/** O que impede gerar o termo. Vazio = pode gerar. */
export function cancellationErrors(input: {
  reason: string;
  destination: CancellationDestination | null;
  returnDate: string | null;
  /** A venda foi concluída? Antes disso não há tratamento a desfazer. */
  wasClosed: boolean;
}): string[] {
  const errors: string[] = [];
  if (!input.reason.trim()) {
    errors.push("Escreva o motivo do cancelamento.");
  }
  if (input.wasClosed) {
    if (!input.destination) {
      errors.push("Escolha para onde o cliente vai depois do cancelamento.");
    }
    // Acompanhamento sem data de retorno é o mesmo que abandonar o paciente:
    // ninguém sabe quando ligar, e o caso some do radar da unidade.
    if (input.destination === "follow_up" && !input.returnDate) {
      errors.push("Informe a data de retorno do acompanhamento.");
    }
  }
  return errors;
}
