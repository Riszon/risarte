"use server";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * A pessoa fechou as boas-vindas (0263): grava quando, no PRÓPRIO perfil, para
 * a janela não voltar. Falhar aqui não pode travar quem está entrando — no pior
 * caso, as boas-vindas aparecem mais uma vez.
 */
export async function marcarBoasVindasVistas(): Promise<{ ok: boolean }> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ welcomed_at: new Date().toISOString() })
    .eq("id", session.userId)
    .is("welcomed_at", null);
  if (error) console.error("marcarBoasVindasVistas falhou:", error.code);
  return { ok: !error };
}
