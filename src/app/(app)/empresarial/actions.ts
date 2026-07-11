"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import {
  COMPANY_STATUSES,
  PAYMENT_MODELS,
  PAYMENT_METHODS,
  type CompanyStatus,
} from "@/lib/empresarial/constants";
import type { CompanyAddress } from "@/lib/empresarial/types";

export type ActionResult = { ok: boolean; error?: string };
export type CreateCompanyResult = ActionResult & { companyId?: string };

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

function digitsOnly(value: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

function intOrNull(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** "1.234,56" ou "1234.56" → centavos inteiros. */
function reaisToCents(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function parseCompanyForm(
  formData: FormData
): { error: string } | { values: Record<string, unknown> } {
  const cnpj = digitsOnly(field(formData, "cnpj"));
  if (cnpj.length !== 14) {
    return { error: "Informe o CNPJ completo (14 dígitos)." };
  }
  const legalName = field(formData, "legal_name");
  if (!legalName) return { error: "Informe a razão social." };

  const paymentModel = field(formData, "payment_model") ?? "";
  if (!(PAYMENT_MODELS as readonly string[]).includes(paymentModel)) {
    return { error: "Selecione o modelo de pagamento." };
  }

  const status = field(formData, "status") ?? "ACTIVE";
  if (!(COMPANY_STATUSES as readonly string[]).includes(status)) {
    return { error: "Situação inválida." };
  }

  // Subsídio da empresa só quando o modelo é "parcial".
  let subsidyType: string | null = null;
  let subsidyValue: number | null = null;
  if (paymentModel === "COMPANY_PARTIAL") {
    subsidyType = field(formData, "company_subsidy_type");
    if (subsidyType !== "PERCENT" && subsidyType !== "AMOUNT") {
      return { error: "Escolha como a empresa subsidia (percentual ou valor)." };
    }
    const raw = field(formData, "company_subsidy_value");
    subsidyValue =
      subsidyType === "PERCENT" ? intOrNull(raw) : reaisToCents(raw);
    if (subsidyValue == null || subsidyValue <= 0) {
      return { error: "Informe o valor do subsídio da empresa." };
    }
    if (subsidyType === "PERCENT" && subsidyValue > 100) {
      return { error: "O percentual de subsídio não pode passar de 100%." };
    }
  }

  const methods = PAYMENT_METHODS.filter((m) =>
    formData.getAll("payment_methods").map(String).includes(m)
  );

  const dueDay = intOrNull(field(formData, "due_day")) ?? 5;
  if (dueDay < 1 || dueDay > 28) {
    return { error: "O dia de vencimento deve ficar entre 1 e 28." };
  }

  const address: CompanyAddress = {
    zipCode: field(formData, "zip_code") ?? undefined,
    street: field(formData, "street") ?? undefined,
    number: field(formData, "number") ?? undefined,
    complement: field(formData, "complement") ?? undefined,
    neighborhood: field(formData, "neighborhood") ?? undefined,
    city: field(formData, "city") ?? undefined,
    state: (field(formData, "state") ?? undefined)?.toUpperCase(),
  };
  const hasAddress = Object.values(address).some(Boolean);

  return {
    values: {
      cnpj,
      legal_name: legalName,
      trade_name: field(formData, "trade_name"),
      state_registration: field(formData, "state_registration"),
      address: hasAddress ? address : null,
      employee_count: intOrNull(field(formData, "employee_count")),
      status,
      payment_model: paymentModel,
      company_subsidy_type: subsidyType,
      company_subsidy_value: subsidyValue,
      due_day: dueDay,
      assigned_consultant_id: field(formData, "assigned_consultant_id"),
      payment_methods: methods.length > 0 ? methods : ["BOLETO"],
      default_max_installments:
        intOrNull(field(formData, "default_max_installments")) ?? 24,
      contract_started_at: field(formData, "contract_started_at"),
      grace_period_days: intOrNull(field(formData, "grace_period_days")) ?? 0,
      employee_grace_period_days:
        intOrNull(field(formData, "employee_grace_period_days")) ?? 0,
      notes: field(formData, "notes"),
    },
  };
}

export async function createCompany(
  formData: FormData
): Promise<CreateCompanyResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) {
    return { ok: false, error: "Você não tem permissão para cadastrar empresas." };
  }
  const parsed = parseCompanyForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = await empresarialDb();
  const { data, error } = await db
    .from("companies")
    .insert(parsed.values)
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Já existe uma empresa com este CNPJ." };
    }
    console.error("createCompany failed:", error.message);
    return { ok: false, error: "Não foi possível cadastrar a empresa." };
  }

  await logAudit({
    action: "create",
    entityType: "empresarial_company",
    entityId: data.id,
  });
  revalidatePath("/empresarial");
  return { ok: true, companyId: data.id };
}

export async function updateCompany(
  companyId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) {
    return { ok: false, error: "Você não tem permissão para editar empresas." };
  }
  const parsed = parseCompanyForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = await empresarialDb();
  const { error } = await db
    .from("companies")
    .update(parsed.values)
    .eq("id", companyId);
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Já existe uma empresa com este CNPJ." };
    }
    console.error("updateCompany failed:", error.message);
    return { ok: false, error: "Não foi possível salvar as alterações." };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_company",
    entityId: companyId,
  });
  revalidatePath("/empresarial");
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function setCompanyStatus(
  companyId: string,
  status: CompanyStatus
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) {
    return { ok: false, error: "Você não tem permissão para isto." };
  }
  if (!(COMPANY_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Situação inválida." };
  }
  const db = await empresarialDb();
  const { error } = await db
    .from("companies")
    .update({ status })
    .eq("id", companyId);
  if (error) {
    console.error("setCompanyStatus failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar a situação." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_company",
    entityId: companyId,
    details: { status },
  });
  revalidatePath("/empresarial");
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}
