"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  JOURNEY_PHASES,
  TREATMENT_PILLARS,
  type JourneyPhase,
  type TreatmentPillar,
} from "@/lib/journey";

export type ActionResult = { ok: boolean; error?: string };

/** The Dentista Planner classifies the client's treatment pillar (phase 3+). */
export async function setTreatmentPillar(
  clientId: string,
  pillar: TreatmentPillar
): Promise<ActionResult> {
  if (!TREATMENT_PILLARS.includes(pillar)) {
    return { ok: false, error: "Pilar inválido." };
  }
  await getSessionContext();

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_treatment_pillar", {
    p_client_id: clientId,
    p_pillar: pillar,
  });

  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Apenas o Dentista Planner pode definir o pilar de tratamento.",
      };
    }
    console.error("set_treatment_pillar failed:", error.message);
    return { ok: false, error: "Não foi possível definir o pilar." };
  }

  revalidatePath("/jornada");
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}

export async function moveClientPhase(
  clientId: string,
  newPhase: JourneyPhase
): Promise<ActionResult> {
  if (!JOURNEY_PHASES.includes(newPhase)) {
    return { ok: false, error: "Fase inválida." };
  }

  await getSessionContext(); // ensures the user is authenticated

  // The database function enforces the role-based transition matrix, moves
  // the client, tracks time, notifies the responsible role and writes the
  // audit log — atomically.
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_client_phase", {
    p_client_id: clientId,
    p_new_phase: newPhase,
  });

  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Sua função não permite esta movimentação de fase.",
      };
    }
    console.error("move_client_phase failed:", error.message);
    return { ok: false, error: "Não foi possível mover o cliente de fase." };
  }

  revalidatePath("/jornada");
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}
