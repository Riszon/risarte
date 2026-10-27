"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import {
  SITUACOES_DO_COMPROMISSO,
  limparDetalhe,
  type SituacaoDoCompromisso,
} from "@/lib/empresarial/vantagens";

export type ActionResult = { ok: boolean; error?: string };

/**
 * AS VANTAGENS COMBINADAS COM A EMPRESA — os compromissos (1033).
 *
 * Decisão do dono (26/10/2026): o que foi prometido além dos procedimentos
 * (palestra, publicidade, unidade exclusiva…) é acompanhado até ser entregue.
 * Quem mexe é o gestor do programa; a RLS confirma.
 */
export async function atualizarCompromisso(
  companyId: string,
  compromissoId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const status = String(formData.get("status") ?? "") as SituacaoDoCompromisso;
  if (!SITUACOES_DO_COMPROMISSO.includes(status)) {
    return { ok: false, error: "Escolha a situação." };
  }
  const db = await empresarialDb();
  const { error } = await db
    .from("company_perks")
    .update({
      status,
      status_note: limparDetalhe(String(formData.get("status_note") ?? "")),
      detail: limparDetalhe(String(formData.get("detail") ?? "")),
      status_changed_at: new Date().toISOString(),
      status_changed_by: session.userId,
    })
    .eq("id", compromissoId)
    .eq("company_id", companyId);
  if (error) {
    console.error("atualizarCompromisso failed:", error.message);
    return { ok: false, error: "Não foi possível salvar." };
  }
  await logAudit({ action: "update", entityType: "empresarial_company_perk", entityId: compromissoId });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/**
 * Inclui uma vantagem DEPOIS do fechamento — a empresa cadastrada direto, ou
 * o que foi combinado mais tarde. O nome é copiado do catálogo agora.
 */
export async function incluirCompromisso(
  companyId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const perkId = String(formData.get("perk_id") ?? "");
  if (!perkId) return { ok: false, error: "Escolha a vantagem." };
  const db = await empresarialDb();
  const { data: perk, error: eP } = await db
    .from("perks")
    .select("name, description")
    .eq("id", perkId)
    .maybeSingle<{ name: string; description: string | null }>();
  if (eP || !perk) return { ok: false, error: "Vantagem não encontrada." };

  const { data, error } = await db
    .from("company_perks")
    .insert({
      company_id: companyId,
      perk_id: perkId,
      name: perk.name,
      detail: limparDetalhe(String(formData.get("detail") ?? "")) ?? perk.description,
    })
    .select("id")
    .single();
  if (error) {
    console.error("incluirCompromisso failed:", error.message);
    return { ok: false, error: "Não foi possível incluir." };
  }
  await logAudit({ action: "create", entityType: "empresarial_company_perk", entityId: data.id });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Tira uma vantagem combinada (desfeita na renegociação, ou incluída por engano). */
export async function removerCompromisso(
  companyId: string,
  compromissoId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db
    .from("company_perks")
    .delete()
    .eq("id", compromissoId)
    .eq("company_id", companyId);
  if (error) {
    console.error("removerCompromisso failed:", error.message);
    return { ok: false, error: "Não foi possível tirar." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_company_perk_removido",
    entityId: compromissoId,
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}
