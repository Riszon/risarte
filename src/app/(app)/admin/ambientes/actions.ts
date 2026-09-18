"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { AMBIENTES, enderecoValido, type Ambiente } from "@/lib/ambientes";
import { isTreino } from "@/lib/environment";
import { espelharTudo } from "@/lib/espelho-treino";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Salva o endereço de um ambiente (0259). Vazio é uma resposta legítima —
 * "ainda não publicado" — e faz o atalho sumir do Início, em vez de virar um
 * link que não abre.
 */
export async function salvarEnderecoDoAmbiente(
  key: string,
  url: string
): Promise<ActionResult> {
  await requireAdminMaster();
  if (!AMBIENTES.includes(key as Ambiente)) {
    return { ok: false, error: "Ambiente desconhecido." };
  }

  const limpo = url.trim();
  if (limpo && !enderecoValido(limpo)) {
    return {
      ok: false,
      error: "O endereço precisa começar com http:// ou https://.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_environment_url", {
    p_key: key,
    p_url: limpo,
  });
  if (error) {
    console.error("salvarEnderecoDoAmbiente falhou:", error.message);
    return {
      ok: false,
      error:
        error.code === "PGRST202"
          ? "O banco ainda não recebeu a migração 0259 (ambientes)."
          : "Não foi possível salvar o endereço.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "environments",
    entityId: key,
    details: { tem_endereco: limpo !== "" },
  });
  revalidatePath("/admin/ambientes");
  revalidatePath("/", "layout");
  return { ok: true };
}

export type ResultadoDaSincronizacao = ActionResult & {
  avisos?: string[];
  resumo?: { pessoas: number; risartanos: number; permissoes: number };
};

/**
 * COPIA TUDO PARA O TREINO AGORA (0260): permissões, todas as pessoas e todas
 * as fichas. Serve para a primeira carga e para consertar o que ficou pendente
 * — a cópia do dia a dia acontece sozinha, a cada alteração.
 *
 * Só na produção e só o Admin Master. Aqui a espera é de propósito (não vai
 * para depois da resposta): quem clicou quer ver o resultado.
 */
export async function sincronizarTreinoAgora(): Promise<ResultadoDaSincronizacao> {
  if (isTreino()) {
    return { ok: false, error: "O treino é a cópia: a sincronização se faz no sistema real." };
  }
  await requireAdminMaster();
  const r = await espelharTudo();
  await logAudit({
    action: "update",
    entityType: "mirror_state",
    entityId: "treino",
    details: { ok: r.ok, ...(r.resumo ?? {}), avisos: r.avisos.length },
  });
  revalidatePath("/admin/ambientes");
  revalidatePath("/risartanos", "layout");
  return { ok: r.ok, error: r.error, avisos: r.avisos, resumo: r.resumo };
}
