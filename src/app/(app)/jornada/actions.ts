"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { JOURNEY_PHASES, type JourneyPhase } from "@/lib/journey";

export type ActionResult = { ok: boolean; error?: string };

const OPERATIONAL_ROLES = [
  "receptionist",
  "clinical_coordinator",
  "planner_dentist",
  "commercial_consultant",
  "commercial_assistant",
] as const;

export async function moveClientPhase(
  clientId: string,
  newPhase: JourneyPhase
): Promise<ActionResult> {
  if (!JOURNEY_PHASES.includes(newPhase)) {
    return { ok: false, error: "Fase inválida." };
  }

  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("clinic_id")
    .eq("id", clientId)
    .single();

  if (!client) return { ok: false, error: "Cliente não encontrado." };
  if (!hasRoleInClinic(session, client.clinic_id, [...OPERATIONAL_ROLES])) {
    return {
      ok: false,
      error: "Sua função não permite mover clientes de fase.",
    };
  }

  // The database function moves the client, tracks time, notifies the
  // responsible role and writes the audit log — atomically.
  const { error } = await supabase.rpc("move_client_phase", {
    p_client_id: clientId,
    p_new_phase: newPhase,
  });

  if (error) {
    console.error("move_client_phase failed:", error.message);
    return { ok: false, error: "Não foi possível mover o cliente de fase." };
  }

  revalidatePath("/jornada");
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}
