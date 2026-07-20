import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BudgetItem } from "@/lib/pricing";
import type {
  PlanOption,
  PlanStage,
  TreatmentPlan,
  TreatmentPlanStatus,
} from "@/lib/planning";

/**
 * Carrega TODOS os planos de tratamento de um cliente (mais novo primeiro), com
 * opções, itens e etapas. Substitui o carregamento de "só o último plano" — o
 * cliente pode ter vários planos ao mesmo tempo, e nenhum é escondido/apagado.
 * Usa poucas consultas (planos → opções → itens/etapas em lote).
 */
export async function loadClientPlans(
  clientId: string
): Promise<TreatmentPlan[]> {
  const supabase = await createClient();

  const { data: planRows } = await supabase
    .from("treatment_plans")
    .select(
      "id, status, diagnosis, objectives, planning_notes, created_at, submitted_at, reviewed_at, review_notes"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        status: TreatmentPlanStatus;
        diagnosis: string | null;
        objectives: string | null;
        planning_notes: string | null;
        created_at: string;
        submitted_at: string | null;
        reviewed_at: string | null;
        review_notes: string | null;
      }[]
    >();
  const plans = planRows ?? [];
  if (plans.length === 0) return [];
  const planIds = plans.map((p) => p.id);

  const { data: optRows } = await supabase
    .from("treatment_plan_options")
    .select(
      "id, plan_id, is_primary, title, description, sort_order, review_status, review_notes"
    )
    .in("plan_id", planIds)
    .order("is_primary", { ascending: false })
    .order("sort_order")
    .returns<
      {
        id: string;
        plan_id: string;
        is_primary: boolean;
        title: string;
        description: string | null;
        sort_order: number;
        review_status: "pending" | "approved" | "rejected";
        review_notes: string | null;
      }[]
    >();
  const opts = optRows ?? [];
  const optionIds = opts.map((o) => o.id);

  const itemsByOption = new Map<string, BudgetItem[]>();
  const stagesByOption = new Map<string, PlanStage[]>();
  if (optionIds.length > 0) {
    const { data: itemRows } = await supabase
      .from("treatment_plan_option_items")
      .select(
        "id, option_id, procedure_id, description, quantity, unit_price_cents, planned_sessions, planned_total_minutes, stage_id, suggested_provider_id, gut_gravity, gut_urgency, gut_tendency, sort_order"
      )
      .in("option_id", optionIds)
      .order("sort_order")
      .returns<
        {
          id: string;
          option_id: string;
          procedure_id: string | null;
          description: string;
          quantity: number;
          unit_price_cents: number;
          planned_sessions: number | null;
          planned_total_minutes: number | null;
          stage_id: string | null;
          suggested_provider_id: string | null;
          gut_gravity: number | null;
          gut_urgency: number | null;
          gut_tendency: number | null;
          sort_order: number;
        }[]
      >();
    for (const it of itemRows ?? []) {
      const list = itemsByOption.get(it.option_id) ?? [];
      list.push({
        id: it.id,
        procedureId: it.procedure_id,
        description: it.description,
        quantity: it.quantity,
        unitPriceCents: it.unit_price_cents,
        plannedSessions: it.planned_sessions,
        plannedMinutes: it.planned_total_minutes,
        stageId: it.stage_id,
        suggestedProviderId: it.suggested_provider_id,
        gutGravity: it.gut_gravity,
        gutUrgency: it.gut_urgency,
        gutTendency: it.gut_tendency,
      });
      itemsByOption.set(it.option_id, list);
    }

    const { data: stageRows } = await supabase
      .from("treatment_plan_stages")
      .select("id, option_id, name, sort_order")
      .in("option_id", optionIds)
      .order("sort_order")
      .returns<
        { id: string; option_id: string; name: string; sort_order: number }[]
      >();
    for (const st of stageRows ?? []) {
      const list = stagesByOption.get(st.option_id) ?? [];
      list.push({ id: st.id, name: st.name, sortOrder: st.sort_order });
      stagesByOption.set(st.option_id, list);
    }
  }

  const optionsByPlan = new Map<string, PlanOption[]>();
  for (const o of opts) {
    const list = optionsByPlan.get(o.plan_id) ?? [];
    list.push({
      id: o.id,
      isPrimary: o.is_primary,
      title: o.title,
      description: o.description,
      sortOrder: o.sort_order,
      items: itemsByOption.get(o.id) ?? [],
      stages: stagesByOption.get(o.id) ?? [],
      reviewStatus: o.review_status,
      reviewNotes: o.review_notes,
    });
    optionsByPlan.set(o.plan_id, list);
  }

  return plans.map((p) => ({
    id: p.id,
    status: p.status,
    diagnosis: p.diagnosis,
    objectives: p.objectives,
    planningNotes: p.planning_notes,
    createdAt: p.created_at,
    submittedAt: p.submitted_at,
    reviewedAt: p.reviewed_at,
    reviewNotes: p.review_notes,
    options: optionsByPlan.get(p.id) ?? [],
  }));
}
