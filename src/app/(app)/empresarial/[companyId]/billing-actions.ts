"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import {
  computeMonthlyCents,
  DEFAULT_ADHESION_PRICING,
  type AdhesionPricing,
  type MonthlyEmployee,
} from "@/lib/empresarial/pricing";
import type { DependentPlan } from "@/lib/empresarial/constants";

export type ActionResult = { ok: boolean; error?: string };

async function computeCompanyMonthly(
  db: Awaited<ReturnType<typeof empresarialDb>>,
  companyId: string
): Promise<number> {
  const [{ data: pricingRows }, { data: emps }, { data: deps }] =
    await Promise.all([
      db
        .from("adhesion_pricing")
        .select(
          "company_id, holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents, max_installments"
        )
        .or(`company_id.eq.${companyId},company_id.is.null`),
      db
        .from("employees")
        .select("id, dependent_plan, status")
        .eq("company_id", companyId)
        .eq("status", "ACTIVE")
        .returns<{ id: string; dependent_plan: DependentPlan; status: "ACTIVE" }[]>(),
      db.from("dependents").select("employee_id, status").eq("status", "ACTIVE"),
    ]);

  const rows = (pricingRows ?? []) as {
    company_id: string | null;
    holder_fee_cents: number;
    dependent_individual_fee_cents: number;
    dependent_family_fee_cents: number;
    dependent_family_extra_fee_cents: number;
    max_installments: number;
  }[];
  const chosen =
    rows.find((r) => r.company_id === companyId) ??
    rows.find((r) => r.company_id === null);
  const pricing: AdhesionPricing = chosen
    ? {
        holderFeeCents: chosen.holder_fee_cents,
        dependentIndividualFeeCents: chosen.dependent_individual_fee_cents,
        dependentFamilyFeeCents: chosen.dependent_family_fee_cents,
        dependentFamilyExtraFeeCents: chosen.dependent_family_extra_fee_cents,
        maxInstallments: chosen.max_installments,
      }
    : DEFAULT_ADHESION_PRICING;

  const depCount = new Map<string, number>();
  for (const d of (deps ?? []) as { employee_id: string }[])
    depCount.set(d.employee_id, (depCount.get(d.employee_id) ?? 0) + 1);

  const list: MonthlyEmployee[] = (emps ?? []).map((e) => ({
    status: "ACTIVE",
    dependentPlan: e.dependent_plan,
    activeDependentCount: depCount.get(e.id) ?? 0,
  }));
  return computeMonthlyCents(pricing, list).totalCents;
}

/** Gera a cobrança (implantação ou mensal). Cria o registro local (PENDING). */
export async function generateBilling(
  companyId: string,
  billingType: "IMPLANTATION" | "MONTHLY"
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { data: company } = await db
    .from("companies")
    .select("due_day")
    .eq("id", companyId)
    .maybeSingle();
  const total = await computeCompanyMonthly(db, companyId);
  if (total <= 0) {
    return {
      ok: false,
      error: "Sem colaboradores ativos para cobrar. Complete cadastros antes.",
    };
  }

  const now = new Date();
  const dueDay = company?.due_day ?? 5;
  const due = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (due < now) due.setMonth(due.getMonth() + 1);
  const referenceMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const { error } = await db.from("adhesion_billing").insert({
    company_id: companyId,
    billing_type: billingType,
    reference_month: referenceMonth.toISOString().slice(0, 10),
    total_amount_cents: total,
    status: "PENDING",
    due_date: due.toISOString().slice(0, 10),
  });
  if (error) {
    console.error("generateBilling failed:", error.message);
    return { ok: false, error: "Não foi possível gerar a cobrança." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_billing",
    entityId: companyId,
    details: { type: billingType, total },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/**
 * Baixa manual (simula o webhook do ASAAS) — liquida a cobrança e grava o split.
 * Quando o ASAAS estiver ligado, a Edge Function chama a mesma RPC settle_billing.
 */
export async function markBillingPaid(
  companyId: string,
  billingId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db.rpc("settle_billing", {
    p_billing_id: billingId,
    p_paid_at: new Date().toISOString(),
  });
  if (error) {
    console.error("markBillingPaid failed:", error.message);
    return { ok: false, error: "Não foi possível registrar o pagamento." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_billing",
    entityId: billingId,
    details: { paid: true },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Roda a checagem de inadimplência (suspende empresas com atraso > 5 dias). */
export async function runOverdueCheck(companyId: string): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db.rpc("mark_overdue_and_suspend", {});
  if (error) {
    console.error("runOverdueCheck failed:", error.message);
    return { ok: false, error: "Não foi possível checar a inadimplência." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}
