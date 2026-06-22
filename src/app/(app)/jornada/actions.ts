"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  JOURNEY_PHASES,
  JOURNEY_STATUSES,
  TREATMENT_PILLARS,
  type JourneyPhase,
  type JourneyStatus,
  type TreatmentPillar,
} from "@/lib/journey";

export type ActionResult = { ok: boolean; error?: string };

/** Answer a mandatory end-of-treatment decision (Sim / Não / Não sei). */
export async function answerDecision(
  decisionId: string,
  answer: "yes" | "no" | "unsure"
): Promise<ActionResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_decision", {
    p_decision_id: decisionId,
    p_answer: answer,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite responder esta decisão." };
    }
    if (error.message.includes("ALREADY_RESOLVED")) {
      return { ok: false, error: "Esta decisão já foi respondida." };
    }
    console.error("answer_decision failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a decisão." };
  }
  revalidatePath("/jornada");
  revalidatePath("/notificacoes");
  return { ok: true };
}

/** The responsible role advances the client's sub-status within a phase. */
export async function setJourneyStatus(
  clientId: string,
  status: JourneyStatus
): Promise<ActionResult> {
  if (!JOURNEY_STATUSES.includes(status)) {
    return { ok: false, error: "Status inválido." };
  }
  await getSessionContext();

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_journey_status", {
    p_client_id: clientId,
    p_status: status,
  });

  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite definir este status." };
    }
    if (error.message.includes("STATUS_INVALID_FOR_PHASE")) {
      return { ok: false, error: "Este status não pertence à fase atual." };
    }
    console.error("set_journey_status failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar o status." };
  }

  revalidatePath("/jornada");
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}

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
    if (error.message.includes("PILLAR_ONLY_IN_PLANNING")) {
      return {
        ok: false,
        error:
          "O pilar de tratamento só pode ser definido pelo Planner na Fase 3 (Centro de Planejamento).",
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

  const session = await getSessionContext(); // ensures the user is authenticated

  const supabase = await createClient();

  // Leaving the Planning Center (3 → 4) requires the treatment pillar AND an
  // approved plan (Etapa 5.3). Admin Master may override.
  if (newPhase === "commercial_conversion") {
    const { data: client } = await supabase
      .from("clients")
      .select("journey_phase, methodology_pillar")
      .eq("id", clientId)
      .single();
    if (client?.journey_phase === "planning_center") {
      if (!client?.methodology_pillar) {
        return {
          ok: false,
          error:
            "Defina o pilar de tratamento antes de avançar para a Conversão Comercial.",
        };
      }
      if (!session.isAdminMaster) {
        const { data: planRows } = await supabase
          .from("treatment_plans")
          .select("status")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(1);
        if (planRows?.[0]?.status !== "approved") {
          return {
            ok: false,
            error:
              "O plano precisa ser aprovado pelo Coordenador Clínico antes de enviar ao Comercial.",
          };
        }
      }
    }
  }

  // The database function enforces the role-based transition matrix, moves
  // the client, tracks time, notifies the responsible role and writes the
  // audit log — atomically.
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
