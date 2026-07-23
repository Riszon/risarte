import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BudgetItem } from "@/lib/pricing";
import type {
  PlanEvent,
  PlanLifecycle,
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
      "id, status, lifecycle, diagnosis, objectives, planning_notes, created_at, submitted_at, reviewed_at, review_notes, commercial_return_note, commercial_returned_at"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        status: TreatmentPlanStatus;
        lifecycle: PlanLifecycle | null;
        diagnosis: string | null;
        objectives: string | null;
        planning_notes: string | null;
        created_at: string;
        submitted_at: string | null;
        reviewed_at: string | null;
        review_notes: string | null;
        commercial_return_note: string | null;
        commercial_returned_at: string | null;
      }[]
    >();
  const plans = planRows ?? [];
  if (plans.length === 0) return [];
  const planIds = plans.map((p) => p.id);

  // Histórico próprio de cada plano (mais antigo primeiro) + nomes dos autores.
  const { data: eventRows } = await supabase
    .from("treatment_plan_events")
    .select("id, plan_id, event_type, description, actor_id, created_at")
    .in("plan_id", planIds)
    .order("created_at")
    .returns<
      {
        id: string;
        plan_id: string;
        event_type: string;
        description: string | null;
        actor_id: string | null;
        created_at: string;
      }[]
    >();
  const actorIds = [
    ...new Set(
      (eventRows ?? [])
        .map((e) => e.actor_id)
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    for (const p of people ?? []) actorNames.set(p.id, p.full_name);
  }
  const eventsByPlan = new Map<string, PlanEvent[]>();
  for (const e of eventRows ?? []) {
    const list = eventsByPlan.get(e.plan_id) ?? [];
    list.push({
      id: e.id,
      type: e.event_type,
      description: e.description,
      actorName: e.actor_id ? (actorNames.get(e.actor_id) ?? null) : null,
      at: e.created_at,
    });
    eventsByPlan.set(e.plan_id, list);
  }

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
    // COM: procedimentos que o cliente NÃO aprovou na negociação comercial
    // (aprovação parcial ou devolução) — marcados no item do plano.
    const rejectedItemIds = new Set<string>();
    {
      const { data: negItemRows } = await supabase
        .from("plan_negotiation_items")
        .select("item_id, included, negotiation:plan_negotiations ( plan_id, status )")
        .eq("included", false)
        .returns<
          {
            item_id: string;
            included: boolean;
            negotiation:
              | { plan_id: string; status: string }
              | { plan_id: string; status: string }[]
              | null;
          }[]
        >();
      for (const r of negItemRows ?? []) {
        const neg = Array.isArray(r.negotiation) ? r.negotiation[0] : r.negotiation;
        if (neg && planIds.includes(neg.plan_id) &&
            (neg.status === "aceita" || neg.status === "devolvida")) {
          rejectedItemIds.add(r.item_id);
        }
      }
    }

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
        clientRejected: rejectedItemIds.has(it.id),
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
    lifecycle: p.lifecycle,
    diagnosis: p.diagnosis,
    objectives: p.objectives,
    planningNotes: p.planning_notes,
    createdAt: p.created_at,
    submittedAt: p.submitted_at,
    reviewedAt: p.reviewed_at,
    reviewNotes: p.review_notes,
    commercialReturnNote: p.commercial_return_note,
    commercialReturnedAt: p.commercial_returned_at,
    events: eventsByPlan.get(p.id) ?? [],
    options: optionsByPlan.get(p.id) ?? [],
  }));
}
