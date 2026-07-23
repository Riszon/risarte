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

// ============================================================================
// COM3 — Kanban do Comercial + Follow-up
// ============================================================================

/** Etapas manuais do cartão (as demais colunas são derivadas no app). */
export const CARD_STAGES = [
  "a_apresentar",
  "acontecendo_agora",
  "apresentado",
  "follow_up",
  "follow_up_clinica",
  "cancelado",
  "perdido",
] as const;
export type CardStage = (typeof CARD_STAGES)[number];

/**
 * Todas as situações possíveis de um cliente no funil. As COLUNAS renderizadas
 * são só as 7 de BOARD_COLUMNS; "cancelado"/"perdido" viram botões de detalhe e
 * "follow_up_clinica" foi absorvido pela coluna Follow-up (indicador na clínica).
 */
export type CommercialColumn =
  | "a_apresentar"
  | "acontecendo_agora"
  | "apresentado"
  | "follow_up"
  | "fechamento"
  | "aguardando_iniciar"
  | "tratamento_iniciado"
  | "cancelado"
  | "perdido";

/** Colunas efetivamente renderizadas no kanban, na ordem do funil. */
export const BOARD_COLUMNS = [
  "a_apresentar",
  "acontecendo_agora",
  "apresentado",
  "follow_up",
  "fechamento",
  "aguardando_iniciar",
  "tratamento_iniciado",
] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const COMMERCIAL_COLUMN_LABELS: Record<CommercialColumn, string> = {
  a_apresentar: "A apresentar",
  acontecendo_agora: "Acontecendo agora",
  apresentado: "Apresentados",
  follow_up: "Follow-up",
  fechamento: "Fechamentos",
  aguardando_iniciar: "Aguardando iniciar tratamento",
  tratamento_iniciado: "Tratamento iniciado",
  cancelado: "Cancelado",
  perdido: "Perdido",
};

/** Cor de acento de cada coluna (padrão do dono: navy + destaques). */
export const COMMERCIAL_COLUMN_COLORS: Record<CommercialColumn, string> = {
  a_apresentar: "#64748b",
  acontecendo_agora: "#8b5cf6",
  apresentado: "#0ea5e9",
  follow_up: "#f59e0b",
  fechamento: "#10b981",
  aguardando_iniciar: "#f59e0b",
  tratamento_iniciado: "#00bf63",
  cancelado: "#94a3b8",
  perdido: "#ef4444",
};

/** Canais de contato do follow-up. */
export const FOLLOWUP_CHANNELS = [
  "whatsapp",
  "ligacao",
  "email",
  "presencial",
  "outro",
] as const;
export type FollowupChannel = (typeof FOLLOWUP_CHANNELS)[number];
export const FOLLOWUP_CHANNEL_LABELS: Record<FollowupChannel, string> = {
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  email: "E-mail",
  presencial: "Presencial",
  outro: "Outro",
};

/** Resultado de uma tentativa de follow-up. */
export const FOLLOWUP_OUTCOMES = [
  "sem_resposta",
  "reagendou",
  "vai_pensar",
  "recusou",
  "sem_interesse",
  "outro",
] as const;
export type FollowupOutcome = (typeof FOLLOWUP_OUTCOMES)[number];
export const FOLLOWUP_OUTCOME_LABELS: Record<FollowupOutcome, string> = {
  sem_resposta: "Sem resposta",
  reagendou: "Reagendou o contato",
  vai_pensar: "Vai pensar",
  recusou: "Recusou",
  sem_interesse: "Sem interesse",
  outro: "Outro",
};

/**
 * Deriva a coluna do kanban de um cliente a partir do estado do cartão + fase
 * da jornada + situação da negociação. Precedência do funil comercial.
 */
export function commercialColumnOf(input: {
  journeyPhase: string;
  journeyStatus: string | null;
  cardStage: CardStage | null;
  negotiationAccepted: boolean;
}): CommercialColumn {
  // Fase 5 (Início de Tratamento) tem colunas próprias.
  if (input.journeyPhase === "treatment_start") {
    return input.journeyStatus === "in_treatment"
      ? "tratamento_iniciado"
      : "aguardando_iniciar";
  }
  // Encerramentos manuais vêm primeiro (viram botões de detalhe, não colunas).
  if (input.cardStage === "cancelado") return "cancelado";
  if (input.cardStage === "perdido") return "perdido";
  // Negociação aceita = pronto para o fechamento (Assistente).
  if (input.negotiationAccepted) return "fechamento";
  // "follow_up_clinica" (legado) foi absorvido pela coluna Follow-up — o reforço
  // da clínica agora é um INDICADOR no cartão (followup_by_clinic), não coluna.
  if (input.cardStage === "follow_up" || input.cardStage === "follow_up_clinica")
    return "follow_up";
  if (input.cardStage === "acontecendo_agora") return "acontecendo_agora";
  if (input.cardStage === "apresentado") return "apresentado";
  return "a_apresentar";
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
