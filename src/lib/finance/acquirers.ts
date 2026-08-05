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
  "boleto",
  "pix",
  "debito",
  "credito_avista",
  "credito_parcelado",
  "cartao_voucher",
  "recorrente",
] as const;
export type CardModality = (typeof CARD_MODALITIES)[number];

export const CARD_MODALITY_LABELS: Record<CardModality, string> = {
  boleto: "Boleto bancário",
  pix: "PIX",
  debito: "Cartão de débito",
  credito_avista: "Crédito à vista",
  credito_parcelado: "Crédito parcelado",
  cartao_voucher: "Cartão voucher",
  recorrente: "Recorrência no cartão",
};

/** Só o crédito parcelado tem faixa de parcelas; o resto é 1×. */
export function hasInstallmentRange(modality: CardModality): boolean {
  return modality === "credito_parcelado";
}

export type AcquirerRate = {
  id: string;
  acquirerId: string;
  modality: CardModality;
  minInstallments: number;
  maxInstallments: number;
  /** Parte percentual ("2,39%"). */
  feePercent: number;
  /** Parte fixa por transação ("+ R$ 0,29", "R$ 1,99 por boleto"). */
  fixedFeeCents: number;
  settlementDays: number;
  /** "1 dia útil" × "32 dias". */
  settlementBusinessDays: boolean;
  /** "100 recebimentos gratuitos por mês". Nulo = sem franquia. */
  freeMonthlyCount: number | null;
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
  /** Parte percentual da taxa. */
  percentFeeCents: number;
  /** Parte fixa cobrada (zero quando caiu na franquia do mês). */
  fixedFeeCents: number;
  feeCents: number;
  /** O que de fato entra na conta da clínica. */
  netCents: number;
  feePercent: number;
  /** A taxa fixa foi dispensada pela franquia mensal. */
  waived: boolean;
  settlementDays: number;
  /** Quando o dinheiro cai. */
  settlementDate: string;
};

/** Data + N dias corridos, em YYYY-MM-DD (sem fuso). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Data + N dias ÚTEIS, pulando sábado e domingo.
 *
 * **Feriado não é considerado** — o sistema não tem calendário de feriados, e
 * inventar um daria data errada em janeiro e no carnaval. A projeção sai
 * otimista nesses meses; está registrado como pendência.
 */
export function addBusinessDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    const dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return dt.toISOString().slice(0, 10);
}

/** Faixa sem taxa fixa, sem franquia ou em dias corridos é o caso comum. */
type RateShape = Pick<AcquirerRate, "feePercent" | "settlementDays"> &
  Partial<
    Pick<
      AcquirerRate,
      "fixedFeeCents" | "settlementBusinessDays" | "freeMonthlyCount"
    >
  >;

/**
 * O que a clínica realmente recebe. O cliente paga o BRUTO (é isso que quita a
 * dívida dele); a diferença é despesa financeira da unidade.
 *
 * A taxa é **percentual + fixa** — numa cobrança pequena a parte fixa pesa
 * mais que o percentual, e ignorá-la subestima o custo do meio de pagamento
 * (foi o que a tabela real do Asaas mostrou, 05/08/2026).
 *
 * `usedThisMonth` é quantas transações desta modalidade já entraram no mês:
 * enquanto couber na franquia, a parte fixa é dispensada.
 */
export function computeSettlement(input: {
  grossCents: number;
  rate: RateShape;
  paidAt: string;
  usedThisMonth?: number;
}): AcquirerSettlement {
  const gross = Math.max(0, Math.round(input.grossCents));
  const percentFee = roundHalfUp((gross * input.rate.feePercent) / 100);

  const free = input.rate.freeMonthlyCount;
  const waived =
    free !== null && free !== undefined && (input.usedThisMonth ?? 0) < free;
  const fixed = waived ? 0 : Math.max(0, input.rate.fixedFeeCents ?? 0);
  const feeCents = percentFee + fixed;

  return {
    grossCents: gross,
    percentFeeCents: percentFee,
    fixedFeeCents: fixed,
    feeCents,
    netCents: gross - feeCents,
    feePercent: input.rate.feePercent,
    waived,
    settlementDays: input.rate.settlementDays,
    settlementDate: input.rate.settlementBusinessDays
      ? addBusinessDays(input.paidAt, input.rate.settlementDays)
      : addDays(input.paidAt, input.rate.settlementDays),
  };
}

/**
 * A modalidade a partir do meio de pagamento da venda (espelha o banco).
 * Boleto e PIX entram aqui desde a 0198: eles também têm custo.
 */
export function modalityOf(
  paymentMethod: string | null,
  installments: number
): CardModality | null {
  if (paymentMethod === "credito_recorrente") return "recorrente";
  if (paymentMethod === "cartao_parcelado") return "credito_parcelado";
  if (paymentMethod === "cartao") {
    return installments > 1 ? "credito_parcelado" : "credito_avista";
  }
  if (paymentMethod === "boleto") return "boleto";
  if (paymentMethod === "pix") return "pix";
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
  fixedFeeCents?: number;
  settlementDays: number;
  minInstallments: number;
  maxInstallments: number;
  freeMonthlyCount?: number | null;
}): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.feePercent) || input.feePercent < 0) {
    errors.push("Informe a taxa (pode ser zero).");
  }
  if ((input.fixedFeeCents ?? 0) < 0) {
    errors.push("A taxa fixa não pode ser negativa.");
  }
  // Taxa zerada NÃO é erro: PIX entre contas do mesmo banco costuma ser
  // gratuito de verdade. Bloquear aqui impediria o cadastro correto.
  if (
    input.freeMonthlyCount !== null &&
    input.freeMonthlyCount !== undefined &&
    (!Number.isInteger(input.freeMonthlyCount) || input.freeMonthlyCount < 1)
  ) {
    errors.push("A franquia mensal é um número inteiro de transações.");
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
