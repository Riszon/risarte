"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

/**
 * Admin Master salva a orientação da rede sobre Avaliação/Reavaliação, que o
 * Coordenador consulta no cockpit. Conteúdo geral (sem clinic_id).
 */
export async function saveClinicalGuidance(
  kind: "avaliacao" | "reavaliacao",
  content: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) {
    return {
      ok: false,
      error: "Apenas o Admin Master pode editar a orientação.",
    };
  }
  if (kind !== "avaliacao" && kind !== "reavaliacao") {
    return { ok: false, error: "Tipo inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("clinical_guidance").upsert(
    {
      kind,
      content: content.trim() || null,
      updated_by: session.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "kind" }
  );
  if (error) {
    console.error("saveClinicalGuidance failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a orientação." };
  }
  await logAudit({
    action: "update",
    entityType: "clinical_guidance",
    entityId: kind,
  });
  revalidatePath("/avaliacao", "layout");
  return { ok: true };
}
