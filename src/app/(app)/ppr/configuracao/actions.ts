"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";

export type PprResult = { ok: boolean; error?: string };

/** Lê "1.234,56" ou "1234.56" e devolve centavos; vazio = 0. */
function cents(form: FormData, key: string): number {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return 0;
  return parseBRLToCents(raw) ?? 0;
}
function int(form: FormData, key: string, fallback = 0): number {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}
function intOrNull(form: FormData, key: string): number | null {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
function num(form: FormData, key: string, fallback = 0): number {
  const raw = String(form.get(key) ?? "").trim().replace(",", ".");
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}
function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function refresh(planId?: string) {
  revalidatePath("/ppr");
  revalidatePath("/ppr/configuracao");
  if (planId) revalidatePath(`/ppr/configuracao/${planId}`);
}

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

/** Cria um plano novo (o dono pode ter quantos planos quiser). */
export async function createPprPlan(form: FormData): Promise<PprResult> {
  await requireAdminMaster();
  const name = text(form, "name");
  if (!name) return { ok: false, error: "Informe o nome do plano." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ppr_plans")
    .insert({
      name,
      description: text(form, "description") || null,
      monthly_cents: cents(form, "monthly"),
      is_active: true,
      sort_order: int(form, "sortOrder", 99),
    })
    .select("id")
    .single();
  if (error) {
    console.error("createPprPlan failed:", error.message);
    return { ok: false, error: "Não foi possível criar o plano." };
  }
  await logAudit({
    action: "create",
    entityType: "ppr_plan",
    entityId: data.id as string,
  });
  refresh();
  return { ok: true };
}

/** Salva os dados e as regras comerciais de um plano. */
export async function savePprPlan(form: FormData): Promise<PprResult> {
  await requireAdminMaster();
  const id = text(form, "id");
  if (!id) return { ok: false, error: "Plano não identificado." };

  const allowsDependents = form.get("allowsDependents") === "on";
  const allowsExtra = form.get("allowsExtraDependents") === "on";
  const methods = form.getAll("allowedMethods").map(String);
  const recurring = form.getAll("recurringMethods").map(String);

  const supabase = await createClient();
  const { error } = await supabase
    .from("ppr_plans")
    .update({
      name: text(form, "name"),
      description: text(form, "description") || null,
      monthly_cents: cents(form, "monthly"),
      allows_dependents: allowsDependents,
      included_dependents: allowsDependents ? int(form, "includedDependents") : 0,
      allows_extra_dependents: allowsDependents && allowsExtra,
      extra_dependent_cents:
        allowsDependents && allowsExtra ? cents(form, "extraDependent") : 0,
      max_dependents: allowsDependents ? intOrNull(form, "maxDependents") : 0,
      cash_discount_percent: num(form, "cashDiscount"),
      max_installments: Math.max(1, int(form, "maxInstallments", 1)),
      min_installment_cents: cents(form, "minInstallment"),
      allowed_methods: methods.length > 0 ? methods : null,
      recurring_methods: recurring.length > 0 ? recurring : [],
      grace_period_days: int(form, "gracePeriodDays"),
      social_enabled: form.get("socialEnabled") === "on",
      social_points_per_cents: Math.max(1, cents(form, "socialPer") || 5000),
      is_active: form.get("isActive") === "on",
      sort_order: int(form, "sortOrder"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("savePprPlan failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o plano." };
  }
  await logAudit({ action: "update", entityType: "ppr_plan", entityId: id });
  refresh(id);
  return { ok: true };
}

/** Ativa/desativa o plano (plano usado por uma adesão nunca é apagado). */
export async function togglePprPlan(
  planId: string,
  active: boolean
): Promise<PprResult> {
  await requireAdminMaster();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ppr_plans")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", planId);
  if (error) return { ok: false, error: "Não foi possível alterar o plano." };
  await logAudit({ action: "update", entityType: "ppr_plan", entityId: planId });
  refresh(planId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Vantagens (texto que aparece na venda e no contrato)
// ---------------------------------------------------------------------------

export async function addPprPerk(form: FormData): Promise<PprResult> {
  await requireAdminMaster();
  const planId = text(form, "planId");
  const label = text(form, "label");
  if (!planId || !label) return { ok: false, error: "Escreva a vantagem." };

  const supabase = await createClient();
  const { error } = await supabase.from("ppr_plan_perks").insert({
    plan_id: planId,
    label,
    sort_order: int(form, "sortOrder", 99),
  });
  if (error) return { ok: false, error: "Não foi possível adicionar." };
  refresh(planId);
  return { ok: true };
}

export async function removePprPerk(
  perkId: string,
  planId: string
): Promise<PprResult> {
  await requireAdminMaster();
  const supabase = await createClient();
  const { error } = await supabase.from("ppr_plan_perks").delete().eq("id", perkId);
  if (error) return { ok: false, error: "Não foi possível remover." };
  refresh(planId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Faixas de desconto por parcelamento (decisão 3)
// ---------------------------------------------------------------------------

export async function savePprTier(form: FormData): Promise<PprResult> {
  await requireAdminMaster();
  const planId = text(form, "planId");
  const upTo = int(form, "upTo");
  if (!planId || upTo < 1)
    return { ok: false, error: "Informe até quantas parcelas." };

  const supabase = await createClient();
  const { error } = await supabase.from("ppr_plan_installment_tiers").upsert(
    {
      plan_id: planId,
      up_to_installments: upTo,
      discount_percent: num(form, "discount"),
    },
    { onConflict: "plan_id,up_to_installments" }
  );
  if (error) {
    console.error("savePprTier failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a faixa." };
  }
  refresh(planId);
  return { ok: true };
}

export async function removePprTier(
  tierId: string,
  planId: string
): Promise<PprResult> {
  await requireAdminMaster();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ppr_plan_installment_tiers")
    .delete()
    .eq("id", tierId);
  if (error) return { ok: false, error: "Não foi possível remover a faixa." };
  refresh(planId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Benefícios por procedimento (cobertura, carência, frequência)
// ---------------------------------------------------------------------------

export async function savePprBenefit(form: FormData): Promise<PprResult> {
  await requireAdminMaster();
  const planId = text(form, "planId");
  const procedureId = text(form, "procedureId");
  const specialty = text(form, "specialty");
  if (!planId) return { ok: false, error: "Plano não identificado." };
  if (!procedureId && !specialty)
    return { ok: false, error: "Escolha um procedimento ou uma especialidade." };

  const benefitType = text(form, "benefitType") || "percent";
  const payload = {
    plan_id: planId,
    procedure_id: procedureId || null,
    specialty: procedureId ? null : specialty || null,
    benefit_type: benefitType,
    benefit_value: benefitType === "percent" ? num(form, "benefitValue") : null,
    grace_period_days: int(form, "grace"),
    frequency_months: intOrNull(form, "frequency"),
    usage_limit_count: intOrNull(form, "limitCount"),
    usage_period_months: intOrNull(form, "limitPeriod"),
    gift_label: text(form, "gift") || null,
  };

  const supabase = await createClient();
  const id = text(form, "id");
  const { error } = id
    ? await supabase.from("ppr_plan_benefits").update(payload).eq("id", id)
    : await supabase.from("ppr_plan_benefits").insert(payload);
  if (error) {
    console.error("savePprBenefit failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o benefício." };
  }
  await logAudit({ action: "update", entityType: "ppr_plan_benefit", entityId: planId });
  refresh(planId);
  return { ok: true };
}

export async function removePprBenefit(
  benefitId: string,
  planId: string
): Promise<PprResult> {
  await requireAdminMaster();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ppr_plan_benefits")
    .delete()
    .eq("id", benefitId);
  if (error) return { ok: false, error: "Não foi possível remover o benefício." };
  refresh(planId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Inadimplência (cascata rede/unidade — decisão 6)
// ---------------------------------------------------------------------------

export async function savePprSettings(form: FormData): Promise<PprResult> {
  await requireAdminMaster();
  const clinicId = text(form, "clinicId") || null;
  const suspend = int(form, "suspendAfterDays", 30);
  const cancel = int(form, "cancelAfterDays", 90);
  if (cancel > 0 && suspend > 0 && cancel < suspend)
    return {
      ok: false,
      error: "O prazo de cancelamento não pode ser menor que o de suspensão.",
    };

  const supabase = await createClient();
  // Sem unique constraint simples (o índice usa coalesce), então é buscar+gravar.
  const existing = clinicId
    ? await supabase
        .from("ppr_settings")
        .select("id")
        .eq("clinic_id", clinicId)
        .maybeSingle()
    : await supabase
        .from("ppr_settings")
        .select("id")
        .is("clinic_id", null)
        .maybeSingle();

  const payload = {
    clinic_id: clinicId,
    suspend_after_days: suspend,
    cancel_after_days: cancel,
    updated_at: new Date().toISOString(),
  };
  const { error } = existing.data?.id
    ? await supabase.from("ppr_settings").update(payload).eq("id", existing.data.id)
    : await supabase.from("ppr_settings").insert(payload);
  if (error) {
    console.error("savePprSettings failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a configuração." };
  }
  await logAudit({
    action: "update",
    entityType: "ppr_settings",
    entityId: clinicId ?? "rede",
    clinicId: clinicId ?? undefined,
  });
  refresh();
  return { ok: true };
}

export async function removePprSettings(id: string): Promise<PprResult> {
  await requireAdminMaster();
  const supabase = await createClient();
  const { error } = await supabase.from("ppr_settings").delete().eq("id", id);
  if (error) return { ok: false, error: "Não foi possível remover o ajuste." };
  refresh();
  return { ok: true };
}
