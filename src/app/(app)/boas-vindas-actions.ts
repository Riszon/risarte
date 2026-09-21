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
  // 0265: conta mais uma aparição e guarda QUANDO foi. O "uma vez por dia" é
  // decidido na leitura (page.tsx) — aqui só se registra o que aconteceu.
  const { data: atual } = await supabase
    .from("profiles")
    .select("welcome_count")
    .eq("id", session.userId)
    .maybeSingle<{ welcome_count: number | null }>();
  const { error } = await supabase
    .from("profiles")
    .update({
      welcomed_at: new Date().toISOString(),
      welcome_count: (atual?.welcome_count ?? 0) + 1,
    })
    .eq("id", session.userId);
  if (error) console.error("marcarBoasVindasVistas falhou:", error.code);
  return { ok: !error };
}
