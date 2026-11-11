/**
 * AS TARIFAS DO ASAAS → as linhas de `acquirer_rates`.
 *
 * `GET /v3/myAccount/fees` devolve a tabela de tarifas da conta. Esta conversão
 * é PURA (tem teste): recebe a resposta e devolve a lista que a função do
 * banco `_gateway_sync_fees` (4001) grava, com vigência.
 *
 * TARIFA PROMOCIONAL: o Asaas dá tarifa menor por um período (conta nova).
 * Quando há promoção com data de fim no futuro, saem DUAS linhas: a
 * promocional, valendo até o fim; e a cheia, valendo do dia seguinte em
 * diante. Assim a tarifa certa de cada dia já está cadastrada — e a
 * compensação do split (ASA3) não erra quando a promoção acaba.
 *
 * Dinheiro em CENTAVOS. O Asaas manda reais com decimais.
 */

export type AsaasFeesResponse = {
  payment?: {
    bankSlip?: {
      defaultValue?: number | null;
      discountValue?: number | null;
      expirationDate?: string | null;
      daysToReceive?: number | null;
    } | null;
    creditCard?: {
      operationValue?: number | null;
      oneInstallmentPercentage?: number | null;
      upToSixInstallmentsPercentage?: number | null;
      upToTwelveInstallmentsPercentage?: number | null;
      upToTwentyOneInstallmentsPercentage?: number | null;
      discountOneInstallmentPercentage?: number | null;
      discountUpToSixInstallmentsPercentage?: number | null;
      discountUpToTwelveInstallmentsPercentage?: number | null;
      discountUpToTwentyOneInstallmentsPercentage?: number | null;
      discountExpiration?: string | null;
      daysToReceive?: number | null;
    } | null;
    debitCard?: {
      operationValue?: number | null;
      defaultPercentage?: number | null;
      daysToReceive?: number | null;
    } | null;
    pix?: {
      fixedFeeValue?: number | null;
      fixedFeeValueWithDiscount?: number | null;
      percentageFee?: number | null;
      minimumFeeValue?: number | null;
      maximumFeeValue?: number | null;
      discountExpiration?: string | null;
      monthlyCreditsWithoutFee?: number | null;
    } | null;
  } | null;
  notification?: {
    phoneCallFeeValue?: number | null;
    whatsAppFeeValue?: number | null;
    messagingFeeValue?: number | null;
  } | null;
};

export type GatewayRate = {
  modality: "boleto" | "pix" | "debito" | "credito_avista" | "credito_parcelado";
  min_installments: number;
  max_installments: number;
  fee_percent: number;
  fixed_fee_cents: number;
  min_fee_cents: number | null;
  max_fee_cents: number | null;
  settlement_days: number;
  free_monthly_count: number | null;
  /** `YYYY-MM-DD`; nulo = a partir de hoje. */
  valid_from: string | null;
  /** `YYYY-MM-DD`; nulo = sem fim. */
  valid_to: string | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cents = (v: unknown): number => Math.round((num(v) ?? 0) * 100);
const centsOrNull = (v: unknown): number | null => {
  const n = num(v);
  return n === null || n <= 0 ? null : Math.round(n * 100);
};
/** Percentual com 3 casas (o que a coluna guarda). */
const pct = (v: unknown): number => Math.round((num(v) ?? 0) * 1000) / 1000;
const days = (v: unknown): number => Math.max(0, Math.round(num(v) ?? 0));

/** A data (`YYYY-MM-DD`) de um carimbo do Asaas, ou nulo. Não converte fuso: o dia que veio escrito. */
export function diaDoAsaas(v: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((v ?? "").trim());
  return m ? m[1] : null;
}

function diaSeguinte(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

type Base = Omit<GatewayRate, "valid_from" | "valid_to">;

/**
 * Uma tarifa com possível promoção. `promo` só vale quando é DIFERENTE da
 * cheia e a data de fim é hoje ou depois (`hoje` no formato `YYYY-MM-DD`).
 */
function comPromocao(cheia: Base, promo: Base | null, fim: string | null, hoje: string): GatewayRate[] {
  const igual =
    !promo || (promo.fee_percent === cheia.fee_percent && promo.fixed_fee_cents === cheia.fixed_fee_cents);
  if (igual || !fim || fim < hoje) {
    return [{ ...cheia, valid_from: null, valid_to: null }];
  }
  return [
    { ...promo!, valid_from: null, valid_to: fim },
    { ...cheia, valid_from: diaSeguinte(fim), valid_to: null },
  ];
}

/**
 * A conversão. `hoje` = o dia no Brasil (`YYYY-MM-DD`).
 * Meio de pagamento que a resposta não traz simplesmente não entra.
 */
export function ratesFromAsaasFees(fees: AsaasFeesResponse | null | undefined, hoje: string): GatewayRate[] {
  const p = fees?.payment;
  if (!p) return [];
  const out: GatewayRate[] = [];

  // ---- Boleto: valor fixo por cobrança paga --------------------------------
  if (p.bankSlip && num(p.bankSlip.defaultValue) !== null) {
    const b = p.bankSlip;
    const cheia: Base = {
      modality: "boleto", min_installments: 1, max_installments: 1,
      fee_percent: 0, fixed_fee_cents: cents(b.defaultValue),
      min_fee_cents: null, max_fee_cents: null,
      settlement_days: days(b.daysToReceive), free_monthly_count: null,
    };
    const promo = num(b.discountValue) !== null ? { ...cheia, fixed_fee_cents: cents(b.discountValue) } : null;
    out.push(...comPromocao(cheia, promo, diaDoAsaas(b.expirationDate), hoje));
  }

  // ---- PIX: fixo OU percentual com piso e teto ------------------------------
  if (p.pix && (num(p.pix.fixedFeeValue) !== null || (num(p.pix.percentageFee) ?? 0) > 0)) {
    const x = p.pix;
    const percentual = (num(x.percentageFee) ?? 0) > 0;
    const gratis = num(x.monthlyCreditsWithoutFee);
    const cheia: Base = {
      modality: "pix", min_installments: 1, max_installments: 1,
      fee_percent: percentual ? pct(x.percentageFee) : 0,
      fixed_fee_cents: percentual ? 0 : cents(x.fixedFeeValue),
      min_fee_cents: percentual ? centsOrNull(x.minimumFeeValue) : null,
      max_fee_cents: percentual ? centsOrNull(x.maximumFeeValue) : null,
      settlement_days: 0,
      free_monthly_count: gratis !== null && gratis > 0 ? Math.round(gratis) : null,
    };
    const promo =
      !percentual && num(x.fixedFeeValueWithDiscount) !== null
        ? { ...cheia, fixed_fee_cents: cents(x.fixedFeeValueWithDiscount) }
        : null;
    out.push(...comPromocao(cheia, promo, diaDoAsaas(x.discountExpiration), hoje));
  }

  // ---- Débito ----------------------------------------------------------------
  if (p.debitCard && num(p.debitCard.defaultPercentage) !== null) {
    const d = p.debitCard;
    out.push({
      modality: "debito", min_installments: 1, max_installments: 1,
      fee_percent: pct(d.defaultPercentage), fixed_fee_cents: cents(d.operationValue),
      min_fee_cents: null, max_fee_cents: null,
      settlement_days: days(d.daysToReceive), free_monthly_count: null,
      valid_from: null, valid_to: null,
    });
  }

  // ---- Crédito: fixo por cobrança + percentual pela faixa de parcelas --------
  if (p.creditCard) {
    const c = p.creditCard;
    const fim = diaDoAsaas(c.discountExpiration);
    const faixas: Array<{
      modality: "credito_avista" | "credito_parcelado";
      de: number; ate: number; cheia: unknown; promo: unknown;
    }> = [
      { modality: "credito_avista", de: 1, ate: 1, cheia: c.oneInstallmentPercentage, promo: c.discountOneInstallmentPercentage },
      { modality: "credito_parcelado", de: 2, ate: 6, cheia: c.upToSixInstallmentsPercentage, promo: c.discountUpToSixInstallmentsPercentage },
      { modality: "credito_parcelado", de: 7, ate: 12, cheia: c.upToTwelveInstallmentsPercentage, promo: c.discountUpToTwelveInstallmentsPercentage },
      { modality: "credito_parcelado", de: 13, ate: 21, cheia: c.upToTwentyOneInstallmentsPercentage, promo: c.discountUpToTwentyOneInstallmentsPercentage },
    ];
    for (const f of faixas) {
      if (num(f.cheia) === null) continue;
      const cheia: Base = {
        modality: f.modality, min_installments: f.de, max_installments: f.ate,
        fee_percent: pct(f.cheia), fixed_fee_cents: cents(c.operationValue),
        min_fee_cents: null, max_fee_cents: null,
        settlement_days: days(c.daysToReceive), free_monthly_count: null,
      };
      const promo = num(f.promo) !== null ? { ...cheia, fee_percent: pct(f.promo) } : null;
      out.push(...comPromocao(cheia, promo, fim, hoje));
    }
  }

  return out;
}
