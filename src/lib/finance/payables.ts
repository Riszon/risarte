// FIN3 — contas a pagar. Regras puras: alçada, saldo, atraso e resumo.
// Espelha a migração 0194; quem manda é o banco, aqui é para a tela avisar
// ANTES de o usuário clicar em salvar.

import { daysLate } from "./late-fees";
import { inPeriod, type Period } from "./receivables";

export const PAYABLE_STATUSES = [
  "aguardando_autorizacao",
  "aberta",
  "parcial",
  "paga",
  "cancelada",
  "recusada",
] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];

export const PAYABLE_STATUS_LABELS: Record<PayableStatus, string> = {
  aguardando_autorizacao: "Aguardando autorização",
  aberta: "Em aberto",
  parcial: "Parcialmente paga",
  paga: "Paga",
  cancelada: "Cancelada",
  recusada: "Recusada",
};

// ---------------------------------------------------------------------------
// Alçada
// ---------------------------------------------------------------------------
export const APPROVAL_MODES = [
  "automatica",
  "sem_autorizacao",
  "com_autorizacao",
] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  automatica: "Automática (despesa contratada)",
  sem_autorizacao: "Sem autorização (respeita o teto)",
  com_autorizacao: "Sempre com autorização",
};

export const APPROVAL_MODE_HELP: Record<ApprovalMode, string> = {
  automatica:
    "Já contratada: nunca pede autorização e não olha o teto. Use em aluguel, contabilidade, software.",
  sem_autorizacao:
    "Lança e paga direto — mas acima do teto exige liberação.",
  com_autorizacao:
    "Exige liberação em qualquer valor. Use em equipamentos, obras, marketing.",
};

export type ApprovalRule = {
  /** Nulo = padrão da rede. */
  clinicId: string | null;
  /** Nulo = vale para todas as contas (o padrão geral). */
  accountCode: string | null;
  mode: ApprovalMode;
  thresholdCents: number | null;
};

/**
 * A cascata: unidade+conta → rede+conta → unidade (geral) → rede (geral).
 *
 * A **conta pesa mais que o escopo** de propósito: se a rede diz que
 * "equipamentos sempre precisam de autorização", a unidade não derruba isso
 * só por ter um teto geral próprio. O contrário abriria um buraco de
 * governança — bastaria a unidade criar uma regra geral para escapar da regra
 * da rede sobre uma conta sensível.
 *
 * Sem nenhuma regra, a despesa passa sem autorização e sem teto.
 */
export function resolveApproval(
  rules: ApprovalRule[],
  clinicId: string,
  accountCode: string
): ApprovalRule {
  const score = (r: ApprovalRule) =>
    (r.accountCode ? 2 : 0) + (r.clinicId ? 1 : 0);
  const applicable = rules
    .filter(
      (r) =>
        (r.clinicId === null || r.clinicId === clinicId) &&
        (r.accountCode === null || r.accountCode === accountCode)
    )
    .sort((a, b) => score(b) - score(a));
  return (
    applicable[0] ?? {
      clinicId: null,
      accountCode: null,
      mode: "sem_autorizacao",
      thresholdCents: null,
    }
  );
}

/**
 * Precisa de liberação? **Automática nunca precisa** — é despesa já
 * contratada, e por isso também ignora o teto (decisão do dono, 04/08/2026).
 */
export function requiresApproval(
  rule: Pick<ApprovalRule, "mode" | "thresholdCents">,
  amountCents: number
): boolean {
  if (rule.mode === "automatica") return false;
  if (rule.mode === "com_autorizacao") return true;
  return rule.thresholdCents !== null && amountCents > rule.thresholdCents;
}

// ---------------------------------------------------------------------------
// A conta a pagar
// ---------------------------------------------------------------------------
export type Payable = {
  id: string;
  clinicId: string;
  supplierId: string | null;
  supplierName: string | null;
  accountCode: string;
  accountName: string | null;
  costCenterId: string | null;
  costCenterName: string | null;
  description: string;
  documentNumber: string | null;
  accrualDate: string;
  dueDate: string;
  amountCents: number;
  paidAmountCents: number;
  paidFeeCents: number;
  paidInterestCents: number;
  status: PayableStatus;
  approvalMode: ApprovalMode;
  requiresApproval: boolean;
  approvedByName: string | null;
  approvalNote: string | null;
  cancelReason: string | null;
  createdByName: string | null;
  createdById: string | null;
  notes: string | null;
  recurrenceId: string | null;
};

export type PayableView = Payable & {
  /** Quanto ainda falta pagar. */
  balanceCents: number;
  daysLate: number;
  isOpen: boolean;
  isOverdue: boolean;
  /** Total desembolsado, somada a multa e os juros que nós pagamos. */
  paidTotalCents: number;
};

export function viewPayable(p: Payable, referenceDate: string): PayableView {
  const balance = Math.max(0, p.amountCents - p.paidAmountCents);
  const closed =
    p.status === "paga" ||
    p.status === "cancelada" ||
    p.status === "recusada";
  const open = !closed && balance > 0;
  return {
    ...p,
    balanceCents: balance,
    daysLate: open ? daysLate(p.dueDate, referenceDate) : 0,
    isOpen: open,
    // Conta esperando autorização já pode estar vencida — e é justamente o
    // que precisa gritar na tela.
    isOverdue: open && daysLate(p.dueDate, referenceDate) > 0,
    paidTotalCents:
      p.paidAmountCents + p.paidFeeCents + p.paidInterestCents,
  };
}

// ---------------------------------------------------------------------------
// Filtros e resumo
// ---------------------------------------------------------------------------
export const PAYABLE_FILTERS = [
  { key: "todas", label: "Todas" },
  { key: "a_autorizar", label: "A autorizar" },
  { key: "a_vencer", label: "A vencer" },
  { key: "vencidas", label: "Vencidas" },
  { key: "pagas", label: "Pagas" },
  { key: "canceladas", label: "Canceladas" },
] as const;

export type PayableFilter = (typeof PAYABLE_FILTERS)[number]["key"];

export function matchesPayableFilter(
  v: PayableView,
  filter: PayableFilter
): boolean {
  switch (filter) {
    case "todas":
      return true;
    case "a_autorizar":
      return v.status === "aguardando_autorizacao";
    case "a_vencer":
      return v.isOpen && !v.isOverdue && v.status !== "aguardando_autorizacao";
    case "vencidas":
      return v.isOverdue;
    case "pagas":
      return v.status === "paga";
    case "canceladas":
      return v.status === "cancelada" || v.status === "recusada";
  }
}

export function countPayablesByFilter(
  views: PayableView[]
): Record<PayableFilter, number> {
  const out = {} as Record<PayableFilter, number>;
  for (const f of PAYABLE_FILTERS) {
    out[f.key] = views.filter((v) => matchesPayableFilter(v, f.key)).length;
  }
  return out;
}

export type PayablesSummary = {
  /** Ainda a pagar (inclui o que espera autorização). */
  openCents: number;
  overdueCents: number;
  overdueCount: number;
  awaitingCount: number;
  awaitingCents: number;
  /** Pago no período consultado. */
  paidCents: number;
};

export type PayablePaymentEntry = {
  paidAt: string;
  amountCents: number;
  feeCents: number;
  interestCents: number;
  reversed: boolean;
  reversalOf: string | null;
};

export function summarizePayables(
  views: PayableView[],
  payments: PayablePaymentEntry[],
  period: Period | null
): PayablesSummary {
  let openCents = 0;
  let overdueCents = 0;
  let overdueCount = 0;
  let awaitingCount = 0;
  let awaitingCents = 0;

  for (const v of views) {
    if (v.status === "cancelada" || v.status === "recusada") continue;
    if (v.status === "aguardando_autorizacao") {
      awaitingCount += 1;
      awaitingCents += v.balanceCents;
    }
    if (!v.isOpen) continue;
    openCents += v.balanceCents;
    if (v.isOverdue) {
      overdueCents += v.balanceCents;
      overdueCount += 1;
    }
  }

  const paidCents = payments
    .filter((p) => !p.reversed && !p.reversalOf && inPeriod(p.paidAt, period))
    .reduce((s, p) => s + p.amountCents + p.feeCents + p.interestCents, 0);

  return {
    openCents,
    overdueCents,
    overdueCount,
    awaitingCount,
    awaitingCents,
    paidCents,
  };
}

/** Erros que impedem lançar a conta. Vazio = pode salvar. */
export function payableErrors(input: {
  description: string;
  accountCode: string;
  amountCents: number;
  dueDate: string;
}): string[] {
  const errors: string[] = [];
  if (!input.description.trim()) errors.push("Descreva a despesa.");
  if (!input.accountCode) {
    errors.push("Escolha a conta do plano de contas.");
  }
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    errors.push("Informe um valor maior que zero.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    errors.push("Informe o vencimento.");
  }
  return errors;
}

/** Erros que impedem registrar o pagamento. */
export function payablePaymentErrors(input: {
  amountCents: number;
  balanceCents: number;
  paidAt: string;
  today: string;
}): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    errors.push("Informe o valor pago.");
  }
  if (input.amountCents > input.balanceCents) {
    errors.push("O valor é maior que o saldo desta conta.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)) {
    errors.push("Informe a data do pagamento.");
  } else if (daysLate(input.today, input.paidAt) > 0) {
    errors.push("A data do pagamento não pode ser no futuro.");
  }
  return errors;
}
