"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { USER_ROLES } from "@/lib/roles";
import { PAPEL_PADRAO, validarTempos } from "@/lib/acesso";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Grava o tempo de inatividade — o padrão e o de cada função (0287).
 *
 * Função em branco deixa de ter regra própria: a linha dela SAI da tabela e
 * ela volta a seguir o padrão. Isso não é apagar dado — é a mesma operação de
 * "voltar ao padrão da rede" das outras configurações, e o antes/depois fica
 * na auditoria.
 */
export async function salvarTemposDeInatividade(
  formData: FormData
): Promise<ActionResult> {
  const session = await requireAdminMaster();

  const entrada: Record<string, string> = {};
  for (const [nome, valor] of formData.entries()) {
    if (nome.startsWith("papel:")) entrada[nome.slice("papel:".length)] = String(valor);
  }
  const lido = validarTempos(entrada, USER_ROLES);
  if (!lido.ok) return { ok: false, error: lido.erro };

  const supabase = await createClient();
  const { data: antesRows, error: erroDaLeitura } = await supabase
    .from("access_idle_settings")
    .select("papel, idle_minutes")
    .returns<{ papel: string; idle_minutes: number }[]>();
  if (erroDaLeitura || !antesRows) {
    return {
      ok: false,
      error:
        "Não foi possível ler a configuração atual (a migração 0287 já foi aplicada neste banco?). Nada foi alterado.",
    };
  }
  const antes = Object.fromEntries(antesRows.map((r) => [r.papel, r.idle_minutes]));

  const gravar = Object.entries(lido.valores)
    .filter((par): par is [string, number] => par[1] !== null)
    .map(([papel, idle_minutes]) => ({
      papel,
      idle_minutes,
      updated_by: session.userId,
      updated_at: new Date().toISOString(),
    }));
  const voltarAoPadrao = Object.entries(lido.valores)
    .filter(([papel, v]) => v === null && papel !== PAPEL_PADRAO && papel in antes)
    .map(([papel]) => papel);

  const { error: erroAoGravar } = await supabase
    .from("access_idle_settings")
    .upsert(gravar, { onConflict: "papel" });
  if (erroAoGravar) {
    console.error("salvarTemposDeInatividade (gravar):", erroAoGravar.message);
    return { ok: false, error: "Não foi possível salvar os tempos." };
  }
  if (voltarAoPadrao.length > 0) {
    const { error: erroAoTirar } = await supabase
      .from("access_idle_settings")
      .delete()
      .in("papel", voltarAoPadrao);
    if (erroAoTirar) {
      console.error("salvarTemposDeInatividade (voltar ao padrão):", erroAoTirar.message);
      return {
        ok: false,
        error: "Os tempos foram salvos, mas não foi possível voltar algumas funções ao padrão. Tente de novo.",
      };
    }
  }

  await logAudit({
    action: "update",
    entityType: "access_idle_settings",
    details: {
      antes,
      depois: Object.fromEntries(gravar.map((g) => [g.papel, g.idle_minutes])),
    },
  });
  revalidatePath("/admin/sessao");
  return { ok: true };
}
