import "server-only";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  computeMonthlyCents,
  DEFAULT_ADHESION_PRICING,
  type AdhesionPricing,
  type SplitRules,
} from "@/lib/empresarial/pricing";
import { DEFAULT_SPLIT_RULES } from "@/lib/empresarial/pricing";
import type {
  BillingStatus,
  BillingType,
  CompanyStatus,
  DependentPlan,
  PaymentMethod,
  PaymentModel,
} from "@/lib/empresarial/constants";
import type {
  BillingModel,
  CompanyCategory,
  DocType,
} from "@/lib/empresarial/documents";
import type { BenefitType } from "@/lib/empresarial/constants";
import type { CompanyAddress } from "@/lib/empresarial/types";

export type CompanySheet = {
  company: {
    id: string;
    cnpj: string;
    legalName: string;
    tradeName: string | null;
    stateRegistration: string | null;
    category: CompanyCategory;
    address: CompanyAddress | null;
    employeeCount: number | null;
    status: CompanyStatus;
    notes: string | null;
    createdAt: string;
    // Responsável pela empresa
    responsibleName: string | null;
    responsibleRole: string | null;
    responsibleCpf: string | null;
    responsibleEmail: string | null;
    responsiblePhone: string | null;
    // Programa e pagamento
    paymentModel: PaymentModel;
    subsidyType: "PERCENT" | "AMOUNT" | null;
    subsidyValue: number | null;
    billingModel: BillingModel;
    dueDay: number;
    defaultMaxInstallments: number;
    paymentMethods: PaymentMethod[];
    contractStartedAt: string | null;
    gracePeriodDays: number;
    employeeGracePeriodDays: number;
    consultantName: string | null;
  };
  documents: {
    docType: DocType;
    docFormatted: string;
    holderCpf: string | null;
    isPrimary: boolean;
    nickname: string | null;
    employees: number;
  }[];
  pricing: AdhesionPricing;
  pricingScope: "empresa" | "rede";
  split: SplitRules;
  splitScope: "empresa" | "rede";
  benefits: {
    procedureName: string;
    benefitType: BenefitType;
    benefitValue: number | null;
    usageLimitCount: number | null;
    usagePeriodMonths: number | null;
    gracePeriodMonths: number;
    maxInstallments: number | null;
    scope: "empresa" | "rede";
  }[];
  program: {
    holders: number;
    dependents: number;
    total: number;
    inactiveHolders: number;
    monthlyCents: number;
    savedCents: number;
    benefitUses: number;
  };
  billings: {
    billingType: BillingType;
    referenceMonth: string | null;
    totalCents: number;
    status: BillingStatus;
    dueDate: string | null;
  }[];
  files: { fileType: string; fileName: string; createdAt: string }[];
  contracts: {
    title: string;
    status: string;
    signerName: string | null;
    signedAt: string | null;
  }[];
  generatedAt: string;
};

/** Dossiê da empresa para impressão/PDF — tudo que está cadastrado sobre ela. */
export async function loadCompanySheet(
  companyId: string
): Promise<CompanySheet | null> {
  const db = await empresarialDb();
  const supabase = await createClient();

  const { data: row } = await db
    .from("companies")
    .select(
      "id, cnpj, legal_name, trade_name, state_registration, category, address, employee_count, status, notes, created_at, responsible_name, responsible_role, responsible_cpf, responsible_email, responsible_phone, payment_model, company_subsidy_type, company_subsidy_value, billing_model, due_day, default_max_installments, payment_methods, contract_started_at, grace_period_days, employee_grace_period_days, assigned_consultant_id"
    )
    .eq("id", companyId)
    .maybeSingle<{
      id: string;
      cnpj: string;
      legal_name: string;
      trade_name: string | null;
      state_registration: string | null;
      category: CompanyCategory;
      address: CompanyAddress | null;
      employee_count: number | null;
      status: CompanyStatus;
      notes: string | null;
      created_at: string;
      responsible_name: string | null;
      responsible_role: string | null;
      responsible_cpf: string | null;
      responsible_email: string | null;
      responsible_phone: string | null;
      payment_model: PaymentModel;
      company_subsidy_type: "PERCENT" | "AMOUNT" | null;
      company_subsidy_value: number | null;
      billing_model: BillingModel;
      due_day: number;
      default_max_installments: number;
      payment_methods: PaymentMethod[];
      contract_started_at: string | null;
      grace_period_days: number;
      employee_grace_period_days: number;
      assigned_consultant_id: string | null;
    }>();
  if (!row) return null;

  const [
    { data: docRows },
    { data: emps },
    { data: deps },
    { data: pricingRows },
    { data: splitRows },
    { data: benefitRows },
    { data: usage },
    { data: billRows },
    { data: fileRows },
    { data: contractRows },
  ] = await Promise.all([
    db
      .from("company_documents")
      .select("id, doc_type, doc_formatted, holder_cpf, is_primary, nickname")
      .eq("company_id", companyId)
      .order("is_primary", { ascending: false })
      .returns<
        {
          id: string;
          doc_type: DocType;
          doc_formatted: string;
          holder_cpf: string | null;
          is_primary: boolean;
          nickname: string | null;
        }[]
      >(),
    db
      .from("employees")
      .select("id, dependent_plan, status, company_document_id")
      .eq("company_id", companyId)
      .returns<
        {
          id: string;
          dependent_plan: DependentPlan;
          status: "ACTIVE" | "INACTIVE" | "DELETED";
          company_document_id: string | null;
        }[]
      >(),
    db
      .from("dependents")
      .select("employee_id, status, employees!inner ( company_id )")
      .eq("status", "ACTIVE")
      .eq("employees.company_id", companyId)
      .returns<{ employee_id: string; status: string }[]>(),
    db
      .from("adhesion_pricing")
      .select(
        "company_id, holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents, max_installments"
      )
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .returns<
        {
          company_id: string | null;
          holder_fee_cents: number;
          dependent_individual_fee_cents: number;
          dependent_family_fee_cents: number;
          dependent_family_extra_fee_cents: number;
          max_installments: number;
        }[]
      >(),
    db
      .from("split_rules")
      .select(
        "company_id, first_payment_risarte_pct, first_payment_rislife_pct, recurring_risarte_pct, recurring_rislife_pct"
      )
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .returns<
        {
          company_id: string | null;
          first_payment_risarte_pct: number;
          first_payment_rislife_pct: number;
          recurring_risarte_pct: number;
          recurring_rislife_pct: number;
        }[]
      >(),
    db
      .from("procedure_benefits")
      .select(
        "company_id, procedure_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months, max_installments"
      )
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .returns<
        {
          company_id: string | null;
          procedure_id: string;
          benefit_type: BenefitType;
          benefit_value: number | null;
          usage_limit_count: number | null;
          usage_period_months: number | null;
          grace_period_months: number;
          max_installments: number | null;
        }[]
      >(),
    db
      .from("benefit_usage")
      .select("amount_saved_cents")
      .eq("company_id", companyId)
      .returns<{ amount_saved_cents: number | null }[]>(),
    db
      .from("adhesion_billing")
      .select("billing_type, reference_month, total_amount_cents, status, due_date")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(12)
      .returns<
        {
          billing_type: BillingType;
          reference_month: string | null;
          total_amount_cents: number;
          status: BillingStatus;
          due_date: string | null;
        }[]
      >(),
    db
      .from("company_files")
      .select("file_type, file_name, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .returns<{ file_type: string; file_name: string; created_at: string }[]>(),
    db
      .from("contracts")
      .select("title, status, signer_name, signed_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .returns<
        {
          title: string;
          status: string;
          signer_name: string | null;
          signed_at: string | null;
        }[]
      >(),
  ]);

  // Consultor RisLife responsável.
  let consultantName: string | null = null;
  if (row.assigned_consultant_id) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", row.assigned_consultant_id)
      .maybeSingle();
    consultantName = prof?.full_name || prof?.email || null;
  }

  // Preço e split: da empresa quando existe; senão o padrão da rede.
  const ownPricing = (pricingRows ?? []).find((p) => p.company_id === companyId);
  const netPricing = (pricingRows ?? []).find((p) => p.company_id === null);
  const chosenPricing = ownPricing ?? netPricing;
  const pricing: AdhesionPricing = chosenPricing
    ? {
        holderFeeCents: chosenPricing.holder_fee_cents,
        dependentIndividualFeeCents: chosenPricing.dependent_individual_fee_cents,
        dependentFamilyFeeCents: chosenPricing.dependent_family_fee_cents,
        dependentFamilyExtraFeeCents:
          chosenPricing.dependent_family_extra_fee_cents,
        maxInstallments: chosenPricing.max_installments,
      }
    : DEFAULT_ADHESION_PRICING;

  const ownSplit = (splitRows ?? []).find((s) => s.company_id === companyId);
  const netSplit = (splitRows ?? []).find((s) => s.company_id === null);
  const chosenSplit = ownSplit ?? netSplit;
  const split: SplitRules = chosenSplit
    ? {
        firstPaymentRisartePct: Number(chosenSplit.first_payment_risarte_pct),
        firstPaymentRislifePct: Number(chosenSplit.first_payment_rislife_pct),
        recurringRisartePct: Number(chosenSplit.recurring_risarte_pct),
        recurringRislifePct: Number(chosenSplit.recurring_rislife_pct),
      }
    : DEFAULT_SPLIT_RULES;

  // Benefícios efetivos: a linha da empresa vence a da rede no mesmo procedimento.
  type BenefitRow = {
    company_id: string | null;
    procedure_id: string;
    benefit_type: BenefitType;
    benefit_value: number | null;
    usage_limit_count: number | null;
    usage_period_months: number | null;
    grace_period_months: number;
    max_installments: number | null;
  };
  const chosenBenefit = new Map<string, BenefitRow>();
  for (const b of benefitRows ?? []) {
    const cur = chosenBenefit.get(b.procedure_id);
    if (!cur || (b.company_id === companyId && cur.company_id === null)) {
      chosenBenefit.set(b.procedure_id, b);
    }
  }
  const procIds = [...chosenBenefit.keys()];
  const procName = new Map<string, string>();
  if (procIds.length > 0) {
    const { data: procs } = await supabase
      .from("procedures")
      .select("id, name")
      .in("id", procIds);
    for (const p of procs ?? []) procName.set(p.id, p.name);
  }

  // Números do programa.
  const depCount = new Map<string, number>();
  for (const d of deps ?? [])
    depCount.set(d.employee_id, (depCount.get(d.employee_id) ?? 0) + 1);
  const activeEmps = (emps ?? []).filter((e) => e.status === "ACTIVE");
  const monthly = computeMonthlyCents(
    pricing,
    activeEmps.map((e) => ({
      status: "ACTIVE" as const,
      dependentPlan: e.dependent_plan,
      activeDependentCount: depCount.get(e.id) ?? 0,
    }))
  );

  const empByDoc = new Map<string, number>();
  for (const e of activeEmps) {
    if (e.company_document_id) {
      empByDoc.set(
        e.company_document_id,
        (empByDoc.get(e.company_document_id) ?? 0) + 1
      );
    }
  }

  return {
    company: {
      id: row.id,
      cnpj: row.cnpj,
      legalName: row.legal_name,
      tradeName: row.trade_name,
      stateRegistration: row.state_registration,
      category: row.category,
      address: row.address,
      employeeCount: row.employee_count,
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at,
      responsibleName: row.responsible_name,
      responsibleRole: row.responsible_role,
      responsibleCpf: row.responsible_cpf,
      responsibleEmail: row.responsible_email,
      responsiblePhone: row.responsible_phone,
      paymentModel: row.payment_model,
      subsidyType: row.company_subsidy_type,
      subsidyValue: row.company_subsidy_value,
      billingModel: row.billing_model,
      dueDay: row.due_day,
      defaultMaxInstallments: row.default_max_installments,
      paymentMethods: row.payment_methods ?? [],
      contractStartedAt: row.contract_started_at,
      gracePeriodDays: row.grace_period_days,
      employeeGracePeriodDays: row.employee_grace_period_days,
      consultantName,
    },
    documents: (docRows ?? []).map((d) => ({
      docType: d.doc_type,
      docFormatted: d.doc_formatted,
      holderCpf: d.holder_cpf,
      isPrimary: d.is_primary,
      nickname: d.nickname,
      employees: empByDoc.get(d.id) ?? 0,
    })),
    pricing,
    pricingScope: ownPricing ? "empresa" : "rede",
    split,
    splitScope: ownSplit ? "empresa" : "rede",
    benefits: [...chosenBenefit.values()]
      .map((b) => ({
        procedureName: procName.get(b.procedure_id) ?? "Procedimento",
        benefitType: b.benefit_type,
        benefitValue: b.benefit_value,
        usageLimitCount: b.usage_limit_count,
        usagePeriodMonths: b.usage_period_months,
        gracePeriodMonths: b.grace_period_months,
        maxInstallments: b.max_installments,
        scope: (b.company_id === companyId ? "empresa" : "rede") as
          | "empresa"
          | "rede",
      }))
      .sort((a, b) => a.procedureName.localeCompare(b.procedureName, "pt-BR")),
    program: {
      holders: activeEmps.length,
      dependents: (deps ?? []).length,
      total: activeEmps.length + (deps ?? []).length,
      inactiveHolders: (emps ?? []).filter((e) => e.status === "INACTIVE").length,
      monthlyCents: monthly.totalCents,
      savedCents: (usage ?? []).reduce(
        (a, u) => a + (u.amount_saved_cents ?? 0),
        0
      ),
      benefitUses: usage?.length ?? 0,
    },
    billings: (billRows ?? []).map((b) => ({
      billingType: b.billing_type,
      referenceMonth: b.reference_month,
      totalCents: b.total_amount_cents,
      status: b.status,
      dueDate: b.due_date,
    })),
    files: (fileRows ?? []).map((f) => ({
      fileType: f.file_type,
      fileName: f.file_name,
      createdAt: f.created_at,
    })),
    contracts: (contractRows ?? []).map((c) => ({
      title: c.title,
      status: c.status,
      signerName: c.signer_name,
      signedAt: c.signed_at,
    })),
    generatedAt: new Date().toISOString(),
  };
}
