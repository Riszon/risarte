"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type QualityResolution = "redo_same" | "redo_other" | "replan";

/**
 * Bloco D — o Coordenador marca a qualidade de um procedimento do plano
 * concluído. Revisão/Reprovado exigem motivo; Reprovado exige uma resolução
 * (mesmo dentista refaz / outro dentista refaz / incluir no próximo plano). A
 * RPC dispara os avisos aos dentistas e trava o plano se 100% aprovado.
 */
export async function setItemQuality(
  clientId: string,
  input: {
    itemId: string;
    status: "aprovado" | "revisao" | "reprovado";
    note?: string;
    executorId?: string | null;
    resolution?: QualityResolution | null;
    assignedId?: string | null;
  }
): Promise<{ ok: boolean; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_plan_item_quality", {
    p_item_id: input.itemId,
    p_status: input.status,
    p_note: input.note?.trim() || null,
    p_executor: input.executorId ?? null,
    p_resolution: input.resolution ?? null,
    p_assigned: input.assignedId ?? null,
  });
  if (error) {
    const m = error.message;
    if (m.includes("NOT_ALLOWED"))
      return { ok: false, error: "Apenas o Coordenador Clínico pode conferir a qualidade." };
    if (m.includes("LOCKED"))
      return { ok: false, error: "Este plano já está 100% aprovado — controle concluído." };
    if (m.includes("NOTE_REQUIRED"))
      return { ok: false, error: "Descreva o motivo da revisão/reprovação." };
    if (m.includes("RESOLUTION_REQUIRED"))
      return { ok: false, error: "Escolha o que fazer com o procedimento reprovado." };
    if (m.includes("ASSIGNED_REQUIRED"))
      return { ok: false, error: "Indique o dentista que vai refazer o procedimento." };
    console.error("set_plan_item_quality failed:", m);
    return { ok: false, error: "Não foi possível registrar a conferência." };
  }
  revalidatePath(`/avaliacao/${clientId}`);
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}

/** Botão do fim do checklist: pede à recepção para agendar as revisões/refações. */
export async function requestQualityScheduling(
  clientId: string,
  planId: string
): Promise<{ ok: boolean; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_quality_scheduling", {
    p_plan_id: planId,
  });
  if (error) {
    const m = error.message;
    if (m.includes("NOT_ALLOWED"))
      return { ok: false, error: "Apenas o Coordenador Clínico pode solicitar o agendamento." };
    if (m.includes("NOTHING_TO_SCHEDULE"))
      return { ok: false, error: "Nenhum procedimento marcado para revisão/refação." };
    console.error("request_quality_scheduling failed:", m);
    return { ok: false, error: "Não foi possível solicitar o agendamento." };
  }
  revalidatePath(`/avaliacao/${clientId}`);
  return { ok: true };
}
