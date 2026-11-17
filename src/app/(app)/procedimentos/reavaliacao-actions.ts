"use server";

// D17 (0418, docs/jornada/FIM-DO-TRATAMENTO-PLANO.md): o procedimento com
// "reavaliação presencial obrigatória" faz o fim do plano marcar "Sim" sem
// perguntar ao dentista (prótese, implante, reabilitação, estética...). Só o
// Admin Master — o banco confere de novo (`procedures_reevaluation_guard`, e a
// regra `procedures_write` já só deixa o Admin gravar).

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type Resultado = { ok: boolean; error?: string };

const SO_O_ADMIN = "Só o Admin Master marca a reavaliação obrigatória.";

export async function salvarReavaliacaoObrigatoria(
  procedureId: string,
  obrigatoria: boolean
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) return { ok: false, error: SO_O_ADMIN };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("procedures")
    .update({ requires_reevaluation: obrigatoria })
    .eq("id", procedureId)
    .select("id");
  if (error) {
    if (error.message?.includes("REEVALUATION_FLAG_ADMIN_ONLY")) return { ok: false, error: SO_O_ADMIN };
    console.error("salvarReavaliacaoObrigatoria:", error.code);
    return { ok: false, error: "Não foi possível salvar." };
  }
  if ((data ?? []).length !== 1) return { ok: false, error: "Nada foi gravado (sem permissão)." };
  revalidatePath("/procedimentos");
  return { ok: true };
}
