import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlarmClock,
  ClipboardList,
  FileImage,
  Link2,
  MessageSquareText,
  TriangleAlert,
} from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PresentationCountdown } from "@/components/presentation-countdown";
import { RisarteMark } from "@/components/risarte-logo";
import { Badge } from "@/components/ui/badge";
import { PhaseBadge } from "@/components/phase-badge";
import { Button } from "@/components/ui/button";
import { PopupCard } from "@/components/popup-card";
import {
  CLINICAL_BUCKET,
  type ClinicalMediaItem,
  type ClinicalMediaKind,
} from "@/lib/clinical";
import {
  PHASE_COLORS,
  PILLAR_LABELS,
  STATUS_LABELS,
  displayedPillar,
  type JourneyPhase,
  type JourneyStatus,
  type MethodologyPillar,
} from "@/lib/journey";
import {
  resolveProcedurePrices,
  type PricedProcedure,
  type Procedure,
  type ProtocolRef,
  type RealStat,
  type UnitPrice,
} from "@/lib/pricing";
import {
  evaluateAlerts,
  formatAnswer,
  mapAnswer,
  type AnamnesisAnswerRow,
  type FilledAnswer,
} from "@/lib/anamnesis";
import { loadClientProgram } from "@/lib/empresarial/benefits";
import { getUnitSchedulingData } from "../../agenda/actions";
import { MediaGallery } from "../../prontuarios/[id]/media-gallery";
import { PlanEditorSwitcher } from "../../prontuarios/[id]/plan-editor-switcher";
import { projectOptionSessions } from "../../prontuarios/[id]/planning-actions";
import { loadClientPlans } from "../../prontuarios/[id]/plan-loader";
import { TreatmentSummary } from "./treatment-summary";
import { SessionJoinPlanner } from "./session-join-planner";

export const metadata: Metadata = { title: "Cockpit de Planejamento" };

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Contador pequeno mostrado no cabeçalho de um bloco recolhível. */
function CountChip({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
      {n}
    </span>
  );
}

/** Iniciais do cliente para o avatar do cartão de identidade. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export default async function PlanningCockpitPage(
  props: PageProps<"/planejamento/[clientId]">
) {
  const session = await getSessionContext();
  const isPlanner =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((roles) =>
      roles.includes("planner_dentist")
    );
  if (!isPlanner) redirect("/");

  const { clientId } = await props.params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, full_name, code, status, clinic_id, journey_phase, journey_status, methodology_pillar, phase_entered_at, empresarial_company_id, empresarial_active, clinic:clinics!clients_clinic_id_fkey ( name )"
    )
    .eq("id", clientId)
    .single();
  if (!client) notFound();

  // -- Evidências do cliente: consentimento, considerações e mídias --
  const [{ data: consentRows }, { data: noteRows }, { data: mediaRows }] =
    await Promise.all([
      supabase
        .from("client_consents")
        .select("granted_at, recorded_by")
        .eq("client_id", clientId)
        .is("revoked_at", null)
        .order("granted_at", { ascending: false })
        .limit(1),
      supabase
        .from("clinical_notes")
        .select(
          "id, body, created_at, created_by, updated_at, updated_by, clinic:clinics ( name )"
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("clinical_media")
        .select(
          "id, kind, original_name, display_name, note, storage_path, external_url, content_type, size_bytes, created_at, uploaded_by"
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
    ]);

  // H3.11: informações complementares do Coordenador — mostra e marca como
  // vistas (limpa o ícone da fila) ao abrir o cockpit.
  const { data: supRows } = await supabase
    .from("planning_supplements")
    .select(
      "id, body, created_at, author:profiles!planning_supplements_created_by_fkey ( full_name )"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        body: string;
        created_at: string;
        author: { full_name: string } | { full_name: string }[] | null;
      }[]
    >();
  const supplements = (supRows ?? []).map((s) => {
    const a = Array.isArray(s.author) ? s.author[0] : s.author;
    return {
      id: s.id,
      body: s.body,
      createdAt: s.created_at,
      authorName: a?.full_name ?? null,
    };
  });
  if (supplements.length > 0) {
    await supabase.rpc("mark_planning_supplements_seen", {
      p_client_id: clientId,
    });
  }

  // H3.13: anamnese do cliente (leitura) — última versão preenchida.
  let anamnesisAnswers: FilledAnswer[] = [];
  let anamnesisAlerts: { label: string; message: string }[] = [];
  let anamnesisInfo: { filledAt: string; templateName: string | null } | null =
    null;
  // Sem filtro por clínica: mostra a anamnese mais recente do cliente mesmo que
  // tenha sido preenchida na unidade anterior (RLS libera via histórico/Planner).
  const { data: latestFill } = await supabase
    .from("anamnesis_fills")
    .select("id, template_name, filled_at")
    .eq("client_id", clientId)
    .order("filled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestFill) {
    const { data: ansRows } = await supabase
      .from("anamnesis_answers")
      .select(
        "id, question_id, section, label, kind, value, detail, is_adhoc, sort_order, alert_when, alert_message"
      )
      .eq("fill_id", latestFill.id)
      .order("sort_order")
      .returns<AnamnesisAnswerRow[]>();
    anamnesisAnswers = (ansRows ?? []).map(mapAnswer);
    anamnesisAlerts = evaluateAlerts(anamnesisAnswers);
    anamnesisInfo = {
      filledAt: latestFill.filled_at as string,
      templateName: (latestFill.template_name as string | null) ?? null,
    };
  }

  const peopleIds = [
    ...new Set(
      [
        consentRows?.[0]?.recorded_by,
        ...(noteRows ?? []).map((n) => n.created_by),
        ...(mediaRows ?? []).map((m) => m.uploaded_by),
      ].filter((x): x is string => Boolean(x))
    ),
  ];
  const nameById = new Map<string, string>();
  if (peopleIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", peopleIds);
    for (const p of people ?? []) nameById.set(p.id, p.full_name);
  }

  const consent = consentRows?.[0]
    ? {
        grantedAt: consentRows[0].granted_at as string,
        recordedByName: consentRows[0].recorded_by
          ? (nameById.get(consentRows[0].recorded_by) ?? null)
          : null,
      }
    : null;

  const notes = (noteRows ?? []).map((n) => {
    const cRaw = (
      n as { clinic?: { name: string } | { name: string }[] | null }
    ).clinic;
    return {
      id: n.id as string,
      body: n.body as string,
      createdAt: n.created_at as string,
      authorName: n.created_by ? (nameById.get(n.created_by) ?? null) : null,
      clinicName: (Array.isArray(cRaw) ? cRaw[0] : cRaw)?.name ?? null,
    };
  });

  const media: ClinicalMediaItem[] = await Promise.all(
    (mediaRows ?? []).map(async (m) => {
      let url: string | null = null;
      if (m.storage_path) {
        const { data: signed } = await supabase.storage
          .from(CLINICAL_BUCKET)
          .createSignedUrl(m.storage_path, 3600);
        url = signed?.signedUrl ?? null;
      }
      return {
        id: m.id,
        kind: m.kind as ClinicalMediaKind,
        originalName: m.original_name,
        displayName:
          (m as { display_name?: string | null }).display_name ?? null,
        note: (m as { note?: string | null }).note ?? null,
        url,
        externalUrl: m.external_url ?? null,
        contentType: m.content_type ?? null,
        createdAt: m.created_at,
        uploaderName: m.uploaded_by
          ? (nameById.get(m.uploaded_by) ?? null)
          : null,
        sizeBytes: m.size_bytes,
      };
    })
  );

  // -- Planos de tratamento (editor) --
  // Carrega TODOS os planos do cliente (nenhum é escondido). O cockpit trabalha
  // no plano "ativo" (o editável mais recente; senão o mais novo).
  const plans = await loadClientPlans(clientId);
  const treatmentPlan =
    plans.find((p) => p.status === "draft" || p.status === "returned") ??
    plans[0] ??
    null;

  // AJ3: próxima apresentação comercial futura — alimenta o cronômetro no topo.
  const { data: presRows } = await supabase
    .from("appointments")
    .select("starts_at")
    .eq("client_id", clientId)
    .eq("type", "commercial_presentation")
    .in("status", ["scheduled", "confirmed"])
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(1)
    .returns<{ starts_at: string }[]>();
  const presentationAt = presRows?.[0]?.starts_at ?? null;

  // -- COM1: procedimentos NÃO aprovados pelo cliente em negociações passadas
  // (aprovação parcial) — alerta para o Planner decidir se inclui no novo plano.
  const { data: pastNegRows } = await supabase
    .from("plan_negotiations")
    .select(
      "id, status, is_partial, partial_reason, updated_at, plan_negotiation_items ( included, item:treatment_plan_option_items ( description ) )"
    )
    .eq("client_id", clientId)
    .eq("status", "aceita")
    .eq("is_partial", true)
    .order("updated_at", { ascending: false })
    .returns<
      {
        id: string;
        status: string;
        is_partial: boolean;
        partial_reason: string | null;
        updated_at: string;
        plan_negotiation_items: {
          included: boolean;
          item: { description: string } | { description: string }[] | null;
        }[];
      }[]
    >();
  const rejectedPastItems: { description: string; when: string; reason: string | null }[] =
    [];
  for (const neg of pastNegRows ?? []) {
    for (const it of neg.plan_negotiation_items ?? []) {
      if (it.included) continue;
      const item = Array.isArray(it.item) ? it.item[0] : it.item;
      if (item?.description) {
        rejectedPastItems.push({
          description: item.description,
          when: neg.updated_at,
          reason: neg.partial_reason,
        });
      }
    }
  }

  // -- Protocolos (Rede + unidade do cliente) — base de sessões/tempo (E3) --
  const protocolByProcedure: Record<string, ProtocolRef> = {};
  {
    const { data: protoRows } = await supabase
      .from("procedure_sessions")
      .select("procedure_id, clinic_id, estimated_minutes")
      .or(`clinic_id.is.null,clinic_id.eq.${client.clinic_id}`)
      .returns<
        {
          procedure_id: string;
          clinic_id: string | null;
          estimated_minutes: number;
        }[]
      >();
    const proto = new Map<
      string,
      { net: { count: number; minutes: number }; unit: { count: number; minutes: number } }
    >();
    for (const r of protoRows ?? []) {
      const e =
        proto.get(r.procedure_id) ??
        { net: { count: 0, minutes: 0 }, unit: { count: 0, minutes: 0 } };
      if (r.clinic_id === null) {
        e.net.count += 1;
        e.net.minutes += r.estimated_minutes;
      } else {
        e.unit.count += 1;
        e.unit.minutes += r.estimated_minutes;
      }
      proto.set(r.procedure_id, e);
    }
    for (const [pid, e] of proto) {
      protocolByProcedure[pid] = {
        network: e.net.count > 0 ? e.net : null,
        unit: e.unit.count > 0 ? e.unit : null,
      };
    }
  }

  // -- Médias REALIZADAS por procedimento na unidade do cliente (E5) --
  const realStatsByProcedure: Record<string, RealStat> = {};
  {
    const { data: statRows } = await supabase.rpc("procedure_real_stats", {
      p_clinic_id: client.clinic_id,
      p_procedure_ids: null,
    });
    for (const r of (statRows ?? []) as {
      procedure_id: string;
      avg_sessions: number;
      avg_total_minutes: number;
      sample: number;
    }[]) {
      realStatsByProcedure[r.procedure_id] = {
        avgSessions: Number(r.avg_sessions),
        avgTotalMinutes: Number(r.avg_total_minutes),
        sample: Number(r.sample),
      };
    }
  }

  // -- Catálogo de preços (preço efetivo da unidade do cliente) --
  const [{ data: procRows }, { data: priceRows }] = await Promise.all([
    supabase
      .from("procedures")
      .select(
        "id, code, tuss_code, name, specialty, default_price_cents, min_price_cents, max_price_cents, commission_percent, commission_fixed_cents, pillar, estimated_minutes, is_active"
      )
      .eq("is_active", true)
      .order("specialty", { nullsFirst: true })
      .order("name")
      .returns<
        {
          id: string;
          code: string | null;
          tuss_code: string | null;
          name: string;
          specialty: string | null;
          default_price_cents: number;
          min_price_cents: number | null;
          max_price_cents: number | null;
          commission_percent: number;
          commission_fixed_cents: number;
          pillar: MethodologyPillar | null;
          estimated_minutes: number | null;
          is_active: boolean;
        }[]
      >(),
    supabase
      .from("clinic_procedure_prices")
      .select("procedure_id, price_cents")
      .eq("clinic_id", client.clinic_id)
      .returns<{ procedure_id: string; price_cents: number }[]>(),
  ]);
  const procedures: Procedure[] = (procRows ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    tussCode: p.tuss_code,
    name: p.name,
    specialty: p.specialty,
    defaultPriceCents: p.default_price_cents,
    minPriceCents: p.min_price_cents,
    maxPriceCents: p.max_price_cents,
    commissionPercent: p.commission_percent,
    commissionFixedCents: p.commission_fixed_cents,
    pillar: p.pillar,
    estimatedMinutes: p.estimated_minutes,
    isActive: p.is_active,
  }));
  const overrides: UnitPrice[] = (priceRows ?? []).map((r) => ({
    procedureId: r.procedure_id,
    priceCents: r.price_cents,
  }));
  const catalog: PricedProcedure[] = resolveProcedurePrices(
    procedures,
    overrides
  );

  const clinicRaw = (
    client as unknown as { clinic?: { name: string } | { name: string }[] | null }
  ).clinic;
  const clinicName =
    (Array.isArray(clinicRaw) ? clinicRaw[0] : clinicRaw)?.name ?? null;
  const phase = client.journey_phase as JourneyPhase;
  const shownPillar = displayedPillar(
    phase,
    client.methodology_pillar as MethodologyPillar | null
  );
  // H4.5 Lote 2: projeção do tratamento — opção principal (ou a 1ª).
  const summaryOption =
    treatmentPlan && treatmentPlan.options.length > 0
      ? (treatmentPlan.options.find((o) => o.isPrimary) ??
        treatmentPlan.options[0])
      : null;

  // Fase 2 — quem pode mover a situação do plano (aqui é o Planner, mas o
  // usuário pode acumular papéis na unidade).
  const lifecycleCaps = {
    presentation: true,
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

  // H4.5 Pedido 1: dentistas da unidade do cliente (o Planner indica por item).
  const scheduling = await getUnitSchedulingData(client.clinic_id);
  const providerOptions = scheduling.staff
    .filter((s) => s.roles.includes("dentist"))
    .map((s) => ({ id: s.userId, name: s.name }));

  // H4.5 Pedido 2: sessões projetadas da opção principal, para o Planner agrupar
  // em atendimentos (juntar sessões já no planejamento).
  const projectedSessions =
    summaryOption && summaryOption.items.length > 0
      ? await projectOptionSessions(summaryOption.id)
      : [];

  // Risarte Empresarial: mostrar ao Planner o selo do programa + economia por
  // opção também no cockpit (igual à ficha).
  const isProgramMember =
    Boolean(client.empresarial_company_id) &&
    client.empresarial_active !== false;
  const program = isProgramMember ? await loadClientProgram(client.id) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      {/* Cartão de identidade — faixa fina na cor da Fase, igual ao resto do app. */}
      <div className="relative overflow-hidden rounded-xl border bg-card">
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
              <p className="text-xs text-muted-foreground">
                Cockpit de Planejamento
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
                  <Badge
                    variant="outline"
                    className="border-primary text-primary"
                  >
                    {STATUS_LABELS[client.journey_status as JourneyStatus]}
                  </Badge>
                )}
                <Badge className="bg-gold text-gold-foreground">
                  {shownPillar ? PILLAR_LABELS[shownPillar] : "Pilar a definir"}
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
              render={<Link href="/planejamento" />}
            >
              ← Voltar à fila
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/prontuarios/${client.id}`} />}
            >
              Ver ficha completa
            </Button>
            {treatmentPlan?.status === "approved" && (
              <Button
                size="sm"
                nativeButton={false}
                render={<Link href={`/apresentacao/${client.id}`} />}
              >
                Apresentação
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* AJ3: apresentação marcada mas plano ainda não pronto — destaque +
          cronômetro para pressionar o Centro de Planejamento. */}
      {presentationAt && treatmentPlan?.status !== "approved" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
            <AlarmClock className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-800">
              Apresentação comercial marcada — plano ainda não está pronto
            </p>
            <p className="text-xs text-red-700/90">
              {new Date(presentationAt).toLocaleString("pt-BR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <PresentationCountdown startsAt={presentationAt} alarm />
        </div>
      )}

      {/* COM1: procedimentos não aprovados pelo cliente em negociação passada —
          o Planner decide se inclui (ou não) no novo plano. */}
      {rejectedPastItems.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <TriangleAlert className="size-4" />
            Procedimentos NÃO aprovados pelo cliente em negociação anterior
          </p>
          <p className="mb-1.5 text-xs text-amber-800/90">
            O cliente fechou parcialmente um plano passado. Avalie se estes
            procedimentos entram no novo planejamento:
          </p>
          <ul className="space-y-0.5 text-sm text-amber-900">
            {rejectedPastItems.map((it, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">• {it.description}</span>
                <span className="text-xs text-amber-800/80">
                  ({new Date(it.when).toLocaleDateString("pt-BR")}
                  {it.reason ? ` — motivo: ${it.reason}` : ""})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Barra de apoio: cada material do caso vira um botão que abre um pop-up.
          Libera a tela e deixa o editor de plano como área principal. */}
      <div className="flex flex-wrap gap-2">
        {summaryOption && (
          <PopupCard
            label="Resumo do tratamento"
            icon={<ClipboardList className="size-4" />}
            wide
          >
            <TreatmentSummary options={treatmentPlan?.options ?? []} />
          </PopupCard>
        )}
        {projectedSessions.length > 0 && summaryOption && (
          <PopupCard
            label="Atendimentos e sequência"
            icon={<Link2 className="size-4" />}
            wide
          >
            <SessionJoinPlanner
              sessions={projectedSessions}
              optionId={summaryOption.id}
              providerOptions={providerOptions}
              items={summaryOption.items}
              canEdit
            />
          </PopupCard>
        )}
        <PopupCard
          label="Evidências"
          icon={<FileImage className="size-4" />}
          badge={<CountChip n={media.length} />}
          dialogTitle="Evidências do cliente"
          wide
        >
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {consent
                ? `Consentimento registrado em ${fmtDateTime(consent.grantedAt)}${
                    consent.recordedByName ? ` por ${consent.recordedByName}` : ""
                  }.`
                : "Sem consentimento registrado."}
            </p>
            {media.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum arquivo enviado.
              </p>
            ) : (
              <MediaGallery media={media} canEdit={false} />
            )}
          </div>
        </PopupCard>
        <PopupCard
          label="Anamnese"
          icon={<ClipboardList className="size-4" />}
          badge={
            anamnesisAlerts.length > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/5 px-1.5 py-0.5 text-xs font-medium text-destructive">
                <TriangleAlert className="size-3" />
                {anamnesisAlerts.length}
              </span>
            ) : undefined
          }
        >
          {anamnesisInfo == null ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma anamnese preenchida.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {anamnesisInfo.templateName ?? "Ficha"} · atualizada em{" "}
                {fmtDateTime(anamnesisInfo.filledAt)}
              </p>
              {anamnesisAlerts.length > 0 && (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  {anamnesisAlerts.map((a, i) => (
                    <p key={i} className="flex items-start gap-1.5">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      <span className="font-medium">{a.message}</span>
                    </p>
                  ))}
                </div>
              )}
              <ul className="space-y-1 text-sm">
                {anamnesisAnswers.map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-2">
                    <span className="text-muted-foreground">{a.label}:</span>
                    <span className="font-medium">
                      {formatAnswer(a.value, a.kind)}
                      {a.detail ? ` — ${a.detail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </PopupCard>
        <PopupCard
          label="Considerações"
          icon={<MessageSquareText className="size-4" />}
          badge={notes.length > 0 ? <CountChip n={notes.length} /> : undefined}
          dialogTitle="Considerações clínicas"
        >
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma consideração registrada pelo Coordenador.
            </p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-md border p-2 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {fmtDateTime(n.createdAt)}
                    {n.authorName ? ` · ${n.authorName}` : ""}
                    {n.clinicName ? ` · ${n.clinicName}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PopupCard>
        {supplements.length > 0 && (
          <PopupCard
            label="Do Coordenador"
            icon={<MessageSquareText className="size-4" />}
            badge={<CountChip n={supplements.length} />}
            dialogTitle="Informações complementares do Coordenador"
          >
            <ul className="space-y-2">
              {supplements.map((s) => (
                <li
                  key={s.id}
                  className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm"
                >
                  <p className="whitespace-pre-wrap">{s.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {fmtDateTime(s.createdAt)}
                    {s.authorName ? ` · ${s.authorName}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </PopupCard>
        )}
      </div>

      {/* Editor do plano — a área principal do cockpit, em largura total. */}
      <PlanEditorSwitcher
        clientId={client.id}
        clientName={client.full_name}
        plans={plans}
        canEdit
        canReview={false}
        inPlanningPhase={phase === "planning_center"}
        catalog={catalog}
        protocols={protocolByProcedure}
        realStats={realStatsByProcedure}
        currentPillar={client.methodology_pillar as MethodologyPillar | null}
        providerOptions={providerOptions}
        programActive={program?.active ?? false}
        programCompanyName={program?.companyName ?? null}
        programBenefits={program?.byProcedure ?? {}}
        lifecycleCaps={lifecycleCaps}
      />
    </div>
  );
}
