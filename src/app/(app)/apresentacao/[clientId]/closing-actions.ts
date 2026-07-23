"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ClosingResult = {
  ok: boolean;
  error?: string;
  closed?: boolean;
};

/**
 * COM4 — marca (ou desmarca) um passo do fechamento: contrato assinado ou
 * pagamento confirmado. Regra de ouro: quando os dois estão marcados, a venda é
 * concluída no banco (cliente vai à Fase 5 + avisos). Marcação manual-primeiro.
 */
export async function markClosingStep(
  clientId: string,
  negotiationId: string,
  step: "contract" | "payment",
  value: boolean
): Promise<ClosingResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("commercial_close_step", {
    p_negotiation_id: negotiationId,
    p_step: step,
    p_value: value,
  });
  if (error) {
    const m = error.message;
    if (m.includes("NOT_ALLOWED"))
      return { ok: false, error: "Você não tem permissão para o fechamento." };
    if (m.includes("NOT_ACCEPTED"))
      return {
        ok: false,
        error: "A negociação precisa estar aceita pelo cliente antes do fechamento.",
      };
    if (m.includes("ALREADY_CLOSED"))
      return {
        ok: false,
        error: "Venda já concluída — não é possível alterar o fechamento.",
      };
    console.error("commercial_close_step failed:", m);
    return { ok: false, error: "Não foi possível registrar o fechamento." };
  }
  revalidatePath(`/apresentacao/${clientId}`);
  revalidatePath(`/comercial/${clientId}`);
  revalidatePath("/comercial");
  revalidatePath("/jornada");
  revalidatePath("/notificacoes");
  const closed = Boolean((data as { closed?: boolean } | null)?.closed);
  return { ok: true, closed };
}
