import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClientForm } from "../client-form";
import {
  JourneySection,
  type ClientAppointment,
  type HistoryEntry,
} from "./journey-section";
import { PendingDecision } from "./pending-decision";
import { AppointmentFormDialog } from "../../agenda/appointment-form-dialog";
import { getUnitSchedulingData } from "../../agenda/actions";
import {
  ClinicalSection,
  type ClinicalMediaItem,
  type ClinicalNoteItem,
  type ConsentInfo,
} from "./clinical-section";
import { CLINICAL_BUCKET, type ClinicalMediaKind } from "@/lib/clinical";
import { PlanningSection } from "./planning-section";
import type {
  PlanOption,
  TreatmentPlan,
  TreatmentPlanStatus,
} from "@/lib/planning";
import { ClientShares, type ActiveShare } from "./client-shares";
import type { StaffOption } from "@/lib/appointments";
import { allowedNextPhases } from "@/lib/journey";
import type {
  DecisionKind,
  JourneyPhase,
  JourneyStatus,
  MethodologyPillar,
} from "@/lib/journey";

export const metadata: Metadata = { title: "Ficha do cliente" };

type HistoryRow = {
  id: string;
  phase: JourneyPhase;
  entered_at: string;
  exited_at: string | null;
  profiles: { full_name: string } | null;
};

type ClinicHistoryRow = {
  id: string;
  clinic_id: string;
  started_at: string;
  ended_at: string | null;
  clinics: { name: string } | null;
  profiles: { full_name: string } | null;
};

type GuardianRow = {
  id: string;
  guardian_client_id: string | null;
  full_name: string;
  cpf: string | null;
  birth_date: string | null;
  relationship: string;
  phone: string | null;
};

type DependentRow = {
  id: string;
  relationship: string;
  clients: { id: string; full_name: string } | null;
};

type AppointmentChangeRow = {
  id: string;
  changed_at: string;
  description: string;
  profiles: { full_name: string } | null;
};

const STATUS_LABELS = {
  active: "Ativo",
  inactive: "Inativo",
  anonymized: "Anonimizado",
} as const;

/** Detailed age, e.g. "22 anos, 3 meses e 15 dias". */
function formatDetailedAge(birthIso: string): string {
  const birth = new Date(`${birthIso}T00:00:00`);
  const now = new Date();
  if (Number.isNaN(birth.getTime()) || birth > now) return "";
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  let days = now.getDate() - birth.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const word = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
  return `${word(years, "ano", "anos")}, ${word(months, "mês", "meses")} e ${word(
    days,
    "dia",
    "dias"
  )}`;
}

export default async function ClientDetailPage(
  props: PageProps<"/clientes/[id]">
) {
  const session = await getSessionContext();
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, code, clinic_id, preferred_clinic_id, full_name, cpf, birth_date, phone, email, address, address_number, complement, neighborhood, city, state, zip_code, notes, status, created_at, created_by, journey_phase, journey_status, phase_entered_at, methodology_pillar, creator:profiles!clients_created_by_fkey ( full_name ), clinic:clinics!clients_clinic_id_fkey ( name )"
    )
    .eq("id", id)
    .single();

  if (!client) notFound();

  const [
    { data: history },
    { data: appointments },
    { data: clinicHistory },
    { data: guardians },
    { data: dependents },
    { data: appointmentChanges },
    { data: openDecisions },
  ] = await Promise.all([
    supabase
      .from("journey_phase_history")
      .select("id, phase, entered_at, exited_at, profiles ( full_name )")
      .eq("client_id", id)
      .order("entered_at")
      .returns<HistoryRow[]>(),
    supabase
      .from("appointments")
      .select("id, type, status, starts_at")
      .eq("client_id", id)
      .order("starts_at")
      .returns<ClientAppointment[]>(),
    supabase
      .from("client_clinic_history")
      .select(
        "id, clinic_id, started_at, ended_at, clinics ( name ), profiles ( full_name )"
      )
      .eq("client_id", id)
      .order("started_at")
      .returns<ClinicHistoryRow[]>(),
    supabase
      .from("client_guardians")
      .select(
        "id, guardian_client_id, full_name, cpf, birth_date, relationship, phone"
      )
      .eq("client_id", id)
      .returns<GuardianRow[]>(),
    supabase
      .from("client_guardians")
      .select("id, relationship, clients ( id, full_name )")
      .eq("guardian_client_id", id)
      .returns<DependentRow[]>(),
    supabase
      .from("appointment_changes")
      .select("id, changed_at, description, profiles ( full_name )")
      .eq("client_id", id)
      .order("changed_at", { ascending: false })
      .limit(50)
      .returns<AppointmentChangeRow[]>(),
    supabase
      .from("journey_decisions")
      .select("id, kind, assignee_user_id")
      .eq("client_id", id)
      .is("resolved_at", null)
      .returns<{ id: string; kind: DecisionKind; assignee_user_id: string | null }[]>(),
  ]);

  // LGPD: every view of a client record is audited.
  await logAudit({
    action: "view",
    entityType: "client",
    entityId: client.id,
    clinicId: client.clinic_id,
  });

  const { data: clientChanges } = await supabase
    .from("client_changes")
    .select("id, fields, changed_at, profiles ( full_name )")
    .eq("client_id", id)
    .order("changed_at", { ascending: false })
    .limit(50)
    .returns<
      {
        id: string;
        fields: string;
        changed_at: string;
        profiles: { full_name: string } | null;
      }[]
    >();

  const canEdit =
    client.status !== "anonymized" &&
    (hasRoleInClinic(session, client.clinic_id, ["receptionist"]) ||
      Object.values(session.rolesByClinic).some((roles) =>
        roles.includes("sdr")
      ));

  const clinicRoles = session.rolesByClinic[client.clinic_id] ?? [];
  const isPlannerAnywhere = Object.values(session.rolesByClinic).some(
    (roles) => roles.includes("planner_dentist")
  );

  const decisions = openDecisions ?? [];
  const canAnswerDecision =
    session.isAdminMaster ||
    clinicRoles.includes("clinical_coordinator") ||
    decisions.some((d) => d.assignee_user_id === session.userId);

  // Was the client transferred away from the clinic the viewer belongs to?
  const currentClinicEntry = (clinicHistory ?? []).find((h) => !h.ended_at);
  const viewerIsFormerClinicOnly =
    !session.isAdminMaster &&
    !(client.clinic_id in session.rolesByClinic) &&
    (clinicHistory ?? []).some(
      (h) => h.ended_at && h.clinic_id in session.rolesByClinic
    );

  const historyEntries: HistoryEntry[] = (history ?? []).map((h) => ({
    id: h.id,
    phase: h.phase,
    entered_at: h.entered_at,
    exited_at: h.exited_at,
    moved_by_name: h.profiles?.full_name ?? null,
  }));

  const creatorRaw = (
    client as unknown as {
      creator?: { full_name: string } | { full_name: string }[] | null;
    }
  ).creator;
  const creator = Array.isArray(creatorRaw) ? creatorRaw[0] : creatorRaw;
  const creatorName = creator?.full_name ?? null;
  const clinicRaw = (
    client as unknown as {
      clinic?: { name: string } | { name: string }[] | null;
    }
  ).clinic;
  const clinicName =
    (Array.isArray(clinicRaw) ? clinicRaw[0] : clinicRaw)?.name ?? null;
  const ageText = client.birth_date
    ? formatDetailedAge(client.birth_date)
    : "";

  // -- Compartilhamento entre unidades (E7) --
  const { data: shareRows } = await supabase
    .from("client_shares")
    .select(
      "id, clinic_id, reason, started_at, shared_by, clinics ( name ), profiles ( full_name )"
    )
    .eq("client_id", id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .returns<
      {
        id: string;
        clinic_id: string;
        reason: string | null;
        started_at: string;
        shared_by: string | null;
        clinics: { name: string } | null;
        profiles: { full_name: string } | null;
      }[]
    >();
  const activeShares: ActiveShare[] = (shareRows ?? []).map((s) => ({
    id: s.id,
    clinicName: s.clinics?.name ?? "Unidade",
    reason: s.reason,
    startedAt: s.started_at,
    sharedByName: s.profiles?.full_name ?? null,
  }));
  const sharedClinicIds = (shareRows ?? []).map((s) => s.clinic_id);

  const canManageShare =
    session.isAdminMaster ||
    hasRoleInClinic(session, client.clinic_id, [
      "receptionist",
      "clinical_coordinator",
      "unit_manager",
    ]);
  // The shared unit (B) can also end the share from its side.
  const canEndShare =
    canManageShare ||
    sharedClinicIds.some((cid) =>
      hasRoleInClinic(session, cid, [
        "receptionist",
        "clinical_coordinator",
        "unit_manager",
      ])
    );
  let shareUnits: { id: string; name: string }[] = [];
  if (canManageShare) {
    const { data: units } = await supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .neq("id", client.clinic_id)
      .order("name");
    shareUnits = units ?? [];
  }

  // "Novo agendamento" from the ficha. Schedule at the ACTIVE clinic when it is
  // the client's home OR a unit the client is currently shared with (E7);
  // otherwise fall back to the preferred unit (SDR) / home.
  const isSdr = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("sdr")
  );
  const activeClinicId = session.activeClinic?.id ?? null;
  const scheduleClinicId =
    activeClinicId &&
    (activeClinicId === client.clinic_id ||
      sharedClinicIds.includes(activeClinicId))
      ? activeClinicId
      : ((client as { preferred_clinic_id?: string | null })
          .preferred_clinic_id ?? client.clinic_id);
  const canScheduleFromFicha =
    client.status !== "anonymized" &&
    (hasRoleInClinic(session, scheduleClinicId, ["receptionist"]) || isSdr);
  let fichaStaff: StaffOption[] = [];
  if (canScheduleFromFicha) {
    fichaStaff = (await getUnitSchedulingData(scheduleClinicId)).staff;
  }

  // -- Avaliação clínica (Etapa 4/E7): registra na unidade ATIVA quando ela é a
  // origem ou uma unidade compartilhada (a B mantém a avaliação dela, separada).
  const canEditClinical =
    session.isAdminMaster ||
    hasRoleInClinic(session, scheduleClinicId, ["clinical_coordinator"]);
  const canViewClinical =
    canEditClinical ||
    isPlannerAnywhere ||
    hasRoleInClinic(session, scheduleClinicId, ["unit_manager"]);
  const canSendToPlanning = allowedNextPhases(
    client.journey_phase as JourneyPhase,
    { isAdminMaster: session.isAdminMaster, clinicRoles, isPlannerAnywhere }
  ).includes("planning_center");

  let consentInfo: ConsentInfo | null = null;
  let clinicalNotes: ClinicalNoteItem[] = [];
  let clinicalMedia: ClinicalMediaItem[] = [];
  if (canViewClinical) {
    const [{ data: consentRows }, { data: noteRows }, { data: mediaRows }] =
      await Promise.all([
        supabase
          .from("client_consents")
          .select("granted_at, recorded_by")
          .eq("client_id", id)
          .is("revoked_at", null)
          .order("granted_at", { ascending: false })
          .limit(1),
        supabase
          .from("clinical_notes")
          .select("id, body, created_at, created_by, updated_at, updated_by")
          .eq("client_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("clinical_media")
          .select(
            "id, kind, original_name, storage_path, external_url, content_type, size_bytes, created_at, uploaded_by"
          )
          .eq("client_id", id)
          .order("created_at", { ascending: false }),
      ]);

    const ids = [
      ...new Set(
        [
          consentRows?.[0]?.recorded_by,
          ...(noteRows ?? []).map((n) => n.created_by),
          ...(noteRows ?? []).map((n) => n.updated_by),
          ...(mediaRows ?? []).map((m) => m.uploaded_by),
        ].filter((x): x is string => Boolean(x))
      ),
    ];
    const nameById = new Map<string, string>();
    if (ids.length > 0) {
      const { data: people } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      for (const p of people ?? []) nameById.set(p.id, p.full_name);
    }

    if (consentRows?.[0]) {
      consentInfo = {
        grantedAt: consentRows[0].granted_at,
        recordedByName: consentRows[0].recorded_by
          ? (nameById.get(consentRows[0].recorded_by) ?? null)
          : null,
      };
    }
    clinicalNotes = (noteRows ?? []).map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.created_at,
      authorName: n.created_by ? (nameById.get(n.created_by) ?? null) : null,
      updatedAt: n.updated_at ?? null,
      editedByName: n.updated_by ? (nameById.get(n.updated_by) ?? null) : null,
    }));
    clinicalMedia = await Promise.all(
      (mediaRows ?? []).map(async (m) => {
        // Only Storage-backed items get a signed URL; links use external_url.
        let url: string | null = null;
        if (m.storage_path) {
          // 1h so inline video/audio playback doesn't expire mid-stream.
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
  }

  // -- Plano de tratamento (Etapa 5 — Centro de Planejamento). O plano pertence
  // à unidade de origem do cliente; o Planner edita, o Coordenador/Gerente leem.
  const canEditPlanning = session.isAdminMaster || isPlannerAnywhere;
  const canViewPlanning =
    canEditPlanning ||
    hasRoleInClinic(session, client.clinic_id, [
      "clinical_coordinator",
      "unit_manager",
    ]);
  let treatmentPlan: TreatmentPlan | null = null;
  if (canViewPlanning) {
    const { data: planRows } = await supabase
      .from("treatment_plans")
      .select(
        "id, status, diagnosis, created_at, submitted_at, reviewed_at, review_notes"
      )
      .eq("client_id", id)
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
        .select("id, is_primary, title, description, sort_order")
        .eq("plan_id", planRow.id)
        .order("sort_order")
        .returns<
          {
            id: string;
            is_primary: boolean;
            title: string;
            description: string | null;
            sort_order: number;
          }[]
        >();
      const options: PlanOption[] = (optRows ?? []).map((o) => ({
        id: o.id,
        isPrimary: o.is_primary,
        title: o.title,
        description: o.description,
        sortOrder: o.sort_order,
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
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.full_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {client.code && (
              <span className="mr-2 font-mono font-medium text-gold">
                {client.code}
              </span>
            )}
            Cliente desde{" "}
            {new Date(client.created_at).toLocaleDateString("pt-BR")}
            {creatorName && <> · cadastrado por {creatorName}</>}
          </p>
          {clinicName && (
            <p className="text-sm font-medium text-primary">
              Unidade: {clinicName}
            </p>
          )}
          {ageText && (
            <p className="text-sm text-muted-foreground">Idade: {ageText}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {viewerIsFormerClinicOnly && (
            <Badge variant="destructive">
              Transferido para {currentClinicEntry?.clinics?.name ?? "outra unidade"}
            </Badge>
          )}
          <Badge variant={client.status === "active" ? "secondary" : "outline"}>
            {STATUS_LABELS[client.status as keyof typeof STATUS_LABELS]}
          </Badge>
          {canScheduleFromFicha && (
            <AppointmentFormDialog
              clients={[
                {
                  id: client.id,
                  full_name: client.full_name,
                  inactive: client.status !== "active",
                },
              ]}
              staff={fichaStaff}
              initialClientId={client.id}
              fixedClinicId={scheduleClinicId}
              trigger={<Button size="sm">Novo agendamento</Button>}
            />
          )}
        </div>
      </div>

      <PendingDecision
        decisions={decisions.map((d) => ({
          id: d.id,
          kind: d.kind,
          isAssignee: d.assignee_user_id === session.userId,
        }))}
        canAnswer={canAnswerDecision}
      />

      <JourneySection
        clientId={client.id}
        clientName={client.full_name}
        phase={client.journey_phase as JourneyPhase}
        phaseEnteredAt={client.phase_entered_at}
        pillar={client.methodology_pillar as MethodologyPillar | null}
        status={client.journey_status as JourneyStatus | null}
        history={historyEntries}
        appointments={appointments ?? []}
        isAdminMaster={session.isAdminMaster}
        clinicRoles={clinicRoles}
        isPlannerAnywhere={isPlannerAnywhere}
      />

      <ClientShares
        clientId={client.id}
        shares={activeShares}
        units={shareUnits}
        canShare={canManageShare}
        canEnd={canEndShare}
      />

      {canViewClinical && (
        <ClinicalSection
          clientId={client.id}
          clientName={client.full_name}
          clinicId={scheduleClinicId}
          canEdit={canEditClinical}
          consent={consentInfo}
          notes={clinicalNotes}
          media={clinicalMedia}
          canSendToPlanning={canSendToPlanning}
        />
      )}

      {canViewPlanning && (
        <PlanningSection
          clientId={client.id}
          clientName={client.full_name}
          plan={treatmentPlan}
          canEdit={canEditPlanning}
          inPlanningPhase={client.journey_phase === "planning_center"}
          pillarSet={Boolean(client.methodology_pillar)}
        />
      )}

      {(guardians ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Responsáveis</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {(guardians ?? []).map((guardian) => (
                <li key={guardian.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">
                    {guardian.guardian_client_id ? (
                      <a
                        href={`/clientes/${guardian.guardian_client_id}`}
                        className="hover:underline"
                      >
                        {guardian.full_name}
                      </a>
                    ) : (
                      guardian.full_name
                    )}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({guardian.relationship})
                    </span>
                    {guardian.guardian_client_id && (
                      <Badge className="ml-2 bg-gold text-gold-foreground text-[10px]">
                        Cliente Risarte
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[guardian.cpf, guardian.phone].filter(Boolean).join(" · ") ||
                      "—"}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(dependents ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dependentes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {(dependents ?? []).map(
                (dependent) =>
                  dependent.clients && (
                    <li key={dependent.id} className="text-sm">
                      <a
                        href={`/clientes/${dependent.clients.id}`}
                        className="font-medium hover:underline"
                      >
                        {dependent.clients.full_name}
                      </a>{" "}
                      <span className="text-xs text-muted-foreground">
                        (este cliente é {dependent.relationship} do dependente)
                      </span>
                    </li>
                  )
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {(clinicHistory ?? []).length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de unidades</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {(clinicHistory ?? []).map((entry) => (
                <li key={entry.id} className="text-sm">
                  <span className="font-medium">
                    {entry.clinics?.name ?? "Unidade"}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">
                    — de{" "}
                    {new Date(entry.started_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {entry.ended_at
                      ? ` até ${new Date(entry.ended_at).toLocaleString(
                          "pt-BR",
                          {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}`
                      : " até hoje (unidade atual)"}
                    {entry.profiles?.full_name
                      ? ` · registrado por ${entry.profiles.full_name}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(appointmentChanges ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Histórico de agendamentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {(appointmentChanges ?? []).map((change) => (
                <li key={change.id} className="text-sm">
                  <span>{change.description}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    —{" "}
                    {new Date(change.changed_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {change.profiles?.full_name
                      ? ` · por ${change.profiles.full_name}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(clientChanges ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Histórico de alterações cadastrais
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {(clientChanges ?? []).map((change) => (
                <li key={change.id} className="text-sm">
                  <span>Alterou: {change.fields}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    —{" "}
                    {new Date(change.changed_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {change.profiles?.full_name
                      ? ` · por ${change.profiles.full_name}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {canEdit ? (
        <ClientForm
          client={client}
          initialGuardians={(guardians ?? []).map((g) => ({
            fullName: g.full_name,
            cpf: g.cpf,
            birthDate: g.birth_date,
            relationship: g.relationship,
            phone: g.phone,
            guardianClientId: g.guardian_client_id,
          }))}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados do cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">CPF</dt>
                <dd>{client.cpf ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Nascimento</dt>
                <dd>
                  {client.birth_date
                    ? new Date(
                        `${client.birth_date}T00:00:00`
                      ).toLocaleDateString("pt-BR")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Telefone</dt>
                <dd>{client.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">E-mail</dt>
                <dd>{client.email ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Endereço</dt>
                <dd>
                  {[
                    [client.address, client.address_number]
                      .filter(Boolean)
                      .join(", nº "),
                    client.complement,
                    client.neighborhood,
                    client.city,
                    client.state,
                    client.zip_code,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Observações</dt>
                <dd>{client.notes ?? "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
