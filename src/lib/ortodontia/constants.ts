// Ortodontia — constantes compartilhadas. Espelham os check constraints da
// migração 0329. Ver docs/ortodontia/ORTO-PLANO.md.

import type { UserRole } from "@/lib/roles";

/** Situação do caso ortodôntico. */
export const ORTHO_STATUSES = [
  "aguardando_inicio",
  "em_tratamento",
  "contencao",
  "finalizado",
  "interrompido",
] as const;
export type OrthoStatus = (typeof ORTHO_STATUSES)[number];

/**
 * Decisão O1 (28/10/2026): entregar as contenções FINALIZA o tratamento; o
 * caso segue em ACOMPANHAMENTO (`contencao`) até a alta (`finalizado`).
 */
export const ORTHO_STATUS_LABELS: Record<OrthoStatus, string> = {
  aguardando_inicio: "Aguardando início",
  em_tratamento: "Em tratamento",
  contencao: "Em acompanhamento",
  finalizado: "Alta",
  interrompido: "Interrompido",
};

/** Uma linha a mais para quem precisa entender a situação. */
export const ORTHO_STATUS_HINTS: Record<OrthoStatus, string> = {
  aguardando_inicio: "caso aberto, aparelho ainda não instalado",
  em_tratamento: "aparelho instalado; a mensalidade é cobrada",
  contencao: "contenções entregues: tratamento finalizado, sem mensalidade",
  finalizado: "acompanhamento encerrado",
  interrompido: "desistência, transferência ou abandono",
};

/** Os casos cujo tratamento está FINALIZADO (contenções entregues ou alta). */
export const ORTHO_FINISHED_STATUSES: OrthoStatus[] = ["contencao", "finalizado"];

/** Os casos que ainda contam como "paciente de ortodontia" da unidade. */
export const ORTHO_OPEN_STATUSES: OrthoStatus[] = [
  "aguardando_inicio",
  "em_tratamento",
  "contencao",
];

/** Tipo de tratamento. */
export const ORTHO_KINDS = [
  "aparelho_fixo",
  "alinhadores",
  "aparelho_removivel",
  "contencao",
  "outro",
] as const;
export type OrthoKind = (typeof ORTHO_KINDS)[number];

export const ORTHO_KIND_LABELS: Record<OrthoKind, string> = {
  aparelho_fixo: "Aparelho fixo",
  alinhadores: "Alinhadores",
  aparelho_removivel: "Aparelho removível",
  contencao: "Contenção",
  outro: "Outro",
};

/**
 * Tipo de contenção FINAL, definido pelo Planner na proposta ortodôntica da
 * opção do plano (0333, R5). Espelha o check de `treatment_plan_ortho`.
 */
export const ORTHO_RETAINER_KINDS = ["placa_removivel", "fixa_colada", "ambas", "a_definir"] as const;
export type OrthoRetainerKind = (typeof ORTHO_RETAINER_KINDS)[number];

export const ORTHO_RETAINER_KIND_LABELS: Record<OrthoRetainerKind, string> = {
  placa_removivel: "Placa removível",
  fixa_colada: "Contenção fixa (colada)",
  ambas: "Placa + fixa",
  a_definir: "A definir no fim do tratamento",
};

/** Situação de cada manutenção do cronograma. */
export const ORTHO_MAINTENANCE_STATUSES = [
  "prevista",
  "agendada",
  "realizada",
  "faltou",
  "cancelada",
] as const;
export type OrthoMaintenanceStatus = (typeof ORTHO_MAINTENANCE_STATUSES)[number];

export const ORTHO_MAINTENANCE_STATUS_LABELS: Record<OrthoMaintenanceStatus, string> = {
  prevista: "Prevista",
  agendada: "Agendada",
  realizada: "Realizada",
  faltou: "Faltou",
  cancelada: "Cancelada",
};

/** Situação de cada mensalidade. */
export const ORTHO_CHARGE_STATUSES = [
  "em_aberto",
  "paga",
  "atrasada",
  "cancelada",
] as const;
export type OrthoChargeStatus = (typeof ORTHO_CHARGE_STATUSES)[number];

export const ORTHO_CHARGE_STATUS_LABELS: Record<OrthoChargeStatus, string> = {
  em_aberto: "Em aberto",
  paga: "Paga",
  atrasada: "Atrasada",
  cancelada: "Cancelada",
};

/** O que a cobrança é: a mensalidade do mês ou a contenção entregue (O1). */
export const ORTHO_CHARGE_KINDS = ["mensalidade", "contencao"] as const;
export type OrthoChargeKind = (typeof ORTHO_CHARGE_KINDS)[number];

export const ORTHO_CHARGE_KIND_LABELS: Record<OrthoChargeKind, string> = {
  mensalidade: "Mensalidade",
  contencao: "Contenção",
};

/** Formas de pagamento da mensalidade (as mesmas do comercial + dinheiro). */
export const ORTHO_PAYMENT_METHODS = [
  "pix",
  "boleto",
  "cartao",
  "credito_recorrente",
  "dinheiro",
] as const;
export type OrthoPaymentMethod = (typeof ORTHO_PAYMENT_METHODS)[number];

export const ORTHO_PAYMENT_METHOD_LABELS: Record<OrthoPaymentMethod, string> = {
  pix: "PIX",
  boleto: "Boleto",
  cartao: "Cartão",
  credito_recorrente: "Cartão recorrente",
  dinheiro: "Dinheiro",
};

/** Conta do plano de contas que recebe a mensalidade (0329). */
export const ORTHO_REVENUE_ACCOUNT = "1.1.04";

/** Quem gere o caso (abre, edita, inicia, finaliza) — espelho de `ortho_can_manage`. */
export const ORTHO_MANAGER_ROLES: UserRole[] = ["unit_manager", "clinical_coordinator"];
/** Quem registra a manutenção e a evolução — espelho de `ortho_can_evolve`. */
export const ORTHO_CLINICAL_ROLES: UserRole[] = ["dentist", "clinical_coordinator"];
/**
 * Quem dá baixa na mensalidade NA UNIDADE — espelho de `ortho_can_settle`
 * (decisão O2, 28/10/2026: Gerente e Financeiro; a Recepção só vê).
 */
export const ORTHO_SETTLE_ROLES: UserRole[] = ["unit_manager"];
/**
 * Quem VÊ a situação financeira sem dar baixa — espelho de `ortho_can_see_money`
 * (0332): a Recepção e o Franqueado (O2, para ajudar) e o Coordenador (Q8,
 * 28/10/2026). O dentista fica de fora (R13): o banco nem lhe devolve o valor.
 */
export const ORTHO_MONEY_VIEW_ROLES: UserRole[] = [
  "unit_manager",
  "clinical_coordinator",
  "receptionist",
  "franchisee",
];

/** Padrões da rede quando ninguém configurou nada. */
export const ORTHO_DEFAULTS = {
  plannedMonths: 24,
  maintenanceIntervalDays: 30,
  reevaluationIntervalMonths: 6,
  finishToleranceDays: 30,
  billingDay: 10,
  retainerChargeEnabled: false,
  retainerFeeCents: 0,
} as const;
