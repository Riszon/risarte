// Shared constants/types for the treatment plan (Centro de Planejamento, Fase 3).
// Kept out of the "use server" actions file (which may only export functions).

import type { BudgetItem } from "@/lib/pricing";

// Must stay in sync with the `treatment_plan_status` enum in the database.
export const TREATMENT_PLAN_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "returned",
] as const;

export type TreatmentPlanStatus = (typeof TREATMENT_PLAN_STATUSES)[number];

export const PLAN_STATUS_LABELS: Record<TreatmentPlanStatus, string> = {
  draft: "Rascunho",
  submitted: "Aguardando aprovação",
  approved: "Aprovado",
  returned: "Devolvido para revisão",
};

export type PlanResult = { ok: boolean; error?: string };

// Per-option review by the Coordenador (F4). Must match option_review_status.
export const OPTION_REVIEW_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;
export type OptionReviewStatus = (typeof OPTION_REVIEW_STATUSES)[number];

export const OPTION_REVIEW_LABELS: Record<OptionReviewStatus, string> = {
  pending: "Aguardando avaliação",
  approved: "Aprovada",
  rejected: "Reprovada",
};

/** H4.5: uma etapa (fase) do tratamento dentro de uma opção do plano. */
export type PlanStage = {
  id: string;
  name: string;
  sortOrder: number;
};

/**
 * H4.5 Pedido 2: uma sessão PROJETADA de uma opção (antes de gerar de verdade),
 * com o "atendimento conjunto" (groupNo) definido pelo Planner. Usada na tela de
 * agrupamento do cockpit.
 */
export type ProjectedSession = {
  itemId: string;
  sessionIndex: number;
  procedureName: string;
  name: string;
  plannedMinutes: number | null;
  groupNo: number | null;
  /** H4.5: ordem do bloco na sequência do tratamento (null = ainda sem ordem). */
  blockOrder: number | null;
  /** H4.5: profissional efetivo (override da sessão ou o indicado no item). */
  providerId: string | null;
};

export type PlanOption = {
  id: string;
  isPrimary: boolean;
  title: string;
  description: string | null;
  sortOrder: number;
  /** Budget lines for this option (Etapa 5.2). */
  items: BudgetItem[];
  /** H4.5: etapas do tratamento desta opção (ordenadas). */
  stages: PlanStage[];
  /** Coordenador's per-option decision (F4). */
  reviewStatus: OptionReviewStatus;
  reviewNotes: string | null;
};

export type TreatmentPlan = {
  id: string;
  status: TreatmentPlanStatus;
  diagnosis: string | null;
  objectives: string | null;
  planningNotes: string | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  options: PlanOption[];
};
