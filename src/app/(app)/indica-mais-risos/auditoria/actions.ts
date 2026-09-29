"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";

type Resultado = { ok: true; mensagem?: string } | { ok: false; error: string };
const SEM_PERMISSAO = "Você não tem permissão para o Indica +Risos.";

/** A franqueadora decide o alerta (o banco confere e grava a auditoria). */
export async function tratarAlerta(
  id: string,
  status: "em_analise" | "procedente" | "improcedente",
  motivo?: string
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const db = await indicaDb();
  const { error } = await db.rpc("tratar_alerta", { p_id: id, p_status: status, p_motivo: motivo ?? null });
  if (error) {
    console.error("tratar_alerta:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  revalidatePath("/indica-mais-risos/auditoria");
  return { ok: true };
}

/** Roda a conferência antifraude agora (a rotina roda sozinha às 02:50). */
export async function rodarConferencia(): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const db = await indicaDb();
  const { data, error } = await db.rpc("detectar_fraudes");
  if (error) {
    console.error("detectar_fraudes:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  const novos = Object.values((data ?? {}) as Record<string, number>).reduce((s, n) => s + Number(n || 0), 0);
  revalidatePath("/indica-mais-risos/auditoria");
  return { ok: true, mensagem: novos === 0 ? "Conferência feita: nenhum alerta novo." : `Conferência feita: ${novos} alerta(s) novo(s).` };
}
