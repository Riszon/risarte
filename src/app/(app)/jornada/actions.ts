"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
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
  revalidatePath(`/prontuarios/${clientId}`);
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
  revalidatePath(`/prontuarios/${clientId}`);
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

  // Fase 2: ao enviar ao Comercial (3→4), os planos aprovados que ainda não
  // entraram no ciclo de vida passam a "Aguardando apresentação" (automático).
  if (newPhase === "commercial_conversion") {
    const { data: approvedPlans } = await supabase
      .from("treatment_plans")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "approved")
      .is("lifecycle", null)
      .returns<{ id: string }[]>();
    for (const p of approvedPlans ?? []) {
      await supabase.rpc("set_plan_lifecycle", {
        p_plan_id: p.id,
        p_to: "aguardando_apresentacao",
        p_note: "Enviado ao Comercial",
      });
    }
  }

  revalidatePath("/jornada");
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}

/**
 * H3.10: Coordenador envia o cliente ao Centro de Planejamento — move a fase e,
 * em seguida, conclui o atendimento em curso e avisa a Recepção para agendar a
 * apresentação comercial (RPC send_to_planning_followup).
 */
export async function sendToPlanningCenter(
  clientId: string
): Promise<ActionResult> {
  const moved = await moveClientPhase(clientId, "planning_center");
  if (!moved.ok) return moved;

  const supabase = await createClient();
  const { error } = await supabase.rpc("send_to_planning_followup", {
    p_client_id: clientId,
  });
  if (error) {
    // Follow-up é best-effort — a movimentação já ocorreu.
    console.error("send_to_planning_followup failed:", error.message);
  }
  revalidatePath("/atendimento");
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}

/**
 * CONCLUIR A REAVALIAÇÃO, SEM NOVO PLANO (21/09/2026, decisão do dono).
 *
 * Era a única passagem da jornada que dependia de alguém EMPURRAR o cartão: o
 * Coordenador terminava a reavaliação, não havia novo plano a fazer, e a fase
 * só andava se ele arrastasse. Virou ato: ele conclui, e a fase anda como
 * consequência — igual ao "Enviar ao Centro de Planejamento", que é a outra
 * saída da mesma tela.
 */
export async function concluirReavaliacao(
  clientId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("journey_phase")
    .eq("id", clientId)
    .single<{ journey_phase: JourneyPhase }>();

  // A trava de verdade é a 0266; aqui a mensagem é amigável.
  if (client?.journey_phase !== "reevaluation") {
    return {
      ok: false,
      error: "Este cliente não está na Reavaliação.",
    };
  }
  return moveClientPhase(clientId, "follow_up");
}

/**
 * DEVOLVER AO COORDENADOR (21/09/2026, decisão do dono).
 *
 * O Planner precisa de mais dados (ou de uma reavaliação) antes de planejar. Já
 * existia como movimentação solta no kanban; virou ato com MOTIVO, porque
 * devolver sem dizer o porquê faz o caso voltar igual — e o tempo perdido
 * aparece no SLA como se fosse lentidão do Coordenador.
 */
export async function devolverAoCoordenador(
  clientId: string,
  destino: "clinical_conversion" | "reevaluation",
  motivo: string
): Promise<ActionResult> {
  const texto = motivo.trim();
  if (texto.length < 10) {
    return {
      ok: false,
      error: "Escreva o que falta para o caso ser planejado (mín. 10 letras).",
    };
  }

  const moved = await moveClientPhase(clientId, destino);
  if (!moved.ok) return moved;

  const supabase = await createClient();
  const session = await getSessionContext();
  const { data: client } = await supabase
    .from("clients")
    .select("full_name, clinic_id")
    .eq("id", clientId)
    .single<{ full_name: string; clinic_id: string }>();

  // O motivo vai para quem recebe o caso de volta — senão ele volta igual.
  if (client) {
    const { data: coordenadores } = await supabase
      .from("user_clinic_roles")
      .select("user_id")
      .eq("clinic_id", client.clinic_id)
      .eq("role", "clinical_coordinator")
      .returns<{ user_id: string }[]>();
    const avisos = (coordenadores ?? [])
      .filter((c) => c.user_id !== session.userId)
      .map((c) => ({
        user_id: c.user_id,
        clinic_id: client.clinic_id,
        title: "Caso devolvido pelo Centro de Planejamento",
        body: `${client.full_name} — ${texto}`,
        link: `/prontuarios/${clientId}`,
      }));
    if (avisos.length > 0) await supabase.from("notifications").insert(avisos);
  }

  await logAudit({
    action: "update",
    entityType: "client_phase",
    entityId: clientId,
    clinicId: client?.clinic_id,
    details: { devolvido_para: destino, com_motivo: true },
  });

  revalidatePath("/jornada");
  revalidatePath("/planejamento");
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}
