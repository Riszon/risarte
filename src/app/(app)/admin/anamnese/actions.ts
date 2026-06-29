"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  kindUsesOptions,
  kindSupportsDetail,
  type AlertWhen,
  type QuestionKind,
} from "@/lib/anamnesis";

type Result = { ok: boolean; error?: string };

export type QuestionPayload = {
  section: string;
  label: string;
  kind: QuestionKind;
  options: string[];
  detailPrompt: string;
  required: boolean;
  alertEnabled: boolean;
  alertMessage: string;
  /** Valor que dispara o alerta (yes_no/single_choice). */
  alertValue: string;
  /** Opções que disparam o alerta (multi_choice). */
  alertOptions: string[];
};

async function requireAdmin(): Promise<{ userId: string } | { error: string }> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) {
    return {
      error: "Apenas o Admin Master pode configurar as fichas de anamnese.",
    };
  }
  return { userId: session.userId };
}

/** Monta o alert_when a partir do formulário; null = sem alerta. */
function buildAlertWhen(p: QuestionPayload): AlertWhen | null {
  if (!p.alertEnabled) return null;
  if (p.kind === "multi_choice") {
    const list = p.alertOptions.filter(Boolean);
    return list.length > 0 ? { any_of: list } : null;
  }
  if (p.kind === "yes_no" || p.kind === "yes_no_unknown") {
    return { equals: p.alertValue || "sim" };
  }
  if (p.kind === "single_choice") {
    return p.alertValue ? { equals: p.alertValue } : null;
  }
  return null; // texto não gera alerta
}

function normalizeQuestion(p: QuestionPayload) {
  const label = p.label.trim();
  if (!label) return { error: "Escreva o texto da pergunta." as const };
  const options = kindUsesOptions(p.kind)
    ? p.options.map((o) => o.trim()).filter(Boolean)
    : [];
  if (kindUsesOptions(p.kind) && options.length < 2) {
    return { error: "Liste ao menos 2 opções (uma por linha)." as const };
  }
  const alertWhen = buildAlertWhen(p);
  return {
    fields: {
      section: p.section.trim() || null,
      label,
      kind: p.kind,
      options: options.length > 0 ? options : null,
      detail_prompt: kindSupportsDetail(p.kind)
        ? p.detailPrompt.trim() || null
        : null,
      required: p.required,
      alert_when: alertWhen,
      alert_message: alertWhen ? p.alertMessage.trim() || null : null,
    },
  };
}

export async function createTemplate(
  name: string,
  description: string
): Promise<Result> {
  const guard = await requireAdmin();
  if ("error" in guard) return { ok: false, error: guard.error };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Dê um nome à ficha." };

  const supabase = await createClient();
  const { error } = await supabase.from("anamnesis_templates").insert({
    name: trimmed,
    description: description.trim() || null,
    created_by: guard.userId,
  });
  if (error) {
    console.error("createTemplate failed:", error.message);
    return { ok: false, error: "Não foi possível criar a ficha." };
  }
  await logAudit({ action: "create", entityType: "anamnesis_template" });
  revalidatePath("/admin/anamnese");
  return { ok: true };
}

export async function updateTemplate(
  id: string,
  data: { name: string; description: string; isActive: boolean }
): Promise<Result> {
  const guard = await requireAdmin();
  if ("error" in guard) return { ok: false, error: guard.error };
  const trimmed = data.name.trim();
  if (!trimmed) return { ok: false, error: "Dê um nome à ficha." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("anamnesis_templates")
    .update({
      name: trimmed,
      description: data.description.trim() || null,
      is_active: data.isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("updateTemplate failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a ficha." };
  }
  await logAudit({ action: "update", entityType: "anamnesis_template", entityId: id });
  revalidatePath("/admin/anamnese");
  return { ok: true };
}

export async function addNetworkQuestion(
  templateId: string,
  payload: QuestionPayload
): Promise<Result> {
  const guard = await requireAdmin();
  if ("error" in guard) return { ok: false, error: guard.error };
  const norm = normalizeQuestion(payload);
  if ("error" in norm) return { ok: false, error: norm.error };

  const supabase = await createClient();
  const { data: maxRow } = await supabase
    .from("anamnesis_questions")
    .select("sort_order")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? 0) + 10;

  const { error } = await supabase.from("anamnesis_questions").insert({
    template_id: templateId,
    clinic_id: null, // pergunta da rede
    ...norm.fields,
    sort_order: nextOrder,
    created_by: guard.userId,
  });
  if (error) {
    console.error("addNetworkQuestion failed:", error.message);
    return { ok: false, error: "Não foi possível adicionar a pergunta." };
  }
  await logAudit({
    action: "create",
    entityType: "anamnesis_question",
    entityId: templateId,
  });
  revalidatePath("/admin/anamnese");
  return { ok: true };
}

export async function updateQuestion(
  id: string,
  payload: QuestionPayload
): Promise<Result> {
  const guard = await requireAdmin();
  if ("error" in guard) return { ok: false, error: guard.error };
  const norm = normalizeQuestion(payload);
  if ("error" in norm) return { ok: false, error: norm.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("anamnesis_questions")
    .update(norm.fields)
    .eq("id", id);
  if (error) {
    console.error("updateQuestion failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a pergunta." };
  }
  await logAudit({ action: "update", entityType: "anamnesis_question", entityId: id });
  revalidatePath("/admin/anamnese");
  return { ok: true };
}

export async function deleteQuestion(id: string): Promise<Result> {
  const guard = await requireAdmin();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("anamnesis_questions")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("deleteQuestion failed:", error.message);
    return { ok: false, error: "Não foi possível remover a pergunta." };
  }
  await logAudit({ action: "update", entityType: "anamnesis_question", entityId: id, details: { removed: true } });
  revalidatePath("/admin/anamnese");
  return { ok: true };
}
