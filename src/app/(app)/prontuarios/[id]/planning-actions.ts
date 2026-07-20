"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { PlanLifecycle, PlanResult, ProjectedSession } from "@/lib/planning";
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

/**
 * H3.11: Coordenador envia informações complementares ao Centro de
 * Planejamento — notifica o Planner e sinaliza no cliente (ícone na fila).
 */
export async function addPlanningSupplement(
  clientId: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  await getSessionContext();
  if (!body.trim()) {
    return { ok: false, error: "Escreva a informação a enviar." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_planning_supplement", {
    p_client_id: clientId,
    p_body: body.trim(),
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Apenas o Coordenador Clínico pode enviar essas informações.",
      };
    }
    console.error("add_planning_supplement failed:", error.message);
    return { ok: false, error: "Não foi possível enviar a informação." };
  }
  await logAudit({
    action: "create",
    entityType: "planning_supplement",
    entityId: clientId,
  });
  revalidatePath(`/prontuarios/${clientId}`);
  revalidatePath(`/planejamento/${clientId}`);
  revalidatePath("/planejamento");
  return { ok: true };
}

/** H3.11: o Planner marca as informações do cliente como vistas (limpa o ícone). */
export async function markPlanningSupplementsSeen(
  clientId: string
): Promise<void> {
  await getSessionContext();
  const supabase = await createClient();
  await supabase.rpc("mark_planning_supplements_seen", {
    p_client_id: clientId,
  });
  revalidatePath("/planejamento");
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
/**
 * Cria SEMPRE um plano NOVO para o cliente (nunca mexe nos existentes). Opcional:
 * `copyFromPlanId` duplica um plano existente (diagnóstico, objetivos, opções,
 * procedimentos e etapas) como ponto de partida — útil para revisar um plano já
 * aprovado sem desfazê-lo. Retorna o id do novo plano.
 */
export async function createTreatmentPlan(
  clientId: string,
  copyFromPlanId?: string | null
): Promise<PlanResult & { planId?: string }> {
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
      error: "O plano só pode ser criado no Centro de Planejamento (Fase 3).",
    };
  }

  const { data: created, error } = await supabase
    .from("treatment_plans")
    .insert({
      client_id: clientId,
      clinic_id: client.clinic_id,
      created_by: guard.userId,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("createTreatmentPlan failed:", error?.message);
    return { ok: false, error: "Não foi possível iniciar o plano." };
  }
  const newPlanId = created.id as string;

  // Duplicação (opcional) de um plano existente do MESMO cliente.
  if (copyFromPlanId) {
    const { data: src } = await supabase
      .from("treatment_plans")
      .select("id, client_id, diagnosis, objectives, planning_notes")
      .eq("id", copyFromPlanId)
      .maybeSingle();
    if (src && src.client_id === clientId) {
      await supabase
        .from("treatment_plans")
        .update({
          diagnosis: src.diagnosis,
          objectives: src.objectives,
          planning_notes: src.planning_notes,
        })
        .eq("id", newPlanId);

      const { data: srcOpts } = await supabase
        .from("treatment_plan_options")
        .select("id, is_primary, title, description, sort_order")
        .eq("plan_id", copyFromPlanId)
        .order("sort_order")
        .returns<
          {
            id: string;
            is_primary: boolean;
            title: string;
            description: string | null;
            sort_order: number;
          }[]
        >();
      const optionMap = new Map<string, string>();
      for (const o of srcOpts ?? []) {
        const { data: newOpt } = await supabase
          .from("treatment_plan_options")
          .insert({
            plan_id: newPlanId,
            clinic_id: client.clinic_id,
            is_primary: o.is_primary,
            title: o.title,
            description: o.description,
            sort_order: o.sort_order,
          })
          .select("id")
          .single();
        if (newOpt) optionMap.set(o.id, newOpt.id as string);
      }
      const srcOptionIds = [...optionMap.keys()];
      const stageMap = new Map<string, string>();
      if (srcOptionIds.length > 0) {
        const { data: srcStages } = await supabase
          .from("treatment_plan_stages")
          .select("id, option_id, name, sort_order")
          .in("option_id", srcOptionIds)
          .returns<
            {
              id: string;
              option_id: string;
              name: string;
              sort_order: number;
            }[]
          >();
        for (const s of srcStages ?? []) {
          const newOptionId = optionMap.get(s.option_id);
          if (!newOptionId) continue;
          const { data: newStage } = await supabase
            .from("treatment_plan_stages")
            .insert({
              option_id: newOptionId,
              clinic_id: client.clinic_id,
              name: s.name,
              sort_order: s.sort_order,
            })
            .select("id")
            .single();
          if (newStage) stageMap.set(s.id, newStage.id as string);
        }

        const { data: srcItems } = await supabase
          .from("treatment_plan_option_items")
          .select(
            "option_id, procedure_id, description, quantity, unit_price_cents, planned_sessions, planned_total_minutes, stage_id, suggested_provider_id, gut_gravity, gut_urgency, gut_tendency, sort_order"
          )
          .in("option_id", srcOptionIds)
          .order("sort_order");
        const rows = (srcItems ?? [])
          .map((it) => {
            const newOptionId = optionMap.get(it.option_id as string);
            if (!newOptionId) return null;
            return {
              option_id: newOptionId,
              clinic_id: client.clinic_id,
              procedure_id: it.procedure_id,
              description: it.description,
              quantity: it.quantity,
              unit_price_cents: it.unit_price_cents,
              planned_sessions: it.planned_sessions,
              planned_total_minutes: it.planned_total_minutes,
              stage_id: it.stage_id
                ? (stageMap.get(it.stage_id as string) ?? null)
                : null,
              suggested_provider_id: it.suggested_provider_id,
              gut_gravity: it.gut_gravity,
              gut_urgency: it.gut_urgency,
              gut_tendency: it.gut_tendency,
              sort_order: it.sort_order,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        if (rows.length > 0) {
          await supabase.from("treatment_plan_option_items").insert(rows);
        }
      }
    }
  }

  await logAudit({
    action: "create",
    entityType: "treatment_plan",
    entityId: clientId,
    clinicId: client.clinic_id,
    details: copyFromPlanId ? { copied: true } : undefined,
  });
  revalidatePath(`/prontuarios/${clientId}`);
  revalidatePath("/planejamento");
  return { ok: true, planId: newPlanId };
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
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

export async function savePlanNarrative(
  planId: string,
  objectives: string,
  planningNotes: string
): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadPlanContext(planId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("treatment_plans")
    .update({
      objectives: objectives.trim() || null,
      planning_notes: planningNotes.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId);
  if (error) {
    console.error("savePlanNarrative failed:", error.message);
    return { ok: false, error: "Não foi possível salvar os objetivos." };
  }
  await logAudit({
    action: "update",
    entityType: "treatment_plan",
    entityId: ctx.clientId,
    clinicId: ctx.clinicId,
    details: { narrative: true },
  });
  revalidatePath(`/prontuarios/${ctx.clientId}`);
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
  revalidatePath(`/prontuarios/${ctx.clientId}`);
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
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

/** Quick action: make an option the primary one (unmarks the others). */
export async function setPrimaryOption(optionId: string): Promise<PlanResult> {
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

  // Unmark every other option first, then mark this one.
  await supabase
    .from("treatment_plan_options")
    .update({ is_primary: false })
    .eq("plan_id", option.plan_id);
  const { error } = await supabase
    .from("treatment_plan_options")
    .update({ is_primary: true })
    .eq("id", optionId);
  if (error) {
    console.error("setPrimaryOption failed:", error.message);
    return { ok: false, error: "Não foi possível definir o plano principal." };
  }
  await touchPlan(option.plan_id);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
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
  revalidatePath(`/prontuarios/${ctx.clientId}`);
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
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  revalidatePath("/planejamento");
  revalidatePath("/jornada");
  revalidatePath("/notificacoes");
  return { ok: true };
}

/**
 * The Coordenador approves/rejects a SINGLE plan option (F4). When all options
 * are decided, the RPC settles the plan (approved if ≥1 approved, else returned).
 */
export async function reviewPlanOption(
  optionId: string,
  approve: boolean,
  notes: string
): Promise<PlanResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { data: option } = await supabase
    .from("treatment_plan_options")
    .select("plan_id")
    .eq("id", optionId)
    .single();
  if (!option) return { ok: false, error: "Opção não encontrada." };
  const ctx = await loadPlanContext(option.plan_id);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const { error } = await supabase.rpc("review_plan_option", {
    p_option_id: optionId,
    p_approve: approve,
    p_notes: notes.trim() || null,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Apenas o Coordenador Clínico pode avaliar as opções.",
      };
    }
    if (error.message.includes("NOT_SUBMITTED")) {
      return { ok: false, error: "Este plano não está aguardando aprovação." };
    }
    if (error.message.includes("NOTES_REQUIRED")) {
      return {
        ok: false,
        error: "Escreva as considerações para reprovar a opção.",
      };
    }
    console.error("review_plan_option failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a avaliação." };
  }
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  revalidatePath("/planejamento");
  revalidatePath("/jornada");
  revalidatePath("/notificacoes");
  return { ok: true };
}

/**
 * Reopen an approved (or submitted) plan for editing. The plan goes back to
 * 'draft' — the Planner can edit, but must re-submit so the Coordenador approves
 * the changes again before it can go to the Comercial (owner rule).
 */
export async function reopenTreatmentPlan(planId: string): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadPlanContext(planId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("treatment_plans")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("id", planId);
  if (error) {
    console.error("reopenTreatmentPlan failed:", error.message);
    return { ok: false, error: "Não foi possível reabrir o plano." };
  }
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  revalidatePath("/planejamento");
  return { ok: true };
}

/**
 * Fase 2 — avança (ou ajusta) o CICLO DE VIDA do plano depois de aprovado:
 * aguardando apresentação → apresentado → aceito/reprovado pelo cliente → em
 * tratamento → concluído. Quem pode marcar cada situação é conferido na RPC
 * `set_plan_lifecycle` (matriz de funções). Cancelar/Suspender NÃO passam aqui
 * (terão ação própria nas Fases 6/7).
 */
export async function setPlanLifecycle(
  planId: string,
  to: PlanLifecycle,
  note?: string
): Promise<PlanResult> {
  await getSessionContext();
  const ctx = await loadPlanContext(planId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_plan_lifecycle", {
    p_plan_id: planId,
    p_to: to,
    p_note: note?.trim() || null,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite marcar esta situação." };
    }
    if (error.message.includes("NOT_APPROVED")) {
      return {
        ok: false,
        error:
          "O plano precisa estar aprovado pelo Coordenador antes de avançar a situação.",
      };
    }
    if (error.message.includes("RESERVED")) {
      return {
        ok: false,
        error: "Cancelar/suspender terá uma ação própria (em breve).",
      };
    }
    console.error("set_plan_lifecycle failed:", error.message);
    return { ok: false, error: "Não foi possível mudar a situação do plano." };
  }
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  revalidatePath(`/planejamento/${ctx.clientId}`);
  revalidatePath("/planejamento");
  revalidatePath("/planos");
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
    if (error.message.includes("OPTION_NEEDS_ITEMS")) {
      return {
        ok: false,
        error:
          "Cada opção precisa ter ao menos um procedimento lançado no orçamento antes de enviar.",
      };
    }
    console.error("submit_treatment_plan failed:", error.message);
    return { ok: false, error: "Não foi possível enviar o plano." };
  }
  revalidatePath(`/prontuarios/${ctx.clientId}`);
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

/** Normaliza um inteiro positivo opcional (sessões/minutos planejados). */
function posIntOrNull(value: number | null | undefined): number | null {
  return value != null && value > 0 ? Math.floor(value) : null;
}

/** Nota GUT válida (1..5) ou null (fora da faixa = sem prioridade). */
function gutNote(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Math.floor(value);
  return n >= 1 && n <= 5 ? n : null;
}

export async function addBudgetItem(
  optionId: string,
  input: {
    procedureId: string | null;
    description: string;
    quantity: number;
    price: string;
    plannedSessions?: number | null;
    plannedMinutes?: number | null;
    stageId?: string | null;
    gutGravity?: number | null;
    gutUrgency?: number | null;
    gutTendency?: number | null;
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
    planned_sessions: posIntOrNull(input.plannedSessions),
    planned_total_minutes: posIntOrNull(input.plannedMinutes),
    stage_id: input.stageId ?? null,
    gut_gravity: gutNote(input.gutGravity),
    gut_urgency: gutNote(input.gutUrgency),
    gut_tendency: gutNote(input.gutTendency),
    sort_order: count ?? 0,
  });
  if (error) {
    console.error("addBudgetItem failed:", error.message);
    return { ok: false, error: "Não foi possível adicionar o item." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

export async function editBudgetItem(
  itemId: string,
  input: {
    description: string;
    quantity: number;
    price: string;
    plannedSessions?: number | null;
    plannedMinutes?: number | null;
    stageId?: string | null;
  }
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
    .update({
      description,
      quantity,
      unit_price_cents: priceCents,
      planned_sessions: posIntOrNull(input.plannedSessions),
      planned_total_minutes: posIntOrNull(input.plannedMinutes),
      stage_id: input.stageId ?? null,
    })
    .eq("id", itemId);
  if (error) {
    console.error("editBudgetItem failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o item." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
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
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

// ---- Etapas do tratamento (H4.5 Lote 1) -----------------------------------

/** Resolve a etapa → opção/plano/unidade/cliente, para escopo e revalidação. */
async function loadStageContext(
  stageId: string
): Promise<
  | { error: string }
  | { optionId: string; planId: string; clinicId: string; clientId: string }
> {
  const supabase = await createClient();
  const { data: stage } = await supabase
    .from("treatment_plan_stages")
    .select("option_id")
    .eq("id", stageId)
    .single();
  if (!stage) return { error: "Etapa não encontrada." };
  return loadOptionContext(stage.option_id);
}

/** Adiciona uma etapa à opção (fica no fim da ordem). */
export async function addPlanStage(
  optionId: string,
  name: string
): Promise<PlanResult> {
  const stageName = name.trim();
  if (!stageName) return { ok: false, error: "Dê um nome à etapa." };

  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadOptionContext(optionId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { count } = await supabase
    .from("treatment_plan_stages")
    .select("id", { count: "exact", head: true })
    .eq("option_id", optionId);

  const { error } = await supabase.from("treatment_plan_stages").insert({
    option_id: optionId,
    clinic_id: ctx.clinicId,
    name: stageName,
    sort_order: count ?? 0,
  });
  if (error) {
    console.error("addPlanStage failed:", error.message);
    return { ok: false, error: "Não foi possível adicionar a etapa." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

/** Renomeia uma etapa. */
export async function renamePlanStage(
  stageId: string,
  name: string
): Promise<PlanResult> {
  const stageName = name.trim();
  if (!stageName) return { ok: false, error: "Dê um nome à etapa." };

  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadStageContext(stageId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("treatment_plan_stages")
    .update({ name: stageName })
    .eq("id", stageId);
  if (error) {
    console.error("renamePlanStage failed:", error.message);
    return { ok: false, error: "Não foi possível renomear a etapa." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

/** Remove a etapa. Os itens dela ficam "sem etapa" (FK on delete set null). */
export async function removePlanStage(stageId: string): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadStageContext(stageId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("treatment_plan_stages")
    .delete()
    .eq("id", stageId);
  if (error) {
    console.error("removePlanStage failed:", error.message);
    return { ok: false, error: "Não foi possível remover a etapa." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

/** Move a etapa uma posição para cima ou para baixo (troca a ordem com a vizinha). */
export async function movePlanStage(
  stageId: string,
  direction: "up" | "down"
): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadStageContext(stageId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { data: stages } = await supabase
    .from("treatment_plan_stages")
    .select("id, sort_order")
    .eq("option_id", ctx.optionId)
    .order("sort_order")
    .returns<{ id: string; sort_order: number }[]>();
  const list = stages ?? [];
  const idx = list.findIndex((s) => s.id === stageId);
  if (idx < 0) return { ok: false, error: "Etapa não encontrada." };
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= list.length) return { ok: true };

  const a = list[idx];
  const b = list[swapIdx];
  await supabase
    .from("treatment_plan_stages")
    .update({ sort_order: b.sort_order })
    .eq("id", a.id);
  await supabase
    .from("treatment_plan_stages")
    .update({ sort_order: a.sort_order })
    .eq("id", b.id);
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

/** Move um item para uma etapa (ou tira dela, com stageId null). */
export async function setItemStage(
  itemId: string,
  stageId: string | null
): Promise<PlanResult> {
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
    .update({ stage_id: stageId })
    .eq("id", itemId);
  if (error) {
    console.error("setItemStage failed:", error.message);
    return { ok: false, error: "Não foi possível mover o item de etapa." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

/**
 * H4.5 Pedido 2: projeta as sessões de uma opção (mesma lógica da geração) com o
 * "atendimento conjunto" de cada uma, para a tela de agrupamento do cockpit.
 */
export async function projectOptionSessions(
  optionId: string
): Promise<ProjectedSession[]> {
  await getSessionContext();
  const supabase = await createClient();
  const { data } = await supabase.rpc("project_option_sessions", {
    p_option_id: optionId,
  });
  return ((data ?? []) as {
    item_id: string;
    session_index: number;
    procedure_name: string;
    name: string;
    planned_minutes: number | null;
    group_no: number | null;
    block_order: number | null;
    provider_id: string | null;
  }[]).map((r) => ({
    itemId: r.item_id,
    sessionIndex: r.session_index,
    procedureName: r.procedure_name,
    name: r.name,
    plannedMinutes: r.planned_minutes,
    groupNo: r.group_no,
    blockOrder: r.block_order,
    providerId: r.provider_id,
  }));
}

/**
 * H4.5: aplica uma alteração numa configuração da sessão planejada (item+índice)
 * preservando as demais. Remove a linha quando todas ficam vazias.
 */
async function patchSessionSetting(
  itemId: string,
  sessionIndex: number,
  clinicId: string,
  patch: {
    group_no?: number | null;
    minutes_override?: number | null;
    provider_override?: string | null;
    block_order?: number | null;
  }
): Promise<void> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("plan_session_joins")
    .select("group_no, minutes_override, provider_override, block_order")
    .eq("item_id", itemId)
    .eq("session_index", sessionIndex)
    .maybeSingle();
  const merged = {
    group_no:
      patch.group_no !== undefined ? patch.group_no : (existing?.group_no ?? null),
    minutes_override:
      patch.minutes_override !== undefined
        ? patch.minutes_override
        : (existing?.minutes_override ?? null),
    provider_override:
      patch.provider_override !== undefined
        ? patch.provider_override
        : (existing?.provider_override ?? null),
    block_order:
      patch.block_order !== undefined
        ? patch.block_order
        : (existing?.block_order ?? null),
  };
  const allNull =
    merged.group_no === null &&
    merged.minutes_override === null &&
    merged.provider_override === null &&
    merged.block_order === null;
  if (allNull) {
    if (existing) {
      await supabase
        .from("plan_session_joins")
        .delete()
        .eq("item_id", itemId)
        .eq("session_index", sessionIndex);
    }
    return;
  }
  await supabase.from("plan_session_joins").upsert(
    { item_id: itemId, clinic_id: clinicId, session_index: sessionIndex, ...merged },
    { onConflict: "item_id,session_index" }
  );
}

/** Resolve o contexto (opção/clínica/cliente/plano) de um item, para as ações. */
async function itemCtx(itemId: string) {
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("treatment_plan_option_items")
    .select("option_id")
    .eq("id", itemId)
    .single();
  if (!item) return { error: "Item não encontrado." } as const;
  return loadOptionContext(item.option_id);
}

/**
 * H4.5 Pedido 2: o Planner define (ou tira) o "atendimento conjunto" (group_no)
 * de uma sessão projetada (item + índice). Sessões com o mesmo group_no serão
 * feitas no mesmo horário quando o tratamento iniciar.
 */
export async function setPlannedSessionGroup(
  itemId: string,
  sessionIndex: number,
  groupNo: number | null
): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await itemCtx(itemId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  await patchSessionSetting(itemId, sessionIndex, ctx.clinicId, {
    group_no: groupNo,
  });
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  revalidatePath(`/planejamento/${ctx.clientId}`);
  return { ok: true };
}

/** H4.5: edita o tempo (min) de uma sessão planejada; null = volta ao padrão. */
export async function setSessionMinutes(
  itemId: string,
  sessionIndex: number,
  minutes: number | null
): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await itemCtx(itemId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const clean = minutes != null && minutes > 0 ? Math.floor(minutes) : null;
  await patchSessionSetting(itemId, sessionIndex, ctx.clinicId, {
    minutes_override: clean,
  });
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  revalidatePath(`/planejamento/${ctx.clientId}`);
  return { ok: true };
}

/** H4.5: define o profissional de uma sessão (override do indicado no item). */
export async function setSessionProvider(
  itemId: string,
  sessionIndex: number,
  providerId: string | null
): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await itemCtx(itemId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  await patchSessionSetting(itemId, sessionIndex, ctx.clinicId, {
    provider_override: providerId,
  });
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  revalidatePath(`/planejamento/${ctx.clientId}`);
  return { ok: true };
}

/**
 * H4.5: grava a sequência dos atendimentos. Recebe os blocos já na ordem; cada
 * bloco é uma lista de sessões (item + índice). Atribui block_order = posição.
 */
export async function reorderPlannedBlocks(
  optionId: string,
  blocks: { itemId: string; sessionIndex: number }[][]
): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadOptionContext(optionId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const itemIds = [
    ...new Set(blocks.flat().map((s) => s.itemId)),
  ];
  const existingByKey = new Map<
    string,
    {
      group_no: number | null;
      minutes_override: number | null;
      provider_override: string | null;
    }
  >();
  if (itemIds.length > 0) {
    const { data } = await supabase
      .from("plan_session_joins")
      .select("item_id, session_index, group_no, minutes_override, provider_override")
      .in("item_id", itemIds);
    for (const r of (data ?? []) as {
      item_id: string;
      session_index: number;
      group_no: number | null;
      minutes_override: number | null;
      provider_override: string | null;
    }[]) {
      existingByKey.set(`${r.item_id}:${r.session_index}`, {
        group_no: r.group_no,
        minutes_override: r.minutes_override,
        provider_override: r.provider_override,
      });
    }
  }

  const rows = blocks.flatMap((block, i) =>
    block.map((s) => {
      const ex = existingByKey.get(`${s.itemId}:${s.sessionIndex}`);
      return {
        item_id: s.itemId,
        clinic_id: ctx.clinicId,
        session_index: s.sessionIndex,
        group_no: ex?.group_no ?? null,
        minutes_override: ex?.minutes_override ?? null,
        provider_override: ex?.provider_override ?? null,
        block_order: i,
      };
    })
  );
  if (rows.length > 0) {
    const { error } = await supabase
      .from("plan_session_joins")
      .upsert(rows, { onConflict: "item_id,session_index" });
    if (error) {
      console.error("reorderPlannedBlocks failed:", error.message);
      return { ok: false, error: "Não foi possível salvar a sequência." };
    }
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  revalidatePath(`/planejamento/${ctx.clientId}`);
  return { ok: true };
}

/**
 * H4.5 Pedido 1: o Planner indica (ou tira) o profissional que deve realizar o
 * procedimento deste item. É uma sugestão — a validade na hora de agendar
 * depende de o profissional atender a unidade atual do cliente.
 */
export async function setItemProvider(
  itemId: string,
  providerId: string | null
): Promise<PlanResult> {
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
    .update({ suggested_provider_id: providerId })
    .eq("id", itemId);
  if (error) {
    console.error("setItemProvider failed:", error.message);
    return { ok: false, error: "Não foi possível indicar o profissional." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

/**
 * Prioridade GUT do item: três notas de 1 a 5 (gravidade, urgência, tendência).
 * Qualquer nota fora da faixa vira null (item "sem prioridade" naquela dimensão).
 */
export async function setItemGut(
  itemId: string,
  gut: {
    gravity: number | null;
    urgency: number | null;
    tendency: number | null;
  }
): Promise<PlanResult> {
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
    .update({
      gut_gravity: gutNote(gut.gravity),
      gut_urgency: gutNote(gut.urgency),
      gut_tendency: gutNote(gut.tendency),
    })
    .eq("id", itemId);
  if (error) {
    console.error("setItemGut failed:", error.message);
    return { ok: false, error: "Não foi possível definir a prioridade." };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}
