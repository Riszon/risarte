"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { AMBIENTES, enderecoValido, type Ambiente } from "@/lib/ambientes";

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
