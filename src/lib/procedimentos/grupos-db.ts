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
  return {
    ok: true,
    grupos: (data ?? []).map((g) => ({
      id: g.id,
      nome: g.name,
      descricao: g.description,
      ativo: g.is_active,
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
