import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { fullAccessClinicIds, getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import { canViewEmpresarial, isProgramManager } from "@/lib/empresarial/access";
import {
  ColaboradoresTab,
  type DependentView,
  type EmployeeView,
} from "./colaboradores-tab";
import { MonthlySimulator, RemoveOverrideButton } from "./simulator";
import {
  loadBenefits,
  loadPricing,
  loadProcedures,
  loadSplit,
} from "../configuracoes/data";
import {
  AdhesionPricingForm,
  SplitRulesForm,
} from "../configuracoes/pricing-forms";
import { BenefitsEditor, type BenefitView } from "../configuracoes/benefits-editor";
import { SocialTab, type SocialTokenView } from "./social-tab";
import { BillingTab, type BillingView } from "./billing-tab";
import { isAsaasConfigured } from "@/lib/empresarial/asaas";
import { ContratosTab, type ContractView } from "./contratos-tab";
import { isZapsignConfigured } from "@/lib/empresarial/zapsign";
import {
  computeMonthlyCents,
  type AdhesionPricing,
  type SplitRules,
} from "@/lib/empresarial/pricing";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCnpj } from "@/lib/masks";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import {
  COMPANY_STATUS_LABELS,
  PAYMENT_MODEL_LABELS,
  PAYMENT_METHOD_LABELS,
  type CompanyStatus,
  type DependentPlan,
  type PaymentMethod,
} from "@/lib/empresarial/constants";
import type { Company } from "@/lib/empresarial/types";
import { CompanyFormDialog } from "../company-form-dialog";

export const metadata: Metadata = { title: "Empresa · Risarte Empresarial" };

const STATUS_VARIANT: Record<
  CompanyStatus,
  "secondary" | "destructive" | "outline"
> = {
  ACTIVE: "secondary",
  SUSPENDED: "destructive",
  TERMINATED: "outline",
};

const TABS = [
  { key: "geral", label: "Dados Gerais" },
  { key: "colaboradores", label: "Colaboradores" },
  { key: "plano", label: "Plano & Benefícios" },
  { key: "financeiro", label: "Financeiro" },
  { key: "social", label: "Riso+ Social" },
  { key: "contratos", label: "Contratos" },
] as const;

type CompanyRow = {
  id: string;
  cnpj: string;
  legal_name: string;
  trade_name: string | null;
  state_registration: string | null;
  address: Company["address"];
  employee_count: number | null;
  status: CompanyStatus;
  payment_model: Company["paymentModel"];
  company_subsidy_type: "PERCENT" | "AMOUNT" | null;
  company_subsidy_value: number | null;
  due_day: number;
  assigned_consultant_id: string | null;
  payment_methods: PaymentMethod[];
  default_max_installments: number;
  contract_started_at: string | null;
  grace_period_days: number;
  employee_grace_period_days: number;
  notes: string | null;
  created_at: string;
};

function toCompany(r: CompanyRow): Company {
  return {
    id: r.id,
    cnpj: r.cnpj,
    legalName: r.legal_name,
    tradeName: r.trade_name,
    stateRegistration: r.state_registration,
    address: r.address,
    employeeCount: r.employee_count,
    status: r.status,
    paymentModel: r.payment_model,
    companySubsidyType: r.company_subsidy_type,
    companySubsidyValue: r.company_subsidy_value,
    dueDay: r.due_day,
    assignedConsultantId: r.assigned_consultant_id,
    paymentMethods: r.payment_methods ?? [],
    defaultMaxInstallments: r.default_max_installments,
    contractStartedAt: r.contract_started_at,
    gracePeriodDays: r.grace_period_days,
    employeeGracePeriodDays: r.employee_grace_period_days,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}

export default async function CompanyDetailPage(props: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  const canManage = isProgramManager(session);

  const { companyId } = await props.params;
  const searchParams = await props.searchParams;
  const abaParam = typeof searchParams.aba === "string" ? searchParams.aba : "geral";
  const aba = TABS.some((t) => t.key === abaParam) ? abaParam : "geral";

  const db = await empresarialDb();
  const { data: row } = await db
    .from("companies")
    .select(
      "id, cnpj, legal_name, trade_name, state_registration, address, employee_count, status, payment_model, company_subsidy_type, company_subsidy_value, due_day, assigned_consultant_id, payment_methods, default_max_installments, contract_started_at, grace_period_days, employee_grace_period_days, notes, created_at"
    )
    .eq("id", companyId)
    .maybeSingle<CompanyRow>();
  if (!row) notFound();
  const company = toCompany(row);

  let consultantName: string | null = null;
  if (row.assigned_consultant_id) {
    const supabase = await createClient();
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", row.assigned_consultant_id)
      .maybeSingle();
    consultantName = prof?.full_name || prof?.email || null;
  }

  const addr = company.address;
  const addrText = addr
    ? [
        [addr.street, addr.number].filter(Boolean).join(", "),
        addr.complement,
        addr.neighborhood,
        [addr.city, addr.state].filter(Boolean).join(" - "),
        addr.zipCode,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const subsidyText =
    company.paymentModel === "COMPANY_PARTIAL" && company.companySubsidyValue
      ? company.companySubsidyType === "PERCENT"
        ? `${company.companySubsidyValue}%`
        : formatBRL(company.companySubsidyValue)
      : null;

  // Aba Colaboradores: carrega colaboradores + dependentes + unidades do seletor.
  const allRoles = Object.values(session.rolesByClinic).flat();
  const canManageEmp =
    isProgramManager(session) ||
    allRoles.some((r) =>
      ["sdr", "receptionist", "unit_manager", "franchisee"].includes(r)
    );
  let employees: EmployeeView[] = [];
  let units: { id: string; name: string }[] = [];
  if (aba === "colaboradores") {
    type EmpRow = {
      id: string;
      cpf: string;
      full_name: string;
      phone: string;
      email: string | null;
      status: "ACTIVE" | "INACTIVE";
      registration_stage: "PRE_REGISTERED" | "COMPLETED";
      dependent_plan: string;
      client_id: string | null;
      dependents: {
        id: string;
        cpf: string;
        full_name: string | null;
        phone: string | null;
        relationship: DependentView["relationship"];
        status: "ACTIVE" | "INACTIVE";
        client_id: string | null;
      }[];
    };
    const supabase = await createClient();
    const [{ data: empRows }, { data: unitRows }] = await Promise.all([
      db
        .from("employees")
        .select(
          "id, cpf, full_name, phone, email, status, registration_stage, dependent_plan, client_id, dependents ( id, cpf, full_name, phone, relationship, status, client_id )"
        )
        .eq("company_id", companyId)
        .order("full_name")
        .returns<EmpRow[]>(),
      supabase
        .from("clinics")
        .select("id, name")
        .eq("type", "franchise_unit")
        .eq("is_active", true)
        .order("name"),
    ]);
    employees = (empRows ?? []).map((e) => ({
      id: e.id,
      cpf: e.cpf,
      fullName: e.full_name,
      phone: e.phone,
      email: e.email,
      status: e.status,
      registrationStage: e.registration_stage,
      dependentPlan: e.dependent_plan,
      clientId: e.client_id,
      dependents: (e.dependents ?? []).map((d) => ({
        id: d.id,
        cpf: d.cpf,
        fullName: d.full_name,
        phone: d.phone,
        relationship: d.relationship,
        status: d.status,
        clientId: d.client_id,
      })),
    }));
    units = unitRows ?? [];
    const privileged =
      session.isAdminMaster ||
      isProgramManager(session) ||
      allRoles.includes("sdr");
    if (!privileged) {
      const scope = await fullAccessClinicIds();
      units = units.filter((u) => scope.includes(u.id));
    }
  }

  // Aba Plano & Benefícios: preços/split/benefícios efetivos + mensalidade.
  let plano: {
    effectivePricing: AdhesionPricing;
    hasPricingOverride: boolean;
    effectiveSplit: SplitRules;
    hasSplitOverride: boolean;
    benefits: BenefitView[];
    procedures: { id: string; name: string }[];
    monthly: ReturnType<typeof computeMonthlyCents>;
  } | null = null;
  if (aba === "plano") {
    const procedures = await loadProcedures();
    const procNames = new Map(procedures.map((p) => [p.id, p.name]));
    const [comp, net, compSplit, netSplit, benefits, empRes] = await Promise.all([
      loadPricing(db, companyId),
      loadPricing(db, null),
      loadSplit(db, companyId),
      loadSplit(db, null),
      loadBenefits(db, companyId, procNames),
      db
        .from("employees")
        .select("dependent_plan, status, dependents ( status )")
        .eq("company_id", companyId)
        .eq("status", "ACTIVE"),
    ]);
    const effectivePricing = comp.hasOverride ? comp.pricing : net.pricing;
    const effectiveSplit = compSplit.hasOverride ? compSplit.split : netSplit.split;
    const empList = (empRes.data ?? []) as {
      dependent_plan: string;
      status: "ACTIVE" | "INACTIVE";
      dependents: { status: string }[];
    }[];
    const monthly = computeMonthlyCents(
      effectivePricing,
      empList.map((e) => ({
        status: e.status,
        dependentPlan: e.dependent_plan as DependentPlan,
        activeDependentCount: (e.dependents ?? []).filter(
          (d) => d.status === "ACTIVE"
        ).length,
      }))
    );
    plano = {
      effectivePricing,
      hasPricingOverride: comp.hasOverride,
      effectiveSplit,
      hasSplitOverride: compSplit.hasOverride,
      benefits,
      procedures,
      monthly,
    };
  }

  // Aba Riso+ Social: fichas sociais + candidatos a beneficiário.
  let social: {
    tokens: SocialTokenView[];
    candidates: { clientId: string; name: string }[];
  } | null = null;
  if (aba === "social") {
    const [{ data: tokenRows }, { data: empCands }] = await Promise.all([
      db
        .from("social_tokens")
        .select("id, trigger_type, is_pool, status, beneficiary_client_id")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .returns<
          {
            id: string;
            trigger_type: string;
            is_pool: boolean;
            status: "AVAILABLE" | "ASSIGNED" | "USED";
            beneficiary_client_id: string | null;
          }[]
        >(),
      db
        .from("employees")
        .select("id, client_id, full_name")
        .eq("company_id", companyId)
        .returns<{ id: string; client_id: string | null; full_name: string }[]>(),
    ]);
    const candidateMap = new Map<string, string>();
    for (const e of empCands ?? [])
      if (e.client_id) candidateMap.set(e.client_id, e.full_name);
    // Dependentes vinculados dos colaboradores desta empresa.
    const empIds = (empCands ?? []).map((e) => e.id);
    if (empIds.length > 0) {
      const { data: depCands } = await db
        .from("dependents")
        .select("client_id, full_name")
        .in("employee_id", empIds)
        .not("client_id", "is", null)
        .returns<{ client_id: string; full_name: string | null }[]>();
      for (const d of depCands ?? [])
        if (d.client_id && !candidateMap.has(d.client_id))
          candidateMap.set(d.client_id, d.full_name ?? "Dependente");
    }
    const candidates = [...candidateMap.entries()].map(([clientId, name]) => ({
      clientId,
      name,
    }));
    const tokens: SocialTokenView[] = (tokenRows ?? []).map((t) => ({
      id: t.id,
      triggerType: t.trigger_type,
      isPool: t.is_pool,
      status: t.status,
      beneficiaryClientId: t.beneficiary_client_id,
      beneficiaryName: t.beneficiary_client_id
        ? candidateMap.get(t.beneficiary_client_id) ?? null
        : null,
    }));
    social = { tokens, candidates };
  }

  // Aba Contratos: contratos da empresa (ZapSign) + proposta (Gamma).
  let contracts: ContractView[] | null = null;
  if (aba === "contratos") {
    const { data } = await db
      .from("contracts")
      .select(
        "id, title, status, signer_name, signer_email, sent_at, signed_at, zapsign_url"
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .returns<
        {
          id: string;
          title: string;
          status: ContractView["status"];
          signer_name: string | null;
          signer_email: string | null;
          sent_at: string | null;
          signed_at: string | null;
          zapsign_url: string | null;
        }[]
      >();
    contracts = (data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      signerName: c.signer_name,
      signerEmail: c.signer_email,
      sentAt: c.sent_at,
      signedAt: c.signed_at,
      zapsignUrl: c.zapsign_url,
    }));
  }

  // Aba Financeiro: economia gerada + cobranças (ASAAS).
  let financeiro: {
    savedTotal: number;
    usageCount: number;
    billings: BillingView[];
  } | null = null;
  if (aba === "financeiro") {
    const [{ data: usage }, { data: billRows }] = await Promise.all([
      db
        .from("benefit_usage")
        .select("amount_saved_cents")
        .eq("company_id", companyId)
        .returns<{ amount_saved_cents: number | null }[]>(),
      db
        .from("adhesion_billing")
        .select(
          "id, billing_type, reference_month, total_amount_cents, status, due_date, paid_at, split_risarte_cents, split_rislife_cents"
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .returns<
          {
            id: string;
            billing_type: BillingView["billingType"];
            reference_month: string | null;
            total_amount_cents: number;
            status: BillingView["status"];
            due_date: string | null;
            paid_at: string | null;
            split_risarte_cents: number | null;
            split_rislife_cents: number | null;
          }[]
        >(),
    ]);
    financeiro = {
      savedTotal: (usage ?? []).reduce(
        (a, u) => a + (u.amount_saved_cents ?? 0),
        0
      ),
      usageCount: usage?.length ?? 0,
      billings: (billRows ?? []).map((b) => ({
        id: b.id,
        billingType: b.billing_type,
        referenceMonth: b.reference_month,
        totalCents: b.total_amount_cents,
        status: b.status,
        dueDate: b.due_date,
        paidAt: b.paid_at,
        splitRisarteCents: b.split_risarte_cents,
        splitRislifeCents: b.split_rislife_cents,
      })),
    };
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link
            href="/empresarial"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Empresas
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {company.tradeName || company.legalName}
            <Badge variant={STATUS_VARIANT[company.status]}>
              {COMPANY_STATUS_LABELS[company.status]}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatCnpj(company.cnpj)}
          </p>
        </div>
        {canManage && (
          <CompanyFormDialog
            company={company}
            consultants={
              row.assigned_consultant_id && consultantName
                ? [{ id: row.assigned_consultant_id, label: consultantName }]
                : []
            }
          />
        )}
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Button
            key={t.key}
            variant="ghost"
            size="sm"
            nativeButton={false}
            className={cn(
              "rounded-b-none border-b-2 border-transparent",
              aba === t.key && "border-gold font-medium text-gold"
            )}
            render={
              <Link
                href={{
                  pathname: `/empresarial/${company.id}`,
                  query: { aba: t.key },
                }}
              />
            }
          >
            {t.label}
          </Button>
        ))}
      </div>

      {aba === "geral" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cadastro</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Info label="Razão social" value={company.legalName} />
              <Info label="Nome fantasia" value={company.tradeName} />
              <Info
                label="Inscrição estadual"
                value={company.stateRegistration}
              />
              <Info
                label="Colaboradores (estimado)"
                value={company.employeeCount}
              />
              <div className="col-span-2">
                <Info label="Endereço" value={addrText} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Programa e pagamento</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Info
                label="Modelo"
                value={PAYMENT_MODEL_LABELS[company.paymentModel]}
              />
              {subsidyText && (
                <Info label="Subsídio da empresa" value={subsidyText} />
              )}
              <Info label="Consultor RisLife" value={consultantName} />
              <Info label="Dia de vencimento" value={company.dueDay} />
              <Info
                label="Parcelamento máximo"
                value={`${company.defaultMaxInstallments}x`}
              />
              <Info
                label="Meios de pagamento"
                value={
                  company.paymentMethods
                    .map((m) => PAYMENT_METHOD_LABELS[m])
                    .join(", ") || "—"
                }
              />
              <Info
                label="Início do contrato"
                value={
                  company.contractStartedAt
                    ? new Date(
                        company.contractStartedAt + "T00:00:00"
                      ).toLocaleDateString("pt-BR")
                    : "—"
                }
              />
              <Info
                label="Carência da empresa"
                value={`${company.gracePeriodDays} dias`}
              />
              <Info
                label="Carência do colaborador"
                value={`${company.employeeGracePeriodDays} dias`}
              />
              {company.notes && (
                <div className="col-span-2">
                  <Info label="Observações" value={company.notes} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {aba === "colaboradores" && (
        <ColaboradoresTab
          companyId={company.id}
          employees={employees}
          units={units}
          canManage={canManageEmp}
        />
      )}

      {aba === "plano" && plano && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mensalidade atual</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold text-gold">
                  {formatBRL(plano.monthly.totalCents)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {plano.monthly.holdersCount} titular(es) ·{" "}
                  {formatBRL(plano.monthly.holdersCents)} + dependentes{" "}
                  {formatBRL(plano.monthly.dependentsCents)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Split mensal:{" "}
                  {plano.effectiveSplit.recurringRisartePct}% Risarte /{" "}
                  {plano.effectiveSplit.recurringRislifePct}% RisLife.
                </p>
              </CardContent>
            </Card>
            <MonthlySimulator pricing={plano.effectivePricing} />
          </div>

          {canManage && (
            <>
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-base">
                    Preços de adesão{" "}
                    {plano.hasPricingOverride ? "(próprios desta empresa)" : "(padrão da rede)"}
                  </CardTitle>
                  {plano.hasPricingOverride && (
                    <RemoveOverrideButton
                      table="adhesion_pricing"
                      companyId={company.id}
                      label="Voltar ao padrão da rede"
                    />
                  )}
                </CardHeader>
                <CardContent>
                  <AdhesionPricingForm
                    companyId={company.id}
                    pricing={plano.effectivePricing}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-base">
                    Split{" "}
                    {plano.hasSplitOverride ? "(próprio desta empresa)" : "(padrão da rede)"}
                  </CardTitle>
                  {plano.hasSplitOverride && (
                    <RemoveOverrideButton
                      table="split_rules"
                      companyId={company.id}
                      label="Voltar ao padrão da rede"
                    />
                  )}
                </CardHeader>
                <CardContent>
                  <SplitRulesForm
                    companyId={company.id}
                    split={plano.effectiveSplit}
                  />
                </CardContent>
              </Card>

              <BenefitsEditor
                companyId={company.id}
                procedures={plano.procedures}
                benefits={plano.benefits}
                scopeLabel="específicos desta empresa (o que não tiver aqui usa o padrão da rede)"
              />
            </>
          )}
        </div>
      )}

      {aba === "financeiro" && financeiro && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs uppercase text-muted-foreground">
                  Economia gerada aos colaboradores
                </p>
                <p className="mt-1 text-2xl font-semibold text-gold">
                  {formatBRL(financeiro.savedTotal)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs uppercase text-muted-foreground">
                  Benefícios utilizados
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {financeiro.usageCount}
                </p>
              </CardContent>
            </Card>
          </div>
          <BillingTab
            companyId={company.id}
            companyStatus={company.status}
            billings={financeiro.billings}
            asaasConfigured={isAsaasConfigured()}
          />
        </div>
      )}

      {aba === "social" && social && (
        <SocialTab
          companyId={company.id}
          paymentModel={company.paymentModel}
          tokens={social.tokens}
          candidates={social.candidates}
        />
      )}

      {aba === "contratos" && contracts && (
        <ContratosTab
          companyId={company.id}
          contracts={contracts}
          zapsignConfigured={isZapsignConfigured()}
          gammaConfigured={Boolean(process.env.GAMMA_API_KEY)}
        />
      )}
    </div>
  );
}
