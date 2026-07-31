import "server-only";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  computeMonthlyCents,
  dependentPlanCostCents,
  DEFAULT_ADHESION_PRICING,
  type AdhesionPricing,
} from "@/lib/empresarial/pricing";
import type {
  CompanyStatus,
  DependentPlan,
  EmployeeStatus,
  PaymentMethod,
  PaymentModel,
  Relationship,
} from "@/lib/empresarial/constants";
import type { CompanyAddress } from "@/lib/empresarial/types";

export type ReportDependent = {
  id: string;
  fullName: string | null;
  cpf: string;
  phone: string | null;
  relationship: Relationship;
  status: EmployeeStatus;
  linked: boolean;
};

export type ReportEmployee = {
  id: string;
  fullName: string;
  cpf: string;
  phone: string;
  email: string | null;
  status: EmployeeStatus;
  registrationStage: "PRE_REGISTERED" | "COMPLETED";
  dependentPlan: DependentPlan;
  joinedAt: string;
  leftAt: string | null;
  leftReason: string | null;
  clinicName: string | null;
  linked: boolean;
  /** Mensalidade deste colaborador (titular + plano de dependentes), em centavos. */
  monthlyCents: number;
  dependents: ReportDependent[];
};

export type CompanyReport = {
  company: {
    id: string;
    cnpj: string;
    legalName: string;
    tradeName: string | null;
    stateRegistration: string | null;
    address: CompanyAddress | null;
    employeeCount: number | null;
    status: CompanyStatus;
    paymentModel: PaymentModel;
    paymentMethods: PaymentMethod[];
    dueDay: number;
    defaultMaxInstallments: number;
    contractStartedAt: string | null;
    gracePeriodDays: number;
    employeeGracePeriodDays: number;
    notes: string | null;
    consultantName: string | null;
  };
  pricing: AdhesionPricing;
  pricingScope: "empresa" | "rede";
  employees: ReportEmployee[];
  totals: {
    employeesActive: number;
    employeesInactive: number;
    dependentsActive: number;
    linkedClients: number;
    pendingRegistration: number;
    monthlyCents: number;
    savedCents: number;
    benefitUses: number;
  };
  generatedAt: string;
};

type CompanyRow = {
  id: string;
  cnpj: string;
  legal_name: string;
  trade_name: string | null;
  state_registration: string | null;
  address: CompanyAddress | null;
  employee_count: number | null;
  status: CompanyStatus;
  payment_model: PaymentModel;
  payment_methods: PaymentMethod[] | null;
  due_day: number;
  default_max_installments: number;
  contract_started_at: string | null;
  grace_period_days: number;
  employee_grace_period_days: number;
  notes: string | null;
  assigned_consultant_id: string | null;
};

type EmployeeRow = {
  id: string;
  full_name: string;
  cpf: string;
  phone: string;
  email: string | null;
  status: EmployeeStatus;
  registration_stage: "PRE_REGISTERED" | "COMPLETED";
  dependent_plan: DependentPlan;
  joined_at: string;
  left_at: string | null;
  left_reason: string | null;
  client_id: string | null;
  clinic_id: string | null;
  dependents: {
    id: string;
    full_name: string | null;
    cpf: string;
    phone: string | null;
    relationship: Relationship;
    status: EmployeeStatus;
    client_id: string | null;
  }[];
};

/**
 * Carrega tudo que o relatório detalhado da empresa mostra: cadastro da empresa,
 * preços efetivos (empresa > rede), colaboradores com dependentes e os totais.
 * A RLS do schema `empresarial` continua sendo a barreira real.
 */
export async function loadCompanyReport(
  companyId: string
): Promise<CompanyReport | null> {
  const db = await empresarialDb();

  const { data: row } = await db
    .from("companies")
    .select(
      "id, cnpj, legal_name, trade_name, state_registration, address, employee_count, status, payment_model, payment_methods, due_day, default_max_installments, contract_started_at, grace_period_days, employee_grace_period_days, notes, assigned_consultant_id"
    )
    .eq("id", companyId)
    .maybeSingle<CompanyRow>();
  if (!row) return null;

  const [{ data: empRows }, { data: pricingRows }, { data: usage }] =
    await Promise.all([
      db
        .from("employees")
        .select(
          "id, full_name, cpf, phone, email, status, registration_stage, dependent_plan, joined_at, left_at, left_reason, client_id, clinic_id, dependents ( id, full_name, cpf, phone, relationship, status, client_id )"
        )
        .eq("company_id", companyId)
        .order("full_name")
        .returns<EmployeeRow[]>(),
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
        .from("benefit_usage")
        .select("amount_saved_cents")
        .eq("company_id", companyId)
        .returns<{ amount_saved_cents: number | null }[]>(),
    ]);

  // Preço efetivo: linha da empresa, senão a da rede, senão o padrão do código.
  const own = (pricingRows ?? []).find((p) => p.company_id === companyId);
  const net = (pricingRows ?? []).find((p) => p.company_id === null);
  const chosen = own ?? net;
  const pricing: AdhesionPricing = chosen
    ? {
        holderFeeCents: chosen.holder_fee_cents,
        dependentIndividualFeeCents: chosen.dependent_individual_fee_cents,
        dependentFamilyFeeCents: chosen.dependent_family_fee_cents,
        dependentFamilyExtraFeeCents: chosen.dependent_family_extra_fee_cents,
        maxInstallments: chosen.max_installments,
      }
    : DEFAULT_ADHESION_PRICING;

  // Nomes das unidades dos colaboradores vinculados + consultor responsável.
  const supabase = await createClient();
  const clinicIds = [
    ...new Set((empRows ?? []).map((e) => e.clinic_id).filter((x): x is string => !!x)),
  ];
  const clinicNames = new Map<string, string>();
  if (clinicIds.length > 0) {
    const { data: clinics } = await supabase
      .from("clinics")
      .select("id, name")
      .in("id", clinicIds);
    for (const c of clinics ?? []) clinicNames.set(c.id, c.name);
  }
  let consultantName: string | null = null;
  if (row.assigned_consultant_id) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", row.assigned_consultant_id)
      .maybeSingle();
    consultantName = prof?.full_name || prof?.email || null;
  }

  const employees: ReportEmployee[] = (empRows ?? []).map((e) => {
    const deps = (e.dependents ?? []).map((d) => ({
      id: d.id,
      fullName: d.full_name,
      cpf: d.cpf,
      phone: d.phone,
      relationship: d.relationship,
      status: d.status,
      linked: Boolean(d.client_id),
    }));
    const activeDeps = deps.filter((d) => d.status === "ACTIVE").length;
    // Só colaborador ATIVO entra na mensalidade (mesma regra do cálculo geral).
    const monthlyCents =
      e.status === "ACTIVE"
        ? pricing.holderFeeCents +
          dependentPlanCostCents(pricing, e.dependent_plan, activeDeps)
        : 0;
    return {
      id: e.id,
      fullName: e.full_name,
      cpf: e.cpf,
      phone: e.phone,
      email: e.email,
      status: e.status,
      registrationStage: e.registration_stage,
      dependentPlan: e.dependent_plan,
      joinedAt: e.joined_at,
      leftAt: e.left_at,
      leftReason: e.left_reason,
      clinicName: e.clinic_id ? clinicNames.get(e.clinic_id) ?? null : null,
      linked: Boolean(e.client_id),
      monthlyCents,
      dependents: deps.sort((a, b) =>
        (a.fullName ?? "").localeCompare(b.fullName ?? "", "pt-BR")
      ),
    };
  });

  const monthly = computeMonthlyCents(
    pricing,
    employees.map((e) => ({
      status: e.status,
      dependentPlan: e.dependentPlan,
      activeDependentCount: e.dependents.filter((d) => d.status === "ACTIVE").length,
    }))
  );

  return {
    company: {
      id: row.id,
      cnpj: row.cnpj,
      legalName: row.legal_name,
      tradeName: row.trade_name,
      stateRegistration: row.state_registration,
      address: row.address,
      employeeCount: row.employee_count,
      status: row.status,
      paymentModel: row.payment_model,
      paymentMethods: row.payment_methods ?? [],
      dueDay: row.due_day,
      defaultMaxInstallments: row.default_max_installments,
      contractStartedAt: row.contract_started_at,
      gracePeriodDays: row.grace_period_days,
      employeeGracePeriodDays: row.employee_grace_period_days,
      notes: row.notes,
      consultantName,
    },
    pricing,
    pricingScope: own ? "empresa" : "rede",
    employees,
    totals: {
      employeesActive: employees.filter((e) => e.status === "ACTIVE").length,
      employeesInactive: employees.filter((e) => e.status === "INACTIVE").length,
      dependentsActive: employees.reduce(
        (a, e) => a + e.dependents.filter((d) => d.status === "ACTIVE").length,
        0
      ),
      linkedClients: employees.filter((e) => e.linked).length,
      pendingRegistration: employees.filter(
        (e) => e.registrationStage === "PRE_REGISTERED" && e.status === "ACTIVE"
      ).length,
      monthlyCents: monthly.totalCents,
      savedCents: (usage ?? []).reduce((a, u) => a + (u.amount_saved_cents ?? 0), 0),
      benefitUses: usage?.length ?? 0,
    },
    generatedAt: new Date().toISOString(),
  };
}
