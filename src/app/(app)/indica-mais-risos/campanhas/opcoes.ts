import "server-only";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import { indicaDb } from "@/lib/indica/db";
import { ehFranqueadoraIndica, ehGestorIndica } from "@/lib/indica/access";
import type { ModeloCampanha } from "@/lib/indica/campanhas";

export type Opcao = { id: string; nome: string };

/** Valor vigente de um parâmetro da REDE (a linha mais nova já em vigor). */
export async function parametroDaRede<T>(chave: string): Promise<T | null> {
  const db = await indicaDb();
  const { data } = await db
    .from("config")
    .select("valor")
    .eq("chave", chave)
    .is("unidade_id", null)
    .lte("vigente_desde", new Date().toISOString())
    .order("vigente_desde", { ascending: false })
    .limit(1)
    .maybeSingle<{ valor: T }>();
  return data?.valor ?? null;
}

/** Valor vigente para a UNIDADE: o dela, se houver; senão o da rede. */
export async function parametroVigente<T>(chave: string, unidadeId: string): Promise<T | null> {
  const db = await indicaDb();
  const { data } = await db
    .from("config")
    .select("valor")
    .eq("chave", chave)
    .eq("unidade_id", unidadeId)
    .lte("vigente_desde", new Date().toISOString())
    .order("vigente_desde", { ascending: false })
    .limit(1)
    .maybeSingle<{ valor: T }>();
  return data ? data.valor : parametroDaRede<T>(chave);
}

/** Tudo que o formulário da campanha precisa para as escolhas. */
export async function opcoesDaCampanha() {
  const session = await getSessionContext();
  const db = await indicaDb();
  const supabase = await createClient();
  const emp = await empresarialDb();
  const [modelos, { data: niveis }, { data: especialidades }, { data: empresas }, { data: unidades }] = await Promise.all([
    parametroDaRede<ModeloCampanha[]>("campanhas_modelos"),
    db.from("niveis").select("codigo, nome, ordem").eq("ativo", true).order("ordem")
      .returns<{ codigo: string; nome: string }[]>(),
    supabase.from("specialties").select("name").eq("is_active", true).order("sort_order").order("name")
      .returns<{ name: string }[]>(),
    // Só as que esta pessoa enxerga (RLS do Empresarial); vazio = sem segmento por empresa.
    emp.from("companies").select("id, legal_name, trade_name").eq("status", "ACTIVE").order("legal_name")
      .returns<{ id: string; legal_name: string; trade_name: string | null }[]>(),
    supabase.from("clinics").select("id, name").eq("type", "franchise_unit").eq("is_active", true).order("name")
      .returns<{ id: string; name: string }[]>(),
  ]);
  const franqueadora = ehFranqueadoraIndica(session);
  return {
    franqueadora,
    modelos: modelos ?? [],
    niveis: (niveis ?? []).map((n) => ({ id: n.codigo, nome: n.nome })),
    especialidades: (especialidades ?? []).map((e) => e.name),
    empresas: (empresas ?? []).map((e) => ({ id: e.id, nome: e.trade_name || e.legal_name })),
    // Unidades em que esta pessoa pode fazer campanha: todas (rede) ou as que gere.
    unidades: (unidades ?? [])
      .filter((u) => franqueadora || ehGestorIndica(session, u.id))
      .map((u) => ({ id: u.id, nome: u.name })),
    todasUnidades: (unidades ?? []).map((u) => ({ id: u.id, nome: u.name })),
  };
}

export type OpcoesCampanha = Awaited<ReturnType<typeof opcoesDaCampanha>>;
