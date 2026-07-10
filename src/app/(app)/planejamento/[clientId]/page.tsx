import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlarmClock } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PresentationCountdown } from "@/components/presentation-countdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CLINICAL_BUCKET,
  type ClinicalMediaItem,
  type ClinicalMediaKind,
} from "@/lib/clinical";
import {
  PHASE_LABELS,
  PILLAR_LABELS,
  STATUS_LABELS,
  displayedPillar,
  type JourneyPhase,
  type JourneyStatus,
  type MethodologyPillar,
} from "@/lib/journey";
import {
  type PlanOption,
  type PlanStage,
  type TreatmentPlan,
  type TreatmentPlanStatus,
} from "@/lib/planning";
import {
  resolveProcedurePrices,
  type BudgetItem,
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
import { getUnitSchedulingData } from "../../agenda/actions";
import { MediaGallery } from "../../prontuarios/[id]/media-gallery";
import { PlanningSection } from "../../prontuarios/[id]/planning-section";
import { TreatmentSummary } from "./treatment-summary";

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
      "id, full_name, code, status, clinic_id, journey_phase, journey_status, methodology_pillar, phase_entered_at, clinic:clinics!clients_clinic_id_fkey ( name )"
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

  // -- Plano de tratamento (editor) --
  let treatmentPlan: TreatmentPlan | null = null;
  const { data: planRows } = await supabase
    .from("treatment_plans")
    .select(
      "id, status, diagnosis, objectives, planning_notes, created_at, submitted_at, reviewed_at, review_notes"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<
      {
        id: string;
        status: TreatmentPlanStatus;
        diagnosis: string | null;
        objectives: string | null;
        planning_notes: string | null;
        created_at: string;
        submitted_at: string | null;
        reviewed_at: string | null;
        review_notes: string | null;
      }[]
    >();
  const planRow = planRows?.[0];

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

  if (planRow) {
    const { data: optRows } = await supabase
      .from("treatment_plan_options")
      .select(
        "id, is_primary, title, description, sort_order, review_status, review_notes"
      )
      .eq("plan_id", planRow.id)
      .order("is_primary", { ascending: false })
      .order("sort_order")
      .returns<
        {
          id: string;
          is_primary: boolean;
          title: string;
          description: string | null;
          sort_order: number;
          review_status: "pending" | "approved" | "rejected";
          review_notes: string | null;
        }[]
      >();
    const optionIds = (optRows ?? []).map((o) => o.id);
    const itemsByOption = new Map<string, BudgetItem[]>();
    if (optionIds.length > 0) {
      const { data: itemRows } = await supabase
        .from("treatment_plan_option_items")
        .select(
          "id, option_id, procedure_id, description, quantity, unit_price_cents, planned_sessions, planned_total_minutes, stage_id, suggested_provider_id, sort_order"
        )
        .in("option_id", optionIds)
        .order("sort_order")
        .returns<
          {
            id: string;
            option_id: string;
            procedure_id: string | null;
            description: string;
            quantity: number;
            unit_price_cents: number;
            planned_sessions: number | null;
            planned_total_minutes: number | null;
            stage_id: string | null;
            suggested_provider_id: string | null;
            sort_order: number;
          }[]
        >();
      for (const it of itemRows ?? []) {
        const list = itemsByOption.get(it.option_id) ?? [];
        list.push({
          id: it.id,
          procedureId: it.procedure_id,
          description: it.description,
          quantity: it.quantity,
          unitPriceCents: it.unit_price_cents,
          plannedSessions: it.planned_sessions,
          plannedMinutes: it.planned_total_minutes,
          stageId: it.stage_id,
          suggestedProviderId: it.suggested_provider_id,
        });
        itemsByOption.set(it.option_id, list);
      }
    }
    // H4.5: etapas do tratamento por opção.
    const stagesByOption = new Map<string, PlanStage[]>();
    if (optionIds.length > 0) {
      const { data: stageRows } = await supabase
        .from("treatment_plan_stages")
        .select("id, option_id, name, sort_order")
        .in("option_id", optionIds)
        .order("sort_order")
        .returns<
          { id: string; option_id: string; name: string; sort_order: number }[]
        >();
      for (const st of stageRows ?? []) {
        const list = stagesByOption.get(st.option_id) ?? [];
        list.push({ id: st.id, name: st.name, sortOrder: st.sort_order });
        stagesByOption.set(st.option_id, list);
      }
    }
    const options: PlanOption[] = (optRows ?? []).map((o) => ({
      id: o.id,
      isPrimary: o.is_primary,
      title: o.title,
      description: o.description,
      sortOrder: o.sort_order,
      items: itemsByOption.get(o.id) ?? [],
      stages: stagesByOption.get(o.id) ?? [],
      reviewStatus: o.review_status,
      reviewNotes: o.review_notes,
    }));
    treatmentPlan = {
      id: planRow.id,
      status: planRow.status,
      diagnosis: planRow.diagnosis,
      objectives: planRow.objectives,
      planningNotes: planRow.planning_notes,
      createdAt: planRow.created_at,
      submittedAt: planRow.submitted_at,
      reviewedAt: planRow.reviewed_at,
      reviewNotes: planRow.review_notes,
      options,
    };
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

  // H4.5 Pedido 1: dentistas da unidade do cliente (o Planner indica por item).
  const scheduling = await getUnitSchedulingData(client.clinic_id);
  const providerOptions = scheduling.staff
    .filter((s) => s.roles.includes("dentist"))
    .map((s) => ({ id: s.userId, name: s.name }));

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">
            Cockpit de Planejamento
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.full_name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {client.code && (
              <span className="font-mono text-xs text-gold">{client.code}</span>
            )}
            {clinicName && (
              <span className="text-xs text-muted-foreground">{clinicName}</span>
            )}
            <Badge variant="secondary">{PHASE_LABELS[phase]}</Badge>
            {client.journey_status && (
              <Badge variant="outline" className="border-primary text-primary">
                {STATUS_LABELS[client.journey_status as JourneyStatus]}
              </Badge>
            )}
            <Badge className="bg-gold text-gold-foreground">
              {shownPillar ? PILLAR_LABELS[shownPillar] : "Pilar a definir"}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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

      {/* AJ3: apresentação marcada mas plano ainda não pronto — destaque +
          cronômetro para pressionar o Centro de Planejamento. */}
      {presentationAt && treatmentPlan?.status !== "approved" && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlarmClock className="size-4 shrink-0" />
          <span className="font-medium">
            Apresentação comercial marcada para{" "}
            {new Date(presentationAt).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            — e o plano ainda não está pronto.
          </span>
          <PresentationCountdown startsAt={presentationAt} alarm />
        </div>
      )}

      {/* H4.5 Lote 2: projeção do tratamento (estrutura + esforço planejado). */}
      {summaryOption && <TreatmentSummary option={summaryOption} />}

      {/* H3.13: colunas com rolagem independente (não rola a página inteira). */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Evidências do cliente (abrem em pop-up, sem trocar de tela). */}
        <div className="space-y-4 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pr-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evidências do cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {consent
                  ? `Consentimento registrado em ${fmtDateTime(consent.grantedAt)}${
                      consent.recordedByName ? ` por ${consent.recordedByName}` : ""
                    }.`
                  : "Sem consentimento registrado."}
              </p>
              <MediaGallery media={media} canEdit={false} />
            </CardContent>
          </Card>

          {/* H3.13: anamnese do cliente (leitura). */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Anamnese</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {anamnesisInfo == null ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma anamnese preenchida.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {anamnesisInfo.templateName ?? "Ficha"} · atualizada em{" "}
                    {fmtDateTime(anamnesisInfo.filledAt)}
                  </p>
                  {anamnesisAlerts.length > 0 && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                      {anamnesisAlerts.map((a, i) => (
                        <p key={i}>⚠ {a.message}</p>
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
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Considerações clínicas</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          {/* H3.11: informações complementares enviadas pelo Coordenador. */}
          {supplements.length > 0 && (
            <Card className="border-primary/40">
              <CardHeader>
                <CardTitle className="text-base text-primary">
                  Informações complementares do Coordenador
                </CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          )}
        </div>

        {/* Editor do plano (mesma tela) — rolagem independente. */}
        <div className="lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pl-1">
          <PlanningSection
            clientId={client.id}
            clientName={client.full_name}
            plan={treatmentPlan}
            canEdit
            canReview={false}
            inPlanningPhase={phase === "planning_center"}
            catalog={catalog}
            protocols={protocolByProcedure}
            realStats={realStatsByProcedure}
            currentPillar={
              client.methodology_pillar as MethodologyPillar | null
            }
            providerOptions={providerOptions}
          />
        </div>
      </div>
    </div>
  );
}
