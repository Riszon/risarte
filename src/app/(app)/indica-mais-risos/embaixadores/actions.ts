"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { EMBAIXADOR_STATUS, type EmbaixadorStatus } from "@/lib/indica/rotulos";
import { formatCpf, formatPhone } from "@/lib/masks";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { origemDoSite } from "@/lib/indica/publico";
import { whatsappLink } from "@/lib/whatsapp";

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const SEM_PERMISSAO = "Você não tem permissão para o Indica +Risos.";

function revalidar(embaixadorId: string) {
  revalidatePath("/indica-mais-risos", "layout");
  revalidatePath(`/indica-mais-risos/embaixadores/${embaixadorId}`);
}

/** Ajuste manual de Riso Coins (o banco exige gestor e motivo). */
export async function ajustarPontos(
  embaixadorId: string,
  risoCoins: number,
  motivo: string
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  if (!Number.isInteger(risoCoins) || risoCoins === 0) {
    return { ok: false, error: "Informe um número inteiro de Riso Coins (negativo debita)." };
  }
  const db = await indicaDb();
  const { error } = await db.rpc("ajustar_pontos", {
    p_embaixador_id: embaixadorId,
    p_riso_coins: risoCoins,
    p_motivo: motivo,
  });
  if (error) {
    console.error("ajustar_pontos:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  revalidar(embaixadorId);
  return { ok: true };
}

export async function definirStatusEmbaixador(
  embaixadorId: string,
  status: EmbaixadorStatus,
  motivo: string
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  if (!EMBAIXADOR_STATUS.includes(status)) return { ok: false, error: "Situação inválida." };
  const db = await indicaDb();
  const { error } = await db.rpc("definir_status_embaixador", {
    p_embaixador_id: embaixadorId,
    p_status: status,
    p_motivo: motivo,
  });
  if (error) {
    console.error("definir_status_embaixador:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  revalidar(embaixadorId);
  return { ok: true };
}

/**
 * Gera o link mágico do portal (o anterior deixa de valer) e devolve a
 * mensagem pronta para o WhatsApp do Embaixador. O link aparece só agora — o
 * banco guarda apenas o hash.
 */
export async function linkDoPortal(
  embaixadorId: string
): Promise<Resultado<{ link: string; whatsapp: string | null }>> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const db = await indicaDb();
  const { data: token, error } = await db.rpc("gerar_link_portal", { p_embaixador_id: embaixadorId });
  if (error || typeof token !== "string") {
    if (error) console.error("gerar_link_portal:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  const { data: emb } = await db
    .from("v_embaixadores")
    .select("nome, cliente_id, clinic_id")
    .eq("id", embaixadorId)
    .single<{ nome: string; cliente_id: string; clinic_id: string }>();
  const supabase = await createClient();
  const [{ data: cliente }, { data: modelo }] = await Promise.all([
    supabase.from("clients").select("phone").eq("id", emb?.cliente_id ?? "").maybeSingle<{ phone: string | null }>(),
    db.rpc("config_valor", { p_chave: "msg_link_portal", p_unidade_id: emb?.clinic_id ?? null }),
  ]);
  const link = `${await origemDoSite()}/e/${token}`;
  const texto = String(modelo ?? "{link}")
    .replace("{embaixador}", (emb?.nome ?? "").split(" ")[0])
    .replace("{link}", link);
  await logAudit({ action: "create", entityType: "indica_link_portal", entityId: embaixadorId });
  return { ok: true, link, whatsapp: whatsappLink(cliente?.phone, texto) };
}

/** Pedido de resgate feito pela equipe em nome do Embaixador. */
export async function solicitarResgate(dados: {
  embaixadorId: string;
  itemId: string;
  unidadeId: string;
  cederPara?: { nome: string; cpf: string; telefone: string } | null;
}): Promise<Resultado<{ codigo: string; status: string }>> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const ceder = dados.cederPara;
  const db = await indicaDb();
  const { data, error } = await db.rpc("solicitar_resgate", {
    p_dados: {
      embaixador_id: dados.embaixadorId,
      item_id: dados.itemId,
      unidade_id: dados.unidadeId,
      ...(ceder && (ceder.nome.trim() || ceder.cpf.trim() || ceder.telefone.trim())
        ? {
            cedido_para_nome: ceder.nome.trim(),
            cedido_para_cpf: formatCpf(ceder.cpf),
            cedido_para_telefone: formatPhone(ceder.telefone),
          }
        : {}),
    },
  });
  if (error) {
    console.error("solicitar_resgate:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  const { data: r } = await db
    .from("resgates")
    .select("codigo, status")
    .eq("id", data as string)
    .single<{ codigo: string; status: string }>();
  revalidar(dados.embaixadorId);
  revalidatePath("/indica-mais-risos/resgates");
  return { ok: true, codigo: r?.codigo ?? "", status: r?.status ?? "" };
}
