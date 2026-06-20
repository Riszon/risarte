"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ShareResult = { ok: boolean; error?: string };

export async function shareClientWithUnit(
  clientId: string,
  targetClinicId: string,
  reason: string
): Promise<ShareResult> {
  await getSessionContext();
  if (!targetClinicId) return { ok: false, error: "Escolha a unidade." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("share_client_with_unit", {
    p_client_id: clientId,
    p_target_clinic_id: targetClinicId,
    p_reason: reason || null,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Você não tem permissão para compartilhar este cliente.",
      };
    }
    if (error.message.includes("SAME_CLINIC")) {
      return {
        ok: false,
        error: "Escolha uma unidade diferente da unidade atual do cliente.",
      };
    }
    if (error.message.includes("TARGET_NOT_UNIT")) {
      return {
        ok: false,
        error: "Só é possível compartilhar com uma unidade franqueada.",
      };
    }
    console.error("share_client_with_unit failed:", error.message);
    return { ok: false, error: "Não foi possível compartilhar o cliente." };
  }
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}

export async function endClientShare(
  shareId: string,
  clientId: string
): Promise<ShareResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_client_share", {
    p_share_id: shareId,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Você não tem permissão para encerrar este compartilhamento.",
      };
    }
    console.error("end_client_share failed:", error.message);
    return { ok: false, error: "Não foi possível encerrar o compartilhamento." };
  }
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}
