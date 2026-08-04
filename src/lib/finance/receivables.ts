// FIN1 — contas a receber do cliente. Regras puras: saldo, valor atualizado,
// situação e resumo. Nenhuma delas pode viver dentro de componente de tela.
//
// Espelha `public.installment_balance` (migração 0188): a conta de uma parcela
// é sempre a soma de QUATRO naturezas — principal, benefício perdido por
// atraso, multa e juros.

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

/** Meios em que o cliente pode atrasar — e por isso perder o benefício. */
export const BENEFIT_RISK_METHODS = ["boleto", "credito_recorrente"] as const;

export function methodRunsLateRisk(method: string | null): boolean {
  return (BENEFIT_RISK_METHODS as readonly string[]).includes(method ?? "");
}

export type Installment = {
  id: string;
  seq: number;
  kind: "entrada" | "parcela";
  dueDate: string;
  /** Valor combinado da parcela (já com o benefício do programa aplicado). */
  amountCents: number;
  /**
   * Benefício que ESTA parcela perde se atrasar. Congelado no fechamento e já
   * zerado quando o meio de pagamento não corre risco (cartão, à vista) ou
   * quando o procedimento ficou 100% gratuito — gratuito nunca é cobrado.
   */
  benefitDiscountCents: number;
  /** Principal já recebido. */
  paidAmountCents: number;
  paidBenefitCents: number;
  paidFeeCents: number;
  paidInterestCents: number;
  status: InstallmentStatus;
  paymentMethod: string | null;
  /** Taxas CONGELADAS quando a parcela nasceu. */
  terms: LateFeeTerms;
  /** De onde veio: negociação do consultor, venda direta ou renegociação. */
  origin: "negotiation" | "direct_sale" | "renegotiation";
  /** Documento de origem (venda ou renegociação) — para abrir o resumo. */
  sourceId: string | null;
  /** Código do documento: PT-00001 (plano), VD-00001 (venda direta), RN-…. */
  sourceCode: string | null;
  /** Já esteve em atraso (sobrevive à renegociação — indicador 9.28). */
  wasOverdue: boolean;
};

export type InstallmentView = Installment & {
  /** Quanto ainda falta do principal. */
  balanceCents: number;
  daysLate: number;
  /** Benefício efetivamente perdido nesta data (0 se está em dia). */
  benefitDueCents: number;
  benefitRemCents: number;
  lateFeeCents: number;
  lateFeeRemCents: number;
  interestCents: number;
  interestRemCents: number;
  /** Tudo que falta hoje: principal + benefício perdido + multa + juros. */
  updatedBalanceCents: number;
  /** Total já recebido nesta cobrança, somadas as quatro naturezas. */
  paidTotalCents: number;
  isOpen: boolean;
  isLate: boolean;
};

/**
 * Situação de uma parcela numa data.
 *
 * **Multa e juros incidem sobre o valor CHEIO da parcela** (mais o benefício
 * perdido), não sobre o saldo — decisão do dono em 04/08/2026, que revisa a de
 * 31/07: receber metade não pode reduzir a multa pela metade, senão a baixa
 * parcial vira um desconto disfarçado. O que muda com o recebimento é só o
 * quanto AINDA FALTA de cada natureza.
 *
 * A ordem de abatimento continua sendo principal → benefício → multa → juros.
 */
export function viewInstallment(
  inst: Installment,
  referenceDate: string
): InstallmentView {
  const balance = Math.max(0, inst.amountCents - inst.paidAmountCents);
  const paidTotal =
    inst.paidAmountCents +
    inst.paidBenefitCents +
    inst.paidFeeCents +
    inst.paidInterestCents;
  const closed =
    inst.status === "paga" ||
    inst.status === "cancelada" ||
    inst.status === "renegociada";

  if (closed) {
    return {
      ...inst,
      balanceCents: balance,
      daysLate: 0,
      benefitDueCents: 0,
      benefitRemCents: 0,
      lateFeeCents: 0,
      lateFeeRemCents: 0,
      interestCents: 0,
      interestRemCents: 0,
      updatedBalanceCents: balance,
      paidTotalCents: paidTotal,
      isOpen: false,
      isLate: false,
    };
  }

  const late = daysLate(inst.dueDate, referenceDate, inst.terms.graceDays);
  // Perdeu a pontualidade → perde o benefício daquela parcela.
  const benefitDue = late > 0 ? Math.max(0, inst.benefitDiscountCents) : 0;

  const charges = computeLateCharges({
    principalCents: inst.amountCents + benefitDue,
    dueDate: inst.dueDate,
    referenceDate,
    terms: inst.terms,
  });

  const benefitRem = Math.max(0, benefitDue - inst.paidBenefitCents);
  const feeRem = Math.max(0, charges.lateFeeCents - inst.paidFeeCents);
  const interestRem = Math.max(0, charges.interestCents - inst.paidInterestCents);
  const updated = balance + benefitRem + feeRem + interestRem;

  return {
    ...inst,
    balanceCents: balance,
    daysLate: charges.daysLate,
    benefitDueCents: benefitDue,
    benefitRemCents: benefitRem,
    lateFeeCents: charges.lateFeeCents,
    lateFeeRemCents: feeRem,
    interestCents: charges.interestCents,
    interestRemCents: interestRem,
    updatedBalanceCents: updated,
    paidTotalCents: paidTotal,
    isOpen: updated > 0,
    isLate: charges.daysLate > 0 && updated > 0,
  };
}

/**
 * Como um recebimento se reparte entre as quatro naturezas. Mesma ordem do
 * banco (`register_payment_receipt`): principal → benefício → multa → juros.
 */
export type ReceiptAllocation = {
  principalCents: number;
  benefitCents: number;
  lateFeeCents: number;
  interestCents: number;
};

export function allocateReceipt(
  view: InstallmentView,
  amountCents: number
): ReceiptAllocation {
  let rest = Math.max(0, Math.round(amountCents));
  const principal = Math.min(rest, view.balanceCents);
  rest -= principal;
  const benefit = Math.min(rest, view.benefitRemCents);
  rest -= benefit;
  const fee = Math.min(rest, view.lateFeeRemCents);
  rest -= fee;
  const interest = Math.min(rest, view.interestRemCents);

  return {
    principalCents: principal,
    benefitCents: benefit,
    lateFeeCents: fee,
    interestCents: interest,
  };
}

// ---------------------------------------------------------------------------
// Filtros da aba (o dono pediu ver por situação)
// ---------------------------------------------------------------------------
export const RECEIVABLE_FILTERS = [
  { key: "todas", label: "Todas" },
  { key: "em_aberto", label: "Em aberto" },
  { key: "em_atraso", label: "Em atraso" },
  { key: "paga", label: "Pagas" },
  { key: "cancelada", label: "Canceladas" },
  { key: "renegociada", label: "Renegociadas" },
] as const;

export type ReceivableFilter = (typeof RECEIVABLE_FILTERS)[number]["key"];

/** "Em aberto" e "Em atraso" são listas separadas: vencida sai de "em aberto". */
export function matchesFilter(
  view: InstallmentView,
  filter: ReceivableFilter
): boolean {
  switch (filter) {
    case "todas":
      return true;
    case "em_aberto":
      return view.isOpen && !view.isLate;
    case "em_atraso":
      return view.isLate;
    case "paga":
      return view.status === "paga";
    case "cancelada":
      return view.status === "cancelada";
    case "renegociada":
      return view.status === "renegociada";
  }
}

export function countByFilter(
  views: InstallmentView[]
): Record<ReceivableFilter, number> {
  const out = {} as Record<ReceivableFilter, number>;
  for (const f of RECEIVABLE_FILTERS) {
    out[f.key] = views.filter((v) => matchesFilter(v, f.key)).length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Período (mês, ano ou intervalo escolhido)
// ---------------------------------------------------------------------------
/** Intervalo [start, end) — `end` é EXCLUSIVO, como no resto do sistema. */
export type Period = { start: string; end: string };

export const PERIOD_PRESETS = [
  { key: "tudo", label: "Tudo" },
  { key: "mes", label: "Este mês" },
  { key: "mes_passado", label: "Mês passado" },
  { key: "ano", label: "Este ano" },
  { key: "custom", label: "Período específico" },
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["key"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Dia seguinte a uma data YYYY-MM-DD (para virar fim EXCLUSIVO). */
export function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** `null` = sem limite (Tudo). O intervalo específico é inclusivo na tela. */
export function resolvePeriod(
  preset: PeriodPreset,
  today: string,
  custom?: { start: string; end: string }
): Period | null {
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "tudo":
      return null;
    case "mes":
      return {
        start: `${y}-${pad2(m)}-01`,
        end: m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`,
      };
    case "mes_passado":
      return {
        start:
          m === 1 ? `${y - 1}-12-01` : `${y}-${pad2(m - 1)}-01`,
        end: `${y}-${pad2(m)}-01`,
      };
    case "ano":
      return { start: `${y}-01-01`, end: `${y + 1}-01-01` };
    case "custom":
      if (!custom?.start || !custom?.end) return null;
      return { start: custom.start, end: nextDay(custom.end) };
  }
}

export function inPeriod(dateIso: string, period: Period | null): boolean {
  if (!period) return true;
  return dateIso >= period.start && dateIso < period.end;
}

/** Rótulo curto do período, para o card de recebimento. */
export function periodLabel(
  preset: PeriodPreset,
  period: Period | null
): string {
  if (!period) return "no total";
  const [y, m, d] = period.start.split("-");
  if (preset === "ano") return `em ${y}`;
  if (preset === "mes" || preset === "mes_passado") return `em ${m}/${y}`;
  const [ey, em, ed] = period.end.split("-");
  const fim = new Date(Date.UTC(Number(ey), Number(em) - 1, Number(ed) - 1));
  return `de ${d}/${m}/${y} a ${pad2(fim.getUTCDate())}/${pad2(
    fim.getUTCMonth() + 1
  )}/${fim.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Recebimentos do período — separados por natureza
// ---------------------------------------------------------------------------
/** O mínimo que a regra precisa de uma baixa (a tela carrega mais campos). */
export type ReceiptEntry = {
  receivedAt: string;
  amountCents: number;
  principalCents: number;
  benefitCents: number;
  lateFeeCents: number;
  interestCents: number;
  reversed: boolean;
  reversalOf: string | null;
};

export type ReceiptTotals = {
  totalCents: number;
  principalCents: number;
  benefitCents: number;
  lateFeeCents: number;
  interestCents: number;
  /** Multa + juros — o que NÃO é o valor da parcela. */
  chargesCents: number;
  count: number;
};

/**
 * Soma as baixas ATIVAS do período (estorno e baixa estornada ficam de fora).
 * O dono pediu que o card diga o que do recebido é multa e juros — senão o
 * número parece faturamento e não é.
 */
export function summarizeReceipts(
  receipts: ReceiptEntry[],
  period: Period | null
): ReceiptTotals {
  const out: ReceiptTotals = {
    totalCents: 0,
    principalCents: 0,
    benefitCents: 0,
    lateFeeCents: 0,
    interestCents: 0,
    chargesCents: 0,
    count: 0,
  };
  for (const r of receipts) {
    if (r.reversed || r.reversalOf) continue;
    if (!inPeriod(r.receivedAt, period)) continue;
    out.totalCents += r.amountCents;
    out.principalCents += r.principalCents;
    out.benefitCents += r.benefitCents;
    out.lateFeeCents += r.lateFeeCents;
    out.interestCents += r.interestCents;
    out.count += 1;
  }
  out.chargesCents = out.lateFeeCents + out.interestCents;
  return out;
}

export type ReceivablesSummary = {
  /** Principal ainda devido (sem multa/juros). */
  openCents: number;
  /** Só a parte vencida, já com benefício perdido, multa e juros. */
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

/** Quanto falta para quitar a parcela hoje (com benefício perdido, multa e juros). */
export function payoffCents(view: InstallmentView): number {
  return view.updatedBalanceCents;
}

/**
 * Erros que impedem registrar uma baixa. Vazio = pode salvar. A validação de
 * verdade está no banco (AMOUNT_OVER_BALANCE); aqui é para o usuário não
 * descobrir só depois de clicar.
 *
 * Não existe "receber com desconto": valor menor que o total vira baixa
 * PARCIAL. Perdoar diferença é ato de renegociação (Gerente da unidade,
 * Financeiro da Franqueadora com autorização, ou Admin Master).
 */
export function receiptErrors(input: {
  amountCents: number;
  /** Total devido hoje: principal + benefício perdido + multa + juros. */
  payoffCents: number;
  receivedAt: string;
  today: string;
}): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    errors.push("Informe o valor recebido.");
  }
  if (input.amountCents > input.payoffCents) {
    errors.push("O valor é maior que o total devido nesta cobrança.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedAt)) {
    errors.push("Informe a data do recebimento.");
  } else if (daysLate(input.today, input.receivedAt) > 0) {
    errors.push("A data do recebimento não pode ser no futuro.");
  }
  return errors;
}
