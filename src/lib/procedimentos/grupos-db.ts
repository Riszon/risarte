import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { GrupoDeProcedimentos } from "@/lib/procedimentos/grupos";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Um<T> = T | T[] | null;
const um = <T,>(v: Um<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Os grupos de procedimentos da rede (0324), com os procedimentos em ordem.
 * `ok: false` = não consegui ler (o banco sem a 0324, ou falha): quem chama
 * AVISA, nunca mostra "nenhum grupo" — leitura que falha não vira lista vazia.
 */
export async function carregarGrupos(
  supabase: Supabase,
  opcoes: { soAtivos?: boolean } = {}
): Promise<{ ok: boolean; grupos: GrupoDeProcedimentos[] }> {
  let q = supabase
    .from("procedure_groups")
    .select(
      "id, name, description, is_active, procedure_group_items ( procedure_id, quantity, sort_order, procedure:procedures ( name, is_active ) )"
    )
    .order("name");
  if (opcoes.soAtivos) q = q.eq("is_active", true);
  const { data, error } = await q.returns<
    {
      id: string;
      name: string;
      description: string | null;
      is_active: boolean;
      procedure_group_items: {
        procedure_id: string;
        quantity: number;
        sort_order: number;
        procedure: Um<{ name: string; is_active: boolean }>;
      }[];
    }[]
  >();
  if (error) {
    console.error("carregarGrupos failed:", error.message);
    return { ok: false, grupos: [] };
  }
  // 0325: o ajuste do pacote, lido À PARTE — sem a 0325 no banco a coluna não
  // existe, e a lista de grupos não pode cair junto (fica sem preço de pacote).
  const { data: ajustes, error: erroDoAjuste } = await supabase
    .from("procedure_groups")
    .select("id, price_adjust_percent")
    .returns<{ id: string; price_adjust_percent: number | string }[]>();
  if (erroDoAjuste) console.error("carregarGrupos (ajuste) failed:", erroDoAjuste.message);
  const ajusteDe = new Map((ajustes ?? []).map((a) => [a.id, Number(a.price_adjust_percent)]));
  // 0326: o mínimo, à parte de novo (a 0325 pode estar no banco sem a 0326).
  const { data: minimos, error: erroDoMinimo } = await supabase
    .from("procedure_groups")
    .select("id, min_price_percent")
    .returns<{ id: string; min_price_percent: number | string | null }[]>();
  if (erroDoMinimo) console.error("carregarGrupos (mínimo) failed:", erroDoMinimo.message);
  const minimoDe = new Map(
    (minimos ?? []).map((m) => [m.id, m.min_price_percent === null ? null : Number(m.min_price_percent)])
  );
  return {
    ok: true,
    grupos: (data ?? []).map((g) => ({
      id: g.id,
      nome: g.name,
      descricao: g.description,
      ativo: g.is_active,
      ajustePercent: erroDoAjuste ? null : (ajusteDe.get(g.id) ?? 0),
      minimoPercent: erroDoMinimo ? undefined : (minimoDe.get(g.id) ?? null),
      itens: [...(g.procedure_group_items ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => {
          const p = um(i.procedure);
          return {
            procedureId: i.procedure_id,
            quantidade: i.quantity,
            nome: p?.name ?? "Procedimento",
            ativo: p?.is_active ?? false,
          };
        }),
    })),
  };
}

/**
 * 0325 (GP6): de cada item do plano, o grupo de onde veio e o preço de tabela
 * que o pacote ajustou — para o "Pacote X: de … por …" do orçamento e da
 * apresentação. Lido À PARTE: sem a 0325 (ou sem a 0324) no banco, a leitura
 * falha e o documento sai como antes, item a item, sem a linha do pacote.
 */
export async function pacoteDosItens(
  supabase: Supabase,
  itemIds: string[]
): Promise<Map<string, { grupo: { id: string; nome: string }; precoDeTabelaCents: number | null }>> {
  const porItem = new Map<string, { grupo: { id: string; nome: string }; precoDeTabelaCents: number | null }>();
  if (itemIds.length === 0) return porItem;
  const { data, error } = await supabase
    .from("treatment_plan_option_items")
    .select("id, procedure_group_id, list_price_cents, grupo:procedure_groups ( name )")
    .in("id", itemIds)
    .not("procedure_group_id", "is", null)
    .returns<
      { id: string; procedure_group_id: string; list_price_cents: number | null; grupo: Um<{ name: string }> }[]
    >();
  if (error) {
    console.error("pacoteDosItens failed:", error.message);
    return porItem;
  }
  for (const r of data ?? []) {
    const nome = um(r.grupo)?.name;
    if (nome) porItem.set(r.id, { grupo: { id: r.procedure_group_id, nome }, precoDeTabelaCents: r.list_price_cents });
  }
  return porItem;
}
