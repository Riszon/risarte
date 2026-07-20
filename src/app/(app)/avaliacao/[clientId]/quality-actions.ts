"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Bloco D — o Coordenador marca a qualidade de um procedimento do plano
 * concluído (aprovado / revisão / reprovado). Quando 100% aprovado, a RPC trava
 * o plano (não pede revisão de novo). Permissão conferida na RPC.
 */
export async function setItemQuality(
  clientId: string,
  itemId: string,
  status: "aprovado" | "revisao" | "reprovado",
  note?: string
): Promise<{ ok: boolean; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_plan_item_quality", {
    p_item_id: itemId,
    p_status: status,
    p_note: note?.trim() || null,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Apenas o Coordenador Clínico pode conferir a qualidade.",
      };
    }
    if (error.message.includes("LOCKED")) {
      return {
        ok: false,
        error: "Este plano já está 100% aprovado — controle de qualidade concluído.",
      };
    }
    console.error("set_plan_item_quality failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a conferência." };
  }
  revalidatePath(`/avaliacao/${clientId}`);
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}
