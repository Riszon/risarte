"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { PLAN_ITEM_TYPES, type PlanItemType } from "@/lib/annual-plan";

export type ActionResult = { ok: boolean; error?: string };

function mapError(message: string): string {
  if (message.includes("NOT_ALLOWED"))
    return "Apenas a Gerente da unidade (ou o Admin) gerencia o planejamento.";
  if (message.includes("PERIOD_IN_PAST"))
    return "Não é possível planejar (ou alterar) um período no passado.";
  if (message.includes("PEOPLE_REQUIRED"))
    return "Escolha ao menos um colaborador para as férias individuais.";
  if (message.includes("INVALID_PERIOD"))
    return "O fim deve ser igual ou depois do início.";
  return "Não foi possível salvar o item do planejamento.";
}

function validate(
  type: string,
  starts: string,
  ends: string
): string | null {
  if (!PLAN_ITEM_TYPES.includes(type as PlanItemType)) return "Tipo inválido.";
  if (!starts || !ends) return "Informe o período (início e fim).";
  if (ends < starts) return "O fim deve ser igual ou depois do início.";
  return null;
}

export async function createPlanItem(input: {
  clinicId: string;
  type: PlanItemType;
  starts: string;
  ends: string;
  title: string;
  note: string;
  userIds: string[];
}): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!hasRoleInClinic(session, input.clinicId, ["unit_manager"])) {
    return { ok: false, error: "Sem permissão para planejar o atendimento." };
  }
  const invalid = validate(input.type, input.starts, input.ends);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_plan_item", {
    p_clinic_id: input.clinicId,
    p_type: input.type,
    p_starts: input.starts,
    p_ends: input.ends,
    p_title: input.title.trim() || null,
    p_note: input.note.trim() || null,
    p_user_ids: input.userIds.filter(Boolean),
  });
  if (error) {
    console.error("create_plan_item failed:", error.message);
    return { ok: false, error: mapError(error.message) };
  }
  await logAudit({
    action: "create",
    entityType: "agenda_plan_item",
    entityId: input.clinicId,
    clinicId: input.clinicId,
  });
  revalidatePath("/agenda/planejamento-anual");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function updatePlanItem(input: {
  itemId: string;
  type: PlanItemType;
  starts: string;
  ends: string;
  title: string;
  note: string;
  userIds: string[];
}): Promise<ActionResult> {
  await getSessionContext();
  const invalid = validate(input.type, input.starts, input.ends);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_plan_item", {
    p_id: input.itemId,
    p_type: input.type,
    p_starts: input.starts,
    p_ends: input.ends,
    p_title: input.title.trim() || null,
    p_note: input.note.trim() || null,
    p_user_ids: input.userIds.filter(Boolean),
  });
  if (error) {
    console.error("update_plan_item failed:", error.message);
    return { ok: false, error: mapError(error.message) };
  }
  await logAudit({
    action: "update",
    entityType: "agenda_plan_item",
    entityId: input.itemId,
  });
  revalidatePath("/agenda/planejamento-anual");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function deletePlanItem(itemId: string): Promise<ActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_plan_item", { p_id: itemId });
  if (error) {
    console.error("delete_plan_item failed:", error.message);
    return { ok: false, error: mapError(error.message) };
  }
  revalidatePath("/agenda/planejamento-anual");
  revalidatePath("/agenda");
  return { ok: true };
}
