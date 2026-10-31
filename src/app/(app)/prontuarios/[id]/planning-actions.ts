"use server";

import { contagemConfirmada } from "@/lib/contagem";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { PlanLifecycle, PlanResult, ProjectedSession } from "@/lib/planning";
import type { LinhaDaSequencia } from "@/lib/sequencia-do-plano";
import { parseBRLToCents } from "@/lib/pricing";
import { mensagemDoPlano } from "@/lib/odontograma/plano";

/**
 * Only the Dentista Planner (or Admin) works on a treatment plan. The plan is
 * scoped to the client's home unit (clinic_id); the Planner reaches it via the
 * franchisor scope. RLS is the real barrier — this guard is for UX/early errors.
 */
function isPlannerSession(session: Awaited<ReturnType<typeof getSessionContext>>) {
  // D6 (decisão do dono, 20/10/2026; banco: 0312): montar o plano é do Planner
  // e do TITULAR (Admin Principal). O Admin Master que não é o titular vê,
  // mas não monta nem envia.
  return (
    Boolean(session.isOwner) ||
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
    return { error: "Apenas o Dentista Planner (ou o Admin Principal) monta o plano." };
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
): Promise<PlanResult & { planId?: string; aviso?: string }> {
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
      // OD3 (D4): a cópia é a NOVA VERSÃO da anterior — o banco numera e,
      // quando ela for aprovada, marca a anterior como substituída (F2).
      ...(copyFromPlanId ? { previous_plan_id: copyFromPlanId } : {}),
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("createTreatmentPlan failed:", error?.message);
    return { ok: false, error: mensagemDoPlano(error?.message ?? "") ?? "Não foi possível iniciar o plano." };
  }
  const newPlanId = created.id as string;
  let itensNaoCopiados = 0;
  let sequenciaNaoCopiada = false;

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
            "id, option_id, procedure_id, description, quantity, unit_price_cents, planned_sessions, planned_total_minutes, stage_id, suggested_provider_id, gut_gravity, gut_urgency, gut_tendency, gut_repeated, sort_order"
          )
          .in("option_id", srcOptionIds)
          .order("sort_order");
        // OD3: o lugar de cada item vem junto, pelo id (leitura à parte: sem a
        // 0311, a cópia segue como antes, sem dente).
        const { data: srcLoc } = await supabase
          .from("treatment_plan_option_items")
          .select("id, tooth_code, face_codes, region_code, situation_override_reason")
          .in("option_id", srcOptionIds)
          .returns<
            { id: string; tooth_code: string | null; face_codes: string[] | null; region_code: string | null; situation_override_reason: string | null }[]
          >();
        const localDoItem = new Map((srcLoc ?? []).map((l) => [l.id, l]));
        // 0324 (GP2): a etiqueta do grupo vem junto (à parte: sem a 0324, a
        // cópia segue sem ela). Grupo editado depois: o banco tira a etiqueta.
        const { data: srcGrupo } = await supabase
          .from("treatment_plan_option_items")
          .select("id, procedure_group_id")
          .in("option_id", srcOptionIds)
          .not("procedure_group_id", "is", null)
          .returns<{ id: string; procedure_group_id: string }[]>();
        const grupoDoItem = new Map((srcGrupo ?? []).map((g) => [g.id, g.procedure_group_id]));
        const rows = (srcItems ?? [])
          .map((it) => {
            const newOptionId = optionMap.get(it.option_id as string);
            if (!newOptionId) return null;
            const loc = localDoItem.get(it.id as string);
            return { antigoId: it.id as string, row: {
              ...(loc?.tooth_code ? { tooth_code: loc.tooth_code, face_codes: loc.face_codes ?? [] } : {}),
              ...(loc?.region_code ? { region_code: loc.region_code } : {}),
              ...(loc?.situation_override_reason ? { situation_override_reason: loc.situation_override_reason } : {}),
              ...(grupoDoItem.get(it.id as string) ? { procedure_group_id: grupoDoItem.get(it.id as string) } : {}),
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
              gut_repeated: it.gut_repeated,
              sort_order: it.sort_order,
            } };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
          // OC-00067: o item personalizado antigo não é copiado — o banco só
          // aceita item do catálogo, e um item recusado derrubaria a cópia
          // inteira. O preço do que vem é o do catálogo de HOJE (0306).
          .filter((r) => r.row.procedure_id != null);
        // Um a um: a OD3 confere cada item contra o diagnóstico de HOJE, e um
        // item que não passa mais (ex.: o dente agora consta ausente) não
        // pode derrubar a cópia inteira — ele fica de fora e a tela avisa.
        const itemNovoPorAntigo = new Map<string, string>();
        for (const { antigoId, row } of rows) {
          const { data: novoItem, error: erroDoItem } = await supabase
            .from("treatment_plan_option_items")
            .insert(row)
            .select("id")
            .single();
          if (erroDoItem || !novoItem) {
            itensNaoCopiados++;
            console.error("createTreatmentPlan — item não copiado:", erroDoItem?.message);
          } else {
            itemNovoPorAntigo.set(antigoId, novoItem.id as string);
          }
        }

        // OC-00009: os atendimentos e a sequência vão junto. A CONFIRMAÇÃO não: a
        // versão nova é outra proposta, e o Planner confere antes de enviar.
        if (itemNovoPorAntigo.size > 0) {
          const { data: ajustes, error: erroDosAjustes } = await supabase
            .from("plan_session_joins")
            .select("item_id, session_index, group_no, minutes_override, provider_override, block_order")
            .in("item_id", [...itemNovoPorAntigo.keys()])
            .returns<
              { item_id: string; session_index: number; group_no: number | null; minutes_override: number | null; provider_override: string | null; block_order: number | null }[]
            >();
          const copias = (ajustes ?? []).map((a) => ({
            ...a,
            item_id: itemNovoPorAntigo.get(a.item_id)!,
            clinic_id: client.clinic_id,
          }));
          const { error: erroDaCopia } =
            copias.length > 0
              ? await supabase.from("plan_session_joins").insert(copias)
              : { error: null };
          if (erroDosAjustes || erroDaCopia) {
            sequenciaNaoCopiada = true;
            console.error(
              "createTreatmentPlan — sequência não copiada:",
              erroDosAjustes?.message ?? erroDaCopia?.message
            );
          }
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
  return {
    ok: true,
    planId: newPlanId,
    aviso:
      [
        itensNaoCopiados > 0
          ? `${itensNaoCopiados} ${itensNaoCopiados === 1 ? "procedimento não foi copiado" : "procedimentos não foram copiados"} para a nova versão (não combinam mais com o diagnóstico ou com o dente). Lance de novo os que ainda valem.`
          : null,
        sequenciaNaoCopiada
          ? "Os atendimentos e a sequência não foram copiados: confira e monte de novo na nova versão."
          : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  };
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
  const { count, error: erroDaOrdem } = await supabase
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
    // Só a posição na lista: zero é aceitável se a contagem falhar (AP11).
    sort_order: contagemConfirmada({ count, error: erroDaOrdem }) ?? 0,
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
/**
 * ORTO7 (0333, R3/R5): o Planner define a PROPOSTA ORTODÔNTICA da opção
 * (tipo de aparelho, meses previstos — referência —, intervalo das
 * manutenções, contenção final). O banco (`save_plan_option_ortho`) confere
 * quem é e se o plano ainda está editável (rascunho/devolvido).
 */
export async function savePlanOptionOrtho(
  optionId: string,
  input: {
    treatmentKind: string;
    plannedMonths: number;
    maintenanceIntervalDays: number;
    retainerKind: string;
    notes: string;
  }
): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const months = Math.round(Number(input.plannedMonths));
  const interval = Math.round(Number(input.maintenanceIntervalDays));
  if (!Number.isFinite(months) || months < 1 || months > 120) {
    return { ok: false, error: "Informe os meses previstos (entre 1 e 120)." };
  }
  if (!Number.isFinite(interval) || interval < 7 || interval > 180) {
    return { ok: false, error: "Informe o intervalo das manutenções (entre 7 e 180 dias)." };
  }
  const supabase = await createClient();
  const { data: option } = await supabase
    .from("treatment_plan_options")
    .select("plan_id")
    .eq("id", optionId)
    .single();
  if (!option) return { ok: false, error: "Opção não encontrada." };
  const ctx = await loadPlanContext(option.plan_id);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const { error } = await supabase.rpc("save_plan_option_ortho", {
    p_option_id: optionId,
    p_treatment_kind: input.treatmentKind,
    p_planned_months: months,
    p_retainer_kind: input.retainerKind,
    p_interval_days: interval,
    p_notes: input.notes.trim() || null,
  });
  if (error) {
    if (error.message.includes("PLAN_LOCKED")) {
      return { ok: false, error: "O plano já foi enviado: a proposta ortodôntica não muda mais. Reabra o plano para alterar." };
    }
    console.error("savePlanOptionOrtho failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a proposta ortodôntica." };
  }
  await touchPlan(option.plan_id);
  await logAudit({
    action: "update",
    entityType: "treatment_plan_ortho",
    entityId: optionId,
    clinicId: ctx.clinicId,
  });
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  revalidatePath(`/planejamento/${ctx.clientId}`);
  return { ok: true };
}

export async function removePlanOptionOrtho(optionId: string): Promise<PlanResult> {
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
  const { error } = await supabase.rpc("delete_plan_option_ortho", { p_option_id: optionId });
  if (error) {
    if (error.message.includes("PLAN_LOCKED")) {
      return { ok: false, error: "O plano já foi enviado: a proposta ortodôntica não muda mais." };
    }
    console.error("removePlanOptionOrtho failed:", error.message);
    return { ok: false, error: "Não foi possível remover a proposta ortodôntica." };
  }
  await touchPlan(option.plan_id);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  revalidatePath(`/planejamento/${ctx.clientId}`);
  return { ok: true };
}

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
// OD3 (D4): o antigo "Reabrir para edição" (voltar o plano a rascunho) SAIU.
// Plano enviado ou aprovado não se edita — vira NOVA VERSÃO
// (`createTreatmentPlan` com `copyFromPlanId`). O banco recusa voltar a
// situação pela API (`treatment_plan_lock`, 0311).

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
    // OD3 (0311): o diagnóstico definido (E2), o lugar de cada item, versões.
    const doPlano = mensagemDoPlano(error.message);
    if (doPlano) return { ok: false, error: doPlano };
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
    /**
     * OD3 (0311): onde acontece. Vários dentes = UM ITEM POR DENTE, quantidade
     * 1 (F4). Quem confere a forma e a situação é o BANCO
     * (`plan_item_location_check`); `motivo` é o de lançar apesar do aviso.
     */
    local?: {
      teeth?: { tooth: string; faces: string[] }[];
      regionCode?: string | null;
      motivo?: string | null;
    };
  }
): Promise<PlanResult> {
  // OC-00067 (decisão do dono, 19/10/2026): SÓ item do catálogo. O nome e o
  // preço quem põe é o BANCO (`plan_item_catalog_guard`, 0306) — o que a tela
  // mandar nesses dois campos não vale.
  if (!input.procedureId) {
    return {
      ok: false,
      error: "Escolha um procedimento do catálogo. Não achou? Sugira à rede.",
    };
  }
  const description = input.description.trim() || "(do catálogo)";
  const quantity = Math.max(1, Math.floor(input.quantity || 1));
  const priceCents = parseBRLToCents(input.price) ?? 0;

  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadOptionContext(optionId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { count, error: erroDaOrdem } = await supabase
    .from("treatment_plan_option_items")
    .select("id", { count: "exact", head: true })
    .eq("option_id", optionId);

  // Só a posição na lista: zero é aceitável se a contagem falhar (AP11).
  const ordem = contagemConfirmada({ count, error: erroDaOrdem }) ?? 0;
  const base = {
    option_id: optionId,
    clinic_id: ctx.clinicId,
    procedure_id: input.procedureId,
    description,
    unit_price_cents: priceCents,
    planned_sessions: posIntOrNull(input.plannedSessions),
    planned_total_minutes: posIntOrNull(input.plannedMinutes),
    stage_id: input.stageId ?? null,
    gut_gravity: gutNote(input.gutGravity),
    gut_urgency: gutNote(input.gutUrgency),
    gut_tendency: gutNote(input.gutTendency),
  };
  // As colunas da 0311 só vão quando têm valor: num banco que ainda não
  // recebeu a migração, o item sem lugar continua entrando como antes.
  const motivo = input.local?.motivo?.trim();
  const comMotivo = motivo ? { situation_override_reason: motivo } : {};
  const dentes = input.local?.teeth ?? [];
  const regiao = input.local?.regionCode ?? null;
  // F4: um item por dente (quantidade 1). Uma gravação só: ou entram todos, ou nenhum.
  const linhas: Record<string, unknown>[] =
    dentes.length > 0
      ? dentes.map((d, i) => ({ ...base, ...comMotivo, quantity: 1, tooth_code: d.tooth, face_codes: d.faces, sort_order: ordem + i }))
      : [{ ...base, ...comMotivo, quantity, ...(regiao ? { region_code: regiao } : {}), sort_order: ordem }];
  const { error } = await supabase.from("treatment_plan_option_items").insert(linhas);
  if (error) {
    console.error("addBudgetItem failed:", error.message);
    return {
      ok: false,
      error: error.message.includes("CATALOG_ITEM_REQUIRED")
        ? "Escolha um procedimento do catálogo. Não achou? Sugira à rede."
        : (mensagemDoPlano(error.message) ?? "Não foi possível adicionar o item."),
    };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true };
}

/**
 * 0324 — LANÇAR UM GRUPO DE PROCEDIMENTOS na opção (pedido do dono,
 * 27/10/2026). O grupo é atalho: cada linha vira um item NORMAL, pelas mesmas
 * travas do lançamento à mão — o banco põe o nome e o preço do catálogo
 * (0306) e confere o dente (0311). As linhas chegam montadas pela tela
 * (`montarLancamento`, dente a dente, na ordem do grupo); aqui só se confere
 * que cada uma é DO grupo e se grava tudo de uma vez: ou entram todas, ou
 * nenhuma — metade do grupo lançada seria pior que nada.
 */
export async function addProcedureGroup(
  optionId: string,
  input: {
    groupId: string;
    linhas: {
      procedureId: string;
      quantity: number;
      tooth: string | null;
      faces: string[];
      regionCode: string | null;
      plannedSessions: number | null;
      plannedMinutes: number | null;
    }[];
    stageId?: string | null;
    /** Motivo de lançar apesar do aviso de situação (vale para as linhas com conflito). */
    motivo?: string | null;
  }
): Promise<PlanResult & { quantos?: number }> {
  if (input.linhas.length === 0) return { ok: false, error: "Nada para lançar: escolha o lugar dos procedimentos." };
  // 30 procedimentos × 32 dentes é o teto do que a tela consegue montar.
  if (input.linhas.length > 960) return { ok: false, error: "Lançamento grande demais para uma vez só." };

  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadOptionContext(optionId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const supabase = await createClient();
  const { data: grupo, error: erroDoGrupo } = await supabase
    .from("procedure_groups")
    .select("id, is_active, procedure_group_items ( procedure_id )")
    .eq("id", input.groupId)
    .maybeSingle<{ id: string; is_active: boolean; procedure_group_items: { procedure_id: string }[] }>();
  if (erroDoGrupo) {
    console.error("addProcedureGroup (grupo) failed:", erroDoGrupo.message);
    return { ok: false, error: "Não foi possível ler o grupo agora." };
  }
  if (!grupo || !grupo.is_active) return { ok: false, error: "Este grupo não está mais ativo." };
  const doGrupo = new Set((grupo.procedure_group_items ?? []).map((i) => i.procedure_id));
  if (input.linhas.some((l) => !doGrupo.has(l.procedureId))) {
    return { ok: false, error: "O grupo mudou enquanto a tela estava aberta. Feche e escolha de novo." };
  }

  const { count, error: erroDaOrdem } = await supabase
    .from("treatment_plan_option_items")
    .select("id", { count: "exact", head: true })
    .eq("option_id", optionId);
  // Só a posição na lista: zero é aceitável se a contagem falhar (AP11).
  const ordem = contagemConfirmada({ count, error: erroDaOrdem }) ?? 0;
  const motivo = input.motivo?.trim();
  const linhas = input.linhas.map((l, i) => ({
    option_id: optionId,
    clinic_id: ctx.clinicId,
    procedure_id: l.procedureId,
    procedure_group_id: grupo.id,
    // O nome e o preço quem põe é o banco (`plan_item_catalog_guard`, 0306).
    description: "(do catálogo)",
    unit_price_cents: 0,
    quantity: l.tooth ? 1 : Math.max(1, Math.floor(l.quantity || 1)),
    planned_sessions: posIntOrNull(l.plannedSessions),
    planned_total_minutes: posIntOrNull(l.plannedMinutes),
    stage_id: input.stageId ?? null,
    sort_order: ordem + i,
    ...(l.tooth ? { tooth_code: l.tooth, face_codes: l.faces } : {}),
    ...(l.regionCode ? { region_code: l.regionCode } : {}),
    ...(motivo ? { situation_override_reason: motivo } : {}),
  }));
  const { error } = await supabase.from("treatment_plan_option_items").insert(linhas);
  if (error) {
    console.error("addProcedureGroup failed:", error.message);
    return {
      ok: false,
      error: mensagemDoPlano(error.message) ?? "Não foi possível lançar o grupo.",
    };
  }
  await touchPlan(ctx.planId);
  revalidatePath(`/prontuarios/${ctx.clientId}`);
  return { ok: true, quantos: linhas.length };
}

export async function editBudgetItem(
  itemId: string,
  input: {
    /** Ignorado: o nome vem do catálogo e não muda (OC-00067). */
    description?: string;
    quantity: number;
    /** Ignorado: o preço vem do catálogo e não muda (OC-00067). */
    price?: string;
    plannedSessions?: number | null;
    plannedMinutes?: number | null;
    stageId?: string | null;
  }
): Promise<PlanResult> {
  const quantity = Math.max(1, Math.floor(input.quantity || 1));

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
      quantity,
      planned_sessions: posIntOrNull(input.plannedSessions),
      planned_total_minutes: posIntOrNull(input.plannedMinutes),
      stage_id: input.stageId ?? null,
    })
    .eq("id", itemId);
  if (error) {
    console.error("editBudgetItem failed:", error.message);
    return { ok: false, error: mensagemDoPlano(error.message) ?? "Não foi possível salvar o item." };
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
    return { ok: false, error: mensagemDoPlano(error.message) ?? "Não foi possível remover o item." };
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
  const { count, error: erroDaOrdem } = await supabase
    .from("treatment_plan_stages")
    .select("id", { count: "exact", head: true })
    .eq("option_id", optionId);

  const { error } = await supabase.from("treatment_plan_stages").insert({
    option_id: optionId,
    clinic_id: ctx.clinicId,
    name: stageName,
    // Só a posição na lista: zero é aceitável se a contagem falhar (AP11).
    sort_order: contagemConfirmada({ count, error: erroDaOrdem }) ?? 0,
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
 * OC-00010: grava a sequência inteira da opção de uma vez — a tela muda na hora e
 * manda o retrato, em vez de uma ida ao servidor (e uma tela recarregada) por
 * clique. Tempo e profissional só viram ajuste quando diferem do padrão.
 */
async function gravarSequencia(
  optionId: string,
  linhas: LinhaDaSequencia[]
): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };
  const ctx = await loadOptionContext(optionId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  // As sessões de hoje: uma lista velha não pode gravar por cima de outra.
  const projetadas = await projectOptionSessions(optionId);
  const chave = (s: { itemId: string; sessionIndex: number }) => `${s.itemId}:${s.sessionIndex}`;
  const porChave = new Map(projetadas.map((p) => [chave(p), p]));
  if (
    projetadas.length === 0 ||
    linhas.length !== projetadas.length ||
    new Set(linhas.map(chave)).size !== linhas.length ||
    linhas.some((l) => !porChave.has(chave(l)))
  ) {
    return {
      ok: false,
      error: "Os procedimentos desta opção mudaram. Recarregue a página e confira a sequência.",
    };
  }
  const inteiroOuNulo = (n: number | null, min: number) =>
    n === null || (Number.isInteger(n) && n >= min);
  if (
    linhas.some(
      (l) =>
        !inteiroOuNulo(l.minutes, 0) ||
        !inteiroOuNulo(l.groupNo, 1) ||
        !Number.isInteger(l.blockOrder) ||
        l.blockOrder < 0
    )
  ) {
    return { ok: false, error: "Há um número inválido na sequência." };
  }

  const supabase = await createClient();
  const { data: existentes, error: erroDaLeitura } = await supabase
    .from("plan_session_joins")
    .select("item_id, session_index, minutes_override, provider_override")
    .in("item_id", [...new Set(linhas.map((l) => l.itemId))])
    .returns<
      { item_id: string; session_index: number; minutes_override: number | null; provider_override: string | null }[]
    >();
  // Sem ler o que já está gravado, gravar apagaria os ajustes dessas sessões.
  if (erroDaLeitura || !existentes) {
    return { ok: false, error: "Não foi possível ler a configuração atual. Nada foi alterado; tente de novo." };
  }
  const atual = new Map(existentes.map((e) => [`${e.item_id}:${e.session_index}`, e]));

  const rows = linhas.map((l) => {
    const padrao = porChave.get(chave(l))!;
    const ex = atual.get(chave(l));
    return {
      item_id: l.itemId,
      clinic_id: ctx.clinicId,
      session_index: l.sessionIndex,
      group_no: l.groupNo,
      block_order: l.blockOrder,
      minutes_override:
        l.minutes === padrao.plannedMinutes
          ? (ex?.minutes_override ?? null)
          : l.minutes && l.minutes > 0
            ? l.minutes
            : null,
      provider_override:
        l.providerId === padrao.providerId ? (ex?.provider_override ?? null) : l.providerId,
    };
  });
  const { error } = await supabase
    .from("plan_session_joins")
    .upsert(rows, { onConflict: "item_id,session_index" });
  if (error) {
    const doPlano = mensagemDoPlano(error.message);
    if (doPlano) return { ok: false, error: doPlano };
    console.error("gravarSequencia failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a sequência." };
  }
  await touchPlan(ctx.planId);
  return { ok: true, clientId: ctx.clientId };
}

/**
 * Sem revalidar de propósito: recarregar o cockpit a cada movimento era a lentidão
 * do relato, e a tela já mostra o que foi gravado.
 */
export async function salvarSequenciaDaOpcao(
  optionId: string,
  linhas: LinhaDaSequencia[]
): Promise<PlanResult> {
  const r = await gravarSequencia(optionId, linhas);
  return r.ok ? { ok: true } : r;
}

/** O Planner confirma a sequência da opção; sem isso, o plano não vai ao Coordenador. */
export async function confirmarSequenciaDaOpcao(
  optionId: string,
  linhas: LinhaDaSequencia[]
): Promise<PlanResult> {
  const r = await gravarSequencia(optionId, linhas);
  if (!r.ok) return r;
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_option_sequence", { p_option_id: optionId });
  if (error) {
    const doPlano = mensagemDoPlano(error.message);
    if (doPlano) return { ok: false, error: doPlano };
    console.error("confirm_option_sequence failed:", error.message);
    return { ok: false, error: "Não foi possível confirmar a sequência." };
  }
  revalidatePath(`/prontuarios/${r.clientId}`);
  revalidatePath(`/planejamento/${r.clientId}`);
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
 * Prioridade GUT do item: as três notas de 1 a 5. O banco repete para os
 * procedimentos iguais do plano (0339). Grava por trás: sem `revalidatePath`, a
 * tela só recarrega quando a lista de prioridades fecha.
 */
export async function definirPrioridadeDoItem(
  itemId: string,
  notas: { gravity: number; urgency: number; tendency: number }
): Promise<PlanResult> {
  const guard = await requirePlanner();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_plan_item_priority", {
    p_item: itemId,
    p_gravity: notas.gravity,
    p_urgency: notas.urgency,
    p_tendency: notas.tendency,
  });
  if (error) {
    const doPlano = mensagemDoPlano(error.message);
    if (doPlano) return { ok: false, error: doPlano };
    console.error("set_plan_item_priority failed:", error.message);
    return { ok: false, error: "Não foi possível definir a prioridade." };
  }
  return { ok: true };
}
