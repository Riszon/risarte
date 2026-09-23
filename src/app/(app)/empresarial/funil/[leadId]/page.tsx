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
import {
  faltaParaContrato,
  faltaParaProposta,
  type BillingBasis,
  type InterestLevel,
} from "@/lib/empresarial/proposta";
import { LEAD_STAGE_LABELS } from "@/lib/empresarial/constants";
import {
  etapaInicial,
  situacaoDasEtapas,
} from "@/lib/empresarial/etapas-do-funil";
import { AbasDaFicha, type AbaDaFicha } from "./abas-da-ficha";
import type { CompanyCategory } from "@/lib/empresarial/documents";
import { FichaDoLead, type QualificacaoView } from "./ficha-lead";
import type {
  ImplementationStep,
  PassoRegistrado,
} from "@/lib/empresarial/implantacao";
import { ApresentacaoEditor } from "./apresentacao-editor";
import { EnvioESelos, type EnvioView } from "./envio-e-selos";
import { FechamentoEImplantacao } from "./fechamento-e-implantacao";

// A tela deixou de ser só o levantamento quando virou abas (OC-00083).
export const metadata: Metadata = { title: "Empresa no funil · Risarte Empresarial" };

type LeadRow = {
  id: string;
  company_name: string;
  cnpj: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  stage: LeadStage;
  consultant_id: string | null;
  company_id: string | null;
  contract_signed_at: string | null;
  implantation_paid_at: string | null;
};

type ReviewRow = {
  confirmed_at: string;
  confirmed_by: string | null;
  everything_ok: boolean;
  considerations: string | null;
  special_agreements: string | null;
};

type StepRow = {
  step: ImplementationStep;
  done_at: string | null;
  done_by: string | null;
  not_applicable: boolean;
  note: string | null;
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
      "id, company_name, cnpj, contact_name, contact_phone, stage, consultant_id, company_id, contract_signed_at, implantation_paid_at"
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

  // C3: a conferência do fechamento e os passos da implantação.
  const [{ data: review }, { data: stepRows }] = await Promise.all([
    db
      .from("lead_closing_reviews")
      .select(
        "confirmed_at, confirmed_by, everything_ok, considerations, special_agreements"
      )
      .eq("lead_id", leadId)
      .maybeSingle<ReviewRow>(),
    db
      .from("lead_implementation_steps")
      .select("step, done_at, done_by, not_applicable, note")
      .eq("lead_id", leadId)
      .returns<StepRow[]>(),
  ]);

  const daEmpresa = templates?.find((t) => t.lead_id === leadId);
  const daRede = templates?.find((t) => !t.lead_id);
  const template = daEmpresa ?? daRede;

  // Nomes de quem enviou e do consultor responsável.
  const userIds = [
    ...new Set(
      [
        lead.consultant_id,
        review?.confirmed_by ?? null,
        ...(dispatches ?? []).map((d) => d.sent_by),
        ...(stepRows ?? []).map((s) => s.done_by),
      ].filter((x): x is string => Boolean(x))
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

  // A SITUAÇÃO DE CADA ABA, pelas réguas que já existem (OC-00083).
  const dadosDaProposta = {
    employeeCount: view.employeeCount,
    paymentModel: view.paymentModel,
    billingBasis: view.billingBasis,
    legalName: view.legalName,
    responsibleName: view.responsibleName,
    responsibleCpf: view.responsibleCpf,
    responsibleEmail: view.responsibleEmail,
    cnpj: lead.cnpj,
  };
  const passos = stepRows ?? [];
  const situacao = situacaoDasEtapas({
    // "Ainda não começou" é uma resposta diferente de "falta um campo", e a
    // aba precisa das duas: a linha vazia vem com os padrões da rede
    // preenchidos e pareceria quase pronta.
    temLevantamento: view.temLevantamento,
    faltaProposta: faltaParaProposta(dadosDaProposta),
    faltaContrato: faltaParaContrato(dadosDaProposta),
    apresentacaoPersonalizada: Boolean(daEmpresa),
    envios: envios.length,
    propostaEnviada: envios.some((e) => e.items.includes("PROPOSAL")),
    contratoAssinadoEm: lead.contract_signed_at,
    implantacaoPagaEm: lead.implantation_paid_at,
    conferido: Boolean(review),
    passosFeitos: passos.filter((s) => s.done_at || s.not_applicable).length,
    passosTotal: passos.length,
  });
  const aberta = etapaInicial(lead.stage);

  const abas: AbaDaFicha[] = [
    {
      id: "levantamento",
      situacao: situacao.levantamento,
      agora: aberta === "levantamento",
      painel: (
        <FichaDoLead leadId={lead.id} cnpj={lead.cnpj} qualificacao={view} />
      ),
    },
    {
      id: "apresentacao",
      situacao: situacao.apresentacao,
      agora: aberta === "apresentacao",
      painel: template ? (
        <ApresentacaoEditor
          leadId={lead.id}
          title={template.title}
          subtitle={template.subtitle}
          blocos={template.sections}
          personalizada={Boolean(daEmpresa)}
        />
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Ainda não há modelo de apresentação cadastrado para a rede. Peça ao
          Admin Master para criar um em Risarte Empresarial → Configurações.
        </p>
      ),
    },
    {
      id: "envio",
      situacao: situacao.envio,
      agora: aberta === "envio",
      painel: (
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
      ),
    },
    {
      id: "fechamento",
      situacao: situacao.fechamento,
      agora: aberta === "fechamento",
      painel: (
        <FechamentoEImplantacao
          leadId={lead.id}
          stage={lead.stage}
          companyId={lead.company_id}
          conferencia={
            review
              ? {
                  confirmedAt: review.confirmed_at,
                  confirmedByName: review.confirmed_by
                    ? nomePorId.get(review.confirmed_by) ?? null
                    : null,
                  everythingOk: review.everything_ok,
                  considerations: review.considerations,
                  specialAgreements: review.special_agreements,
                }
              : null
          }
          passos={passos.map(
            (s): PassoRegistrado => ({
              step: s.step,
              doneAt: s.done_at,
              notApplicable: s.not_applicable,
              note: s.note,
              doneByName: s.done_by ? nomePorId.get(s.done_by) ?? null : null,
            })
          )}
        />
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <CabecalhoDeModulo
        /* A FASE DE VERDADE, das nove que existem. Estava escrito "fase 4" na
           mão, e uma empresa em Captação mostrava o mesmo que uma em
           Implantação (OC-00083). */
        chapeu={`Funil comercial · ${LEAD_STAGE_LABELS[lead.stage]}`}
        icone={ClipboardList}
        titulo={lead.company_name}
        descricao="Cada etapa na sua aba. A ficha abre na etapa em que a empresa está; as outras continuam a um clique."
        voltar={{ href: "/empresarial/funil", rotulo: "Funil" }}
      />

      {/* As abas montam os QUATRO formulários de uma vez e escondem os
          inativos — aninhar <form> dentro de <form> não funciona, e
          desmontar apagaria o que ainda não foi salvo. */}
      <AbasDaFicha abas={abas} inicial={aberta} />
    </div>
  );
}
