import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { isoDateIn, todayInBrazil } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { indicadorDe } from "./indicadores";
import { medirCadeira } from "./medicao-no-app";
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

const NAO_MEDIU = "Não foi possível medir agora.";

/**
 * O realizado de cada meta. A porta do banco (`goal_measure`) aplica quem vê
 * o quê (D3); para o indicador MEDIDO NO CÓDIGO (O2 — a cadeira), o servidor
 * troca o "ao vivo" pela conta do Planejamento Anual e, passado o prazo,
 * GRAVA o resultado final (`goal_record_app_final`, só com a chave de
 * serviço). Chegar aqui já é prova de que a pessoa vê a meta: ela foi lida
 * pela RLS e a porta respondeu.
 */
export async function medirMetas(db: Db, metas: Meta[]): Promise<Map<string, MedicaoLida>> {
  const hoje = todayInBrazil();
  const pares = await Promise.all(
    metas.map(async (meta): Promise<[string, MedicaoLida]> => {
      const { data, error } = await db.rpc("goal_measure", { p_goal_id: meta.id });
      if (error) return [meta.id, { medicao: null, erro: NAO_MEDIU }] as [string, MedicaoLida];
      const medicao = data as Medicao;
      const ind = indicadorDe(meta.indicator);
      if (!ind?.noApp || meta.status === "cancelled" || meta.status === "draft") {
        return [meta.id, { medicao, erro: null }] as [string, MedicaoLida];
      }
      const temFinal = medicao.frozen.some((f) => f.kind === "final");
      if (temFinal || meta.starts_on > hoje) return [meta.id, { medicao, erro: null }] as [string, MedicaoLida];
      try {
        const clinicas = await clinicasDaMeta(meta);
        const encerrada = meta.ends_on < hoje;
        const foto = await medirCadeira(
          ind.chave as "chair_occupancy" | "chair_idle_hours",
          clinicas,
          meta.starts_on,
          encerrada ? meta.ends_on : hoje,
          hoje
        );
        if (!foto) return [meta.id, { medicao, erro: NAO_MEDIU }] as [string, MedicaoLida];
        if (encerrada) {
          // O prazo acabou: o servidor grava o resultado UMA vez (O2).
          const { error: e } = await createAdminClient().rpc("goal_record_app_final", {
            p_goal_id: meta.id,
            p_snapshot: foto,
          });
          if (e) console.error("metas — gravar o resultado da cadeira:", e.message);
          return [
            meta.id,
            {
              medicao: {
                ...medicao,
                live: null,
                frozen: [
                  ...medicao.frozen,
                  {
                    kind: "final",
                    from: meta.starts_on,
                    to: meta.ends_on,
                    achieved: null,
                    stretch: null,
                    people_achieved: null,
                    people_total: null,
                    measured_at: new Date().toISOString(),
                    snapshot: foto,
                  },
                ],
              },
              erro: null,
            },
          ] as [string, MedicaoLida];
        }
        return [meta.id, { medicao: { ...medicao, live: foto }, erro: null }] as [string, MedicaoLida];
      } catch (e) {
        console.error("metas — medir a cadeira:", e instanceof Error ? e.message : e);
        return [meta.id, { medicao, erro: NAO_MEDIU }] as [string, MedicaoLida];
      }
    })
  );
  return new Map(pares);
}

/** As unidades da meta (a rede = todas as unidades franqueadas ativas, como no banco). */
export async function clinicasDaMeta(meta: Pick<Meta, "scope" | "clinic_ids">): Promise<string[]> {
  if (meta.scope === "clinics") return meta.clinic_ids;
  const { data, error } = await createAdminClient()
    .from("clinics")
    .select("id")
    .eq("type", "franchise_unit")
    .eq("is_active", true)
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => c.id as string);
}

/** As duas leituras do ponto de equilíbrio (O1). `null` = não vê ou não se aplica. */
export type LeituraDoEquilibrio = {
  receita_liquida: number;
  margem_contribuicao: number;
  custo_fixo: number;
  ponto: number | null;
  atendimentos: number;
  atendimentos_necessarios: number | null;
};

export async function lerLeituraDoEquilibrio(db: Db, id: string): Promise<LeituraDoEquilibrio | null> {
  const { data, error } = await db.rpc("goal_breakeven_reading", { p_goal_id: id });
  if (error || !data) return null;
  const d = data as Record<string, number | null>;
  return {
    receita_liquida: Number(d.receita_liquida ?? 0),
    margem_contribuicao: Number(d.margem_contribuicao ?? 0),
    custo_fixo: Number(d.custo_fixo ?? 0),
    ponto: d.ponto == null ? null : Number(d.ponto),
    atendimentos: Number(d.atendimentos ?? 0),
    atendimentos_necessarios: d.atendimentos_necessarios == null ? null : Number(d.atendimentos_necessarios),
  };
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
