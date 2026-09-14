"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Ajusta os limites de dias por fase e o prazo de inatividade.
 *
 * Só o gestor do programa: o limite vale para o funil inteiro, e quem é cobrado
 * por ele não deveria ser quem o define. A RLS (1012) impõe o mesmo — esta
 * guarda é para a mensagem ficar clara antes de o banco recusar.
 */
export async function saveFunnelLimits(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) {
    return { ok: false, error: "Só o gestor do programa ajusta os limites." };
  }

  const db = await empresarialDb();

  const inatividade = Number.parseInt(
    String(formData.get("inactivity_days") ?? ""),
    10
  );
  if (!Number.isFinite(inatividade) || inatividade <= 0) {
    return { ok: false, error: "O prazo de inatividade tem de ser maior que zero." };
  }
  const { error: sErr } = await db
    .from("funnel_settings")
    .update({ inactivity_days: inatividade, updated_by: session.userId })
    .eq("singleton", true);
  if (sErr) {
    console.error("saveFunnelLimits (settings) failed:", sErr.message);
    return { ok: false, error: "Não foi possível salvar o prazo de inatividade." };
  }

  // As fases vêm do banco, não de uma lista escrita aqui: acrescentar uma fase
  // na migração passaria a valer sozinha, sem ninguém lembrar deste arquivo.
  const { data: atuais, error: lErr } = await db
    .from("funnel_stage_limits")
    .select("stage")
    .returns<{ stage: string }[]>();
  if (lErr) {
    console.error("saveFunnelLimits (ler fases) failed:", lErr.message);
    return { ok: false, error: "Não foi possível ler as fases." };
  }

  for (const { stage } of atuais ?? []) {
    const bruto = String(formData.get(`limite_${stage}`) ?? "").trim();
    if (!bruto) continue;
    const dias = Number.parseInt(bruto, 10);
    // Valor inválido é IGNORADO, não vira zero: zero faria a fase alertar em
    // toda empresa, todo dia.
    if (!Number.isFinite(dias) || dias <= 0) continue;

    const { error } = await db
      .from("funnel_stage_limits")
      .update({ max_days: dias, updated_by: session.userId })
      .eq("stage", stage);
    if (error) {
      console.error(`saveFunnelLimits (${stage}) failed:`, error.message);
      return { ok: false, error: "Não foi possível salvar os limites." };
    }
  }

  revalidatePath("/empresarial/funil/painel");
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

/** Apura os alertas agora, em vez de esperar as 9h da manhã seguinte. */
export async function refreshFunnelAlerts(): Promise<
  ActionResult & { abertos?: number }
> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) {
    return { ok: false, error: "Só o gestor do programa apura os alertas." };
  }
  const db = await empresarialDb();
  const { data, error } = await db.rpc("check_funnel_alerts");
  if (error) {
    console.error("refreshFunnelAlerts failed:", error.message);
    return { ok: false, error: "Não foi possível apurar os alertas." };
  }
  revalidatePath("/empresarial/funil/painel");
  return { ok: true, abertos: typeof data === "number" ? data : undefined };
}
