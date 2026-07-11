"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, requireAdminMaster } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { BENEFIT_TYPES } from "@/lib/empresarial/constants";

export type ActionResult = { ok: boolean; error?: string };

/** Config da REDE (company_id null) = Admin/Franqueadora; da EMPRESA = gestor do programa. */
function canEditConfig(session: SessionContext, companyId: string | null): boolean {
  if (companyId === null) {
    return (
      session.isAdminMaster ||
      Object.values(session.rolesByClinic).flat().includes("franchisor_staff")
    );
  }
  return isProgramManager(session);
}

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

function reaisToCents(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseFloat(
    value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function num(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Upsert em cascata: cria/atualiza a linha da rede (null) ou da empresa. */
async function upsertCascadeRow(
  db: Db,
  table: string,
  companyId: string | null,
  values: Record<string, unknown>,
  matchExtra?: Record<string, unknown>
): Promise<{ error: string | null }> {
  let sel = db.from(table).select("id");
  sel = companyId === null ? sel.is("company_id", null) : sel.eq("company_id", companyId);
  for (const [k, v] of Object.entries(matchExtra ?? {})) sel = sel.eq(k, v);
  const { data: existing } = await sel.maybeSingle();

  if (existing?.id) {
    const { error } = await db.from(table).update(values).eq("id", existing.id);
    return { error: error?.message ?? null };
  }
  const { error } = await db
    .from(table)
    .insert({ company_id: companyId, ...matchExtra, ...values });
  return { error: error?.message ?? null };
}

export async function saveAdhesionPricing(
  companyId: string | null,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canEditConfig(session, companyId)) {
    return { ok: false, error: "Sem permissão." };
  }
  const values = {
    holder_fee_cents: reaisToCents(field(formData, "holder_fee")) ?? 0,
    dependent_individual_fee_cents:
      reaisToCents(field(formData, "dependent_individual_fee")) ?? 0,
    dependent_family_fee_cents:
      reaisToCents(field(formData, "dependent_family_fee")) ?? 0,
    dependent_family_extra_fee_cents:
      reaisToCents(field(formData, "dependent_family_extra_fee")) ?? 0,
    max_installments: intOrNull(field(formData, "max_installments")) ?? 24,
  };
  const db = await empresarialDb();
  const { error } = await upsertCascadeRow(db, "adhesion_pricing", companyId, values);
  if (error) {
    console.error("saveAdhesionPricing failed:", error);
    return { ok: false, error: "Não foi possível salvar os preços." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_adhesion_pricing",
    entityId: companyId ?? "network",
  });
  revalidatePath("/empresarial/configuracoes");
  if (companyId) revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function saveSplitRules(
  companyId: string | null,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canEditConfig(session, companyId)) {
    return { ok: false, error: "Sem permissão." };
  }
  const fr = num(field(formData, "first_payment_risarte_pct")) ?? 0;
  const rr = num(field(formData, "recurring_risarte_pct")) ?? 0;
  if (fr < 0 || fr > 100 || rr < 0 || rr > 100) {
    return { ok: false, error: "Os percentuais devem ficar entre 0 e 100." };
  }
  const values = {
    first_payment_risarte_pct: fr,
    first_payment_rislife_pct: 100 - fr,
    recurring_risarte_pct: rr,
    recurring_rislife_pct: 100 - rr,
  };
  const db = await empresarialDb();
  const { error } = await upsertCascadeRow(db, "split_rules", companyId, values);
  if (error) {
    console.error("saveSplitRules failed:", error);
    return { ok: false, error: "Não foi possível salvar o split." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_split_rules",
    entityId: companyId ?? "network",
  });
  revalidatePath("/empresarial/configuracoes");
  if (companyId) revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function upsertProcedureBenefit(
  companyId: string | null,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canEditConfig(session, companyId)) {
    return { ok: false, error: "Sem permissão." };
  }
  const procedureId = field(formData, "procedure_id");
  if (!procedureId) return { ok: false, error: "Escolha o procedimento." };
  const benefitType = field(formData, "benefit_type") ?? "";
  if (!(BENEFIT_TYPES as readonly string[]).includes(benefitType)) {
    return { ok: false, error: "Tipo de benefício inválido." };
  }

  let benefitValue: number | null = null;
  if (benefitType === "DISCOUNT_PERCENT") {
    benefitValue = num(field(formData, "benefit_value"));
    if (benefitValue == null || benefitValue < 0 || benefitValue > 100) {
      return { ok: false, error: "Informe um percentual entre 0 e 100." };
    }
  } else if (benefitType === "DISCOUNT_AMOUNT") {
    benefitValue = reaisToCents(field(formData, "benefit_value"));
    if (benefitValue == null || benefitValue <= 0) {
      return { ok: false, error: "Informe o valor do desconto." };
    }
  }

  const values = {
    benefit_type: benefitType,
    benefit_value: benefitValue,
    usage_limit_count: intOrNull(field(formData, "usage_limit_count")),
    usage_period_months: intOrNull(field(formData, "usage_period_months")),
    grace_period_months: intOrNull(field(formData, "grace_period_months")) ?? 0,
    max_installments: intOrNull(field(formData, "max_installments")),
  };

  const db = await empresarialDb();
  const { error } = await upsertCascadeRow(db, "procedure_benefits", companyId, values, {
    procedure_id: procedureId,
  });
  if (error) {
    console.error("upsertProcedureBenefit failed:", error);
    return { ok: false, error: "Não foi possível salvar o benefício." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_procedure_benefit",
    entityId: companyId ?? "network",
    details: { procedure_id: procedureId },
  });
  revalidatePath("/empresarial/configuracoes");
  if (companyId) revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** LGPD: roda a rotina de retenção (anonimiza dados de quem saiu há +5 anos). */
export async function runRetention(): Promise<ActionResult & { count?: number }> {
  await requireAdminMaster();
  const db = await empresarialDb();
  const { data, error } = await db.rpc("run_retention", {});
  if (error) {
    console.error("runRetention failed:", error.message);
    return { ok: false, error: "Não foi possível rodar a retenção." };
  }
  await logAudit({
    action: "anonymize",
    entityType: "empresarial_retention",
    details: { count: data ?? 0 },
  });
  return { ok: true, count: (data as number) ?? 0 };
}

export async function removeOverride(
  table: "adhesion_pricing" | "split_rules",
  companyId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { error } = await db.from(table).delete().eq("company_id", companyId);
  if (error) {
    console.error("removeOverride failed:", error);
    return { ok: false, error: "Não foi possível voltar ao padrão da rede." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function deleteProcedureBenefit(
  benefitId: string,
  companyId: string | null
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canEditConfig(session, companyId)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { error } = await db.from("procedure_benefits").delete().eq("id", benefitId);
  if (error) {
    console.error("deleteProcedureBenefit failed:", error);
    return { ok: false, error: "Não foi possível remover." };
  }
  revalidatePath("/empresarial/configuracoes");
  if (companyId) revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}
