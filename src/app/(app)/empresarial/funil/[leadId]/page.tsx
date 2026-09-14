import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  canViewEmpresarial,
  isProgramManager,
  isRislifeConsultant,
} from "@/lib/empresarial/access";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { DEFAULT_ADHESION_PRICING } from "@/lib/empresarial/pricing";
import type { LeadStage, PaymentModel } from "@/lib/empresarial/constants";
import type { BillingBasis, InterestLevel } from "@/lib/empresarial/proposta";
import type { CompanyCategory } from "@/lib/empresarial/documents";
import { FichaDoLead, type QualificacaoView } from "./ficha-lead";

export const metadata: Metadata = { title: "Levantamento · Risarte Empresarial" };

type LeadRow = {
  id: string;
  company_name: string;
  cnpj: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  stage: LeadStage;
};

type QualRow = {
  has_dental_plan: boolean | null;
  dental_plan_name: string | null;
  dental_plan_monthly_cents: number | null;
  other_benefits: string | null;
  social_projects: boolean | null;
  social_projects_note: string | null;
  interest_level: InterestLevel | null;
  success_chance: number | null;
  payment_model: PaymentModel | null;
  subsidy_type: "PERCENT" | "AMOUNT" | null;
  subsidy_value: number | null;
  employee_count: number | null;
  includes_dependents: boolean | null;
  dependents_estimate: number | null;
  billing_model: "unico" | "por_cnpj" | null;
  billing_basis: BillingBasis | null;
  holder_fee_cents: number | null;
  dependent_fee_cents: number | null;
  fixed_monthly_cents: number | null;
  implantation_per_employee_cents: number | null;
  legal_name: string | null;
  category: CompanyCategory | null;
  responsible_name: string | null;
  responsible_role: string | null;
  responsible_cpf: string | null;
  responsible_email: string | null;
  responsible_phone: string | null;
  notes: string | null;
};

export default async function FichaDoLeadPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;

  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  if (!isProgramManager(session) && !isRislifeConsultant(session)) {
    redirect("/empresarial");
  }

  const db = await empresarialDb();
  const { data: lead } = await db
    .from("commercial_leads")
    .select("id, company_name, cnpj, contact_name, contact_phone, stage")
    .eq("id", leadId)
    .maybeSingle<LeadRow>();
  // A RLS já decide o que este consultor enxerga; aqui "não achou" é
  // "não é seu" ou "não existe" — nos dois casos, a porta é a mesma.
  if (!lead) notFound();

  const { data: qual, error } = await db
    .from("lead_qualification")
    .select("*")
    .eq("lead_id", leadId)
    .maybeSingle<QualRow>();
  if (error) {
    console.error("levantamento do lead:", error.message);
    throw new Error(
      "Não foi possível ler o levantamento. Confirme se a migração 1009 foi aplicada neste banco."
    );
  }

  // Valores de partida quando ainda não há levantamento: os preços padrão da
  // rede. É sugestão declarada, não número inventado — a tela diz de onde vêm.
  const view: QualificacaoView = {
    hasDentalPlan: qual?.has_dental_plan ?? null,
    dentalPlanName: qual?.dental_plan_name ?? null,
    dentalPlanMonthlyCents: qual?.dental_plan_monthly_cents ?? null,
    otherBenefits: qual?.other_benefits ?? null,
    socialProjects: qual?.social_projects ?? null,
    socialProjectsNote: qual?.social_projects_note ?? null,
    interestLevel: qual?.interest_level ?? null,
    successChance: qual?.success_chance ?? null,
    paymentModel: qual?.payment_model ?? null,
    subsidyType: qual?.subsidy_type ?? null,
    subsidyValue: qual?.subsidy_value ?? null,
    employeeCount: qual?.employee_count ?? null,
    includesDependents: qual?.includes_dependents ?? null,
    dependentsEstimate: qual?.dependents_estimate ?? null,
    billingModel: qual?.billing_model ?? null,
    billingBasis: qual?.billing_basis ?? null,
    holderFeeCents:
      qual?.holder_fee_cents ?? DEFAULT_ADHESION_PRICING.holderFeeCents,
    dependentFeeCents:
      qual?.dependent_fee_cents ??
      DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents,
    fixedMonthlyCents: qual?.fixed_monthly_cents ?? null,
    implantationPerEmployeeCents: qual?.implantation_per_employee_cents ?? null,
    legalName: qual?.legal_name ?? lead.company_name,
    category: qual?.category ?? null,
    responsibleName: qual?.responsible_name ?? lead.contact_name,
    responsibleRole: qual?.responsible_role ?? null,
    responsibleCpf: qual?.responsible_cpf ?? null,
    responsibleEmail: qual?.responsible_email ?? null,
    responsiblePhone: qual?.responsible_phone ?? lead.contact_phone,
    notes: qual?.notes ?? null,
    temLevantamento: Boolean(qual),
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Funil comercial · fase 4"
        icone={ClipboardList}
        titulo={lead.company_name}
        descricao="O que o consultor levantou na apresentação, e os dados que montam a proposta e o contrato."
        voltar={{ href: "/empresarial/funil", rotulo: "Funil" }}
      />
      <FichaDoLead
        leadId={lead.id}
        cnpj={lead.cnpj}
        qualificacao={view}
      />
    </div>
  );
}
