"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";

export async function marcarMensagem(
  id: number,
  status: "enviada" | "descartada" | "a_enviar"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: "Você não tem permissão para o Indica +Risos." };
  const db = await indicaDb();
  const { error } = await db.rpc("marcar_mensagem", { p_id: id, p_status: status });
  if (error) {
    console.error("marcar_mensagem:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  revalidatePath("/indica-mais-risos/mensagens");
  return { ok: true };
}
