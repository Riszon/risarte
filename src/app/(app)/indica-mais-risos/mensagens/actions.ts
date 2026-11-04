"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { origemDoSite } from "@/lib/indica/publico";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappLink } from "@/lib/whatsapp";

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

/**
 * O link do WhatsApp do CONVITE ao indicado (AP100). O token do convite não
 * fica na fila: quem lê a fila não consegue aceitar em nome do indicado. Aqui
 * (1) a pessoa logada prova, pela RLS, que enxerga a mensagem; (2) a chave de
 * serviço pede o link a `indica.link_do_convite`, que registra quem pediu em
 * `audit_logs` (só ids) e devolve nulo quando o convite já não vale.
 */
export async function abrirConvite(id: number): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: "Você não tem permissão para o Indica +Risos." };
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Mensagem inválida." };

  const db = await indicaDb();
  const { data: m, error } = await db
    .from("mensagens")
    .select("id, evento, telefone, texto, status")
    .eq("id", id)
    .maybeSingle<{ id: number; evento: string; telefone: string; texto: string; status: string }>();
  if (error) return { ok: false, error: mensagemDoBanco(error) };
  if (!m || m.evento !== "convite") return { ok: false, error: "Esta mensagem não é um convite." };

  const { data: caminho, error: erroLink } = await createAdminClient()
    .schema("indica")
    .rpc("link_do_convite", { p_mensagem_id: id, p_usuario: session.userId });
  if (erroLink) {
    console.error("link_do_convite:", erroLink.message);
    return { ok: false, error: mensagemDoBanco(erroLink) };
  }
  if (typeof caminho !== "string" || !caminho) {
    return { ok: false, error: "Este convite não vale mais (já foi aceito, venceu ou a indicação encerrou). Descarte a mensagem." };
  }
  const texto = m.texto.replace("{link}", `${await origemDoSite()}${caminho}`);
  const link = whatsappLink(m.telefone, texto);
  if (!link) return { ok: false, error: "Telefone inválido." };
  return { ok: true, link };
}
