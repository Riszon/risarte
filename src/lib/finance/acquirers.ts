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

/**
 * Quando o custo do meio de pagamento nasce.
 *
 * `pagamento` — a taxa sai do que entra na baixa: não pagou, não custou.
 * `emissao` — o custo nasce quando o documento é gerado, **pago ou não**. É
 * assim que o banco cobra o boleto, e sem isso boleto emitido e não pago fica
 * com custo zero no resultado (mentira).
 */
export const FEE_CHARGE_MOMENTS = ["pagamento", "emissao"] as const;
export type FeeChargeMoment = (typeof FEE_CHARGE_MOMENTS)[number];

export const FEE_CHARGE_MOMENT_LABELS: Record<FeeChargeMoment, string> = {
  pagamento: "No pagamento",
  emissao: "Na emissão",
};

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
  feeChargedOn: FeeChargeMoment;
  validFrom: string;
  validTo: string | null;
};

/**
 * Abrangência do cadastro. A franqueadora negocia uma tabela com a adquirente
 * para a rede inteira; recadastrar a mesma coisa em 200 unidades só multiplica
 * erro de digitação — e erro de digitação aqui vira caixa errado.
 */
export const ACQUIRER_SCOPES = ["unidade", "rede", "unidades"] as const;
export type AcquirerScope = (typeof ACQUIRER_SCOPES)[number];

export const ACQUIRER_SCOPE_LABELS: Record<AcquirerScope, string> = {
  unidade: "Só esta unidade",
  rede: "Toda a rede",
  unidades: "Unidades específicas",
};

export type AcquirerScopeShape = {
  id: string;
  /** Nulo quando o cadastro é da franqueadora (rede ou unidades específicas). */
  clinicId: string | null;
  scope: AcquirerScope;
  isDefault: boolean;
  active: boolean;
  name: string;
  /** Unidades atendidas quando o escopo é `unidades`. */
  clinicIds?: string[];
};

/** A adquirente atende esta unidade? Espelha `acquirer_applies_to` no banco. */
export function acquirerAppliesTo(
  acquirer: AcquirerScopeShape,
  clinicId: string
): boolean {
  if (acquirer.clinicId === clinicId) return true;
  if (acquirer.scope === "rede") return true;
  if (acquirer.scope === "unidades") {
    return (acquirer.clinicIds ?? []).includes(clinicId);
  }
  return false;
}

/**
 * Qual adquirente o sistema usa sozinho numa venda desta unidade.
 *
 * Ordem: padrão da própria unidade → outra da unidade → padrão da rede →
 * qualquer uma que atenda. **O cadastro próprio ganha da rede** porque quem
 * tem contrato próprio é quem paga aquela taxa.
 */
export function pickAcquirer<T extends AcquirerScopeShape>(
  acquirers: T[],
  clinicId: string
): T | null {
  const usable = acquirers.filter(
    (a) => a.active && acquirerAppliesTo(a, clinicId)
  );
  const score = (a: T) => (a.clinicId !== null ? 2 : 0) + (a.isDefault ? 1 : 0);
  const sorted = [...usable].sort(
    (a, b) => score(b) - score(a) || a.name.localeCompare(b.name, "pt-BR")
  );
  return sorted[0] ?? null;
}

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
  /** O custo desta faixa nasce na emissão do documento, não no recebimento. */
  chargedAtIssue: boolean;
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
      | "fixedFeeCents"
      | "settlementBusinessDays"
      | "freeMonthlyCount"
      | "feeChargedOn"
    >
  >;

/**
 * A BAIXA cobra a taxa desta cobrança?
 *
 * Trava de dupla cobrança, e é a razão de ela morar aqui e no banco: se a
 * faixa diz "emissão", a baixa **nunca** cobra — nem quando a emissão não foi
 * registrada. Deixar de lançar um custo é erro menor que lançar o mesmo custo
 * duas vezes, e é isso que protege o dia em que o ASAAS emitir sozinho.
 */
export function chargesFeeAtReceipt(input: {
  rate: Pick<RateShape, "feeChargedOn">;
  alreadyIssued?: boolean;
}): boolean {
  if (input.alreadyIssued) return false;
  return (input.rate.feeChargedOn ?? "pagamento") !== "emissao";
}

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
    chargedAtIssue: (input.rate.feeChargedOn ?? "pagamento") === "emissao",
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
  modality?: CardModality;
  feeChargedOn?: FeeChargeMoment;
}): string[] {
  const errors: string[] = [];
  // "Na emissão" só faz sentido onde existe um documento a gerar. No cartão a
  // adquirente cobra sobre a transação — não há o que emitir.
  if (
    input.feeChargedOn === "emissao" &&
    input.modality !== undefined &&
    input.modality !== "boleto" &&
    input.modality !== "pix"
  ) {
    errors.push(
      "Cobrança na emissão só vale para boleto e PIX — no cartão não há documento a emitir."
    );
  }
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
