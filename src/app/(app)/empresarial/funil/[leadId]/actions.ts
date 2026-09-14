"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager, isRislifeConsultant } from "@/lib/empresarial/access";
import { PAYMENT_MODELS } from "@/lib/empresarial/constants";
import { BILLING_BASES, INTEREST_LEVELS } from "@/lib/empresarial/proposta";
import { COMPANY_CATEGORIES } from "@/lib/empresarial/documents";
import { formatPhone } from "@/lib/masks";

export type ActionResult = { ok: boolean; error?: string };

function canUseFunnel(session: SessionContext): boolean {
  return isProgramManager(session) || isRislifeConsultant(session);
}

function texto(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

/**
 * Número inteiro, ou nulo.
 *
 * ⚠️ Campo em branco vira NULO, nunca zero. "Não perguntei quantos
 * colaboradores" e "a empresa tem zero colaboradores" são coisas diferentes, e
 * confundi-las faria o painel contar como respondida toda ficha em branco.
 */
function inteiro(formData: FormData, key: string): number | null {
  const v = texto(formData, key);
  if (v == null) return null;
  const n = Number.parseInt(v.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** "1.234,56" → 123456 centavos. Em branco continua nulo. */
function centavos(formData: FormData, key: string): number | null {
  const v = texto(formData, key);
  if (v == null) return null;
  const n = Number.parseFloat(
    v.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Caixa de marcar de TRÊS estados: sim, não, e "não perguntei". */
function triBooleano(formData: FormData, key: string): boolean | null {
  const v = texto(formData, key);
  if (v === "SIM") return true;
  if (v === "NAO") return false;
  return null;
}

function daLista<T extends string>(
  formData: FormData,
  key: string,
  lista: readonly T[]
): T | null {
  const v = texto(formData, key);
  return v && (lista as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * Salva o levantamento e os dados comerciais do lead.
 *
 * Uma linha por lead: é retrato do estado atual da conversa, não histórico — o
 * que muda ao longo do tempo já está na linha do tempo e nas tentativas de
 * contato. Por isso o update-depois-insert, e não duas linhas.
 */
export async function saveQualification(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const chance = inteiro(formData, "success_chance");
  if (chance != null && (chance < 0 || chance > 100)) {
    return { ok: false, error: "A chance de sucesso vai de 0 a 100." };
  }

  const dados = {
    lead_id: leadId,
    has_dental_plan: triBooleano(formData, "has_dental_plan"),
    dental_plan_name: texto(formData, "dental_plan_name"),
    dental_plan_monthly_cents: centavos(formData, "dental_plan_monthly"),
    other_benefits: texto(formData, "other_benefits"),
    social_projects: triBooleano(formData, "social_projects"),
    social_projects_note: texto(formData, "social_projects_note"),
    interest_level: daLista(formData, "interest_level", INTEREST_LEVELS),
    success_chance: chance,

    payment_model: daLista(formData, "payment_model", PAYMENT_MODELS),
    subsidy_type: daLista(formData, "subsidy_type", ["PERCENT", "AMOUNT"] as const),
    subsidy_value:
      texto(formData, "subsidy_type") === "PERCENT"
        ? inteiro(formData, "subsidy_percent")
        : centavos(formData, "subsidy_amount"),
    employee_count: inteiro(formData, "employee_count"),
    includes_dependents: triBooleano(formData, "includes_dependents"),
    dependents_estimate: inteiro(formData, "dependents_estimate"),
    billing_model: daLista(formData, "billing_model", ["unico", "por_cnpj"] as const),
    billing_basis: daLista(formData, "billing_basis", BILLING_BASES),
    holder_fee_cents: centavos(formData, "holder_fee"),
    dependent_fee_cents: centavos(formData, "dependent_fee"),
    fixed_monthly_cents: centavos(formData, "fixed_monthly"),
    implantation_per_employee_cents: centavos(formData, "implantation_per_employee"),

    legal_name: texto(formData, "legal_name"),
    category: daLista(formData, "category", COMPANY_CATEGORIES),
    responsible_name: texto(formData, "responsible_name"),
    responsible_role: texto(formData, "responsible_role"),
    responsible_cpf: texto(formData, "responsible_cpf"),
    responsible_email: texto(formData, "responsible_email"),
    responsible_phone: texto(formData, "responsible_phone")
      ? formatPhone(texto(formData, "responsible_phone")!)
      : null,
    notes: texto(formData, "notes"),
    updated_by: session.userId,
  };

  const db = await empresarialDb();
  // Atualiza-depois-insere em vez de `on conflict`: o índice único é sobre
  // lead_id, e o caminho explícito deixa claro qual dos dois aconteceu.
  const { data: existente } = await db
    .from("lead_qualification")
    .select("id")
    .eq("lead_id", leadId)
    .maybeSingle();

  const { error } = existente
    ? await db.from("lead_qualification").update(dados).eq("id", existente.id)
    : await db.from("lead_qualification").insert(dados);

  if (error) {
    console.error("saveQualification failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o levantamento." };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_lead_qualification",
    entityId: leadId,
  });
  revalidatePath(`/empresarial/funil/${leadId}`);
  revalidatePath("/empresarial/funil");
  return { ok: true };
}
