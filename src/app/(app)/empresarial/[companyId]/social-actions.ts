"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { SOCIAL_TRIGGER_TYPES } from "@/lib/empresarial/constants";
import {
  metasDoFormulario,
  metasParaGravar,
  problemasDasMetas,
} from "@/lib/empresarial/riso-social";
import { formatCpf } from "@/lib/masks";
import { lookupClientByCpf } from "./employee-actions";

export type ActionResult = { ok: boolean; error?: string };

/**
 * LIBERA UMA FICHA SOCIAL — o clique do gestor (1034: "o sistema mostra, o
 * gestor libera"). O gatilho é o da meta que rendeu a ficha; é por ele que o
 * painel conta "liberadas" de cada meta.
 */
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
    .select("payment_model, status, social_participates")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return { ok: false, error: "Empresa não encontrada." };
  if (company.status !== "ACTIVE") {
    return { ok: false, error: "Só empresas ativas participam do Riso+ Social." };
  }
  if (company.payment_model === "EMPLOYEE_PAYS") {
    return {
      ok: false,
      error: "Empresas no modelo “titular paga” não participam do Riso+ Social.",
    };
  }
  if (company.social_participates === false) {
    return { ok: false, error: "Esta empresa não participa do Riso+ Social (combinado na proposta)." };
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
    return { ok: false, error: "Não foi possível liberar a ficha social." };
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
    .eq("id", tokenId)
    .eq("company_id", companyId);
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
  const { error } = await db
    .from("social_tokens")
    .delete()
    .eq("id", tokenId)
    .eq("company_id", companyId);
  if (error) {
    console.error("removeSocialToken failed:", error.message);
    return { ok: false, error: "Não foi possível remover." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

// -----------------------------------------------------------------------------
// 1034 — metas e indicações
// -----------------------------------------------------------------------------

/** A participação e as metas da empresa — para a cadastrada direto, ou o renegociado. */
export async function salvarMetasDaEmpresa(
  companyId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const participa = formData.get("social_participates") === "on";
  const metas = participa
    ? metasDoFormulario((k) => {
        const v = formData.get(k);
        return v == null ? null : String(v);
      })
    : [];
  const problemas = problemasDasMetas(metas);
  if (problemas.length > 0) return { ok: false, error: `Confira as metas: ${problemas.join("; ")}.` };

  const db = await empresarialDb();
  const { error } = await db
    .from("companies")
    .update({
      social_participates: participa,
      ...(participa ? { social_goals: metasParaGravar(metas) } : {}),
    })
    .eq("id", companyId);
  if (error) {
    console.error("salvarMetasDaEmpresa failed:", error.message);
    return { ok: false, error: "Não foi possível salvar as metas." };
  }
  await logAudit({ action: "update", entityType: "empresarial_social_metas", entityId: companyId });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/**
 * REGISTRA UMA INDICAÇÃO feita pela empresa. Ela entra "em análise": a equipe
 * decide antes de qualquer ficha ser usada.
 *
 * ⚠️ DADO PESSOAL DE TERCEIRO (LGPD): só o necessário para contatar e decidir,
 * e nada disso vai para o registro de auditoria.
 */
export async function registrarIndicacao(
  companyId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const nome = String(formData.get("full_name") ?? "").trim();
  if (nome.length < 3) return { ok: false, error: "Informe o nome de quem foi indicado." };
  const cpfBruto = String(formData.get("cpf") ?? "").trim();
  const cpf = cpfBruto ? formatCpf(cpfBruto) : null;
  if (cpf && cpf.replace(/\D/g, "").length !== 11) {
    return { ok: false, error: "O CPF precisa ter 11 dígitos (ou fique em branco)." };
  }

  const db = await empresarialDb();
  const { data, error } = await db
    .from("social_referrals")
    .insert({
      company_id: companyId,
      full_name: nome.slice(0, 160),
      phone: String(formData.get("phone") ?? "").trim() || null,
      cpf,
      reason: String(formData.get("reason") ?? "").trim() || null,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error) {
    console.error("registrarIndicacao failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a indicação." };
  }
  await logAudit({ action: "create", entityType: "empresarial_social_indicacao", entityId: data.id });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/**
 * APROVA: a indicação consome UMA ficha liberada e ainda livre (a mais antiga).
 * Sem ficha livre, recusa — aprovar sem ficha seria prometer o que a meta não
 * rendeu.
 */
export async function aprovarIndicacao(
  companyId: string,
  indicacaoId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();

  const { data: ind } = await db
    .from("social_referrals")
    .select("status")
    .eq("id", indicacaoId)
    .eq("company_id", companyId)
    .maybeSingle<{ status: string }>();
  if (!ind) return { ok: false, error: "Indicação não encontrada." };
  if (ind.status !== "IN_REVIEW") return { ok: false, error: "Esta indicação já foi decidida." };

  const { data: livres, error: eT } = await db
    .from("social_tokens")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "AVAILABLE")
    .order("created_at")
    .limit(1)
    .returns<{ id: string }[]>();
  if (eT) return { ok: false, error: "Não foi possível conferir as fichas liberadas." };
  if (!livres?.length) {
    return {
      ok: false,
      error: "Não há ficha social liberada e livre. Libere uma ficha (pelas metas) antes de aprovar.",
    };
  }
  const tokenId = livres[0].id;

  // Ficha primeiro: se ela não mudar, a indicação não é aprovada sem ficha.
  const { error: eU } = await db
    .from("social_tokens")
    .update({ status: "ASSIGNED" })
    .eq("id", tokenId)
    .eq("status", "AVAILABLE");
  if (eU) return { ok: false, error: "Não foi possível reservar a ficha." };
  const { error } = await db
    .from("social_referrals")
    .update({
      status: "APPROVED",
      token_id: tokenId,
      decided_at: new Date().toISOString(),
      decided_by: session.userId,
    })
    .eq("id", indicacaoId)
    .eq("status", "IN_REVIEW");
  if (error) {
    // Devolve a ficha: reservada para ninguém, ela sumiria da conta.
    await db.from("social_tokens").update({ status: "AVAILABLE" }).eq("id", tokenId);
    console.error("aprovarIndicacao failed:", error.message);
    return { ok: false, error: "Não foi possível aprovar." };
  }
  await logAudit({ action: "update", entityType: "empresarial_social_indicacao", entityId: indicacaoId });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function recusarIndicacao(
  companyId: string,
  indicacaoId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const motivo = String(formData.get("decision_note") ?? "").trim();
  if (!motivo) return { ok: false, error: "Diga o motivo da recusa — a empresa vai perguntar." };
  const db = await empresarialDb();
  const { error } = await db
    .from("social_referrals")
    .update({
      status: "REJECTED",
      decision_note: motivo,
      decided_at: new Date().toISOString(),
      decided_by: session.userId,
    })
    .eq("id", indicacaoId)
    .eq("company_id", companyId)
    .eq("status", "IN_REVIEW");
  if (error) {
    console.error("recusarIndicacao failed:", error.message);
    return { ok: false, error: "Não foi possível recusar." };
  }
  await logAudit({ action: "update", entityType: "empresarial_social_indicacao", entityId: indicacaoId });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/**
 * VINCULA a pessoa aprovada ao cadastro de cliente, pelo CPF. O cadastro é o
 * de sempre (recepção, com CPF e consentimento); aqui só se liga um ao outro —
 * e a ficha passa a apontar para o cliente.
 */
export async function vincularClienteDaIndicacao(
  companyId: string,
  indicacaoId: string,
  cpf: string
): Promise<ActionResult & { nome?: string }> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const achado = await lookupClientByCpf(cpf);
  if (!achado.found || !achado.clientId) {
    return {
      ok: false,
      error: "Nenhum cliente com este CPF. Peça à recepção que faça o cadastro e tente de novo.",
    };
  }
  const db = await empresarialDb();
  const { data: ind } = await db
    .from("social_referrals")
    .select("status, token_id")
    .eq("id", indicacaoId)
    .eq("company_id", companyId)
    .maybeSingle<{ status: string; token_id: string | null }>();
  if (!ind || ind.status !== "APPROVED") {
    return { ok: false, error: "Só a indicação aprovada é vinculada a um cliente." };
  }
  const { error } = await db
    .from("social_referrals")
    .update({ client_id: achado.clientId, cpf: formatCpf(cpf) })
    .eq("id", indicacaoId);
  if (error) return { ok: false, error: "Não foi possível vincular." };
  if (ind.token_id) {
    await db
      .from("social_tokens")
      .update({ beneficiary_client_id: achado.clientId })
      .eq("id", ind.token_id);
  }
  await logAudit({ action: "update", entityType: "empresarial_social_indicacao", entityId: indicacaoId });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true, nome: achado.fullName };
}
