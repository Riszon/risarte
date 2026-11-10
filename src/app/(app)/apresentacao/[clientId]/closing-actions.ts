"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type ClosingResult = {
  ok: boolean;
  error?: string;
  closed?: boolean;
  /** ORTO8 (0334): o caso ortodôntico aberto no fechamento (venda com ortodontia). */
  orthoCaseId?: string | null;
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
    // OC-00171 (0392): à mão, só com o papel assinado anexado.
    if (m.includes("PAPER_REQUIRED"))
      return {
        ok: false,
        error: "Para marcar o contrato à mão, anexe a foto ou o PDF do contrato assinado.",
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
  // ORTO8 (0334): venda com ortodontia → o caso nasceu no fechamento.
  const orthoCaseId = ((data as { ortho_case_id?: string | null } | null)?.ortho_case_id as string | null) ?? null;
  if (orthoCaseId) {
    revalidatePath("/ortodontia");
    revalidatePath("/ortodontia/atencao");
    revalidatePath("/ortodontia/casos");
  }
  return { ok: true, closed, orthoCaseId };
}

/**
 * OC-00171 (0392): o contrato assinado NO PAPEL só se marca com o papel
 * anexado. A tela envia o arquivo à pasta `contratos-papel`
 * (`<negociação>/<uuid>.<ext>`) e chama esta ação, que grava o papel e marca o
 * contrato numa transação só (`commercial_mark_paper_contract`).
 */
export async function markPaperContract(
  clientId: string,
  negotiationId: string,
  path: string,
  fileName: string
): Promise<ClosingResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("commercial_mark_paper_contract", {
    p_negotiation_id: negotiationId,
    p_path: path,
    p_name: fileName,
  });
  if (error) {
    const m = error.message;
    if (m.includes("NOT_ALLOWED")) return { ok: false, error: "Você não tem permissão para o fechamento." };
    if (m.includes("NOT_ACCEPTED"))
      return { ok: false, error: "A negociação precisa estar aceita pelo cliente antes do fechamento." };
    if (m.includes("ALREADY_CLOSED"))
      return { ok: false, error: "Venda já concluída — não é possível alterar o fechamento." };
    if (m.includes("FILE_NOT_FOUND"))
      return { ok: false, error: "O arquivo do contrato não chegou. Envie de novo." };
    if (error.code === "PGRST202")
      return { ok: false, error: "O banco ainda não recebeu a atualização 0392. Avise o administrador." };
    console.error("commercial_mark_paper_contract failed:", m);
    return { ok: false, error: "Não foi possível registrar o contrato." };
  }
  await logAudit({
    action: "update",
    entityType: "commercial_sale_paper",
    entityId: negotiationId,
  });
  revalidatePath(`/apresentacao/${clientId}`);
  revalidatePath(`/comercial/${clientId}`);
  revalidatePath(`/prontuarios/${clientId}`);
  revalidatePath("/comercial");
  revalidatePath("/jornada");
  const closed = Boolean((data as { closed?: boolean } | null)?.closed);
  const orthoCaseId = ((data as { ortho_case_id?: string | null } | null)?.ortho_case_id as string | null) ?? null;
  return { ok: true, closed, orthoCaseId };
}

/** OC-00171: link temporário (5 min) para ver o papel assinado — a regra da pasta decide quem vê. */
export async function linkDoPapelAssinado(
  negotiationId: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data: venda } = await supabase
    .from("commercial_sales")
    .select("contract_paper_path")
    .eq("negotiation_id", negotiationId)
    .maybeSingle<{ contract_paper_path: string | null }>();
  if (!venda?.contract_paper_path) return { ok: false, error: "Nenhum papel anexado a esta venda." };
  const { data, error } = await supabase.storage
    .from("contratos-papel")
    .createSignedUrl(venda.contract_paper_path, 300);
  if (error || !data?.signedUrl) return { ok: false, error: "Não foi possível abrir o arquivo agora." };
  await logAudit({ action: "view", entityType: "commercial_sale_paper", entityId: negotiationId });
  return { ok: true, url: data.signedUrl };
}
