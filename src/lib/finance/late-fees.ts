// FIN0 — multa e juros por atraso.
//
// Regra da rede (decisão do dono, 31/07/2026): multa de 2% + juros de 1% ao mês
// PRO RATA DIE, contando o atraso a partir do dia seguinte ao vencimento
// (carência configurável, padrão 0).
//
// O teto de 2% da multa é o limite do art. 52, §1º do Código de Defesa do
// Consumidor para contrato de consumo com pagamento parcelado. A trava real
// está no banco (check constraint); aqui só respeitamos o valor recebido.
//
// TAXAS CONGELADAS: cada parcela guarda a multa e o juro vigentes quando foi
// gerada. Mudar a configuração da rede NÃO reescreve o passado — por isso estas
// funções recebem as taxas por parâmetro, nunca leem configuração global.

import { percentOf, roundCents, type RoundingMode } from "./money";

export type LateFeeTerms = {
  /** % de multa aplicada uma vez sobre o principal. */
  lateFeePercent: number;
  /** % de juros ao mês, aplicado proporcionalmente aos dias de atraso. */
  monthlyInterestPercent: number;
  /** Dias de tolerância antes de contar atraso (0 = dia seguinte). */
  graceDays: number;
  roundingMode?: RoundingMode;
};

export type LateCharges = {
  /** Dias de atraso já descontada a carência (0 = em dia). */
  daysLate: number;
  lateFeeCents: number;
  interestCents: number;
  /** Principal + multa + juros. */
  totalCents: number;
};

/** Dias inteiros entre duas datas YYYY-MM-DD (sem fuso, como no resto do app). */
export function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = Date.UTC(fy, (fm ?? 1) - 1, fd ?? 1);
  const to = Date.UTC(ty, (tm ?? 1) - 1, td ?? 1);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Dias de atraso de uma parcela. Vencimento hoje = 0 (não está atrasada);
 * vencimento ontem = 1. A carência desconta do total.
 */
export function daysLate(
  dueDate: string,
  referenceDate: string,
  graceDays = 0
): number {
  const diff = daysBetween(dueDate, referenceDate);
  if (diff <= 0) return 0;
  return Math.max(0, diff - Math.max(0, graceDays));
}

/**
 * Multa + juros de uma parcela em atraso.
 *
 * - **Multa:** percentual único sobre o principal, incide uma vez.
 * - **Juros:** taxa mensal dividida por 30 e multiplicada pelos dias de atraso
 *   (pro rata die), sobre o principal — juros SIMPLES, não compostos, que é o
 *   praticado em cobrança de mensalidade/parcela no varejo.
 *
 * Em dia (ou dentro da carência) devolve tudo zero e o total igual ao principal.
 */
export function computeLateCharges(input: {
  principalCents: number;
  dueDate: string;
  referenceDate: string;
  terms: LateFeeTerms;
}): LateCharges {
  const { principalCents, dueDate, referenceDate, terms } = input;
  const mode = terms.roundingMode ?? "half_up";
  const principal = Math.max(0, Math.round(principalCents));
  const late = daysLate(dueDate, referenceDate, terms.graceDays);

  if (late <= 0 || principal <= 0) {
    return {
      daysLate: 0,
      lateFeeCents: 0,
      interestCents: 0,
      totalCents: principal,
    };
  }

  const lateFeeCents = percentOf(principal, terms.lateFeePercent, mode);
  const dailyRate = Math.max(0, terms.monthlyInterestPercent) / 30 / 100;
  const interestCents = roundCents(principal * dailyRate * late, mode);

  return {
    daysLate: late,
    lateFeeCents,
    interestCents,
    totalCents: principal + lateFeeCents + interestCents,
  };
}

/** Rótulo curto do atraso para as telas ("3 dias em atraso"). */
export function lateLabel(days: number): string {
  if (days <= 0) return "Em dia";
  return days === 1 ? "1 dia em atraso" : `${days} dias em atraso`;
}
