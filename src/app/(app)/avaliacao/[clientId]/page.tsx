import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Stethoscope } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RisarteMark } from "@/components/risarte-logo";
import { Badge } from "@/components/ui/badge";
import { PhaseBadge } from "@/components/phase-badge";
import { Button } from "@/components/ui/button";
import {
  PHASE_COLORS,
  PILLAR_LABELS,
  STATUS_LABELS,
  allowedNextPhases,
  type JourneyPhase,
  type JourneyStatus,
  type MethodologyPillar,
} from "@/lib/journey";
import type { UserRole } from "@/lib/roles";
import { loadClientProgram } from "@/lib/empresarial/benefits";
import type { ReactNode } from "react";
import { type EvaluationFlowKind } from "@/lib/evaluation-steps";
import { ClinicalSection } from "../../prontuarios/[id]/clinical-section";
import { AnamnesisFill } from "../../prontuarios/[id]/anamnesis-fill";
import { loadEvaluationWorkspace } from "../../prontuarios/[id]/evaluation-loader";
import { loadAnamnesisWorkspace } from "../../prontuarios/[id]/anamnesis-loader";
import { loadClientPlans } from "../../prontuarios/[id]/plan-loader";
import { PlanEditorSwitcher } from "../../prontuarios/[id]/plan-editor-switcher";
import { StepGuide } from "./step-guide";
import {
  AudioBlock,
  ConsentGate,
  ConsiderationsBlock,
  MediaCollectionBlock,
  RoundsBlock,
  SendToPlanningBlock,
} from "./clinical-tools";

export const metadata: Metadata = { title: "Cockpit de Avaliação" };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export default async function EvaluationCockpitPage(
  props: PageProps<"/avaliacao/[clientId]">
) {
  const session = await getSessionContext();
  const { clientId } = await props.params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, full_name, code, status, gender, clinic_id, journey_phase, journey_status, methodology_pillar, empresarial_company_id, empresarial_active, clinic:clinics!clients_clinic_id_fkey ( name )"
    )
    .eq("id", clientId)
    .single();
  if (!client) notFound();

  // -- Resolve a unidade onde o Coordenador atua (origem ou compartilhada). ----
  const { data: shares } = await supabase
    .from("client_shares")
    .select("clinic_id")
    .eq("client_id", clientId)
    .is("ended_at", null);
  const sharedIds = (shares ?? []).map((s) => s.clinic_id as string);
  const candidates = [client.clinic_id as string, ...sharedIds];
  const canActIn = (cid: string) =>
    session.isAdminMaster ||
    hasRoleInClinic(session, cid, ["clinical_coordinator"]);
  const active = session.activeClinic?.id ?? null;
  let actClinicId: string | null = null;
  if (active && candidates.includes(active) && canActIn(active)) {
    actClinicId = active;
  } else if (canActIn(client.clinic_id as string)) {
    actClinicId = client.clinic_id as string;
  } else {
    for (const cid of sharedIds) {
      if (canActIn(cid)) {
        actClinicId = cid;
        break;
      }
    }
  }
  // Só o Coordenador (ou Admin) usa este cockpit; os demais voltam à ficha.
  if (!actClinicId) redirect(`/prontuarios/${clientId}`);
  const clinicId = actClinicId;

  const phase = client.journey_phase as JourneyPhase;
  // Fase 2 = Avaliação; Fase 6 = Reavaliação; nas demais, sem roteiro guiado.
  const flowKind: EvaluationFlowKind | null =
    phase === "clinical_conversion"
      ? "avaliacao"
      : phase === "reevaluation"
        ? "reavaliacao"
        : null;
  const clinicRaw = (
    client as unknown as { clinic?: { name: string } | { name: string }[] | null }
  ).clinic;
  const clinicName =
    (Array.isArray(clinicRaw) ? clinicRaw[0] : clinicRaw)?.name ?? null;

  // -- Espaço de avaliação (consent, considerações, mídias, rodadas) + planos --
  const [{ consent, notes, media, evaluations }, plans] = await Promise.all([
    loadEvaluationWorkspace(clientId),
    loadClientPlans(clientId),
  ]);

  // Orientação da rede (editável pelo Admin) sobre este momento do fluxo.
  let guidance: string | null = null;
  if (flowKind) {
    const { data: g } = await supabase
      .from("clinical_guidance")
      .select("content")
      .eq("kind", flowKind)
      .maybeSingle();
    guidance = (g?.content as string | null) ?? null;
  }

  // Anamnese embutida no passo 2 (só nas Fases 2/6).
  const anamnesis = flowKind
    ? await loadAnamnesisWorkspace(clientId, clinicId)
    : { templates: [], fills: [] };

  // -- Envio ao Centro de Planejamento (mesma regra da ficha). ----------------
  const clinicRoles = (session.rolesByClinic[client.clinic_id as string] ??
    []) as UserRole[];
  const isPlannerAnywhere = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  const canSendToPlanning = allowedNextPhases(phase, {
    isAdminMaster: session.isAdminMaster,
    clinicRoles,
    isPlannerAnywhere,
  }).includes("planning_center");

  // Anamnese: bloqueia o envio se estiver ausente (ou desatualizada na reaval.).
  const { data: fillRows } = await supabase
    .from("anamnesis_fills")
    .select("filled_at")
    .eq("client_id", clientId)
    .order("filled_at", { ascending: false });
  const fills = fillRows ?? [];
  const anamnesisMissing = fills.length === 0;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  const latestAt = fills.length > 0 ? new Date(fills[0].filled_at).getTime() : 0;
  const anamnesisOutdated = fills.length > 0 && latestAt < cutoff.getTime();
  const isReeval = phase === "reevaluation";
  const anamnesisBlocksPlanning =
    anamnesisMissing || (isReeval && anamnesisOutdated);
  const anamnesisBlockMessage = anamnesisMissing
    ? "Preencha a anamnese do cliente antes de enviar ao Centro de Planejamento."
    : "A anamnese tem mais de 12 meses. Atualize-a antes de enviar ao planejamento.";

  // -- Situação do ciclo de vida do plano (Fase 2). ---------------------------
  const lifecycleCaps = {
    presentation: isPlannerAnywhere || session.isAdminMaster,
    commercial:
      session.isAdminMaster ||
      hasRoleInClinic(session, client.clinic_id, ["commercial_consultant"]),
    treatment:
      session.isAdminMaster ||
      hasRoleInClinic(session, client.clinic_id, [
        "dentist",
        "clinical_coordinator",
        "receptionist",
        "unit_manager",
      ]),
  };

  const isProgramMember =
    Boolean(client.empresarial_company_id) &&
    client.empresarial_active !== false;
  const program = isProgramMember ? await loadClientProgram(client.id) : null;
  const pillar = client.methodology_pillar as MethodologyPillar | null;

  // Ferramentas embutidas em cada passo do roteiro (Fases 2/6): cada momento da
  // consulta traz a ferramenta certa — considerações, coleta de mídia, gravação
  // e envio ao planejamento. Os demais passos são só orientação.
  const evalById = new Map(evaluations.map((e) => [e.id, e]));
  const hasConsent = Boolean(consent);
  const toolsByStep: Record<number, ReactNode> = flowKind
    ? {
        2: (
          <div className="space-y-4">
            <AnamnesisFill
              clientId={client.id}
              canEdit
              hasConsent={hasConsent}
              templates={anamnesis.templates}
              fills={anamnesis.fills}
              clientGender={client.gender as string | null}
            />
            <ConsiderationsBlock
              clientId={client.id}
              notes={notes}
              canEdit
              evalById={evalById}
            />
          </div>
        ),
        3: (
          <MediaCollectionBlock
            clientId={client.id}
            clinicId={clinicId}
            media={media}
            canEdit
            hasConsent={hasConsent}
          />
        ),
        8: (
          <SendToPlanningBlock
            clientId={client.id}
            clientName={client.full_name}
            canSend={canSendToPlanning}
            blocked={anamnesisBlocksPlanning}
            blockMessage={anamnesisBlockMessage}
          />
        ),
      }
    : {};

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 lg:flex lg:h-[100dvh] lg:flex-col lg:gap-4 lg:space-y-0 lg:overflow-hidden">
      {/* Cartão de identidade — faixa fina na cor da Fase. */}
      <div className="relative shrink-0 overflow-hidden rounded-xl border bg-card">
        <div
          className="h-1 w-full"
          style={{ backgroundColor: PHASE_COLORS[phase] }}
          aria-hidden
        />
        <RisarteMark className="pointer-events-none absolute top-2 -right-4 h-24 text-gold/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-4 sm:p-5">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-gold"
              aria-hidden
            >
              {initialsOf(client.full_name)}
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Stethoscope className="size-3.5" />
                Cockpit de Avaliação (Coordenador Clínico)
              </p>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {client.full_name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {client.code && (
                  <span className="rounded-md bg-gold/15 px-2 py-0.5 font-mono text-xs font-medium text-gold-foreground">
                    {client.code}
                  </span>
                )}
                {clinicName && (
                  <span className="text-xs text-muted-foreground">
                    {clinicName}
                  </span>
                )}
                <PhaseBadge phase={phase} showNumber />
                {client.journey_status && (
                  <Badge variant="outline" className="border-primary text-primary">
                    {STATUS_LABELS[client.journey_status as JourneyStatus]}
                  </Badge>
                )}
                <Badge className="bg-gold text-gold-foreground">
                  {pillar ? PILLAR_LABELS[pillar] : "Pilar a definir"}
                </Badge>
                {isProgramMember && (
                  <Badge className="bg-gold/20 text-gold-foreground">
                    ★ Risarte Empresarial
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/prontuarios/${clientId}`} />}
            >
              ← Ficha completa
            </Button>
          </div>
        </div>
      </div>

      {/* Duas colunas com rolagem INDEPENDENTE (cada uma rola por dentro). */}
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
        <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          {flowKind ? (
            <>
              {/* 1º) Consentimento (LGPD) — pré-requisito de tudo. */}
              <ConsentGate clientId={client.id} consent={consent} canEdit />
              {/* 2º) Gravação da consulta — a primeira coisa a fazer ao iniciar. */}
              <div className="rounded-xl border border-gold/40 bg-gold/5 p-3">
                <p className="mb-2 text-sm font-semibold">
                  Gravação da consulta — inicie antes de começar
                </p>
                <AudioBlock
                  clientId={client.id}
                  clinicId={clinicId}
                  hasConsent={hasConsent}
                />
              </div>
              {flowKind === "reavaliacao" && (
                <RoundsBlock
                  clientId={client.id}
                  evaluations={evaluations}
                  canEdit
                />
              )}
              {/* Roteiro do fluxo com as ferramentas embutidas em cada passo. */}
              <StepGuide
                kind={flowKind}
                guidance={guidance}
                toolsByStep={toolsByStep}
              />
            </>
          ) : (
            <ClinicalSection
              clientId={client.id}
              clientName={client.full_name}
              clinicId={clinicId}
              canEdit
              consent={consent}
              notes={notes}
              media={media}
              evaluations={evaluations}
              canSendToPlanning={canSendToPlanning}
              anamnesisBlocksPlanning={anamnesisBlocksPlanning}
              anamnesisBlockMessage={anamnesisBlockMessage}
            />
          )}
        </div>
        <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <PlanEditorSwitcher
            clientId={client.id}
            clientName={client.full_name}
            plans={plans}
            canEdit={false}
            canReview
            inPlanningPhase={phase === "planning_center"}
            catalog={[]}
            protocols={{}}
            realStats={{}}
            currentPillar={pillar}
            lifecycleCaps={lifecycleCaps}
            programActive={program?.active ?? false}
            programCompanyName={program?.companyName ?? null}
            programBenefits={program?.byProcedure ?? {}}
          />
        </div>
      </div>
    </div>
  );
}
