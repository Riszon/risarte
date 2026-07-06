"use server";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type ActionResult = { ok: boolean; error?: string };

/**
 * AJ4: pede à recepção da unidade do cliente que agende a apresentação comercial.
 * Dispara um aviso forte (RPC security-definer) que aparece no pop-up da recepção.
 */
export async function requestCommercialScheduling(
  clientId: string
): Promise<ActionResult> {
  if (!clientId) return { ok: false, error: "Cliente inválido." };
  const session = await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("request_commercial_scheduling", {
    p_client_id: clientId,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Você não tem acesso a esta unidade para pedir o agendamento.",
      };
    }
    console.error("requestCommercialScheduling failed:", error.message);
    return { ok: false, error: "Não foi possível enviar o pedido." };
  }

  await logAudit({
    action: "update",
    entityType: "client",
    entityId: clientId,
    details: { requested: "commercial_scheduling" },
    clinicId: session.activeClinic?.id,
  });
  return { ok: true };
}
