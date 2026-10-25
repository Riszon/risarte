import "server-only";
import type { SessionContext } from "@/lib/auth";
import type { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import { podeCriarMetaDaRede, unidadesParaMetaPropria } from "./access";
import type { Alvo, Meta, RegraDeParticipante } from "./regras";
import { MODELOS_DE_META, modeloDoBanco, type Modelo } from "./modelos";

type Db = Awaited<ReturnType<typeof createClient>>;

export type Opcoes = {
  podeRede: boolean;
  unidades: { id: string; name: string }[];
  especialidades: string[];
  planosPpr: { id: string; name: string }[];
  hoje: string;
  modelos: Modelo[];
};

/**
 * Os modelos do banco (0322). `todos` = também os desativados (a tela de
 * modelos). Sem a 0322 no banco, a lista de reserva do código — e `doBanco`
 * falso, para a tela de modelos dizer por que não dá para editar.
 */
export async function lerModelos(db: Db, todos = false): Promise<{ modelos: Modelo[]; doBanco: boolean }> {
  let q = db.from("goal_templates").select("*").order("position").order("name").limit(500);
  if (!todos) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) return { modelos: MODELOS_DE_META, doBanco: false };
  return { modelos: (data ?? []).map((r) => modeloDoBanco(r as Record<string, unknown>)), doBanco: true };
}

/** O que o assistente oferece para escolher. */
export async function opcoesDoAssistente(db: Db, session: SessionContext): Promise<Opcoes> {
  const podeRede = podeCriarMetaDaRede(session);
  const [unidades, especialidades, planos, modelos] = await Promise.all([
    podeRede
      ? db
          .from("clinics")
          .select("id, name")
          .eq("type", "franchise_unit")
          .eq("is_active", true)
          .order("name")
          .limit(1000)
          .then((r) => (r.data ?? []) as { id: string; name: string }[])
      : Promise.resolve(unidadesParaMetaPropria(session)),
    db.from("specialties").select("name").eq("is_active", true).order("sort_order").order("name").limit(500),
    db.from("ppr_plans").select("id, name").eq("is_active", true).order("name").limit(100),
    lerModelos(db),
  ]);
  return {
    podeRede,
    unidades,
    especialidades: (especialidades.data ?? []).map((e) => e.name as string),
    planosPpr: (planos.data ?? []) as { id: string; name: string }[],
    hoje: todayInBrazil(),
    modelos: modelos.modelos,
  };
}

/** Uma meta gravada, no formato que o assistente recebe para editar. */
export async function dadosParaEditar(db: Db, meta: Meta) {
  const [regras, alvos, marcos] = await Promise.all([
    db.from("goal_participant_rules").select("kind, role, user_id").eq("goal_id", meta.id).limit(1000),
    db.from("goal_targets").select("subject_kind, subject_id, target_value").eq("goal_id", meta.id).limit(1000),
    db.from("goal_milestones").select("label, indicator, due_on, target_value, position").eq("goal_id", meta.id).order("position").limit(100),
  ]);
  const rules: RegraDeParticipante[] = (regras.data ?? []).map((r) =>
    r.kind === "all" ? { kind: "all" } : r.kind === "role" ? { kind: "role", role: r.role } : { kind: "user", user_id: r.user_id }
  );
  const targets: Alvo[] = (alvos.data ?? []).map((t) => ({
    subject_kind: t.subject_kind,
    subject_id: t.subject_id,
    target_value: Number(t.target_value),
  }));
  return {
    name: meta.name,
    indicator: meta.indicator,
    filters: meta.filters,
    scope: meta.scope,
    clinic_ids: meta.clinic_ids,
    how_text: meta.how_text ?? "",
    direction: meta.direction,
    target_mode: meta.target_mode,
    target_value: meta.target_value,
    individual_rule: meta.individual_rule,
    individual_value: meta.individual_value,
    stretch_value: meta.stretch_value,
    baseline_value: meta.baseline_value,
    baseline_from: meta.baseline_from,
    baseline_to: meta.baseline_to,
    resources_text: meta.resources_text ?? "",
    attainable_note: meta.attainable_note ?? "",
    strategic_objective: meta.strategic_objective ?? "",
    relevance_text: meta.relevance_text ?? "",
    periodicity: meta.periodicity,
    starts_on: meta.starts_on,
    ends_on: meta.ends_on,
    reward_text: meta.reward_text ?? "",
    stretch_reward_text: meta.stretch_reward_text ?? "",
    show_ranking: meta.show_ranking !== false,
    rules,
    targets,
    milestones: (marcos.data ?? []).map((m) => ({
      label: m.label as string,
      indicator: m.indicator as string,
      due_on: m.due_on as string,
      target_value: Number(m.target_value),
    })),
  };
}
