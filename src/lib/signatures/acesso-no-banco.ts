import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackagePermissions } from "./actions-permitidas";

/**
 * AS PERMISSÕES DE UM PACOTE PERGUNTADAS AO BANCO (AP158, item 2).
 *
 * `pode()` na tela olha só os papéis da pessoa NAQUELA unidade; o banco
 * (`signature_can`, 0340) também conta o papel da Franqueadora com escopo
 * sobre a unidade. Resultado antes: a equipe da Franqueadora via o pacote da
 * unidade (a RLS deixava), mas a tela escondia ver/baixar/reenviar/cancelar.
 * Agora o detalhe, a lista e as ações do pacote perguntam ao banco — a tela
 * segue o banco, com a mesma regra da leitura (`signature_can_view_package`:
 * visualizar na unidade OU o painel da rede).
 */

export type CapacidadeDoPacote =
  | "acao.assinaturas.visualizar"
  | "acao.assinaturas.baixar"
  | "acao.assinaturas.enviar"
  | "acao.assinaturas.cancelar";

export async function podeNoBanco(supabase: SupabaseClient, capacidade: CapacidadeDoPacote, clinicId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("signature_can", { p_capability: capacidade, p_clinic_id: clinicId });
  if (error) {
    console.error("signature_can:", error.message);
    return false;
  }
  if (data === true) return true;
  if (capacidade !== "acao.assinaturas.visualizar") return false;
  // Como na leitura do pacote: quem tem o painel da rede vê de todas as unidades.
  const rede = await supabase.rpc("signature_can", { p_capability: "acao.assinaturas.painel_rede", p_clinic_id: null });
  return rede.data === true;
}

export async function permissoesNoBanco(supabase: SupabaseClient, clinicId: string): Promise<PackagePermissions> {
  const [view, download, send, cancel] = await Promise.all([
    podeNoBanco(supabase, "acao.assinaturas.visualizar", clinicId),
    podeNoBanco(supabase, "acao.assinaturas.baixar", clinicId),
    podeNoBanco(supabase, "acao.assinaturas.enviar", clinicId),
    podeNoBanco(supabase, "acao.assinaturas.cancelar", clinicId),
  ]);
  return { view, download, send, cancel };
}

/** Uma consulta por unidade, não por pacote (a lista pode ter muitos da mesma). */
export function permissoesPorUnidade(supabase: SupabaseClient): (clinicId: string) => Promise<PackagePermissions> {
  const cache = new Map<string, Promise<PackagePermissions>>();
  return (clinicId) => {
    let p = cache.get(clinicId);
    if (!p) {
      p = permissoesNoBanco(supabase, clinicId);
      cache.set(clinicId, p);
    }
    return p;
  };
}
