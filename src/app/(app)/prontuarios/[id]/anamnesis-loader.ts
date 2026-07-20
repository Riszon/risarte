import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  mapAnswer,
  mapQuestion,
  type AnamnesisAnswerRow,
  type AnamnesisQuestionRow,
  type AnamnesisTemplateRow,
} from "@/lib/anamnesis";
import type { FillTemplate, AnamnesisTypeGroup } from "./anamnesis-fill";

/**
 * Carrega a anamnese do cliente para o `AnamnesisFill`: modelos (perguntas da
 * rede + acréscimos da unidade) + as fichas preenchidas agrupadas por TIPO (a
 * versão atual de cada tipo + o histórico). Reaproveita a mesma lógica da ficha,
 * agora também no cockpit do Coordenador (anamnese embutida no passo 2).
 */
export async function loadAnamnesisWorkspace(
  clientId: string,
  clinicId: string
): Promise<{ templates: FillTemplate[]; fills: AnamnesisTypeGroup[] }> {
  const supabase = await createClient();

  const [{ data: tplRows }, { data: qRows }, { data: fillRows }] =
    await Promise.all([
      supabase
        .from("anamnesis_templates")
        .select("id, name, description, is_active, is_default, sort_order")
        .eq("is_active", true)
        .order("sort_order")
        .order("name")
        .returns<AnamnesisTemplateRow[]>(),
      supabase
        .from("anamnesis_questions")
        .select(
          "id, template_id, clinic_id, section, label, kind, options, detail_prompt, required, sort_order, alert_when, alert_message, gender, condition_question_id, condition_values"
        )
        .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
        .order("sort_order")
        .returns<AnamnesisQuestionRow[]>(),
      supabase
        .from("anamnesis_fills")
        .select("id, template_id, template_name, filled_at, filled_by, no_changes")
        .eq("client_id", clientId)
        .order("filled_at", { ascending: false })
        .returns<
          {
            id: string;
            template_id: string | null;
            template_name: string | null;
            filled_at: string;
            filled_by: string | null;
            no_changes: boolean;
          }[]
        >(),
    ]);

  const qByTemplate = new Map<string, ReturnType<typeof mapQuestion>[]>();
  for (const r of qRows ?? []) {
    const list = qByTemplate.get(r.template_id) ?? [];
    list.push(mapQuestion(r));
    qByTemplate.set(r.template_id, list);
  }
  const templates: FillTemplate[] = (tplRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    isDefault: t.is_default,
    questions: (qByTemplate.get(t.id) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder
    ),
  }));

  const fills = fillRows ?? [];
  const fillerIds = [
    ...new Set(fills.map((f) => f.filled_by).filter((x): x is string => Boolean(x))),
  ];
  const fillerNames = new Map<string, string>();
  if (fillerIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", fillerIds);
    for (const p of people ?? []) fillerNames.set(p.id, p.full_name);
  }

  const byTemplate = new Map<string, typeof fills>();
  for (const f of fills) {
    const key = f.template_id ?? "__none__";
    const arr = byTemplate.get(key) ?? [];
    arr.push(f);
    byTemplate.set(key, arr);
  }
  const groups = [...byTemplate.values()];
  const latestIds = groups.map((g) => g[0].id);
  const answersByFill = new Map<string, ReturnType<typeof mapAnswer>[]>();
  if (latestIds.length > 0) {
    const { data: ansRows } = await supabase
      .from("anamnesis_answers")
      .select(
        "id, fill_id, question_id, section, label, kind, value, detail, is_adhoc, sort_order, alert_when, alert_message"
      )
      .in("fill_id", latestIds)
      .order("sort_order")
      .returns<(AnamnesisAnswerRow & { fill_id: string })[]>();
    for (const r of ansRows ?? []) {
      const list = answersByFill.get(r.fill_id) ?? [];
      list.push(mapAnswer(r));
      answersByFill.set(r.fill_id, list);
    }
  }

  const anamnesisFills: AnamnesisTypeGroup[] = groups
    .map((arr) => {
      const latest = arr[0];
      return {
        templateId: latest.template_id,
        templateName: latest.template_name,
        current: {
          id: latest.id,
          templateId: latest.template_id,
          templateName: latest.template_name,
          filledAt: latest.filled_at,
          filledByName: latest.filled_by
            ? (fillerNames.get(latest.filled_by) ?? null)
            : null,
          answers: answersByFill.get(latest.id) ?? [],
        },
        history: arr.map((f) => ({
          id: f.id,
          filledAt: f.filled_at,
          filledByName: f.filled_by
            ? (fillerNames.get(f.filled_by) ?? null)
            : null,
          templateName: f.template_name,
          noChanges: f.no_changes,
        })),
      };
    })
    .sort(
      (a, b) =>
        new Date(b.current.filledAt).getTime() -
        new Date(a.current.filledAt).getTime()
    );

  return { templates, fills: anamnesisFills };
}
