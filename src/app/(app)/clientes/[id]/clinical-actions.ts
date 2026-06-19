"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  CLINICAL_BUCKET,
  CLINICAL_MEDIA_KINDS,
  type ClinicalMediaInput,
  type ClinicalResult,
} from "@/lib/clinical";

/** Only the clinic's Coordenador Clínico (or Admin) may record the evaluation. */
async function requireCoordinator(
  clientId: string
): Promise<{ error: string } | { clinicId: string; userId: string }> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("clinic_id")
    .eq("id", clientId)
    .single();
  if (!client) return { error: "Cliente não encontrado." };
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, client.clinic_id, ["clinical_coordinator"])
  ) {
    return { error: "Apenas o Coordenador Clínico pode registrar a avaliação." };
  }
  return { clinicId: client.clinic_id as string, userId: session.userId };
}

async function hasConsent(clientId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_consents")
    .select("id")
    .eq("client_id", clientId)
    .is("revoked_at", null)
    .limit(1);
  return Boolean(data && data.length > 0);
}

/** LGPD: register the patient's consent before any clinical data is collected. */
export async function recordConsent(clientId: string): Promise<ClinicalResult> {
  const guard = await requireCoordinator(clientId);
  if ("error" in guard) return { ok: false, error: guard.error };

  if (await hasConsent(clientId)) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.from("client_consents").insert({
    client_id: clientId,
    clinic_id: guard.clinicId,
    recorded_by: guard.userId,
  });
  if (error) {
    console.error("recordConsent failed:", error.message);
    return { ok: false, error: "Não foi possível registrar o consentimento." };
  }
  await logAudit({
    action: "create",
    entityType: "client_consent",
    entityId: clientId,
    clinicId: guard.clinicId,
  });
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}

export async function addClinicalNote(
  clientId: string,
  body: string
): Promise<ClinicalResult> {
  const text = body.trim();
  if (!text) return { ok: false, error: "Escreva a consideração antes de salvar." };

  const guard = await requireCoordinator(clientId);
  if ("error" in guard) return { ok: false, error: guard.error };
  if (!(await hasConsent(clientId))) {
    return {
      ok: false,
      error: "Registre o consentimento do paciente antes de adicionar dados.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("clinical_notes").insert({
    client_id: clientId,
    clinic_id: guard.clinicId,
    body: text,
    created_by: guard.userId,
  });
  if (error) {
    console.error("addClinicalNote failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a consideração." };
  }
  await logAudit({
    action: "create",
    entityType: "clinical_note",
    entityId: clientId,
    clinicId: guard.clinicId,
  });
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}

/** Records the metadata after the file itself was uploaded to Storage. */
export async function recordClinicalMedia(
  clientId: string,
  input: ClinicalMediaInput
): Promise<ClinicalResult> {
  const guard = await requireCoordinator(clientId);
  if ("error" in guard) return { ok: false, error: guard.error };
  if (!(await hasConsent(clientId))) {
    return {
      ok: false,
      error: "Registre o consentimento do paciente antes de enviar arquivos.",
    };
  }
  if (!CLINICAL_MEDIA_KINDS.includes(input.kind)) {
    return { ok: false, error: "Tipo de arquivo inválido." };
  }
  // Defense-in-depth: the path must live under this clinic's folder.
  if (!input.storagePath.startsWith(`${guard.clinicId}/`)) {
    return { ok: false, error: "Caminho de arquivo inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("clinical_media").insert({
    client_id: clientId,
    clinic_id: guard.clinicId,
    kind: input.kind,
    storage_path: input.storagePath,
    original_name: input.originalName,
    content_type: input.contentType,
    size_bytes: input.sizeBytes,
    uploaded_by: guard.userId,
  });
  if (error) {
    console.error("recordClinicalMedia failed:", error.message);
    return { ok: false, error: "Não foi possível registrar o arquivo." };
  }
  await logAudit({
    action: "create",
    entityType: "clinical_media",
    entityId: clientId,
    clinicId: guard.clinicId,
  });
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}

export async function deleteClinicalMedia(
  mediaId: string
): Promise<ClinicalResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: media } = await supabase
    .from("clinical_media")
    .select("client_id, clinic_id, storage_path")
    .eq("id", mediaId)
    .single();
  if (!media) return { ok: false, error: "Arquivo não encontrado." };
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, media.clinic_id, ["clinical_coordinator"])
  ) {
    return {
      ok: false,
      error: "Apenas o Coordenador Clínico pode remover arquivos.",
    };
  }

  // External-link items have no file in Storage.
  if (media.storage_path) {
    await supabase.storage.from(CLINICAL_BUCKET).remove([media.storage_path]);
  }
  const { error } = await supabase
    .from("clinical_media")
    .delete()
    .eq("id", mediaId);
  if (error) {
    console.error("deleteClinicalMedia failed:", error.message);
    return { ok: false, error: "Não foi possível remover o arquivo." };
  }
  await logAudit({
    action: "update",
    entityType: "clinical_media",
    entityId: media.client_id,
    clinicId: media.clinic_id,
    details: { removed: true },
  });
  revalidatePath(`/clientes/${media.client_id}`);
  return { ok: true };
}

/** Edit a consideration; the previous version is kept in the history. */
export async function editClinicalNote(
  noteId: string,
  body: string
): Promise<ClinicalResult> {
  const text = body.trim();
  if (!text) return { ok: false, error: "A consideração não pode ficar vazia." };

  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: note } = await supabase
    .from("clinical_notes")
    .select("client_id, clinic_id, body")
    .eq("id", noteId)
    .single();
  if (!note) return { ok: false, error: "Consideração não encontrada." };
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, note.clinic_id, ["clinical_coordinator"])
  ) {
    return {
      ok: false,
      error: "Apenas o Coordenador Clínico pode editar as considerações.",
    };
  }
  if (note.body === text) return { ok: true };

  // Keep the previous version in the history before overwriting.
  await supabase.from("clinical_note_revisions").insert({
    note_id: noteId,
    client_id: note.client_id,
    clinic_id: note.clinic_id,
    body: note.body,
    edited_by: session.userId,
  });

  const { error } = await supabase
    .from("clinical_notes")
    .update({
      body: text,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    })
    .eq("id", noteId);
  if (error) {
    console.error("editClinicalNote failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a edição." };
  }
  await logAudit({
    action: "update",
    entityType: "clinical_note",
    entityId: note.client_id,
    clinicId: note.clinic_id,
    details: { edited: true },
  });
  revalidatePath(`/clientes/${note.client_id}`);
  return { ok: true };
}

/** Add a clinical media item that is a LINK (e.g. a 3D scan), not a file. */
export async function addExternalMedia(
  clientId: string,
  input: { kind: string; url: string; label: string }
): Promise<ClinicalResult> {
  const url = input.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    return {
      ok: false,
      error: "Informe um link válido (começando com http:// ou https://).",
    };
  }
  const guard = await requireCoordinator(clientId);
  if ("error" in guard) return { ok: false, error: guard.error };
  if (!(await hasConsent(clientId))) {
    return {
      ok: false,
      error: "Registre o consentimento do paciente antes de adicionar dados.",
    };
  }
  if (!CLINICAL_MEDIA_KINDS.includes(input.kind as never)) {
    return { ok: false, error: "Tipo inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("clinical_media").insert({
    client_id: clientId,
    clinic_id: guard.clinicId,
    kind: input.kind,
    storage_path: null,
    external_url: url,
    original_name: input.label.trim() || url,
    uploaded_by: guard.userId,
  });
  if (error) {
    console.error("addExternalMedia failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o link." };
  }
  await logAudit({
    action: "create",
    entityType: "clinical_media",
    entityId: clientId,
    clinicId: guard.clinicId,
  });
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}
