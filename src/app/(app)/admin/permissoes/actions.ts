"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { CAPACIDADES_POR_ID, matrizPadrao } from "@/lib/permissions";
import { USER_ROLES, type UserRole } from "@/lib/roles";
import { isTreino } from "@/lib/environment";
import { SOMENTE_CONSULTA_NO_TREINO } from "@/lib/espelho";
import { agendarEspelho } from "@/lib/espelho-treino";

type Resultado = { ok: boolean; error?: string };

/** No treino as permissões são cópia da produção (0260): o banco recusa a escrita. */
const SO_NA_PRODUCAO =
  "No treino as permissões são cópia da produção. Faça a mudança no sistema de verdade — ela chega aqui sozinha.";

/** A função ainda não existe neste banco: a migração 0292 não rodou. */
function faltaMigracao(e: { message: string; code?: string }): boolean {
  return e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message);
}

function papeisValidos(papeis: unknown): papeis is UserRole[] {
  return (
    Array.isArray(papeis) &&
    papeis.every((p) => typeof p === "string" && (USER_ROLES as readonly string[]).includes(p))
  );
}

/**
 * Grava as permissões que mudaram — a barra de alterações manda todas de uma
 * vez, cada uma com o conjunto INTEIRO de funções.
 *
 * O conjunto é o valor: gravar papel a papel deixaria a permissão pela metade
 * se a rede caísse no meio. Cada permissão é uma transação no banco
 * (`set_permission`); se uma falhar, as outras continuam e a resposta diz
 * exatamente quais ficaram de fora — a tela não finge que salvou tudo.
 *
 * A guarda aparece duas vezes de propósito: aqui (`requireAdminMaster`, para a
 * mensagem ser amigável) e dentro de `set_permission` no banco, que é a
 * barreira de verdade.
 */
export async function salvarPermissoes(
  alteracoes: { capacidade: string; papeis: UserRole[] }[]
): Promise<Resultado & { salvas: string[]; falhas: string[] }> {
  const vazio = { salvas: [] as string[], falhas: [] as string[] };
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO, ...vazio };
  await requireAdminMaster();

  if (!Array.isArray(alteracoes) || alteracoes.length === 0) {
    return { ok: false, error: "Nenhuma alteração para salvar.", ...vazio };
  }
  for (const a of alteracoes) {
    if (!CAPACIDADES_POR_ID.has(a.capacidade)) {
      return { ok: false, error: "Permissão desconhecida.", ...vazio };
    }
    if (!papeisValidos(a.papeis)) {
      return { ok: false, error: "Função desconhecida.", ...vazio };
    }
  }

  const supabase = await createClient();
  const salvas: string[] = [];
  const falhas: string[] = [];
  for (const a of alteracoes) {
    const cap = CAPACIDADES_POR_ID.get(a.capacidade)!;
    const { error } = await supabase.rpc("set_permission", {
      p_capability: a.capacidade,
      p_roles: [...new Set(a.papeis)],
    });
    if (error) {
      console.error("set_permission:", error.message);
      if (error.message === "NOT_ALLOWED") {
        return { ok: false, error: "Só o Admin Master altera permissões.", salvas, falhas };
      }
      if (error.message === "MIRROR_READ_ONLY") {
        return { ok: false, error: SO_NA_PRODUCAO, salvas, falhas };
      }
      falhas.push(cap.rotulo);
      continue;
    }
    salvas.push(cap.rotulo);
    // Trilha LGPD: só ids e metadados. Aqui o "quem" é o PAPEL, não a pessoa.
    await logAudit({
      action: "update",
      entityType: "permission_matrix",
      entityId: a.capacidade,
      details: { rotulo: cap.rotulo, papeis: a.papeis },
    });
  }

  if (salvas.length > 0) {
    // A matriz do treino é cópia desta (0260): cada gravação aqui vai para lá.
    agendarEspelho({ permissoes: true });
    revalidatePath("/admin/permissoes");
    revalidatePath("/", "layout");
  }
  if (falhas.length > 0) {
    return {
      ok: false,
      error:
        salvas.length > 0
          ? `Salvei ${salvas.length}, mas não consegui salvar: ${falhas.join(", ")}. Tente de novo.`
          : "Não foi possível salvar. Tente de novo.",
      salvas,
      falhas,
    };
  }
  return { ok: true, salvas, falhas };
}

/**
 * "Tornar padrão" (OC-00002, 0292): o que está GRAVADO agora vira o padrão.
 *
 * Quem copia é o banco (`fix_permission_defaults`), lendo a matriz — nunca o
 * rascunho da tela. Por isso a tela só oferece o botão quando não há
 * alteração por salvar naquela permissão.
 */
export async function tornarPadrao(capacidades: string[]): Promise<Resultado> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();

  const ids = [...new Set(capacidades)];
  if (ids.length === 0) return { ok: false, error: "Escolha ao menos uma permissão." };
  if (ids.some((id) => !CAPACIDADES_POR_ID.has(id))) {
    return { ok: false, error: "Permissão desconhecida." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("fix_permission_defaults", { p_capabilities: ids });
  if (error) {
    console.error("fix_permission_defaults:", error.message);
    return {
      ok: false,
      error: faltaMigracao(error)
        ? "O “Tornar padrão” aguarda a migração 0292 neste banco."
        : error.message === "MIRROR_READ_ONLY"
          ? SO_NA_PRODUCAO
          : error.message === "NOT_ALLOWED"
          ? "Só o Admin Master altera o padrão."
          : "Não foi possível tornar padrão. Tente de novo.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "permission_defaults",
    entityId: ids.length === 1 ? ids[0] : "varias",
    details: { permissoes: ids, quantas: ids.length },
  });
  agendarEspelho({ permissoes: true });
  revalidatePath("/admin/permissoes");
  return { ok: true };
}

/**
 * Volta a usar o ORIGINAL DE FÁBRICA (o do código) como padrão desta
 * permissão. Não mexe em quem tem acesso: só muda a referência do selo e o
 * destino do "voltar ao padrão". É uma regravação, nunca exclusão.
 */
export async function usarOriginalComoPadrao(capacidade: string): Promise<Resultado> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();

  const cap = CAPACIDADES_POR_ID.get(capacidade);
  const original = matrizPadrao()[capacidade];
  if (!cap || !original) return { ok: false, error: "Permissão desconhecida." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_permission_default", {
    p_capability: capacidade,
    p_roles: original,
  });
  if (error) {
    console.error("set_permission_default:", error.message);
    return {
      ok: false,
      error: faltaMigracao(error)
        ? "Isto aguarda a migração 0292 neste banco."
        : error.message === "MIRROR_READ_ONLY"
          ? SO_NA_PRODUCAO
          : "Não foi possível mudar o padrão. Tente de novo.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "permission_defaults",
    entityId: capacidade,
    details: { rotulo: cap.rotulo, original: true },
  });
  agendarEspelho({ permissoes: true });
  revalidatePath("/admin/permissoes");
  return { ok: true };
}
