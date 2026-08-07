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
 * 0205 — cancela uma venda fechada pelo Comercial.
 *
 * Desfaz os efeitos (sessões não realizadas, cobranças em aberto) e devolve o
 * cliente à **Fase 4**, de onde ele pode ser renegociado ou marcado como
 * perdido. **Com recebimento, não cancela**: dinheiro que entrou sai por
 * estorno ou renegociação, nunca por cancelamento.
 */
export async function cancelNegotiationSale(
  clientId: string,
  negotiationId: string,
  reason: string
): Promise<ClosingResult> {
  await getSessionContext();
  const supabase = await createClient();

  if (!reason.trim()) {
    return { ok: false, error: "Escreva o motivo do cancelamento." };
  }

  const { error } = await supabase.rpc("cancel_negotiation", {
    p_negotiation_id: negotiationId,
    p_reason: reason,
  });
  if (error) {
    const m = error.message;
    if (m.includes("HAS_RECEIPTS")) {
      return {
        ok: false,
        error:
          "Esta venda já tem recebimento. Estorne a baixa ou faça uma renegociação — cancelar não faz o dinheiro desaparecer.",
      };
    }
    if (m.includes("ALREADY_CANCELLED")) {
      return { ok: false, error: "Esta venda já foi cancelada." };
    }
    if (m.includes("REASON_REQUIRED")) {
      return { ok: false, error: "Escreva o motivo do cancelamento." };
    }
    if (m.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Cancelar venda é do Gerente da unidade ou do Admin Master.",
      };
    }
    console.error("cancel_negotiation failed:", m);
    return { ok: false, error: "Não foi possível cancelar a venda." };
  }

  revalidatePath(`/apresentacao/${clientId}`);
  revalidatePath(`/comercial/${clientId}`);
  revalidatePath(`/prontuarios/${clientId}`);
  revalidatePath("/comercial");
  revalidatePath("/jornada");
  return { ok: true };
}

/**
 * COM4 — marca (ou desmarca) um passo do fechamento: contrato assinado ou
 * pagamento confirmado. Regra de ouro: quando os dois estão marcados, a venda é
 * concluída no banco (cliente vai à Fase 5 + avisos). Marcação manual-primeiro.
 */
export async function markClosingStep(
  clientId: string,
  negotiationId: string,
  /**
   * 0202: `payment_issued` (cobrança gerada) entrou para a venda do Comercial
   * ter os MESMOS três passos da venda direta e da renegociação — é o passo que
   * o ASAAS vai preencher sozinho. `payment` continua valendo como apelido de
   * `payment_confirmed`.
   */
  step: "contract" | "payment_issued" | "payment_confirmed" | "payment",
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
