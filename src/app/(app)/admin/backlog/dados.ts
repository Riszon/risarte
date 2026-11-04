import { createClient } from "@/lib/supabase/server";
import { lerTodasAsPaginas } from "@/lib/paginar";
import type { CategoriaDoBacklog, ItemDoBacklog, Prioridade, SituacaoDoItem } from "@/lib/backlog";

/**
 * As leituras da tela do backlog (BK2). A regra de linha da 0366 só entrega
 * ao Admin Master; a página já barrou os outros antes de chegar aqui.
 *
 * Leitura que falha devolve `ok: false` — nunca uma lista vazia, que pareceria
 * "nada em aberto" (§0d do CLAUDE.md).
 */

type LinhaDoItem = {
  code: string;
  title: string;
  category_id: string;
  module: string | null;
  priority: Prioridade;
  status: SituacaoDoItem;
  origin: string;
  found_on: string;
  resolved_at: string | null;
  resolved_version: string | null;
  updated_at: string;
  backlog_categories: { name: string } | null;
};

export type Leitura<T> = { ok: true; dados: T } | { ok: false; motivo: string };

function semTabela(msg: string): boolean {
  return /backlog_|does not exist|schema cache|Could not find/.test(msg);
}

export async function carregarCategorias(): Promise<Leitura<CategoriaDoBacklog[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("backlog_categories")
    .select("id, name, sort_order, active")
    .order("sort_order")
    .order("name");
  if (error) {
    console.error("backlog_categories:", error.message);
    return { ok: false, motivo: semTabela(error.message) ? "sem_migracao" : "erro" };
  }
  return {
    ok: true,
    dados: (data ?? []).map((c) => ({ id: c.id, name: c.name, sortOrder: c.sort_order, active: c.active })),
  };
}

export async function carregarItens(): Promise<Leitura<ItemDoBacklog[]>> {
  const supabase = await createClient();
  const lido = await lerTodasAsPaginas<LinhaDoItem>((de, ate) =>
    supabase
      .from("backlog_items")
      .select(
        "code, title, category_id, module, priority, status, origin, found_on, resolved_at, resolved_version, updated_at, backlog_categories ( name )"
      )
      .order("created_at")
      .order("code")
      .range(de, ate)
      .returns<LinhaDoItem[]>()
  );
  if (!lido.ok) {
    console.error("backlog_items:", lido.error.message);
    return { ok: false, motivo: semTabela(lido.error.message) ? "sem_migracao" : "erro" };
  }
  return {
    ok: true,
    dados: lido.linhas.map((r) => ({
      code: r.code,
      title: r.title,
      category: r.backlog_categories?.name ?? "—",
      categoryId: r.category_id,
      module: r.module,
      priority: r.priority,
      status: r.status,
      origin: r.origin,
      foundOn: r.found_on,
      resolvedAt: r.resolved_at,
      resolvedVersion: r.resolved_version,
      updatedAt: r.updated_at,
    })),
  };
}

export type DetalheDoItem = ItemDoBacklog & {
  detail: string;
  resolution: string | null;
  createdAt: string;
};

export type EventoDoItem = {
  id: number;
  kind: string;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  author: string;
  createdAt: string;
};

export type RelatoLigado = { code: string; title: string; status: string };

export async function carregarDetalhe(code: string): Promise<
  Leitura<{ item: DetalheDoItem; eventos: EventoDoItem[]; relatos: RelatoLigado[] } | null>
> {
  const supabase = await createClient();
  const { data: it, error } = await supabase
    .from("backlog_items")
    .select(
      "id, code, title, detail, category_id, module, priority, status, origin, found_on, resolved_at, resolved_version, resolution, created_at, updated_at, backlog_categories ( name )"
    )
    .eq("code", code)
    .maybeSingle<LinhaDoItem & { id: string; detail: string; resolution: string | null; created_at: string }>();
  if (error) {
    console.error("backlog_items (detalhe):", error.message);
    return { ok: false, motivo: semTabela(error.message) ? "sem_migracao" : "erro" };
  }
  if (!it) return { ok: true, dados: null };

  const [ev, rel] = await Promise.all([
    supabase
      .from("backlog_item_events")
      .select("id, kind, from_value, to_value, note, author_label, created_at, profiles ( full_name )")
      .eq("item_id", it.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .returns<
        {
          id: number;
          kind: string;
          from_value: string | null;
          to_value: string | null;
          note: string | null;
          author_label: string | null;
          created_at: string;
          profiles: { full_name: string | null } | null;
        }[]
      >(),
    supabase
      .from("backlog_item_reports")
      .select("system_reports ( code, title, status )")
      .eq("item_id", it.id)
      .returns<{ system_reports: { code: string; title: string; status: string } | null }[]>(),
  ]);
  if (ev.error || rel.error) {
    console.error("backlog (linha do tempo/relatos):", ev.error?.message ?? rel.error?.message);
    return { ok: false, motivo: "erro" };
  }

  return {
    ok: true,
    dados: {
      item: {
        code: it.code,
        title: it.title,
        detail: it.detail,
        category: it.backlog_categories?.name ?? "—",
        categoryId: it.category_id,
        module: it.module,
        priority: it.priority,
        status: it.status,
        origin: it.origin,
        foundOn: it.found_on,
        resolvedAt: it.resolved_at,
        resolvedVersion: it.resolved_version,
        resolution: it.resolution,
        createdAt: it.created_at,
        updatedAt: it.updated_at,
      },
      eventos: (ev.data ?? []).map((e) => ({
        id: e.id,
        kind: e.kind,
        fromValue: e.from_value,
        toValue: e.to_value,
        note: e.note,
        author: e.profiles?.full_name ?? e.author_label ?? "Sistema",
        createdAt: e.created_at,
      })),
      relatos: (rel.data ?? []).flatMap((r) => (r.system_reports ? [r.system_reports] : [])),
    },
  };
}
