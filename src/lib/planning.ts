// Shared constants/types for the treatment plan (Centro de Planejamento, Fase 3).
// Kept out of the "use server" actions file (which may only export functions).

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

export type PlanOption = {
  id: string;
  isPrimary: boolean;
  title: string;
  description: string | null;
  sortOrder: number;
};

export type TreatmentPlan = {
  id: string;
  status: TreatmentPlanStatus;
  diagnosis: string | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  options: PlanOption[];
};
