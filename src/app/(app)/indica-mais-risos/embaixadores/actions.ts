"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { EMBAIXADOR_STATUS, type EmbaixadorStatus } from "@/lib/indica/rotulos";
import { formatCpf, formatPhone } from "@/lib/masks";

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
