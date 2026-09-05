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
} from "@/lib/empresarial/pricing";
import type { DependentPlan } from "@/lib/empresarial/constants";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";

export type ActionResult = { ok: boolean; error?: string };

export type BillingPreview = {
  ok: boolean;
  error?: string;
  /** Uma linha por boleto que será gerado (mais de uma no modelo por documento). */
  items?: {
    documentId: string | null;
    payerName: string;
    payerDoc: string;
    employees: number;
    totalCents: number;
  }[];
  dueDate?: string;
  referenceMonth?: string;
  description?: string;
  beneficiary?: string;
  billingModel?: string;
};

/**
 * Prévia do que será cobrado — o dono confirma antes de gerar (valor, vencimento,
 * pagador, beneficiário e a que se refere).
 */
export async function previewBilling(
  companyId: string,
  billingType: "IMPLANTATION" | "MONTHLY"
): Promise<BillingPreview> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { data: company } = await db
    .from("companies")
    .select("legal_name, trade_name, cnpj, due_day, billing_model")
    .eq("id", companyId)
    .maybeSingle<{
      legal_name: string;
      trade_name: string | null;
      cnpj: string;
      due_day: number;
      billing_model: string;
    }>();
  if (!company) return { ok: false, error: "Empresa não encontrada." };

  const { data: docs } = await db
    .from("company_documents")
    .select("id, doc_type, doc_formatted, nickname, is_primary")
    .eq("company_id", companyId)
    .returns<
      {
        id: string;
        doc_type: string;
        doc_formatted: string;
        nickname: string | null;
        is_primary: boolean;
      }[]
    >();
  const perDocument = company.billing_model === "por_cnpj" && (docs?.length ?? 0) > 1;

  const breakdown = await computeMonthlyBreakdown(db, companyId);
  const companyName = company.trade_name || company.legal_name;
  const primary = (docs ?? []).find((d) => d.is_primary);

  const { dueDate, referenceMonth } = nextDue(company.due_day);
  const monthLabel = new Date(referenceMonth + "T00:00:00").toLocaleDateString(
    "pt-BR",
    { timeZone: BRAZIL_TIME_ZONE, month: "long", year: "numeric" }
  );
  const description =
    billingType === "IMPLANTATION"
      ? `Adesão e implantação — Risarte Empresarial (${companyName})`
      : `Mensalidade do Risarte Empresarial — ${monthLabel}`;

  let items: NonNullable<BillingPreview["items"]>;
  if (perDocument) {
    items = (docs ?? []).map((d) => {
      const part = breakdown.byDocument.get(d.id) ?? { employees: 0, cents: 0 };
      return {
        documentId: d.id,
        payerName: d.nickname ? `${companyName} — ${d.nickname}` : companyName,
        payerDoc: `${d.doc_type} ${d.doc_formatted}`,
        employees: part.employees,
        totalCents: part.cents,
      };
    });
    // Colaboradores sem documento definido entram no principal.
    const orphan = breakdown.byDocument.get("__none__");
    if (orphan && orphan.cents > 0 && items.length > 0) {
      const target =
        items.find((i) => i.documentId === primary?.id) ?? items[0];
      target.employees += orphan.employees;
      target.totalCents += orphan.cents;
    }
    items = items.filter((i) => i.totalCents > 0);
  } else {
    items = [
      {
        documentId: null,
        payerName: companyName,
        payerDoc: primary
          ? `${primary.doc_type} ${primary.doc_formatted}`
          : company.cnpj,
        employees: breakdown.totalEmployees,
        totalCents: breakdown.totalCents,
      },
    ];
  }

  if (items.length === 0 || items.every((i) => i.totalCents <= 0)) {
    return {
      ok: false,
      error: "Sem colaboradores ativos para cobrar. Complete os cadastros antes.",
    };
  }

  return {
    ok: true,
    items,
    dueDate,
    referenceMonth,
    description,
    beneficiary: "Risarte / RisLife",
    billingModel: perDocument ? "por_cnpj" : "unico",
  };
}

/** Vencimento: próximo dia configurado que ainda não passou. */
function nextDue(dueDay: number): { dueDate: string; referenceMonth: string } {
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (due < now) due.setMonth(due.getMonth() + 1);
  const reference = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    dueDate: due.toISOString().slice(0, 10),
    referenceMonth: reference.toISOString().slice(0, 10),
  };
}

/** Mensalidade total e por documento (para o modelo "um boleto por CNPJ"). */
async function computeMonthlyBreakdown(
  db: Awaited<ReturnType<typeof empresarialDb>>,
  companyId: string
): Promise<{
  totalCents: number;
  totalEmployees: number;
  byDocument: Map<string, { employees: number; cents: number }>;
}> {
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
        .select("id, dependent_plan, status, company_document_id")
        .eq("company_id", companyId)
        .eq("status", "ACTIVE")
        .returns<
          {
            id: string;
            dependent_plan: DependentPlan;
            status: "ACTIVE";
            company_document_id: string | null;
          }[]
        >(),
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

  const byDocument = new Map<string, { employees: number; cents: number }>();
  let totalCents = 0;
  for (const e of emps ?? []) {
    const one = computeMonthlyCents(pricing, [
      {
        status: "ACTIVE",
        dependentPlan: e.dependent_plan,
        activeDependentCount: depCount.get(e.id) ?? 0,
      },
    ]).totalCents;
    totalCents += one;
    const key = e.company_document_id ?? "__none__";
    const cur = byDocument.get(key) ?? { employees: 0, cents: 0 };
    cur.employees++;
    cur.cents += one;
    byDocument.set(key, cur);
  }

  return { totalCents, totalEmployees: (emps ?? []).length, byDocument };
}

/** Gera a cobrança (implantação ou mensal). Cria o registro local (PENDING). */
export async function generateBilling(
  companyId: string,
  billingType: "IMPLANTATION" | "MONTHLY"
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  // A prévia é a mesma que o usuário confirmou na tela (um ou vários boletos).
  const preview = await previewBilling(companyId, billingType);
  if (!preview.ok || !preview.items) {
    return { ok: false, error: preview.error ?? "Não foi possível gerar." };
  }

  const db = await empresarialDb();
  const rows = preview.items.map((i) => ({
    company_id: companyId,
    company_document_id: i.documentId,
    billing_type: billingType,
    reference_month: preview.referenceMonth,
    total_amount_cents: i.totalCents,
    status: "PENDING",
    due_date: preview.dueDate,
    description: preview.description,
  }));

  const { error } = await db.from("adhesion_billing").insert(rows);
  if (error) {
    console.error("generateBilling failed:", error.message);
    return { ok: false, error: "Não foi possível gerar a cobrança." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_billing",
    entityId: companyId,
    details: { type: billingType, count: rows.length },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Edita uma cobrança ainda não paga (valor, vencimento e descrição). */
export async function updateBilling(
  companyId: string,
  billingId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { data: current } = await db
    .from("adhesion_billing")
    .select("status")
    .eq("id", billingId)
    .maybeSingle<{ status: string }>();
  if (!current) return { ok: false, error: "Cobrança não encontrada." };
  if (current.status === "PAID") {
    return { ok: false, error: "Cobrança já paga não pode ser editada." };
  }

  const rawValue = String(formData.get("total") ?? "").trim();
  const cents = Math.round(
    Number.parseFloat(
      rawValue.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
    ) * 100
  );
  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, error: "Informe um valor válido." };
  }
  const dueDate = String(formData.get("due_date") ?? "").trim();
  if (!dueDate) return { ok: false, error: "Informe o vencimento." };

  const { error } = await db
    .from("adhesion_billing")
    .update({
      total_amount_cents: cents,
      due_date: dueDate,
      description: String(formData.get("description") ?? "").trim() || null,
    })
    .eq("id", billingId);
  if (error) {
    console.error("updateBilling failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a cobrança." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_billing",
    entityId: billingId,
    details: { total: cents, due_date: dueDate },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Cancela a cobrança — o motivo é obrigatório (validado também no banco). */
export async function cancelBilling(
  companyId: string,
  billingId: string,
  reason: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  if (!reason.trim()) {
    return { ok: false, error: "Informe o motivo do cancelamento." };
  }

  const db = await empresarialDb();
  const { error } = await db.rpc("cancel_billing", {
    p_billing_id: billingId,
    p_reason: reason.trim(),
  });
  if (error) {
    console.error("cancelBilling failed:", error.message);
    return {
      ok: false,
      error: error.hint ?? "Não foi possível cancelar a cobrança.",
    };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_billing",
    entityId: billingId,
    details: { cancelled: true },
  });
  // A empresa pode sair da suspensão ao acabar o atraso — a lista mostra isso.
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
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
  // Pagar pode tirar a empresa da suspensão por inadimplência.
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}

/**
 * Exclui a cobrança de vez (Admin Master). Diferente de cancelar, que fica no
 * histórico: aqui a linha é apagada — serve para limpar cobranças de TESTE
 * antes de a empresa receber um relatório. O banco registra em audit_logs antes
 * de apagar e reavalia a suspensão da empresa.
 */
export async function deleteBilling(
  companyId: string,
  billingId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) {
    return { ok: false, error: "Só o Admin Master pode excluir uma cobrança." };
  }
  const db = await empresarialDb();
  const { error } = await db.rpc("delete_billing", {
    p_billing_id: billingId,
  });
  if (error) {
    console.error("deleteBilling failed:", error.message);
    return {
      ok: false,
      error: error.hint ?? "Não foi possível excluir a cobrança.",
    };
  }
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
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
