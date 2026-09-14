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
import { createClient } from "@/lib/supabase/server";
import type {
  DispatchChannel,
  DispatchItem,
  LeadStage,
  PaymentModel,
} from "@/lib/empresarial/constants";
import type { BillingBasis, InterestLevel } from "@/lib/empresarial/proposta";
import type { CompanyCategory } from "@/lib/empresarial/documents";
import { FichaDoLead, type QualificacaoView } from "./ficha-lead";
import { ApresentacaoEditor } from "./apresentacao-editor";
import { EnvioESelos, type EnvioView } from "./envio-e-selos";

export const metadata: Metadata = { title: "Levantamento · Risarte Empresarial" };

type LeadRow = {
  id: string;
  company_name: string;
  cnpj: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  stage: LeadStage;
  consultant_id: string | null;
  contract_signed_at: string | null;
  implantation_paid_at: string | null;
};

type TemplateRow = {
  lead_id: string | null;
  title: string;
  subtitle: string | null;
  sections: { titulo: string; corpo: string }[];
};

type DispatchRow = {
  id: string;
  channel: DispatchChannel;
  items: DispatchItem[];
  note: string | null;
  sent_at: string;
  sent_by: string | null;
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
    .select(
      "id, company_name, cnpj, contact_name, contact_phone, stage, consultant_id, contract_signed_at, implantation_paid_at"
    )
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

  // C2: a apresentação (cascata rede → empresa) e o que já foi enviado.
  const [{ data: templates }, { data: dispatches }] = await Promise.all([
    db
      .from("presentation_templates")
      .select("lead_id, title, subtitle, sections")
      .or(`lead_id.eq.${leadId},lead_id.is.null`)
      .returns<TemplateRow[]>(),
    db
      .from("lead_dispatches")
      .select("id, channel, items, note, sent_at, sent_by")
      .eq("lead_id", leadId)
      .order("sent_at", { ascending: false })
      .returns<DispatchRow[]>(),
  ]);

  const daEmpresa = templates?.find((t) => t.lead_id === leadId);
  const daRede = templates?.find((t) => !t.lead_id);
  const template = daEmpresa ?? daRede;

  // Nomes de quem enviou e do consultor responsável.
  const userIds = [
    ...new Set(
      [lead.consultant_id, ...(dispatches ?? []).map((d) => d.sent_by)].filter(
        (x): x is string => Boolean(x)
      )
    ),
  ];
  const nomePorId = new Map<string, string>();
  if (userIds.length) {
    const supabase = await createClient();
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    for (const p of profs ?? [])
      nomePorId.set(p.id, p.full_name || p.email || "—");
  }

  const envios: EnvioView[] = (dispatches ?? []).map((d) => ({
    id: d.id,
    channel: d.channel,
    items: d.items,
    note: d.note,
    sentAt: d.sent_at,
    authorName: d.sent_by ? nomePorId.get(d.sent_by) ?? null : null,
  }));

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

      {/* Fora do formulário do levantamento de propósito: são formulários
          próprios, e aninhar <form> dentro de <form> não funciona. */}
      {template && (
        <ApresentacaoEditor
          leadId={lead.id}
          title={template.title}
          subtitle={template.subtitle}
          blocos={template.sections}
          personalizada={Boolean(daEmpresa)}
        />
      )}

      <EnvioESelos
        leadId={lead.id}
        empresa={lead.company_name}
        contato={lead.contact_name}
        telefone={lead.contact_phone}
        consultor={
          lead.consultant_id ? nomePorId.get(lead.consultant_id) ?? null : null
        }
        envios={envios}
        contractSignedAt={lead.contract_signed_at}
        implantationPaidAt={lead.implantation_paid_at}
      />
    </div>
  );
}
