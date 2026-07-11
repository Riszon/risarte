"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { isDocumentKind } from "@/lib/documents";

type Result = { ok: boolean; error?: string };

/** Cria/edita um modelo de documento da REDE (clinic_id null). Admin Master. */
export async function saveTemplate(input: {
  id?: string;
  kind: string;
  title: string;
  body: string;
}): Promise<Result> {
  await requireAdminMaster();
  if (!isDocumentKind(input.kind)) return { ok: false, error: "Tipo inválido." };
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return { ok: false, error: "Informe o título do modelo." };

  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase
      .from("document_templates")
      .update({ kind: input.kind, title, body, updated_at: new Date().toISOString() })
      .eq("id", input.id);
    if (error) {
      console.error("saveTemplate update failed:", error.message);
      return { ok: false, error: "Não foi possível salvar o modelo." };
    }
  } else {
    const { error } = await supabase
      .from("document_templates")
      .insert({ clinic_id: null, kind: input.kind, title, body });
    if (error) {
      console.error("saveTemplate insert failed:", error.message);
      return { ok: false, error: "Não foi possível criar o modelo." };
    }
  }
  await logAudit({ action: input.id ? "update" : "create", entityType: "document_template" });
  revalidatePath("/admin/documentos");
  return { ok: true };
}

/** Ativa/desativa um modelo da rede. Admin Master. */
export async function setTemplateActive(
  id: string,
  active: boolean
): Promise<Result> {
  await requireAdminMaster();
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_templates")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("setTemplateActive failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar o modelo." };
  }
  revalidatePath("/admin/documentos");
  return { ok: true };
}
