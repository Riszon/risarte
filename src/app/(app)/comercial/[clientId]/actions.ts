"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleWithScopeForClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type PresentationSaveResult = { ok: boolean; error?: string };

/** Salva a mesa de apresentação do Consultor (COM2): links, resumo, notas. */
export async function saveCommercialPresentation(
  clientId: string,
  input: {
    meetLink: string;
    recordingUrl: string;
    summary: string;
    notes: string;
  }
): Promise<PresentationSaveResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, clinic_id")
    .eq("id", clientId)
    .single();
  if (!client) return { ok: false, error: "Cliente não encontrado." };

  const allowed =
    session.isAdminMaster ||
    (await hasRoleWithScopeForClinic(session, client.clinic_id, [
      "commercial_consultant",
    ]));
  if (!allowed) {
    return { ok: false, error: "Apenas o Consultor Comercial pode editar." };
  }

  const clean = (s: string) => s.trim() || null;
  const { error } = await supabase.from("commercial_presentations").upsert(
    {
      client_id: clientId,
      clinic_id: client.clinic_id,
      consultant_id: session.userId,
      meet_link: clean(input.meetLink),
      recording_url: clean(input.recordingUrl),
      summary: clean(input.summary),
      notes: clean(input.notes),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" }
  );
  if (error) {
    console.error("saveCommercialPresentation failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a apresentação." };
  }

  await logAudit({
    action: "update",
    entityType: "commercial_presentation",
    entityId: clientId,
    clinicId: client.clinic_id,
  });
  revalidatePath(`/comercial/${clientId}`);
  return { ok: true };
}
