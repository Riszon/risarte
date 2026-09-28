import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Indica +Risos — as tabelas vivem no schema `indica` (não no `public`).
 *
 * Só existe a versão com o usuário logado (a RLS aplica): toda escrita do
 * programa passa pelas funções do banco (`registrar_indicacao`,
 * `avancar_status`…), que têm guarda própria. Não há motivo para a chave de
 * serviço aqui — o portal do Embaixador (IND3) terá a sua porta separada.
 *
 * O schema precisa estar em Supabase → Integrations → Data API → "Exposed
 * schemas" (feito nos dois bancos em 28/09/2026).
 */
export const INDICA_SCHEMA = "indica" as const;

export async function indicaDb() {
  const supabase = await createClient();
  return supabase.schema(INDICA_SCHEMA);
}
