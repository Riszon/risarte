"use server";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Gera (idempotente) as sessões a agendar do tratamento quando o cliente está em
 * Início de Tratamento (Fase 5). Disparado ao abrir a ficha. A própria RPC checa
 * a fase, a opção principal aprovada e se já existem sessões.
 */
export async function ensureTreatmentSessions(clientId: string): Promise<void> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("ensure_treatment_sessions", {
    p_client_id: clientId,
  });
  if (error) {
    console.error("ensure_treatment_sessions failed:", error.message);
  }
}
