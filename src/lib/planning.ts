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

// -- Ciclo de vida do plano (Fase 2) ----------------------------------------
// A CONTINUAÇÃO da linha do tempo, depois que o Coordenador aprova. Só "liga"
// quando o plano está aprovado. Deve espelhar o enum treatment_plan_lifecycle.
export const PLAN_LIFECYCLES = [
  "aguardando_apresentacao",
  "apresentado",
  "aceito",
  "reprovado",
  "em_tratamento",
  "concluido",
  "cancelado",
  "suspenso",
] as const;
export type PlanLifecycle = (typeof PLAN_LIFECYCLES)[number];

/**
 * Estágio UNIFICADO do plano: uma única linha do tempo que junta o trilho
 * interno (status) com o ciclo de vida (lifecycle). É o que a interface mostra.
 */
export const PLAN_STAGES = [
  "em_planejamento",
  "aguardando_aprovacao",
  "em_revisao",
  "aprovado_coordenador",
  "aguardando_apresentacao",
  "apresentado",
  "aceito",
  "reprovado",
  "em_tratamento",
  "concluido",
  "cancelado",
  "suspenso",
] as const;
export type PlanTimelineStage = (typeof PLAN_STAGES)[number];

export const PLAN_STAGE_LABELS: Record<PlanTimelineStage, string> = {
  em_planejamento: "Em planejamento",
  aguardando_aprovacao: "Aguardando aprovação do Coordenador",
  em_revisao: "Em revisão",
  aprovado_coordenador: "Aprovado pelo Coordenador",
  aguardando_apresentacao: "Aguardando apresentação",
  apresentado: "Apresentado ao cliente",
  aceito: "Aceito pelo cliente",
  reprovado: "Reprovado pelo cliente",
  em_tratamento: "Em tratamento",
  concluido: "Concluído",
  cancelado: "Cancelado",
  suspenso: "Suspenso",
};

/** Cores da etiqueta por estágio (classes Tailwind: fundo/texto/borda). */
export const PLAN_STAGE_STYLES: Record<PlanTimelineStage, string> = {
  em_planejamento: "bg-slate-100 text-slate-700 border-slate-200",
  aguardando_aprovacao: "bg-amber-100 text-amber-800 border-amber-200",
  em_revisao: "bg-orange-100 text-orange-800 border-orange-200",
  aprovado_coordenador: "bg-sky-100 text-sky-800 border-sky-200",
  aguardando_apresentacao: "bg-indigo-100 text-indigo-800 border-indigo-200",
  apresentado: "bg-violet-100 text-violet-800 border-violet-200",
  aceito: "bg-emerald-100 text-emerald-800 border-emerald-200",
  reprovado: "bg-rose-100 text-rose-800 border-rose-200",
  em_tratamento: "bg-blue-100 text-blue-800 border-blue-200",
  concluido: "bg-teal-100 text-teal-800 border-teal-200",
  cancelado: "bg-red-100 text-red-800 border-red-200",
  suspenso: "bg-yellow-100 text-yellow-900 border-yellow-300",
};

/**
 * Deriva o estágio unificado de um plano. Se o ciclo de vida está preenchido,
 * ele manda; senão, mapeia o status interno para o passo correspondente.
 */
export function planStage(plan: {
  status: TreatmentPlanStatus;
  lifecycle: PlanLifecycle | null;
}): PlanTimelineStage {
  if (plan.lifecycle) return plan.lifecycle;
  switch (plan.status) {
    case "draft":
      return "em_planejamento";
    case "submitted":
      return "aguardando_aprovacao";
    case "returned":
      return "em_revisao";
    case "approved":
      return "aprovado_coordenador";
  }
}

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
  /** Ciclo de vida (Fase 2): null enquanto o plano está no trilho interno. */
  lifecycle: PlanLifecycle | null;
  diagnosis: string | null;
  objectives: string | null;
  planningNotes: string | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  options: PlanOption[];
};
