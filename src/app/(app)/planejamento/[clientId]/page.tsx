import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
  type TreatmentPlan,
  type TreatmentPlanStatus,
} from "@/lib/planning";
import {
  resolveProcedurePrices,
  type BudgetItem,
  type PricedProcedure,
  type Procedure,
  type UnitPrice,
} from "@/lib/pricing";
import { MediaGallery } from "../../prontuarios/[id]/media-gallery";
import { PlanningSection } from "../../prontuarios/[id]/planning-section";

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
        .select("id, body, created_at, created_by, updated_at, updated_by")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("clinical_media")
        .select(
          "id, kind, original_name, storage_path, external_url, content_type, size_bytes, created_at, uploaded_by"
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
    ]);

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

  const notes = (noteRows ?? []).map((n) => ({
    id: n.id as string,
    body: n.body as string,
    createdAt: n.created_at as string,
    authorName: n.created_by ? (nameById.get(n.created_by) ?? null) : null,
  }));

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
      "id, status, diagnosis, created_at, submitted_at, reviewed_at, review_notes"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<
      {
        id: string;
        status: TreatmentPlanStatus;
        diagnosis: string | null;
        created_at: string;
        submitted_at: string | null;
        reviewed_at: string | null;
        review_notes: string | null;
      }[]
    >();
  const planRow = planRows?.[0];
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
          "id, option_id, procedure_id, description, quantity, unit_price_cents, sort_order"
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
        });
        itemsByOption.set(it.option_id, list);
      }
    }
    const options: PlanOption[] = (optRows ?? []).map((o) => ({
      id: o.id,
      isPrimary: o.is_primary,
      title: o.title,
      description: o.description,
      sortOrder: o.sort_order,
      items: itemsByOption.get(o.id) ?? [],
      reviewStatus: o.review_status,
      reviewNotes: o.review_notes,
    }));
    treatmentPlan = {
      id: planRow.id,
      status: planRow.status,
      diagnosis: planRow.diagnosis,
      createdAt: planRow.created_at,
      submittedAt: planRow.submitted_at,
      reviewedAt: planRow.reviewed_at,
      reviewNotes: planRow.review_notes,
      options,
    };
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
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Evidências do cliente (abrem em pop-up, sem trocar de tela). */}
        <div className="space-y-4">
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
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Editor do plano (mesma tela). */}
        <div>
          <PlanningSection
            clientId={client.id}
            clientName={client.full_name}
            plan={treatmentPlan}
            canEdit
            canReview={false}
            inPlanningPhase={phase === "planning_center"}
            pillarSet={Boolean(client.methodology_pillar)}
            catalog={catalog}
          />
        </div>
      </div>
    </div>
  );
}
