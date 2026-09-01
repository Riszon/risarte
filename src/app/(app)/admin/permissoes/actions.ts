"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { CAPACIDADES_POR_ID, matrizPadrao } from "@/lib/permissions";
import type { UserRole } from "@/lib/roles";

type Resultado = { ok: boolean; error?: string };

/**
 * Grava os papéis de UMA capacidade.
 *
 * Vem tudo de uma vez, não papel a papel: o conjunto É o valor. Salvar um papel
 * por vez deixaria a permissão pela metade se a rede caísse no meio — alguém
 * ganhando acesso e outro não, sem ninguém perceber.
 *
 * A guarda aparece duas vezes de propósito: aqui (`requireAdminMaster`, para a
 * mensagem ser amigável) e dentro de `set_permission` no banco, que é a
 * barreira de verdade. Esconder o botão na tela é conforto.
 */
export async function salvarPermissao(
  capacidade: string,
  papeis: UserRole[]
): Promise<Resultado> {
  await requireAdminMaster();

  const cap = CAPACIDADES_POR_ID.get(capacidade);
  if (!cap) {
    return { ok: false, error: "Permissão desconhecida." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_permission", {
    p_capability: capacidade,
    p_roles: papeis,
  });

  if (error) {
    console.error("set_permission:", error.message);
    return {
      ok: false,
      error:
        error.message === "NOT_ALLOWED"
          ? "Só o Admin Master altera permissões."
          : "Não foi possível salvar. Tente de novo.",
    };
  }

  // Trilha LGPD: só ids e metadados, nunca dado pessoal. Aqui o "quem" é o
  // PAPEL, não a pessoa — e é exatamente o que precisa ficar registrado.
  await logAudit({
    action: "update",
    entityType: "permission_matrix",
    entityId: capacidade,
    details: { rotulo: cap.rotulo, papeis },
  });

  revalidatePath("/admin/permissoes");
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Devolve UMA capacidade ao padrão de fábrica.
 *
 * Existe porque uma matriz sem volta assusta: a pessoa deixa de experimentar
 * com medo de não saber desfazer, e aí a tela não cumpre o que prometeu.
 */
export async function restaurarPadrao(capacidade: string): Promise<Resultado> {
  await requireAdminMaster();
  const padrao = matrizPadrao()[capacidade];
  if (!padrao) return { ok: false, error: "Permissão desconhecida." };
  return salvarPermissao(capacidade, padrao);
}
