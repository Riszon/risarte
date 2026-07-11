"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { isDocumentKind } from "@/lib/documents";

export type CreateDocumentResult = {
  ok: boolean;
  id?: string;
  error?: string;
};

/** H4.6 C: o Dentista (ou Coordenador) emite um documento clínico (prescrição,
 * atestado, declaração, orientações). Fica registrado no prontuário e pode ser
 * impresso/salvo em PDF. */
export async function createDocument(input: {
  clientId: string;
  clinicId: string;
  kind: string;
  title: string;
  body: string;
}): Promise<CreateDocumentResult> {
  const session = await getSessionContext();
  const canEmit =
    session.isAdminMaster ||
    hasRoleInClinic(session, input.clinicId, ["dentist", "clinical_coordinator"]);
  if (!canEmit) {
    return { ok: false, error: "Sua função não permite emitir documentos." };
  }
  if (!isDocumentKind(input.kind)) {
    return { ok: false, error: "Tipo de documento inválido." };
  }
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return { ok: false, error: "Informe um título para o documento." };
  if (!body) return { ok: false, error: "O documento está vazio." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinical_documents")
    .insert({
      client_id: input.clientId,
      clinic_id: input.clinicId,
      author_id: session.userId,
      kind: input.kind,
      title,
      body,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createDocument failed:", error?.message);
    return { ok: false, error: "Não foi possível emitir o documento." };
  }
  await logAudit({
    action: "create",
    entityType: "clinical_document",
    entityId: data.id,
    clinicId: input.clinicId,
    details: { kind: input.kind },
  });
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true, id: data.id };
}
