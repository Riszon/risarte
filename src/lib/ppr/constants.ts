// Programa de Prevenção Riso+ (PPR+) — constantes compartilhadas.
// Espelham os check constraints da migração 0162. Ver docs/PPR.md.

import type { UserRole } from "@/lib/roles";

/** Situação da adesão (o cliente só usa benefícios quando está "ativo"). */
export const PPR_STATUSES = [
  "aguardando_ativacao",
  "ativo",
  "suspenso",
  "cancelado",
] as const;
export type PprStatus = (typeof PPR_STATUSES)[number];

export const PPR_STATUS_LABELS: Record<PprStatus, string> = {
  aguardando_ativacao: "Aguardando ativação",
  ativo: "Ativo",
  suspenso: "Suspenso",
  cancelado: "Cancelado",
};

/** Papel do beneficiário dentro da adesão. */
export const PPR_ROLES = ["titular", "dependente"] as const;
export type PprRole = (typeof PPR_ROLES)[number];

export const PPR_ROLE_LABELS: Record<PprRole, string> = {
  titular: "Titular",
  dependente: "Dependente",
};

/** Grau de parentesco sugerido para o dependente (campo livre no fim). */
export const PPR_RELATIONSHIPS = [
  "Cônjuge",
  "Filho(a)",
  "Pai",
  "Mãe",
  "Irmão(ã)",
  "Avô/Avó",
  "Neto(a)",
  "Outro",
] as const;

/** Formas de pagamento da MENSALIDADE — só recorrentes (docs/PPR.md §4). */
export const PPR_RECURRING_METHODS = [
  "credito_recorrente",
  "debito_recorrente",
  "pix_recorrente",
] as const;
export type PprRecurringMethod = (typeof PPR_RECURRING_METHODS)[number];

export const PPR_RECURRING_METHOD_LABELS: Record<PprRecurringMethod, string> = {
  credito_recorrente: "Cartão de crédito recorrente",
  debito_recorrente: "Débito recorrente",
  pix_recorrente: "PIX recorrente",
};

/** Cobertura do benefício em cada procedimento. */
export const PPR_BENEFIT_TYPES = ["free", "percent", "none"] as const;
export type PprBenefitType = (typeof PPR_BENEFIT_TYPES)[number];

export const PPR_BENEFIT_TYPE_LABELS: Record<PprBenefitType, string> = {
  free: "Sem custo (isento)",
  percent: "Desconto (%)",
  none: "Sem benefício",
};

/** Situação de cada mensalidade. */
export const PPR_CHARGE_STATUSES = [
  "em_aberto",
  "paga",
  "atrasada",
  "cancelada",
] as const;
export type PprChargeStatus = (typeof PPR_CHARGE_STATUSES)[number];

export const PPR_CHARGE_STATUS_LABELS: Record<PprChargeStatus, string> = {
  em_aberto: "Em aberto",
  paga: "Paga",
  atrasada: "Atrasada",
  cancelada: "Cancelada",
};

/** Por onde a adesão foi vendida. */
export const PPR_SALE_ORIGINS = ["comercial", "venda_direta"] as const;
export type PprSaleOrigin = (typeof PPR_SALE_ORIGINS)[number];

export const PPR_SALE_ORIGIN_LABELS: Record<PprSaleOrigin, string> = {
  comercial: "Fluxo comercial",
  venda_direta: "Venda direta na unidade",
};

// Quem vende o PPR+ (decisão 10 do dono, docs/PPR.md §14). A SDR NÃO vende.
export const PPR_SELLER_ROLES_COMERCIAL: UserRole[] = ["commercial_consultant"];
export const PPR_SELLER_ROLES_DIRETA: UserRole[] = [
  "receptionist",
  "unit_manager",
  "clinical_coordinator",
];
/** Quem cancela ou suspende uma adesão. */
export const PPR_MANAGER_ROLES: UserRole[] = ["unit_manager"];

/** Padrões de inadimplência da rede (configuráveis por unidade). */
export const PPR_DEFAULT_SUSPEND_DAYS = 30;
export const PPR_DEFAULT_CANCEL_DAYS = 90;
