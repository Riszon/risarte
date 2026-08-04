// FIN2 — renegociação. Regras puras: apuração da dívida, desconto e teto.
// Espelha `public.save_renegotiation` (migração 0189); quem manda é o banco,
// aqui é para a tela mostrar a conta ANTES de o usuário clicar em salvar.

import type { InstallmentView } from "./receivables";

export const RENEGOTIATION_STATUSES = [
  "aplicada",
  "aguardando_autorizacao",
  "recusada",
] as const;
export type RenegotiationStatus = (typeof RENEGOTIATION_STATUSES)[number];

export const RENEGOTIATION_STATUS_LABELS: Record<RenegotiationStatus, string> = {
  aplicada: "Aplicada",
  aguardando_autorizacao: "Aguardando autorização",
  recusada: "Recusada",
};

/**
 * A dívida apurada das cobranças escolhidas. Decisão do dono (04/08/2026):
 * entra **tudo** o que é devido hoje — o que falta da parcela, o benefício
 * perdido por atraso, a multa e os juros. Perdoar qualquer parte é desconto, e
 * desconto tem teto e fica registrado.
 */
export type RenegotiationBase = {
  principalCents: number;
  benefitCents: number;
  lateFeeCents: number;
  interestCents: number;
  /** Soma das quatro naturezas. */
  totalCents: number;
  count: number;
  /** Quantas das escolhidas estão vencidas. */
  lateCount: number;
};

export function renegotiationBase(
  views: InstallmentView[]
): RenegotiationBase {
  const out: RenegotiationBase = {
    principalCents: 0,
    benefitCents: 0,
    lateFeeCents: 0,
    interestCents: 0,
    totalCents: 0,
    count: 0,
    lateCount: 0,
  };
  for (const v of views) {
    if (!canRenegotiateInstallment(v)) continue;
    out.principalCents += v.balanceCents;
    out.benefitCents += v.benefitRemCents;
    out.lateFeeCents += v.lateFeeRemCents;
    out.interestCents += v.interestRemCents;
    out.count += 1;
    if (v.isLate) out.lateCount += 1;
  }
  out.totalCents =
    out.principalCents +
    out.benefitCents +
    out.lateFeeCents +
    out.interestCents;
  return out;
}

/** Só cobrança viva entra: paga, cancelada e já renegociada ficam de fora. */
export function canRenegotiateInstallment(v: InstallmentView): boolean {
  return v.status === "em_aberto" || v.status === "parcial";
}

// ---------------------------------------------------------------------------
// Juros do parcelamento (Tabela Price)
// ---------------------------------------------------------------------------
/**
 * Parcela fixa que quita `pvCents` em `n` meses a `monthlyPercent` ao mês —
 * a **Tabela Price**, que é como o varejo brasileiro parcela.
 *
 * Pedido do dono (04/08/2026): quanto mais tempo o cliente leva para quitar a
 * dívida, mais juros ele paga. Com taxa zero devolve a divisão simples.
 */
export function priceInstallmentCents(
  pvCents: number,
  monthlyPercent: number,
  n: number
): number {
  const pv = Math.max(0, Math.round(pvCents));
  const count = Math.max(1, Math.floor(n));
  const i = Math.max(0, monthlyPercent) / 100;
  if (pv === 0) return 0;
  // Sem juros a parcela não é "fixa": o resíduo de centavos vai para a última
  // (regra do splitAmount). Aqui devolvemos só a parte inteira.
  if (i === 0) return Math.floor(pv / count);
  const factor = i / (1 - Math.pow(1 + i, -count));
  return Math.round(pv * factor);
}

export type FinancedPlan = {
  /** Parcela fixa. */
  installmentCents: number;
  /** Soma das parcelas (sem a entrada). */
  financedTotalCents: number;
  /** Quanto do total é juros do parcelamento. */
  interestCents: number;
};

/** O que o cliente paga ao parcelar `pvCents` em `n` vezes com juros. */
export function financedPlan(
  pvCents: number,
  monthlyPercent: number,
  n: number
): FinancedPlan {
  const pv = Math.max(0, Math.round(pvCents));
  const count = Math.max(1, Math.floor(n));
  const pmt = priceInstallmentCents(pv, monthlyPercent, count);
  // Sem juros, o financiado é a própria dívida (o resíduo cai na última parcela).
  if (Math.max(0, monthlyPercent) === 0) {
    return {
      installmentCents: pmt,
      financedTotalCents: pv,
      interestCents: 0,
    };
  }
  const total = pmt * count;
  return {
    installmentCents: pmt,
    financedTotalCents: total,
    interestCents: Math.max(0, total - pv),
  };
}

export type RenegotiationOutcome = {
  originalCents: number;
  newCents: number;
  /** Positivo = perdão concedido; negativo = acréscimo do parcelamento. */
  discountCents: number;
  discountPercent: number;
  /** Passou do teto da unidade, ou é desconto de quem não é Gerente. */
  needsAuthorization: boolean;
};

/**
 * O resultado da simulação. `maxDiscountPercent` é o MESMO teto da regra
 * comercial da unidade (decisão do dono); `isManager` distingue quem perdoa
 * sozinho (Gerente/Admin) de quem precisa de autorização (Financeiro da
 * Franqueadora).
 */
export function renegotiationOutcome(input: {
  originalCents: number;
  newCents: number;
  maxDiscountPercent: number | null;
  isManager: boolean;
}): RenegotiationOutcome {
  const discount = input.originalCents - input.newCents;
  const percent =
    input.originalCents > 0 && discount > 0
      ? Math.round((discount * 10000) / input.originalCents) / 100
      : 0;
  const overCap =
    input.maxDiscountPercent !== null && percent > input.maxDiscountPercent;
  return {
    originalCents: input.originalCents,
    newCents: input.newCents,
    discountCents: discount,
    discountPercent: percent,
    needsAuthorization: overCap || (discount > 0 && !input.isManager),
  };
}

/** Erros que impedem salvar a renegociação. Vazio = pode salvar. */
export function renegotiationErrors(input: {
  selectedCount: number;
  originalCents: number;
  newCents: number;
  scheduleErrors: string[];
}): string[] {
  const errors: string[] = [];
  if (input.selectedCount === 0) {
    errors.push("Escolha ao menos uma cobrança para renegociar.");
  }
  if (input.originalCents <= 0) {
    errors.push("As cobranças escolhidas não têm saldo devedor.");
  }
  if (input.newCents <= 0) {
    errors.push("O novo parcelamento precisa somar mais que zero.");
  }
  return [...errors, ...input.scheduleErrors];
}
