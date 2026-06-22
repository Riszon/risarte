"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { PlanResult } from "@/lib/planning";
import { parseBRLToCents } from "@/lib/pricing";

/**
 * Only the Dentista Planner (or Admin) works on a treatment plan. The plan is
 * scoped to the client's home unit (clinic_id); the Planner reaches it via the
 * franchisor scope. RLS is the real barrier — this guard is for UX/early errors.
 */
function isPlannerSession(session: Awaited<ReturnType<typeof getSessionContext>>) {
  return (
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((roles) =>
      roles.includes("planner_dentist")
    )
  );
}

async function requirePlanner(): Promise<
  { error: string } | { userId: string }
> {
  const session = await getSessionContext();
  if (!isPlannerSession(session)) {
    return { error: "Apenas o Dentista Planner pode trabalhar no plano." };
  }
  return { userId: session.userId };
}

/** Resolves a plan's client + clinic, for revalidation and option scoping. */
async function loadPlanContext(
  planId: string
): Promise<{ error: string } | { clientId: string; clinicId: string }> {
  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("treatment_plans")
    .select("client_id, clinic_id")
    .eq("id", planId)
    .single();
  if (!plan) return { error: "Plano não encontrado." };
  return { clientId: plan.client_id, clinicId: plan.clinic_id };
}

/**
 * Starts a treatment plan for a client (or returns the current one). Only one
 * open plan at a time: if the latest plan is not yet approved, reuse it.
 */
export async function createTreatmentPlan(clientId: string): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("clinic_id, journey_phase")
    .eq("id", clientId)
    .single();
  if (!client) return { ok: false, error: "Cliente não encontrado." };
  if (client.journey_phase !== "planning_center") {
    return {
      ok: false,
      error: "O plano só pode ser iniciado no Centro de Planejamento (Fase 3).",
    };
  }

  const { data: existing } = await supabase
    .from("treatment_plans")
    .select("id, status")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existing?.[0] && existing[0].status !== "approved") {
    return { ok: true };
  }

  const { error } = await supabase.from("treatment_plans").insert({
    client_id: clientId,
    clinic_id: client.clinic_id,
    created_by: guard.userId,
  });
  if (error) {
    console.error("createTreatmentPlan failed:", error.message);
    return { ok: false, error: "Não foi possível iniciar o plano." };
  }
  await logAudit({
    action: "create",
    entityType: "treatment_plan",
    entityId: clientId,
    clinicId: client.clinic_id,
  });
  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/planejamento");
  return { ok: true };
}

export async function saveDiagnosis(
  planId: string,
  diagnosis: string
): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadPlanContext(planId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("treatment_plans")
    .update({ diagnosis: diagnosis.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", planId);
  if (error) {
    console.error("saveDiagnosis failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o diagnóstico." };
  }
  await logAudit({
    action: "update",
    entityType: "treatment_plan",
    entityId: ctx.clientId,
    clinicId: ctx.clinicId,
    details: { diagnosis: true },
  });
  revalidatePath(`/clientes/${ctx.clientId}`);
  return { ok: true };
}

export async function addPlanOption(
  planId: string,
  input: { title: string; description: string; isPrimary: boolean }
): Promise<PlanResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Dê um título à opção do plano." };

  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadPlanContext(planId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { count } = await supabase
    .from("treatment_plan_options")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);

  // Only one primary option per plan.
  if (input.isPrimary) {
    await supabase
      .from("treatment_plan_options")
      .update({ is_primary: false })
      .eq("plan_id", planId);
  }

  const { error } = await supabase.from("treatment_plan_options").insert({
    plan_id: planId,
    clinic_id: ctx.clinicId,
    is_primary: input.isPrimary,
    title,
    description: input.description.trim() || null,
    sort_order: count ?? 0,
  });
  if (error) {
    console.error("addPlanOption failed:", error.message);
    return { ok: false, error: "Não foi possível adicionar a opção." };
  }
  await touchPlan(planId);
  revalidatePath(`/clientes/${ctx.clientId}`);
  return { ok: true };
}

export async function editPlanOption(
  optionId: string,
  input: { title: string; description: string; isPrimary: boolean }
): Promise<PlanResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Dê um título à opção do plano." };

  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { data: option } = await supabase
    .from("treatment_plan_options")
    .select("plan_id")
    .eq("id", optionId)
    .single();
  if (!option) return { ok: false, error: "Opção não encontrada." };
  const ctx = await loadPlanContext(option.plan_id);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  if (input.isPrimary) {
    await supabase
      .from("treatment_plan_options")
      .update({ is_primary: false })
      .eq("plan_id", option.plan_id);
  }

  const { error } = await supabase
    .from("treatment_plan_options")
    .update({
      title,
      description: input.description.trim() || null,
      is_primary: input.isPrimary,
    })
    .eq("id", optionId);
  if (error) {
    console.error("editPlanOption failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a opção." };
  }
  await touchPlan(option.plan_id);
  revalidatePath(`/clientes/${ctx.clientId}`);
  return { ok: true };
}

export async function removePlanOption(optionId: string): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { data: option } = await supabase
    .from("treatment_plan_options")
    .select("plan_id")
    .eq("id", optionId)
    .single();
  if (!option) return { ok: false, error: "Opção não encontrada." };
  const ctx = await loadPlanContext(option.plan_id);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const { error } = await supabase
    .from("treatment_plan_options")
    .delete()
    .eq("id", optionId);
  if (error) {
    console.error("removePlanOption failed:", error.message);
    return { ok: false, error: "Não foi possível remover a opção." };
  }
  await touchPlan(option.plan_id);
  revalidatePath(`/clientes/${ctx.clientId}`);
  return { ok: true };
}

/**
 * The Coordenador Clínico approves or returns a submitted plan (Etapa 5.3/4.3).
 * Approve → status 'approved' + notify the Planner to send to Commercial.
 * Return → status 'returned' with orientações + sub-status revision_with_coordinator.
 */
export async function reviewTreatmentPlan(
  planId: string,
  approve: boolean,
  notes: string
): Promise<PlanResult> {
  await getSessionContext();
  const ctx = await loadPlanContext(planId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_treatment_plan", {
    p_plan_id: planId,
    p_approve: approve,
    p_notes: approve ? null : notes,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Apenas o Coordenador Clínico pode aprovar ou devolver o plano.",
      };
    }
    if (error.message.includes("NOT_SUBMITTED")) {
      return {
        ok: false,
        error: "Este plano não está aguardando aprovação.",
      };
    }
    if (error.message.includes("NOTES_REQUIRED")) {
      return {
        ok: false,
        error: "Escreva as orientações ao devolver o plano.",
      };
    }
    console.error("review_treatment_plan failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a revisão." };
  }
  revalidatePath(`/clientes/${ctx.clientId}`);
  revalidatePath("/planejamento");
  revalidatePath("/jornada");
  revalidatePath("/notificacoes");
  return { ok: true };
}

/** The Planner sends the plan to the Coordenador Clínico for approval. */
export async function submitTreatmentPlan(planId: string): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadPlanContext(planId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_treatment_plan", {
    p_plan_id: planId,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite enviar o plano." };
    }
    if (error.message.includes("WRONG_PHASE")) {
      return {
        ok: false,
        error: "O cliente precisa estar no Centro de Planejamento (Fase 3).",
      };
    }
    if (error.message.includes("DIAGNOSIS_REQUIRED")) {
      return { ok: false, error: "Escreva o diagnóstico antes de enviar." };
    }
    if (error.message.includes("OPTIONS_REQUIRED")) {
      return {
        ok: false,
        error: "Adicione ao menos uma opção de plano antes de enviar.",
      };
    }
    console.error("submit_treatment_plan failed:", error.message);
    return { ok: false, error: "Não foi possível enviar o plano." };
  }
  revalidatePath(`/clientes/${ctx.clientId}`);
  revalidatePath("/planejamento");
  revalidatePath("/jornada");
  revalidatePath("/notificacoes");
  return { ok: true };
}

async function touchPlan(planId: string) {
  const supabase = await createClient();
  await supabase
    .from("treatment_plans")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", planId);
}

// ---- Orçamento por opção (Etapa 5.2) --------------------------------------

/** Resolves an option's plan/clinic/client, for scoping and revalidation. */
async function loadOptionContext(
  optionId: string
): Promise<
  | { error: string }
  | { optionId: string; planId: string; clinicId: string; clientId: string }
> {
  const supabase = await createClient();
  const { data: option } = await supabase
    .from("treatment_plan_options")
    .select("plan_id, clinic_id")
    .eq("id", optionId)
    .single();
  if (!option) return { error: "Opção não encontrada." };
  const ctx = await loadPlanContext(option.plan_id);
  if ("error" in ctx) return { error: ctx.error };
  return {
    optionId,
    planId: option.plan_id,
    clinicId: option.clinic_id,
    clientId: ctx.clientId,
  };
}

export async function addBudgetItem(
  optionId: string,
  input: {
    procedureId: string | null;
    description: string;
    quantity: number;
    price: string;
  }
): Promise<PlanResult> {
  const description = input.description.trim();
  if (!description) return { ok: false, error: "Descreva o item do orçamento." };
  const quantity = Math.max(1, Math.floor(input.quantity || 1));
  const priceCents = parseBRLToCents(input.price);
  if (priceCents === null) return { ok: false, error: "Valor inválido." };

  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadOptionContext(optionId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { count } = await supabase
    .from("treatment_plan_option_items")
    .select("id", { count: "exact", head: true })
    .eq("option_id", optionId);

  const { error } = await supabase.from("treatment_plan_option_items").insert({
    option_id: optionId,
    clinic_id: ctx.clinicId,
    procedure_id: input.procedureId,
    description,
    quantity,
    unit_price_cents: priceCents,
    sort_order: count ?? 0,
  });
  if (error) {
    console.error("addBudgetItem failed:", error.message);
    return { ok: false, error: "Não foi possível adicionar o item." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/clientes/${ctx.clientId}`);
  return { ok: true };
}

export async function editBudgetItem(
  itemId: string,
  input: { description: string; quantity: number; price: string }
): Promise<PlanResult> {
  const description = input.description.trim();
  if (!description) return { ok: false, error: "Descreva o item do orçamento." };
  const quantity = Math.max(1, Math.floor(input.quantity || 1));
  const priceCents = parseBRLToCents(input.price);
  if (priceCents === null) return { ok: false, error: "Valor inválido." };

  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("treatment_plan_option_items")
    .select("option_id")
    .eq("id", itemId)
    .single();
  if (!item) return { ok: false, error: "Item não encontrado." };
  const ctx = await loadOptionContext(item.option_id);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const { error } = await supabase
    .from("treatment_plan_option_items")
    .update({ description, quantity, unit_price_cents: priceCents })
    .eq("id", itemId);
  if (error) {
    console.error("editBudgetItem failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o item." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/clientes/${ctx.clientId}`);
  return { ok: true };
}

export async function removeBudgetItem(itemId: string): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("treatment_plan_option_items")
    .select("option_id")
    .eq("id", itemId)
    .single();
  if (!item) return { ok: false, error: "Item não encontrado." };
  const ctx = await loadOptionContext(item.option_id);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const { error } = await supabase
    .from("treatment_plan_option_items")
    .delete()
    .eq("id", itemId);
  if (error) {
    console.error("removeBudgetItem failed:", error.message);
    return { ok: false, error: "Não foi possível remover o item." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/clientes/${ctx.clientId}`);
  return { ok: true };
}
