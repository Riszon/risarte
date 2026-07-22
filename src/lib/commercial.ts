// Módulo Comercial (Fase 4) — tipos e regras puras da negociação.
// Dinheiro SEMPRE em centavos (inteiro). Ver docs/COMERCIAL.md.

// Meios de pagamento aceitos na rede. Devem casar com o check constraint de
// plan_negotiations.payment_method e com commercial_rules.allowed_methods.
export const PAYMENT_METHODS = [
  "pix",
  "boleto",
  "cartao",
  "cartao_parcelado",
  "credito_recorrente",
  "deposito_avista",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: "PIX",
  boleto: "Boleto",
  cartao: "Cartão",
  cartao_parcelado: "Cartão de crédito parcelado",
  credito_recorrente: "Crédito recorrente",
  deposito_avista: "Depósito à vista",
};

// Situações da negociação (COM1; kanban/follow-up ampliam depois).
export const NEGOTIATION_STATUSES = [
  "em_negociacao",
  "aguardando_autorizacao",
  "aceita",
  "devolvida",
  "perdida",
] as const;

export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number];

export const NEGOTIATION_STATUS_LABELS: Record<NegotiationStatus, string> = {
  em_negociacao: "Em negociação",
  aguardando_autorizacao: "Aguardando autorização da unidade",
  aceita: "Aceita pelo cliente",
  devolvida: "Devolvida ao planejamento",
  perdida: "Perdida",
};

/** Linha da tabela commercial_rules (cascata: clinic_id null = padrão da rede). */
export type CommercialRuleRow = {
  clinic_id: string | null;
  max_discount_percent: number | null;
  max_installments: number | null;
  allowed_methods: string[] | null;
};

/** Regra comercial efetiva para uma unidade (campo a campo: unidade > rede). */
export type CommercialRule = {
  maxDiscountPercent: number | null;
  maxInstallments: number | null;
  allowedMethods: PaymentMethod[] | null;
};

export function resolveCommercialRule(
  rows: CommercialRuleRow[],
  clinicId: string | null
): CommercialRule {
  const unit = clinicId
    ? rows.find((r) => r.clinic_id === clinicId)
    : undefined;
  const network = rows.find((r) => r.clinic_id === null);
  const methods = unit?.allowed_methods ?? network?.allowed_methods ?? null;
  return {
    maxDiscountPercent:
      unit?.max_discount_percent ?? network?.max_discount_percent ?? null,
    maxInstallments:
      unit?.max_installments ?? network?.max_installments ?? null,
    allowedMethods: methods
      ? methods.filter((m): m is PaymentMethod =>
          (PAYMENT_METHODS as readonly string[]).includes(m)
        )
      : null,
  };
}

/** Desconto efetivo (%) de uma negociação: ajuste negativo sobre o subtotal. */
export function discountPercentOf(
  subtotalCents: number,
  adjustmentCents: number
): number {
  if (subtotalCents <= 0 || adjustmentCents >= 0) return 0;
  return (-adjustmentCents / subtotalCents) * 100;
}

/**
 * Violações da negociação contra a regra comercial efetiva. Vazio = dentro da
 * regra. Mensagens em pt-BR (mostradas ao consultor e ao gerente).
 */
export function negotiationViolations(
  input: {
    subtotalCents: number;
    adjustmentCents: number;
    installments: number;
    paymentMethod: PaymentMethod | null;
  },
  rule: CommercialRule
): string[] {
  const violations: string[] = [];
  const discount = discountPercentOf(input.subtotalCents, input.adjustmentCents);
  if (
    rule.maxDiscountPercent !== null &&
    discount > rule.maxDiscountPercent + 1e-9
  ) {
    violations.push(
      `Desconto de ${discount.toFixed(1)}% acima do máximo permitido (${rule.maxDiscountPercent}%)`
    );
  }
  if (
    rule.maxInstallments !== null &&
    input.installments > rule.maxInstallments
  ) {
    violations.push(
      `Parcelamento em ${input.installments}x acima do máximo permitido (${rule.maxInstallments}x)`
    );
  }
  if (
    input.paymentMethod &&
    rule.allowedMethods !== null &&
    !rule.allowedMethods.includes(input.paymentMethod)
  ) {
    violations.push(
      `Meio de pagamento "${PAYMENT_METHOD_LABELS[input.paymentMethod]}" não permitido pela regra comercial`
    );
  }
  return violations;
}

/** Nota GUT (G×U×T, 1..125) de um item — null quando não priorizado. */
export function gutScore(
  g: number | null | undefined,
  u: number | null | undefined,
  t: number | null | undefined
): number | null {
  if (!g || !u || !t) return null;
  return g * u * t;
}
