// FIN4b — adquirentes: taxa do cartão e liquidação D+n.
//
// Dois erros que o sistema cometia com cartão e que estas regras corrigem:
// o VALOR (a adquirente desconta a taxa — entra menos) e a DATA (o dinheiro
// não cai no vencimento, cai em D+1 no débito e D+30 no crédito).
//
// A taxa é despesa da UNIDADE (decisão do dono, 7.5 do briefing): se a
// franqueadora absorvesse, a unidade não teria incentivo para negociar com a
// adquirente nem para puxar o cliente para o PIX.

import { roundHalfUp } from "./money";
import { daysBetween } from "./late-fees";

export const CARD_MODALITIES = [
  "debito",
  "credito_avista",
  "credito_parcelado",
  "recorrente",
] as const;
export type CardModality = (typeof CARD_MODALITIES)[number];

export const CARD_MODALITY_LABELS: Record<CardModality, string> = {
  debito: "Débito",
  credito_avista: "Crédito à vista",
  credito_parcelado: "Crédito parcelado",
  recorrente: "Recorrência no cartão",
};

export type AcquirerRate = {
  id: string;
  acquirerId: string;
  modality: CardModality;
  minInstallments: number;
  maxInstallments: number;
  feePercent: number;
  settlementDays: number;
  validFrom: string;
  validTo: string | null;
};

/**
 * A taxa vigente NA DATA pedida, para a faixa de parcelas.
 *
 * Vigência importa: renegociar a taxa com a adquirente não pode reescrever o
 * que já foi recebido — mesma lógica das taxas congeladas da parcela.
 */
export function resolveRate(
  rates: AcquirerRate[],
  input: {
    acquirerId: string;
    modality: CardModality;
    installments: number;
    date: string;
  }
): AcquirerRate | null {
  const n = Math.max(1, Math.floor(input.installments));
  const applicable = rates
    .filter(
      (r) =>
        r.acquirerId === input.acquirerId &&
        r.modality === input.modality &&
        n >= r.minInstallments &&
        n <= r.maxInstallments &&
        r.validFrom <= input.date &&
        (r.validTo === null || r.validTo >= input.date)
    )
    // Entre as vigentes, a mais recente manda.
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return applicable[0] ?? null;
}

export type AcquirerSettlement = {
  grossCents: number;
  feeCents: number;
  /** O que de fato entra na conta da clínica. */
  netCents: number;
  feePercent: number;
  settlementDays: number;
  /** Quando o dinheiro cai. */
  settlementDate: string;
};

/** Data + N dias, em YYYY-MM-DD (sem fuso). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * O que a clínica realmente recebe. O cliente paga o BRUTO (é isso que quita a
 * dívida dele); a diferença é despesa financeira da unidade.
 */
export function computeSettlement(input: {
  grossCents: number;
  rate: Pick<AcquirerRate, "feePercent" | "settlementDays">;
  paidAt: string;
}): AcquirerSettlement {
  const gross = Math.max(0, Math.round(input.grossCents));
  const feeCents = roundHalfUp((gross * input.rate.feePercent) / 100);
  return {
    grossCents: gross,
    feeCents,
    netCents: gross - feeCents,
    feePercent: input.rate.feePercent,
    settlementDays: input.rate.settlementDays,
    settlementDate: addDays(input.paidAt, input.rate.settlementDays),
  };
}

/** A modalidade a partir do meio de pagamento da venda (espelha o banco). */
export function modalityOf(
  paymentMethod: string | null,
  installments: number
): CardModality | null {
  if (paymentMethod === "credito_recorrente") return "recorrente";
  if (paymentMethod === "cartao_parcelado") return "credito_parcelado";
  if (paymentMethod === "cartao") {
    return installments > 1 ? "credito_parcelado" : "credito_avista";
  }
  return null;
}

/** Quantos dias o dinheiro leva para chegar — para a tela avisar. */
export function daysUntilSettlement(
  paidAt: string,
  settlementDate: string
): number {
  return Math.max(0, daysBetween(paidAt, settlementDate));
}

/** Erros que impedem salvar uma faixa de taxa. Vazio = pode salvar. */
export function rateErrors(input: {
  feePercent: number;
  settlementDays: number;
  minInstallments: number;
  maxInstallments: number;
}): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.feePercent) || input.feePercent < 0) {
    errors.push("Informe a taxa (pode ser zero).");
  }
  if (input.feePercent > 30) {
    errors.push("Taxa acima de 30% — confira se não digitou errado.");
  }
  if (!Number.isInteger(input.settlementDays) || input.settlementDays < 0) {
    errors.push("O prazo de liquidação é um número de dias.");
  }
  if (input.minInstallments < 1 || input.maxInstallments < 1) {
    errors.push("A faixa de parcelas começa em 1.");
  }
  if (input.maxInstallments < input.minInstallments) {
    errors.push("A faixa de parcelas está invertida.");
  }
  return errors;
}
