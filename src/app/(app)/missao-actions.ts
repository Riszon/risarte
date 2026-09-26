"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export type ActionResult = { ok: boolean; error?: string };

/**
 * ⚠️ O CLIQUE QUE COMEÇA A MISSÃO.
 *
 * Só a própria pessoa inicia — e a trava de verdade está no banco
 * (`ONLY_THE_PERSON_STARTS`), não aqui. A razão não é formalidade: o marco só
 * significa alguma coisa se ela SOUBER que dali em diante está sendo medida.
 * Admin iniciando pelos outros devolveria exatamente o problema que a 0273
 * existe para resolver — a pessoa estaria sendo avaliada enquanto ainda
 * pensava que estava aprendendo.
 */
export async function iniciarMinhaMissao(
  enrollmentId: string
): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "Sessão expirada. Entre de novo." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("start_training_mission", {
    p_enrollment_id: enrollmentId,
  });

  if (error) {
    const m = error.message;
    return {
      ok: false,
      error: m.includes("ONLY_THE_PERSON_STARTS")
        ? "Só você pode começar a sua própria missão."
        : m.includes("ENROLLMENT_NOT_FOUND")
          ? "Esta convocação não existe mais."
          : m.includes("ENROLLMENT_DISMISSED")
            ? "Você foi dispensado desta turma."
            : "Não foi possível iniciar a missão. Tente de novo.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "training_enrollments",
    entityId: enrollmentId,
  });

  revalidatePath("/");
  return { ok: true };
}
