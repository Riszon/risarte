"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { canViewMetas } from "@/lib/metas/access";
import { mensagemDaMeta } from "@/lib/metas/erros";
import { indicadorDe } from "@/lib/metas/indicadores";
import type { Candidato, RegraDeParticipante } from "@/lib/metas/regras";
import { clinicasDaMeta } from "@/lib/metas/dados";
import { medirCadeira } from "@/lib/metas/medicao-no-app";
import { todayInBrazil } from "@/lib/dates";

/**
 * As ações do módulo de Metas. Quem pode o quê o BANCO decide
 * (`goal_save`, `goal_publish`, `goal_change_status` — 0318); aqui a guarda é
 * só a de ver o módulo, e a recusa do banco volta em português.
 */

export type ResultadoDaMeta = { ok: true; id: string } | { ok: false; error: string };
export type Resultado = { ok: true } | { ok: false; error: string };

/** O que o assistente manda. Valores já no formato do banco (R$ em centavos). */
export type DadosDaMeta = {
  name: string;
  indicator: string;
  filters: Record<string, unknown>;
  scope: "network" | "clinics";
  clinic_ids: string[];
  how_text: string;
  direction: "increase" | "decrease";
  target_mode: "collective" | "individual" | "both";
  target_value: number | null;
  individual_rule: "same" | "split" | null;
  individual_value: number | null;
  stretch_value: number | null;
  baseline_value: number | null;
  baseline_from: string | null;
  baseline_to: string | null;
  resources_text: string;
  attainable_note: string;
  strategic_objective: string;
  relevance_text: string;
  periodicity: "whole" | "monthly";
  starts_on: string;
  ends_on: string;
  rules: RegraDeParticipante[];
  targets: { subject_kind: "user" | "clinic"; subject_id: string; target_value: number }[];
  milestones: { label: string; indicator: string; due_on: string; target_value: number }[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function texto(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Normaliza no servidor o que veio do navegador (nunca confiar no formato). */
function normalizar(d: DadosDaMeta): DadosDaMeta {
  return {
    name: texto(d.name, 160),
    indicator: indicadorDe(d.indicator)?.chave ?? "",
    filters: d.filters && typeof d.filters === "object" ? d.filters : {},
    scope: d.scope === "network" ? "network" : "clinics",
    clinic_ids: d.scope === "network" ? [] : (d.clinic_ids ?? []).filter((x) => UUID.test(x)),
    how_text: texto(d.how_text),
    direction: d.direction === "decrease" ? "decrease" : "increase",
    target_mode: ["collective", "individual", "both"].includes(d.target_mode) ? d.target_mode : "collective",
    target_value: numero(d.target_value),
    individual_rule: d.individual_rule === "same" || d.individual_rule === "split" ? d.individual_rule : null,
    individual_value: numero(d.individual_value),
    stretch_value: numero(d.stretch_value),
    baseline_value: d.baseline_value == null ? null : Number(d.baseline_value),
    baseline_from: d.baseline_from && ISO.test(d.baseline_from) ? d.baseline_from : null,
    baseline_to: d.baseline_to && ISO.test(d.baseline_to) ? d.baseline_to : null,
    resources_text: texto(d.resources_text),
    attainable_note: texto(d.attainable_note),
    strategic_objective: texto(d.strategic_objective, 40),
    relevance_text: texto(d.relevance_text),
    periodicity: d.periodicity === "monthly" ? "monthly" : "whole",
    starts_on: ISO.test(d.starts_on) ? d.starts_on : "",
    ends_on: ISO.test(d.ends_on) ? d.ends_on : "",
    rules: (d.rules ?? []).filter(
      (r) => r.kind === "all" || (r.kind === "role" && r.role) || (r.kind === "user" && UUID.test(r.user_id))
    ),
    targets: (d.targets ?? []).filter(
      (t) => (t.subject_kind === "user" || t.subject_kind === "clinic") && UUID.test(t.subject_id) && numero(t.target_value) != null
    ),
    milestones: (d.milestones ?? [])
      .filter((m) => texto(m.label) && indicadorDe(m.indicator) && ISO.test(m.due_on) && numero(m.target_value) != null)
      .map((m) => ({ ...m, label: texto(m.label, 160) })),
  };
}

function caminhos(id?: string) {
  revalidatePath("/metas");
  revalidatePath("/");
  if (id) revalidatePath(`/metas/${id}`);
}

export async function salvarMeta(
  id: string | null,
  dados: DadosDaMeta,
  motivo?: string
): Promise<ResultadoDaMeta> {
  const session = await getSessionContext();
  if (!canViewMetas(session)) return { ok: false, error: "Você não tem acesso ao módulo de Metas." };
  const d = normalizar(dados);
  if (!d.starts_on || !d.ends_on) return { ok: false, error: "Defina o início e o fim do prazo (passo T)." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("goal_save", {
    p_goal_id: id,
    p_data: d,
    p_reason: motivo?.trim() || null,
  });
  if (error || !data) return { ok: false, error: mensagemDaMeta(error) };
  const novoId = String(data);
  await logAudit({
    action: id ? "update" : "create",
    entityType: "goal",
    entityId: novoId,
    clinicId: d.clinic_ids.length === 1 ? d.clinic_ids[0] : undefined,
  });
  caminhos(novoId);
  return { ok: true, id: novoId };
}

export async function publicarMeta(id: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewMetas(session)) return { ok: false, error: "Você não tem acesso ao módulo de Metas." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("goal_publish", { p_goal_id: id });
  if (error) return { ok: false, error: mensagemDaMeta(error) };
  await logAudit({ action: "update", entityType: "goal_status", entityId: id, details: { acao: "publicar" } });
  caminhos(id);
  return { ok: true };
}

export async function mudarSituacaoDaMeta(
  id: string,
  acao: "pause" | "resume" | "cancel" | "discard",
  motivo?: string
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewMetas(session)) return { ok: false, error: "Você não tem acesso ao módulo de Metas." };
  if (!["pause", "resume", "cancel", "discard"].includes(acao)) return { ok: false, error: "Ação desconhecida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("goal_change_status", {
    p_goal_id: id,
    p_action: acao,
    p_reason: motivo?.trim() || null,
  });
  if (error) return { ok: false, error: mensagemDaMeta(error) };
  await logAudit({ action: "update", entityType: "goal_status", entityId: id, details: { acao } });
  caminhos(acao === "discard" ? undefined : id);
  return { ok: true };
}

export async function buscarCandidatos(
  scope: "network" | "clinics",
  clinicIds: string[]
): Promise<{ ok: true; candidatos: Candidato[] } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!canViewMetas(session)) return { ok: false, error: "Você não tem acesso ao módulo de Metas." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("goal_candidates", {
    p_scope: scope,
    p_clinic_ids: scope === "network" ? [] : clinicIds.filter((x) => UUID.test(x)),
  });
  if (error) return { ok: false, error: mensagemDaMeta(error) };
  return { ok: true, candidatos: (data ?? []) as Candidato[] };
}

export type LinhaDeBase = {
  from: string;
  to: string;
  total: { num: number | null; den: number | null };
  people: number;
  by_month: { month: string; num: number | null; den: number | null }[];
};

export async function medirLinhaDeBase(
  indicator: string,
  filters: Record<string, unknown>,
  scope: "network" | "clinics",
  clinicIds: string[],
  from: string,
  to: string
): Promise<{ ok: true; base: LinhaDeBase } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!canViewMetas(session)) return { ok: false, error: "Você não tem acesso ao módulo de Metas." };
  if (!indicadorDe(indicator) || !ISO.test(from) || !ISO.test(to)) return { ok: false, error: "Período inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("goal_measure_preview", {
    p_indicator: indicator,
    p_filters: filters ?? {},
    p_scope: scope,
    p_clinic_ids: scope === "network" ? [] : clinicIds.filter((x) => UUID.test(x)),
    p_from: from,
    p_to: to,
  });
  if (error) return { ok: false, error: mensagemDaMeta(error) };
  const ind = indicadorDe(indicator);
  if (!ind?.noApp) return { ok: true, base: data as LinhaDeBase };

  // O2: a cadeira é medida pela conta do Planejamento Anual. A porta acima já
  // conferiu que a pessoa pode criar meta nessas unidades.
  try {
    const clinicas = await clinicasDaMeta({ scope, clinic_ids: clinicIds });
    const foto = await medirCadeira(
      ind.chave as "chair_occupancy" | "chair_idle_hours",
      clinicas,
      from,
      to,
      todayInBrazil()
    );
    if (!foto) return { ok: false, error: "Não foi possível ler a agenda agora." };
    const meses = new Map<string, { num: number; den: number | null }>();
    for (const d of foto.by_day) {
      const mes = `${d.day.slice(0, 7)}-01`;
      const m = meses.get(mes) ?? { num: 0, den: d.den == null ? null : 0 };
      m.num += Number(d.num ?? 0);
      if (m.den != null) m.den += Number(d.den ?? 0);
      meses.set(mes, m);
    }
    return {
      ok: true,
      base: {
        from,
        to,
        total: { num: Number(foto.total.num ?? 0), den: foto.total.den == null ? null : Number(foto.total.den) },
        people: 0,
        by_month: [...meses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
      },
    };
  } catch {
    return { ok: false, error: "Não foi possível ler a agenda agora." };
  }
}
