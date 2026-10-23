import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { isoDateIn } from "@/lib/dates";
import { mensagemDaMeta } from "./erros";
import { CAMPOS_DA_META, type Alvo, type Medicao, type Meta, type Pausa } from "./regras";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * As leituras do módulo de Metas. Quem pode ver o quê é o BANCO
 * (`can_view_goal` na RLS; `goal_measure` com a D3) — aqui só se lê.
 *
 * ⚠️ LEITURA QUE FALHA NÃO VIRA ZERO. Se a medição de uma meta falhar, o
 * cartão diz "não foi possível medir agora" — uma barra em 0% seria uma
 * afirmação falsa sobre o trabalho da equipe.
 */

export async function lerMetas(db: Db): Promise<{ metas: Meta[]; erro: string | null }> {
  const { data, error } = await db
    .from("goals")
    .select(CAMPOS_DA_META)
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<Meta[]>();
  if (error) {
    // A janela entre o código no ar e a 0318 rodada naquele banco (CLAUDE.md
    // §0b): a tabela ainda não existe. Dizer isso, em vez de "tente de novo".
    if (error.code === "PGRST205" || error.code === "42P01") {
      return { metas: [], erro: "O módulo de Metas ainda não foi instalado neste ambiente (falta a migração 0318)." };
    }
    return { metas: [], erro: mensagemDaMeta(error) };
  }
  return { metas: (data ?? []).map(normalizar), erro: null };
}

export async function lerMeta(db: Db, id: string): Promise<Meta | null> {
  const { data } = await db.from("goals").select(CAMPOS_DA_META).eq("id", id).maybeSingle<Meta>();
  return data ? normalizar(data) : null;
}

/** O banco devolve `numeric` como número ou texto conforme o caminho — normaliza. */
function normalizar(m: Meta): Meta {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    ...m,
    target_value: n(m.target_value),
    individual_value: n(m.individual_value),
    stretch_value: n(m.stretch_value),
    baseline_value: n(m.baseline_value),
    clinic_ids: m.clinic_ids ?? [],
    filters: m.filters ?? {},
  };
}

export type MedicaoLida = { medicao: Medicao | null; erro: string | null };

export async function medirMetas(db: Db, ids: string[]): Promise<Map<string, MedicaoLida>> {
  const pares = await Promise.all(
    ids.map(async (id) => {
      const { data, error } = await db.rpc("goal_measure", { p_goal_id: id });
      const lida: MedicaoLida = error
        ? { medicao: null, erro: "Não foi possível medir agora." }
        : { medicao: data as Medicao, erro: null };
      return [id, lida] as const;
    })
  );
  return new Map(pares);
}

export async function lerPausas(db: Db, ids: string[]): Promise<Map<string, Pausa[]>> {
  const out = new Map<string, Pausa[]>();
  if (ids.length === 0) return out;
  const { data } = await db
    .from("goal_pauses")
    .select("goal_id, paused_at, resumed_at")
    .in("goal_id", ids)
    .limit(1000);
  for (const p of data ?? []) {
    const lista = out.get(p.goal_id) ?? [];
    lista.push({
      de: isoDateIn(new Date(p.paused_at)),
      ate: p.resumed_at ? isoDateIn(new Date(p.resumed_at)) : null,
    });
    out.set(p.goal_id, lista);
  }
  return out;
}

export async function lerAlvos(db: Db, ids: string[]): Promise<Map<string, Alvo[]>> {
  const out = new Map<string, Alvo[]>();
  if (ids.length === 0) return out;
  const { data } = await db
    .from("goal_targets")
    .select("goal_id, subject_kind, subject_id, target_value")
    .in("goal_id", ids)
    .limit(1000);
  for (const t of data ?? []) {
    const lista = out.get(t.goal_id) ?? [];
    lista.push({ subject_kind: t.subject_kind, subject_id: t.subject_id, target_value: Number(t.target_value) });
    out.set(t.goal_id, lista);
  }
  return out;
}

export async function minhasMetas(db: Db): Promise<Set<string>> {
  const { data } = await db.rpc("my_goal_ids");
  // `returns setof uuid`: o PostgREST devolve a lista de valores; aceita
  // também a forma de objeto, para não depender do detalhe da versão.
  const lista = (data ?? []) as (string | { my_goal_ids: string })[];
  return new Set(lista.map((x) => (typeof x === "string" ? x : x.my_goal_ids)));
}

export async function nomesDasUnidades(db: Db): Promise<Map<string, string>> {
  const { data } = await db.from("clinics").select("id, name").limit(1000);
  return new Map((data ?? []).map((c) => [c.id as string, c.name as string]));
}

export async function lerParticipantes(
  db: Db,
  id: string
): Promise<{ lista: { user_id: string; full_name: string; roles: string[]; clinic_ids: string[] }[]; erro: string | null }> {
  const { data, error } = await db.rpc("goal_participants", { p_goal_id: id });
  if (error) return { lista: [], erro: mensagemDaMeta(error) };
  return { lista: (data ?? []) as { user_id: string; full_name: string; roles: string[]; clinic_ids: string[] }[], erro: null };
}
