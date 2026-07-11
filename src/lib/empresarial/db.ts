import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Módulo Risarte Empresarial — as tabelas vivem no schema `empresarial`
 * (não no `public`). O Supabase JS acessa via `.schema('empresarial')`.
 *
 * IMPORTANTE (passo único do dono no painel): o schema precisa estar em
 * Supabase → Project Settings → API → "Exposed schemas".
 *
 * Use `empresarialDb()` em server components/actions (RLS do usuário aplica) e
 * `empresarialAdminDb()` só dentro de actions que já checaram o papel, para o
 * que a RLS não cobre (webhooks de pagamento, rotinas de sistema).
 */
export const EMPRESARIAL_SCHEMA = "empresarial" as const;

export async function empresarialDb() {
  const supabase = await createClient();
  return supabase.schema(EMPRESARIAL_SCHEMA);
}

export function empresarialAdminDb() {
  return createAdminClient().schema(EMPRESARIAL_SCHEMA);
}
