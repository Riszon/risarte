import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  mapQuestion,
  mapTemplate,
  type AnamnesisQuestionRow,
  type AnamnesisTemplateRow,
} from "@/lib/anamnesis";
import { TemplateManager, type ManagedTemplate } from "./template-manager";

export const metadata: Metadata = { title: "Fichas de Anamnese" };

export default async function AnamnesisAdminPage() {
  const session = await getSessionContext();
  if (!session.isAdminMaster) redirect("/");

  const supabase = await createClient();
  const [{ data: templateRows }, { data: questionRows }] = await Promise.all([
    supabase
      .from("anamnesis_templates")
      .select("id, name, description, is_active, is_default, sort_order")
      .order("sort_order")
      .order("name")
      .returns<AnamnesisTemplateRow[]>(),
    // Só as perguntas da rede (clinic_id null) — acréscimos por unidade são
    // gerenciados pelo Coordenador no preenchimento (A3).
    supabase
      .from("anamnesis_questions")
      .select(
        "id, template_id, clinic_id, section, label, kind, options, detail_prompt, required, sort_order, alert_when, alert_message, gender, condition_question_id, condition_values"
      )
      .is("clinic_id", null)
      .order("sort_order")
      .returns<AnamnesisQuestionRow[]>(),
  ]);

  const questionsByTemplate = new Map<string, AnamnesisQuestionRow[]>();
  for (const r of questionRows ?? []) {
    const list = questionsByTemplate.get(r.template_id) ?? [];
    list.push(r);
    questionsByTemplate.set(r.template_id, list);
  }

  const templates: ManagedTemplate[] = (templateRows ?? []).map((t) => {
    const tpl = mapTemplate(t);
    return {
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      isActive: tpl.isActive,
      isDefault: tpl.isDefault,
      questions: (questionsByTemplate.get(tpl.id) ?? []).map(mapQuestion),
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Fichas de Anamnese
        </h1>
        <p className="text-sm text-muted-foreground">
          Modelos de ficha usados no prontuário. Crie tipos diferentes (ex.:
          Geral, Cirúrgica, Estética) e suas perguntas. O Coordenador Clínico
          poderá acrescentar perguntas da sua unidade ao preencher.
        </p>
      </div>
      <TemplateManager templates={templates} />
    </div>
  );
}
