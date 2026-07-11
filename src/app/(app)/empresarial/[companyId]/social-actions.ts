"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { SOCIAL_TRIGGER_TYPES } from "@/lib/empresarial/constants";

export type ActionResult = { ok: boolean; error?: string };

export async function generateSocialToken(
  companyId: string,
  triggerType: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  if (!(SOCIAL_TRIGGER_TYPES as readonly string[]).includes(triggerType)) {
    return { ok: false, error: "Gatilho inválido." };
  }

  const db = await empresarialDb();
  const { data: company } = await db
    .from("companies")
    .select("payment_model, status")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return { ok: false, error: "Empresa não encontrada." };
  if (company.status !== "ACTIVE") {
    return { ok: false, error: "Só empresas ativas participam do Riso+ Social." };
  }
  if (company.payment_model === "EMPLOYEE_PAYS") {
    return {
      ok: false,
      error: "Empresas no modelo “colaborador paga” não participam do Riso+ Social.",
    };
  }
  // Integral → beneficiário próprio; Parcial → entra no pool coletivo.
  const isPool = company.payment_model === "COMPANY_PARTIAL";

  const { error } = await db.from("social_tokens").insert({
    company_id: companyId,
    trigger_type: triggerType,
    is_pool: isPool,
    status: "AVAILABLE",
  });
  if (error) {
    console.error("generateSocialToken failed:", error.message);
    return { ok: false, error: "Não foi possível gerar a ficha social." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_social_token",
    entityId: companyId,
    details: { trigger: triggerType, pool: isPool },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function assignSocialToken(
  companyId: string,
  tokenId: string,
  clientId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  if (!clientId) return { ok: false, error: "Escolha o beneficiário." };
  const db = await empresarialDb();
  const { error } = await db
    .from("social_tokens")
    .update({ beneficiary_client_id: clientId, status: "ASSIGNED" })
    .eq("id", tokenId);
  if (error) {
    console.error("assignSocialToken failed:", error.message);
    return { ok: false, error: "Não foi possível atribuir." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function markSocialTokenUsed(
  companyId: string,
  tokenId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db
    .from("social_tokens")
    .update({ status: "USED" })
    .eq("id", tokenId);
  if (error) {
    console.error("markSocialTokenUsed failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function removeSocialToken(
  companyId: string,
  tokenId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db.from("social_tokens").delete().eq("id", tokenId);
  if (error) {
    console.error("removeSocialToken failed:", error.message);
    return { ok: false, error: "Não foi possível remover." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}
