"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { CancellationDestination } from "@/lib/finance/cancellation";

export type CancellationResult = {
  ok: boolean;
  error?: string;
  /** Id do termo criado — a tela navega para ele. */
  cancellationId?: string;
};

/**
 * 0206 — passo 1: APURAR. Calcula e congela o acerto de contas, sem desfazer
 * nada. Enquanto o termo não for assinado e efetivado, o tratamento continua
 * de pé: se a conversa com o paciente mudar de rumo, é só descartar.
 */
export async function openPlanCancellation(input: {
  clientId: string;
  negotiationId: string;
  reason: string;
  destination: CancellationDestination | null;
  returnDate: string | null;
  notes: string;
}): Promise<CancellationResult> {
  await getSessionContext();
  const supabase = await createClient();

  if (!input.reason.trim()) {
    return { ok: false, error: "Escreva o motivo do cancelamento." };
  }

  const { data, error } = await supabase.rpc("open_plan_cancellation", {
    p_negotiation_id: input.negotiationId,
    p_reason: input.reason,
    p_destination: input.destination,
    p_return_date: input.returnDate,
    p_notes: input.notes || null,
  });
  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_OPEN")) {
      return {
        ok: false,
        error: "Já existe um termo de cancelamento em aberto para este plano.",
      };
    }
    if (m.includes("ALREADY_CANCELLED")) {
      return { ok: false, error: "Este plano já foi cancelado." };
    }
    if (m.includes("DESTINATION_REQUIRED")) {
      return {
        ok: false,
        error: "Escolha para onde o cliente vai depois do cancelamento.",
      };
    }
    if (m.includes("RETURN_DATE_REQUIRED")) {
      return { ok: false, error: "Informe a data de retorno do acompanhamento." };
    }
    if (m.includes("REASON_REQUIRED")) {
      return { ok: false, error: "Escreva o motivo do cancelamento." };
    }
    if (m.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Cancelar tratamento é do Gerente da unidade ou do Admin Master.",
      };
    }
    console.error("open_plan_cancellation failed:", m);
    return { ok: false, error: "Não foi possível apurar o cancelamento." };
  }

  await logAudit({
    action: "create",
    entityType: "plan_cancellation",
    entityId: typeof data === "string" ? data : input.negotiationId,
  });
  revalidatePath(`/apresentacao/${input.clientId}`);
  revalidatePath(`/comercial/${input.clientId}`);
  return { ok: true, cancellationId: typeof data === "string" ? data : undefined };
}

/** Passo 2: o cliente assinou o termo (marcação manual, como o fechamento). */
export async function signPlanCancellation(input: {
  id: string;
  clientId: string;
  signed: boolean;
}): Promise<CancellationResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("sign_plan_cancellation", {
    p_id: input.id,
    p_signed: input.signed,
  });
  if (error) {
    if (error.message.includes("ALREADY_APPLIED")) {
      return { ok: false, error: "Este cancelamento já foi efetivado." };
    }
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite esta ação." };
    }
    console.error("sign_plan_cancellation failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a assinatura." };
  }

  await logAudit({
    action: "update",
    entityType: "plan_cancellation_sign",
    entityId: input.id,
  });
  revalidatePath(`/cancelamentos/${input.id}/termo`);
  return { ok: true };
}

/**
 * Passo 3: EFETIVAR. É só aqui que sessões, cobranças e fase mudam — e o banco
 * exige o termo assinado antes.
 */
export async function applyPlanCancellation(input: {
  id: string;
  clientId: string;
}): Promise<CancellationResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("apply_plan_cancellation", {
    p_id: input.id,
  });
  if (error) {
    const m = error.message;
    if (m.includes("TERM_NOT_SIGNED")) {
      return {
        ok: false,
        error:
          "O termo precisa estar assinado pelo cliente antes de efetivar o cancelamento.",
      };
    }
    if (m.includes("ALREADY_APPLIED")) {
      return { ok: false, error: "Este cancelamento já foi efetivado." };
    }
    if (m.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Cancelar tratamento é do Gerente da unidade ou do Admin Master.",
      };
    }
    console.error("apply_plan_cancellation failed:", m);
    return { ok: false, error: "Não foi possível efetivar o cancelamento." };
  }

  await logAudit({
    action: "update",
    entityType: "plan_cancellation_apply",
    entityId: input.id,
  });
  revalidatePath(`/cancelamentos/${input.id}/termo`);
  revalidatePath(`/prontuarios/${input.clientId}`);
  revalidatePath(`/apresentacao/${input.clientId}`);
  revalidatePath("/jornada");
  revalidatePath("/comercial");
  return { ok: true };
}

/** Desistiu do cancelamento: joga o termo fora sem tocar no tratamento. */
export async function discardPlanCancellation(input: {
  id: string;
  clientId: string;
}): Promise<CancellationResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("discard_plan_cancellation", {
    p_id: input.id,
  });
  if (error) {
    if (error.message.includes("ALREADY_APPLIED")) {
      return {
        ok: false,
        error: "Este cancelamento já foi efetivado — não dá para descartar.",
      };
    }
    console.error("discard_plan_cancellation failed:", error.message);
    return { ok: false, error: "Não foi possível descartar o termo." };
  }

  revalidatePath(`/apresentacao/${input.clientId}`);
  return { ok: true };
}
