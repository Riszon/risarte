"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { AlertWhen, AnswerValue, QuestionKind } from "@/lib/anamnesis";

type Result = { ok: boolean; error?: string; noChanges?: boolean };

export type FillAnswerInput = {
  questionId: string | null;
  section: string | null;
  label: string;
  kind: QuestionKind;
  value: AnswerValue;
  detail: string | null;
  isAdhoc: boolean;
  sortOrder: number;
  alertWhen: AlertWhen | null;
  alertMessage: string | null;
  /** Pergunta ad-hoc que deve ser salva na ficha da unidade (reutilizável). */
  addToUnit?: boolean;
};

export type FillPayload = {
  templateId: string | null;
  templateName: string;
  answers: FillAnswerInput[];
  note?: string | null;
};

/**
 * Resolve a unidade do registro clínico e exige Coordenador (ou Admin). Mesma
 * regra usada na avaliação clínica (suporta unidade compartilhada — E7).
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
  const canActIn = (cid: string) =>
    session.isAdminMaster ||
    hasRoleInClinic(session, cid, ["clinical_coordinator"]);

  const active = session.activeClinic?.id ?? null;
  if (active && [client.clinic_id, ...sharedIds].includes(active) && canActIn(active)) {
    return { clinicId: active, userId: session.userId };
  }
  if (canActIn(client.clinic_id as string)) {
    return { clinicId: client.clinic_id as string, userId: session.userId };
  }
  for (const cid of sharedIds) {
    if (canActIn(cid)) return { clinicId: cid, userId: session.userId };
  }
  return { error: "Apenas o Coordenador Clínico pode preencher a anamnese." };
}

/** Assinatura canônica das respostas, para detectar "atualizada sem alterações". */
function answerSignature(
  items: {
    questionId: string | null;
    label: string;
    value: AnswerValue;
    detail: string | null;
  }[]
): string {
  const norm = items
    .map((a) => {
      const key = a.questionId ? `q:${a.questionId}` : `ad:${a.label.trim()}`;
      const value = Array.isArray(a.value) ? [...a.value].sort() : a.value;
      return { key, value, detail: (a.detail ?? "").trim() };
    })
    .sort((x, y) => x.key.localeCompare(y.key));
  return JSON.stringify(norm);
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

export async function saveAnamnesisFill(
  clientId: string,
  payload: FillPayload
): Promise<Result> {
  const guard = await requireCoordinator(clientId);
  if ("error" in guard) return { ok: false, error: guard.error };
  if (!(await hasConsent(clientId))) {
    return {
      ok: false,
      error: "Registre o consentimento do paciente antes de preencher a anamnese.",
    };
  }
  if (payload.answers.length === 0) {
    return { ok: false, error: "A ficha não tem perguntas para responder." };
  }

  const supabase = await createClient();

  // Perguntas ad-hoc marcadas para virar pergunta da unidade (reutilizável).
  const answers = [...payload.answers];
  if (payload.templateId) {
    const { data: maxRow } = await supabase
      .from("anamnesis_questions")
      .select("sort_order")
      .eq("template_id", payload.templateId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextOrder = (maxRow?.sort_order ?? 0) + 10;
    for (let i = 0; i < answers.length; i++) {
      const a = answers[i];
      if (a.isAdhoc && a.addToUnit && a.label.trim()) {
        const { data: created, error } = await supabase
          .from("anamnesis_questions")
          .insert({
            template_id: payload.templateId,
            clinic_id: guard.clinicId,
            section: a.section,
            label: a.label.trim(),
            kind: a.kind,
            required: false,
            sort_order: nextOrder,
            created_by: guard.userId,
          })
          .select("id")
          .single();
        nextOrder += 10;
        if (!error && created) {
          answers[i] = { ...a, questionId: created.id, isAdhoc: false };
        }
      }
    }
  }

  // "Atualizada sem alterações": compara com a última versão (A4).
  let noChanges = false;
  const { data: lastFill } = await supabase
    .from("anamnesis_fills")
    .select("id")
    .eq("client_id", clientId)
    .eq("clinic_id", guard.clinicId)
    .order("filled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastFill) {
    const { data: oldAns } = await supabase
      .from("anamnesis_answers")
      .select("question_id, label, value, detail")
      .eq("fill_id", lastFill.id);
    const oldSig = answerSignature(
      (oldAns ?? []).map((a) => ({
        questionId: a.question_id,
        label: a.label,
        value: a.value as AnswerValue,
        detail: a.detail,
      }))
    );
    const newSig = answerSignature(
      answers.map((a) => ({
        questionId: a.questionId,
        label: a.label,
        value: a.value,
        detail: a.detail,
      }))
    );
    noChanges = oldSig === newSig;
  }

  // Cria a versão (fill) e suas respostas.
  const { data: fill, error: fillErr } = await supabase
    .from("anamnesis_fills")
    .insert({
      client_id: clientId,
      clinic_id: guard.clinicId,
      template_id: payload.templateId,
      template_name: payload.templateName,
      filled_by: guard.userId,
      note: payload.note ?? null,
      no_changes: noChanges,
    })
    .select("id")
    .single();
  if (fillErr || !fill) {
    console.error("saveAnamnesisFill (fill) failed:", fillErr?.message);
    return { ok: false, error: "Não foi possível salvar a anamnese." };
  }

  const rows = answers.map((a) => ({
    fill_id: fill.id,
    clinic_id: guard.clinicId,
    question_id: a.questionId,
    section: a.section,
    label: a.label,
    kind: a.kind,
    value: a.value,
    detail: a.detail,
    is_adhoc: a.isAdhoc,
    sort_order: a.sortOrder,
    alert_when: a.alertWhen,
    alert_message: a.alertMessage,
  }));
  const { error: ansErr } = await supabase
    .from("anamnesis_answers")
    .insert(rows);
  if (ansErr) {
    console.error("saveAnamnesisFill (answers) failed:", ansErr.message);
    // Desfaz a versão para não deixar fill sem respostas.
    await supabase.from("anamnesis_fills").delete().eq("id", fill.id);
    return { ok: false, error: "Não foi possível salvar as respostas." };
  }

  await logAudit({
    action: "create",
    entityType: "anamnesis_fill",
    entityId: clientId,
    clinicId: guard.clinicId,
  });
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true, noChanges };
}
