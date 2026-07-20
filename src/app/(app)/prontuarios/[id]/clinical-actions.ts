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
  type EvaluationKind,
} from "@/lib/clinical";

/**
 * Fase 3 — resolve a rodada de avaliação ABERTA do cliente na unidade (cria a
 * "Avaliação 1" se ainda não houver). Toda consideração/mídia entra nesta rodada.
 */
async function openEvaluationId(
  clientId: string,
  clinicId: string
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ensure_open_evaluation", {
    p_client: clientId,
    p_clinic: clinicId,
  });
  if (error) {
    console.error("ensure_open_evaluation failed:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/**
 * Only the Coordenador Clínico (or Admin) may record the evaluation. The clinic
 * the record is scoped to is the home unit OR a unit the client is currently
 * SHARED with (E7) — preferring the user's active clinic — so a shared unit (B)
 * keeps its own clinical records, separate from the home unit (A).
 */
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

  const { data: shares } = await supabase
    .from("client_shares")
    .select("clinic_id")
    .eq("client_id", clientId)
    .is("ended_at", null);
  const sharedIds = (shares ?? []).map((s) => s.clinic_id as string);
  const candidates = [client.clinic_id as string, ...sharedIds];
  const canActIn = (cid: string) =>
    session.isAdminMaster ||
    hasRoleInClinic(session, cid, ["clinical_coordinator"]);

  const active = session.activeClinic?.id ?? null;
  if (active && candidates.includes(active) && canActIn(active)) {
    return { clinicId: active, userId: session.userId };
  }
  if (canActIn(client.clinic_id as string)) {
    return { clinicId: client.clinic_id as string, userId: session.userId };
  }
  for (const cid of sharedIds) {
    if (canActIn(cid)) return { clinicId: cid, userId: session.userId };
  }
  return { error: "Apenas o Coordenador Clínico pode registrar a avaliação." };
}

/**
 * H4.12: quem pode capturar/salvar imagem da câmera — Coordenador OU Dentista
 * (ou Admin) da unidade do cliente (ou de uma unidade compartilhada), preferindo
 * a clínica ativa. Mesma lógica de escopo do requireCoordinator.
 */
async function requireClinicalCapturer(
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
  const { data: shares } = await supabase
    .from("client_shares")
    .select("clinic_id")
    .eq("client_id", clientId)
    .is("ended_at", null);
  const sharedIds = (shares ?? []).map((s) => s.clinic_id as string);
  const canActIn = (cid: string) =>
    session.isAdminMaster ||
    hasRoleInClinic(session, cid, ["clinical_coordinator", "dentist"]);
  const active = session.activeClinic?.id ?? null;
  const candidates = [client.clinic_id as string, ...sharedIds];
  if (active && candidates.includes(active) && canActIn(active)) {
    return { clinicId: active, userId: session.userId };
  }
  for (const cid of candidates) {
    if (canActIn(cid)) return { clinicId: cid, userId: session.userId };
  }
  return {
    error: "Apenas o coordenador ou o dentista podem salvar imagens.",
  };
}

/** H4.12: registra a imagem capturada pela câmera (já enviada ao Storage). */
export async function recordCameraCapture(
  clientId: string,
  input: ClinicalMediaInput
): Promise<ClinicalResult> {
  const guard = await requireClinicalCapturer(clientId);
  if ("error" in guard) return { ok: false, error: guard.error };
  if (!(await hasConsent(clientId))) {
    return {
      ok: false,
      error: "Registre o consentimento do paciente antes de salvar imagens.",
    };
  }
  if (!CLINICAL_MEDIA_KINDS.includes(input.kind)) {
    return { ok: false, error: "Tipo de imagem inválido." };
  }
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
    evaluation_id: await openEvaluationId(clientId, guard.clinicId),
  });
  if (error) {
    console.error("recordCameraCapture failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a imagem." };
  }
  await logAudit({
    action: "create",
    entityType: "clinical_media",
    entityId: clientId,
    clinicId: guard.clinicId,
  });
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
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
  revalidatePath(`/prontuarios/${clientId}`);
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
    evaluation_id: await openEvaluationId(clientId, guard.clinicId),
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
  revalidatePath(`/prontuarios/${clientId}`);
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
    evaluation_id: await openEvaluationId(clientId, guard.clinicId),
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
  revalidatePath(`/prontuarios/${clientId}`);
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
  revalidatePath(`/prontuarios/${media.client_id}`);
  return { ok: true };
}

/** H3.12: renomeia e/ou anota uma mídia clínica (Coordenador/Admin). */
export async function updateClinicalMedia(
  mediaId: string,
  input: { displayName?: string; note?: string }
): Promise<ClinicalResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: media } = await supabase
    .from("clinical_media")
    .select("client_id, clinic_id")
    .eq("id", mediaId)
    .single();
  if (!media) return { ok: false, error: "Arquivo não encontrado." };
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, media.clinic_id, ["clinical_coordinator"])
  ) {
    return {
      ok: false,
      error: "Apenas o Coordenador Clínico pode editar arquivos.",
    };
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };
  if (input.displayName !== undefined) {
    patch.display_name = input.displayName.trim() || null;
  }
  if (input.note !== undefined) {
    patch.note = input.note.trim() || null;
  }

  const { error } = await supabase
    .from("clinical_media")
    .update(patch)
    .eq("id", mediaId);
  if (error) {
    console.error("updateClinicalMedia failed:", error.message);
    return { ok: false, error: "Não foi possível salvar as alterações." };
  }
  await logAudit({
    action: "update",
    entityType: "clinical_media",
    entityId: media.client_id,
    clinicId: media.clinic_id,
    details: {
      renamed: input.displayName !== undefined,
      annotated: input.note !== undefined,
    },
  });
  revalidatePath(`/prontuarios/${media.client_id}`);
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
  revalidatePath(`/prontuarios/${note.client_id}`);
  return { ok: true };
}

/**
 * P3 — Anamnese (Coordenador Clínico). Salva a ficha de anamnese (4 campos
 * livres) da unidade resolvida, guardando a versão anterior no histórico.
 */
export type AnamnesisInput = {
  chiefComplaint: string;
  healthHistory: string;
  dentalHistory: string;
  lifestyle: string;
};

export async function saveAnamnesis(
  clientId: string,
  input: AnamnesisInput
): Promise<ClinicalResult> {
  const fields = {
    chief_complaint: input.chiefComplaint.trim() || null,
    health_history: input.healthHistory.trim() || null,
    dental_history: input.dentalHistory.trim() || null,
    lifestyle: input.lifestyle.trim() || null,
  };
  if (!fields.chief_complaint && !fields.health_history && !fields.dental_history && !fields.lifestyle) {
    return { ok: false, error: "Preencha ao menos um campo da anamnese." };
  }

  const guard = await requireCoordinator(clientId);
  if ("error" in guard) return { ok: false, error: guard.error };
  if (!(await hasConsent(clientId))) {
    return {
      ok: false,
      error: "Registre o consentimento do paciente antes de preencher a anamnese.",
    };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("clinical_anamnesis")
    .select(
      "id, chief_complaint, health_history, dental_history, lifestyle"
    )
    .eq("client_id", clientId)
    .eq("clinic_id", guard.clinicId)
    .maybeSingle();

  if (existing) {
    const unchanged =
      (existing.chief_complaint ?? null) === fields.chief_complaint &&
      (existing.health_history ?? null) === fields.health_history &&
      (existing.dental_history ?? null) === fields.dental_history &&
      (existing.lifestyle ?? null) === fields.lifestyle;
    if (unchanged) return { ok: true };

    // Guarda a versão anterior antes de sobrescrever.
    await supabase.from("clinical_anamnesis_revisions").insert({
      anamnesis_id: existing.id,
      client_id: clientId,
      clinic_id: guard.clinicId,
      chief_complaint: existing.chief_complaint,
      health_history: existing.health_history,
      dental_history: existing.dental_history,
      lifestyle: existing.lifestyle,
      edited_by: guard.userId,
    });

    const { error } = await supabase
      .from("clinical_anamnesis")
      .update({
        ...fields,
        updated_at: new Date().toISOString(),
        updated_by: guard.userId,
      })
      .eq("id", existing.id);
    if (error) {
      console.error("saveAnamnesis (update) failed:", error.message);
      return { ok: false, error: "Não foi possível salvar a anamnese." };
    }
  } else {
    const { error } = await supabase.from("clinical_anamnesis").insert({
      client_id: clientId,
      clinic_id: guard.clinicId,
      ...fields,
      created_by: guard.userId,
    });
    if (error) {
      console.error("saveAnamnesis (insert) failed:", error.message);
      return { ok: false, error: "Não foi possível salvar a anamnese." };
    }
  }

  await logAudit({
    action: "update",
    entityType: "clinical_anamnesis",
    entityId: clientId,
    clinicId: guard.clinicId,
  });
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}

/**
 * Fase 3 — inicia uma NOVA rodada de avaliação/reavaliação. Fecha a rodada
 * aberta (que fica congelada) e abre a próxima; a coleta seguinte entra nela.
 * Só o Coordenador Clínico (ou Admin) da unidade.
 */
export async function openNewEvaluation(
  clientId: string,
  kind: EvaluationKind = "reavaliacao",
  title?: string
): Promise<ClinicalResult> {
  const guard = await requireCoordinator(clientId);
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("open_new_evaluation", {
    p_client: clientId,
    p_clinic: guard.clinicId,
    p_kind: kind,
    p_title: title?.trim() || null,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Apenas o Coordenador Clínico pode iniciar uma reavaliação.",
      };
    }
    console.error("open_new_evaluation failed:", error.message);
    return { ok: false, error: "Não foi possível iniciar a nova avaliação." };
  }
  await logAudit({
    action: "create",
    entityType: "clinical_evaluation",
    entityId: clientId,
    clinicId: guard.clinicId,
    details: { kind },
  });
  revalidatePath(`/prontuarios/${clientId}`);
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
    evaluation_id: await openEvaluationId(clientId, guard.clinicId),
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
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}
