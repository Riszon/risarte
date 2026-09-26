"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  ehEscopo,
  ehGatilho,
  ehModoDeGrupo,
  indicadoresDoPapel,
  normalizarMeta,
  PAPEIS_COM_MISSAO,
} from "@/lib/certificacao";
import type { UserRole } from "@/lib/roles";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Grava a missão de UMA função. A tela salva função por função de propósito:
 * um botão só, salvando as treze, faria o Admin perder o trabalho das outras
 * doze quando errasse um número — e ele não saberia qual.
 */
export async function salvarMissao(
  papel: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdminMaster();

  if (!(PAPEIS_COM_MISSAO as readonly string[]).includes(papel)) {
    return { ok: false, error: "Função desconhecida." };
  }
  const role = papel as UserRole;

  // Só os indicadores DAQUELA função entram. Ler o formulário inteiro deixaria
  // um campo renomeado no navegador gravar meta para indicador de outro papel.
  const metas: Record<string, number> = {};
  for (const indicador of indicadoresDoPapel(role)) {
    metas[indicador.chave] = normalizarMeta(formData.get(indicador.chave));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_training_requirements", {
    p_role: role,
    p_metas: metas,
  });

  if (error) {
    return {
      ok: false,
      error:
        error.message === "NOT_ALLOWED"
          ? "Só o Admin Master define as metas de treino."
          : "Não foi possível salvar as metas. Tente de novo.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "training_requirements",
    entityId: role,
  });

  revalidatePath("/admin/certificacao");
  return { ok: true };
}

/**
 * Grava os dois eixos de liberação e, junto, o grupo do teste coletivo (0272).
 *
 * ⚠️ NUM FORMULÁRIO SÓ, de propósito. O grupo só existe por causa do modo
 * coletivo; salvá-los separadamente abriria a janela em que a liberação já é
 * coletiva e o grupo ainda está vazio — e nessa janela ninguém seria liberado,
 * sem nada na tela explicando por quê.
 */
export async function salvarPortao(formData: FormData): Promise<ActionResult> {
  await requireAdminMaster();

  const escopo = String(formData.get("release_scope") ?? "");
  const gatilho = String(formData.get("release_trigger") ?? "");
  const modo = String(formData.get("cohort_mode") ?? "papeis");

  // Valor fora da lista é recusado AQUI, com nome: deixar chegar ao banco daria
  // um "erro ao salvar" sem nada explicando qual dos campos está errado.
  if (!ehEscopo(escopo)) return { ok: false, error: "Escopo inválido." };
  if (!ehGatilho(gatilho)) return { ok: false, error: "Gatilho inválido." };
  if (!ehModoDeGrupo(modo)) return { ok: false, error: "Modo de grupo inválido." };

  const supabase = await createClient();

  const { error } = await supabase.rpc("save_training_settings", {
    p_scope: escopo,
    p_trigger: gatilho,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.message === "NOT_ALLOWED"
          ? "Só o Admin Master muda as regras de liberação."
          : "Não foi possível salvar as regras. Tente de novo.",
    };
  }

  // O formulário só traz as caixas do modo que está aparecendo. As duas listas
  // são enviadas mesmo assim (uma vazia) porque o banco guarda as duas: trocar
  // de modo para conferir e voltar não pode apagar o que já foi montado — e o
  // que for enviado vazio é justamente o que o Admin não está editando agora.
  const papeisMarcados = formData.getAll("cohort_roles").map(String);
  const pessoasMarcadas = formData.getAll("cohort_members").map(String);

  const { error: erroGrupo } = await supabase.rpc("save_training_cohort", {
    p_mode: modo,
    p_roles: modo === "papeis" ? papeisMarcados : null,
    p_members: modo === "pessoas" ? pessoasMarcadas : null,
  });
  if (erroGrupo) {
    return {
      ok: false,
      error:
        erroGrupo.message === "NOT_ALLOWED"
          ? "Só o Admin Master muda o grupo do teste coletivo."
          : "As regras foram salvas, mas o grupo não. Tente salvar de novo.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "training_settings",
    details: {
      escopo,
      gatilho,
      modo,
      participantes:
        modo === "papeis" ? papeisMarcados.length : pessoasMarcadas.length,
    },
  });

  revalidatePath("/admin/certificacao");
  return { ok: true };
}
