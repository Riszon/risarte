import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Hierarquia } from "@/lib/admins";

/**
 * Lê do banco a hierarquia entre quem está logado e a pessoa-alvo (0262).
 *
 * Banco sem a 0262 (sem `is_owner`): ninguém é Principal, e o acesso de um
 * Admin fica travado para todos — o lado seguro. A tela diz o que falta.
 */
export async function carregarHierarquia(
  supabase: SupabaseClient,
  sessao: { userId: string; isAdminMaster: boolean },
  alvoId: string | null
): Promise<Hierarquia> {
  const ids = [...new Set([sessao.userId, alvoId].filter(Boolean) as string[])];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, is_admin_master, is_owner")
    .in("id", ids)
    .returns<{ id: string; is_admin_master: boolean; is_owner: boolean }[]>();

  let linhas = data ?? [];
  if (error) {
    const { data: semDono } = await supabase
      .from("profiles")
      .select("id, is_admin_master")
      .in("id", ids)
      .returns<{ id: string; is_admin_master: boolean }[]>();
    linhas = (semDono ?? []).map((l) => ({ ...l, is_owner: false }));
  }
  const eu = linhas.find((l) => l.id === sessao.userId);
  const alvo = alvoId ? linhas.find((l) => l.id === alvoId) : undefined;
  return {
    souAdmin: sessao.isAdminMaster,
    souPrincipal: Boolean(eu?.is_owner),
    alvoEAdmin: Boolean(alvo?.is_admin_master),
    alvoEPrincipal: Boolean(alvo?.is_owner),
    ehVoceMesmo: alvoId === sessao.userId,
  };
}
