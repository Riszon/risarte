"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string };

/** H4.6 D: o Dentista cria um pedido (reavaliação / revisão do plano). A RPC
 * avisa o Coordenador. Retorna o id para anexar arquivos em seguida. */
export async function createClinicalRequest(input: {
  clientId: string;
  kind: "reevaluation" | "plan_revision";
  body: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_clinical_request", {
    p_client_id: input.clientId,
    p_kind: input.kind,
    p_body: input.body,
  });
  if (error || !data) {
    if (error?.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Apenas o dentista pode registrar o pedido." };
    }
    console.error("create_clinical_request failed:", error?.message);
    return { ok: false, error: "Não foi possível registrar o pedido." };
  }
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true, id: data as string };
}

/** Registra o metadado de um anexo já enviado ao Storage (bucket clinical-media). */
export async function recordRequestMedia(input: {
  requestId: string;
  clientId: string;
  clinicId: string;
  kind: string;
  storagePath: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<Result> {
  const session = await getSessionContext();
  const canAttach =
    session.isAdminMaster ||
    hasRoleInClinic(session, input.clinicId, ["dentist", "clinical_coordinator"]);
  if (!canAttach) return { ok: false, error: "Sem permissão para anexar." };
  if (!input.storagePath.startsWith(`${input.clinicId}/`)) {
    return { ok: false, error: "Caminho de arquivo inválido." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("clinical_request_media").insert({
    request_id: input.requestId,
    client_id: input.clientId,
    clinic_id: input.clinicId,
    kind: input.kind,
    storage_path: input.storagePath,
    original_name: input.originalName,
    content_type: input.contentType,
    size_bytes: input.sizeBytes,
    uploaded_by: session.userId,
  });
  if (error) {
    console.error("recordRequestMedia failed:", error.message);
    return { ok: false, error: "Não foi possível registrar o anexo." };
  }
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true };
}

/** O Coordenador resolve o pedido (a RPC avisa quem pediu). */
export async function resolveClinicalRequest(
  requestId: string,
  clientId: string,
  note: string
): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_clinical_request", {
    p_request_id: requestId,
    p_note: note,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Apenas o coordenador clínico pode resolver o pedido.",
      };
    }
    console.error("resolve_clinical_request failed:", error.message);
    return { ok: false, error: "Não foi possível resolver o pedido." };
  }
  await logAudit({ action: "update", entityType: "clinical_request", entityId: requestId });
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}
