// FIN1 — contas a receber do cliente. Regras puras: saldo, valor atualizado,
// situação e resumo. Nenhuma delas pode viver dentro de componente de tela.

import { computeLateCharges, daysLate, type LateFeeTerms } from "./late-fees";

export const INSTALLMENT_STATUSES = [
  "em_aberto",
  "parcial",
  "paga",
  "cancelada",
  "renegociada",
] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
  em_aberto: "Em aberto",
  parcial: "Parcialmente paga",
  paga: "Paga",
  cancelada: "Cancelada",
  renegociada: "Renegociada",
};

export type Installment = {
  id: string;
  seq: number;
  kind: "entrada" | "parcela";
  dueDate: string;
  amountCents: number;
  paidAmountCents: number;
  status: InstallmentStatus;
  paymentMethod: string | null;
  /** Taxas CONGELADAS quando a parcela nasceu. */
  terms: LateFeeTerms;
  /** De onde veio: negociação do consultor ou venda direta. */
  origin: "negotiation" | "direct_sale";
  /** Já esteve em atraso (sobrevive à renegociação — indicador 9.28). */
  wasOverdue: boolean;
};

export type InstallmentView = Installment & {
  /** Quanto ainda falta do principal. */
  balanceCents: number;
  daysLate: number;
  lateFeeCents: number;
  interestCents: number;
  /** Saldo + multa + juros — o que o cliente paga se quitar hoje. */
  updatedBalanceCents: number;
  isOpen: boolean;
  isLate: boolean;
};

/**
 * Situação de uma parcela numa data. **O que se abate primeiro é o PRINCIPAL**
 * (decisão do dono, 31/07/2026): multa e juros incidem sobre o que ainda falta,
 * o que é mais favorável ao cliente e mais simples de explicar no balcão.
 */
export function viewInstallment(
  inst: Installment,
  referenceDate: string
): InstallmentView {
  const balance = Math.max(0, inst.amountCents - inst.paidAmountCents);
  const closed =
    inst.status === "paga" ||
    inst.status === "cancelada" ||
    inst.status === "renegociada";

  if (closed || balance <= 0) {
    return {
      ...inst,
      balanceCents: balance,
      daysLate: 0,
      lateFeeCents: 0,
      interestCents: 0,
      updatedBalanceCents: balance,
      isOpen: false,
      isLate: false,
    };
  }

  const charges = computeLateCharges({
    principalCents: balance,
    dueDate: inst.dueDate,
    referenceDate,
    terms: inst.terms,
  });

  return {
    ...inst,
    balanceCents: balance,
    daysLate: charges.daysLate,
    lateFeeCents: charges.lateFeeCents,
    interestCents: charges.interestCents,
    updatedBalanceCents: charges.totalCents,
    isOpen: true,
    isLate: charges.daysLate > 0,
  };
}

export type ReceivablesSummary = {
  /** Principal ainda devido (sem multa/juros). */
  openCents: number;
  /** Só a parte vencida, já com multa e juros. */
  lateCents: number;
  /** Quantas parcelas estão em atraso. */
  lateCount: number;
  /** Recebido no período consultado. */
  receivedCents: number;
  /** Total contratado (tudo que já virou parcela, menos cancelado). */
  contractedCents: number;
  /** Inadimplência do cliente: vencido ÷ total a receber (indicador 9.28). */
  latePercent: number;
};

/**
 * Resumo do topo da aba. `receivedCents` vem das BAIXAS do período (não do
 * status da parcela) — é o que responde "quanto entrou neste mês".
 */
export function summarizeReceivables(
  views: InstallmentView[],
  receivedInPeriodCents: number
): ReceivablesSummary {
  let openCents = 0;
  let lateCents = 0;
  let lateCount = 0;
  let contractedCents = 0;

  for (const v of views) {
    if (v.status === "cancelada" || v.status === "renegociada") continue;
    contractedCents += v.amountCents;
    if (!v.isOpen) continue;
    openCents += v.balanceCents;
    if (v.isLate) {
      lateCents += v.updatedBalanceCents;
      lateCount += 1;
    }
  }

  const toReceive = openCents;
  return {
    openCents,
    lateCents,
    lateCount,
    receivedCents: receivedInPeriodCents,
    contractedCents,
    latePercent: toReceive > 0 ? (lateCents / toReceive) * 100 : 0,
  };
}

/** Quanto falta para quitar a parcela hoje (com multa e juros). */
export function payoffCents(view: InstallmentView): number {
  return view.updatedBalanceCents;
}

/**
 * Erros que impedem registrar uma baixa. Vazio = pode salvar. A validação de
 * verdade está no banco (AMOUNT_OVER_BALANCE); aqui é para o usuário não
 * descobrir só depois de clicar.
 */
export function receiptErrors(input: {
  amountCents: number;
  balanceCents: number;
  receivedAt: string;
  today: string;
}): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    errors.push("Informe o valor recebido.");
  }
  if (input.amountCents > input.balanceCents) {
    errors.push("O valor é maior que o saldo desta cobrança.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedAt)) {
    errors.push("Informe a data do recebimento.");
  } else if (daysLate(input.today, input.receivedAt) > 0) {
    errors.push("A data do recebimento não pode ser no futuro.");
  }
  return errors;
}
