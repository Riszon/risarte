import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Building2, Cake, Route } from "lucide-react";
import { RisarteMark } from "@/components/risarte-logo";
import { cn } from "@/lib/utils";
import {
  getSessionContext,
  hasRoleInClinic,
  hasRoleWithScopeForClinic,
  isDentistRestricted,
  isSdrRestricted,
  sdrAccessibleClientIds,
} from "@/lib/auth";
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
import { ClientDataSection } from "./client-data-section";
import {
  JourneySection,
  type ClientAppointment,
  type HistoryEntry,
} from "./journey-section";
import { PendingDecision } from "./pending-decision";
import { AppointmentFormDialog } from "../../agenda/appointment-form-dialog";
import {
  getUnitSchedulingData,
  type AgendaFormConfig,
} from "../../agenda/actions";
import {
  ClinicalSection,
  type ClinicalMediaItem,
  type ClinicalNoteItem,
  type ConsentInfo,
} from "./clinical-section";
import {
  ClinicalProgressSection,
  type ProgressNoteItem,
} from "./clinical-progress-section";
import {
  ClientProceduresSection,
  type ProcedureItem,
} from "./client-procedures-section";
import {
  PlanSummarySection,
  type PlanSummaryStage,
} from "./plan-summary-section";
import { DocumentsSection } from "./documents-section";
import type {
  ClinicalDocumentItem,
  DocumentKind,
  DocumentTemplate,
} from "@/lib/documents";
import { RequestsSection } from "./requests-section";
import type {
  ClinicalRequestItem,
  ClinicalRequestKind,
  RequestMediaItem,
} from "@/lib/requests";
import { ProntuarioTabs, TabPanel } from "./prontuario-tabs";
import {
  ClinicalImagesSection,
  type ClinicalImageItem,
} from "./clinical-images-section";
import {
  AnamnesisFill,
  type AnamnesisTypeGroup,
  type FillTemplate,
} from "./anamnesis-fill";
import {
  evaluateAlerts,
  mapAnswer,
  mapQuestion,
  type AnamnesisAnswerRow,
  type AnamnesisQuestionRow,
  type AnamnesisTemplateRow,
} from "@/lib/anamnesis";
import { CLINICAL_BUCKET, type ClinicalMediaKind } from "@/lib/clinical";
import { PlanningSection } from "./planning-section";
import { EmpresarialPanel } from "./empresarial-panel";
import { loadClientProgram, loadClientUsage } from "@/lib/empresarial/benefits";
import type {
  PlanOption,
  PlanStage,
  TreatmentPlan,
  TreatmentPlanStatus,
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
import { ClientShares, type ActiveShare } from "./client-shares";
import { BirthdayWhatsAppButton } from "../birthday-whatsapp";
import {
  PlanningSupplements,
  type PlanningSupplement,
} from "./planning-supplements";
import { ensureTreatmentSessions } from "./treatment-actions";
import {
  TreatmentSessionsPanel,
  type TreatmentSession,
} from "./treatment-sessions-panel";
import type {
  AppointmentStatus,
  AppointmentType,
  StaffOption,
} from "@/lib/appointments";
import { roomLabel } from "@/lib/rooms";
import { allowedNextPhases, PHASE_LABELS } from "@/lib/journey";
import type {
  DecisionKind,
  JourneyPhase,
  JourneyStatus,
  MethodologyPillar,
} from "@/lib/journey";

export const metadata: Metadata = { title: "Prontuário do cliente" };

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

/** Iniciais do cliente para o avatar do cabeçalho (1ª + última palavra). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

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
  props: PageProps<"/prontuarios/[id]">
) {
  const session = await getSessionContext();
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, code, clinic_id, preferred_clinic_id, full_name, cpf, birth_date, gender, phone, email, address, address_number, complement, neighborhood, city, state, zip_code, notes, status, created_at, created_by, journey_phase, journey_status, phase_entered_at, methodology_pillar, staff_member_id, risartano_active, empresarial_company_id, empresarial_active, creator:profiles!clients_created_by_fkey ( full_name ), clinic:clinics!clients_clinic_id_fkey ( name )"
    )
    .eq("id", id)
    .single();

  if (!client) {
    // The shared unit (B) loses access when its share ends — show a friendly
    // "compartilhamento encerrado" message (with the details) instead of a 404.
    const { data: endedShare } = await supabase
      .from("client_shares")
      .select(
        "ended_at, reason, clinics ( name ), ender:profiles!client_shares_ended_by_fkey ( full_name )"
      )
      .eq("client_id", id)
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(1)
      .returns<
        {
          ended_at: string;
          reason: string | null;
          clinics: { name: string } | null;
          ender: { full_name: string } | { full_name: string }[] | null;
        }[]
      >();
    const es = endedShare?.[0];
    if (!es) {
      // H4.6 B2: o Dentista (executor) só acessa o prontuário dos pacientes que
      // ele atende — a RLS bloqueou; mostra a mensagem amigável.
      if (isDentistRestricted(session)) {
        return (
          <div className="mx-auto max-w-xl px-4 py-16">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Acesso restrito</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  Você só tem acesso ao prontuário dos pacientes que você atende.
                  Este cliente não faz parte dos seus atendimentos.
                </p>
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/meu-dia" />}
                >
                  Ir para Meu Dia
                </Button>
              </CardContent>
            </Card>
          </div>
        );
      }
      notFound();
    }
    const enderRaw = es.ender;
    const enderName = (Array.isArray(enderRaw) ? enderRaw[0] : enderRaw)
      ?.full_name;
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Compartilhamento encerrado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              O compartilhamento deste cliente com a sua unidade
              {es.clinics?.name ? ` (${es.clinics.name})` : ""} foi encerrado em{" "}
              <span className="font-medium">
                {new Date(es.ended_at).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {enderName ? (
                <>
                  {" "}
                  por <span className="font-medium">{enderName}</span>
                </>
              ) : null}
              . Sua unidade não tem mais acesso a este cliente.
            </p>
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/prontuarios" />}
            >
              Voltar para Clientes
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // H3.7: a SDR "pura" só abre a ficha de clientes que ela tocou (cadastrou/
  // editou/agendou/transferiu). A RLS ainda deixa ver o nome na agenda; aqui
  // bloqueamos o acesso ao prontuário/cadastro completo.
  if (isSdrRestricted(session)) {
    const accessibleIds = await sdrAccessibleClientIds();
    if (!accessibleIds.includes(client.id)) {
      return (
        <div className="mx-auto max-w-xl px-4 py-16">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acesso restrito</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                Você só tem acesso ao prontuário de clientes que você cadastrou,
                editou, agendou ou transferiu. Este cliente não faz parte do seu
                acompanhamento.
              </p>
              <Button
                size="sm"
                nativeButton={false}
                render={<Link href="/prontuarios" />}
              >
                Voltar para Prontuários
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
  }

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
  // H3.8: aniversário HOJE (compara mês/dia, sem fuso).
  const isBirthdayToday = (() => {
    if (!client.birth_date) return false;
    const [, bm, bd] = client.birth_date.split("-");
    const now = new Date();
    return (
      Number(bm) === now.getMonth() + 1 && Number(bd) === now.getDate()
    );
  })();

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

  // Histórico de compartilhamento (todos, inclusive encerrados) — F2.
  const { data: shareHistoryRows } = await supabase
    .from("client_shares")
    .select(
      "id, started_at, ended_at, reason, clinics ( name ), profiles ( full_name )"
    )
    .eq("client_id", id)
    .order("started_at", { ascending: false })
    .returns<
      {
        id: string;
        started_at: string;
        ended_at: string | null;
        reason: string | null;
        clinics: { name: string } | null;
        profiles: { full_name: string } | null;
      }[]
    >();

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
  let fichaConfig: AgendaFormConfig | undefined;
  if (canScheduleFromFicha) {
    const schedulingData = await getUnitSchedulingData(scheduleClinicId);
    fichaStaff = schedulingData.staff;
    fichaConfig = schedulingData.config;
  }

  // Sessões do tratamento a agendar (E4): gera na Fase 5 e carrega.
  let treatmentSessions: TreatmentSession[] = [];
  if (client.journey_phase === "treatment_start") {
    await ensureTreatmentSessions(id);
    const { data: tsRows } = await supabase
      .from("treatment_sessions")
      .select(
        "id, procedure_id, procedure_name, session_index, session_total, name, planned_minutes, actual_minutes, status, planned_date, stage_name, stage_order, planner_provider_id, join_key, plan_order, appointment:appointments!treatment_sessions_appointment_id_fkey ( id, type, status, starts_at, ends_at, notes, provider_user_id, room_id, is_online, needs_reschedule, room:clinic_rooms ( name, deleted_at ), provider:profiles!appointments_provider_user_id_fkey ( full_name ) )"
      )
      .eq("client_id", id)
      .order("created_at")
      .returns<
        {
          id: string;
          procedure_id: string | null;
          procedure_name: string;
          session_index: number;
          session_total: number;
          name: string | null;
          planned_minutes: number | null;
          actual_minutes: number | null;
          status: "pending" | "scheduled" | "done";
          planned_date: string | null;
          stage_name: string | null;
          stage_order: number | null;
          planner_provider_id: string | null;
          join_key: string | null;
          plan_order: number | null;
          appointment: {
            id: string;
            type: string;
            status: string;
            starts_at: string;
            ends_at: string;
            notes: string | null;
            provider_user_id: string | null;
            room_id: string | null;
            is_online: boolean | null;
            needs_reschedule: boolean | null;
            room: { name: string | null; deleted_at: string | null } | null;
            provider: { full_name: string } | null;
          } | null;
        }[]
      >();
    treatmentSessions = (tsRows ?? []).map((r) => ({
      id: r.id,
      procedureId: r.procedure_id,
      procedureName: r.procedure_name,
      sessionIndex: r.session_index,
      sessionTotal: r.session_total,
      name: r.name,
      plannedMinutes: r.planned_minutes,
      actualMinutes: r.actual_minutes,
      status: r.status,
      plannedDate: r.planned_date,
      stageName: r.stage_name,
      stageOrder: r.stage_order,
      plannerProviderId: r.planner_provider_id,
      joinKey: r.join_key,
      planOrder: r.plan_order,
      // H4.5 Lote 3: preenchido logo abaixo (sugestão de profissional).
      suggestedProviderId: null as string | null,
      suggestedProviderName: null as string | null,
      suggestionReason: null as string | null,
      // H3.14: agendamento vinculado (quando/quem) para exibir e abrir os detalhes.
      appointment: r.appointment
        ? {
            id: r.appointment.id,
            type: r.appointment.type as AppointmentType,
            status: r.appointment.status as AppointmentStatus,
            starts_at: r.appointment.starts_at,
            ends_at: r.appointment.ends_at,
            notes: r.appointment.notes,
            provider_user_id: r.appointment.provider_user_id,
            provider: r.appointment.provider,
            room_id: r.appointment.room_id ?? null,
            room_name: roomLabel(r.appointment.room),
            is_online: r.appointment.is_online ?? false,
            needs_reschedule: r.appointment.needs_reschedule ?? false,
            clients: {
              id: client.id,
              full_name: client.full_name,
              journey_phase: client.journey_phase as JourneyPhase,
              methodology_pillar:
                client.methodology_pillar as MethodologyPillar | null,
            },
          }
        : null,
    }));

    // -- H4.5 Lote 3: sugere o profissional de cada sessão pendente --
    const pendingSessions = treatmentSessions.filter(
      (s) => s.status === "pending"
    );
    if (
      canScheduleFromFicha &&
      fichaStaff.length > 0 &&
      pendingSessions.length > 0
    ) {
      const staffIds = fichaStaff.map((s) => s.userId);
      const nameOf = (uid: string) =>
        fichaStaff.find((s) => s.userId === uid)?.name ?? null;

      const procIds = [
        ...new Set(
          treatmentSessions
            .map((s) => s.procedureId)
            .filter((x): x is string => Boolean(x))
        ),
      ];

      // Especialidade de cada procedimento.
      const specByProc = new Map<string, string | null>();
      // Especialidades de cada profissional da unidade (com login).
      const specByUser = new Map<string, string[]>();
      // Quem já executou cada procedimento na unidade (mais recente).
      const historyByProc = new Map<string, string>();

      const { data: staffSpecRows } = await supabase
        .from("staff_members")
        .select("user_id, specialties")
        .eq("clinic_id", scheduleClinicId)
        .in("user_id", staffIds);
      for (const r of (staffSpecRows ?? []) as {
        user_id: string | null;
        specialties: string[] | null;
      }[]) {
        if (r.user_id) specByUser.set(r.user_id, r.specialties ?? []);
      }

      if (procIds.length > 0) {
        const [{ data: procSpecRows }, { data: histRows }] = await Promise.all([
          supabase.from("procedures").select("id, specialty").in("id", procIds),
          supabase
            .from("treatment_sessions")
            .select(
              "procedure_id, done_at, appointment:appointments!treatment_sessions_appointment_id_fkey ( provider_user_id )"
            )
            .eq("clinic_id", scheduleClinicId)
            .eq("status", "done")
            .in("procedure_id", procIds)
            .order("done_at", { ascending: false })
            .limit(500),
        ]);
        for (const p of (procSpecRows ?? []) as {
          id: string;
          specialty: string | null;
        }[]) {
          specByProc.set(p.id, p.specialty);
        }
        for (const r of (histRows ?? []) as {
          procedure_id: string | null;
          appointment:
            | { provider_user_id: string | null }
            | { provider_user_id: string | null }[]
            | null;
        }[]) {
          const ap = Array.isArray(r.appointment)
            ? r.appointment[0]
            : r.appointment;
          const prov = ap?.provider_user_id ?? null;
          if (
            r.procedure_id &&
            prov &&
            staffIds.includes(prov) &&
            !historyByProc.has(r.procedure_id)
          ) {
            historyByProc.set(r.procedure_id, prov);
          }
        }
      }

      // Continuidade: dentista do agendamento mais recente deste cliente.
      let treatmentDentist: string | null = null;
      let bestTime = -1;
      for (const s of treatmentSessions) {
        const uid = s.appointment?.provider_user_id;
        if (uid && s.appointment && staffIds.includes(uid)) {
          const t = new Date(s.appointment.starts_at).getTime();
          if (t > bestTime) {
            bestTime = t;
            treatmentDentist = uid;
          }
        }
      }

      for (const s of pendingSessions) {
        const spec = s.procedureId
          ? (specByProc.get(s.procedureId) ?? null)
          : null;
        const specialists = spec
          ? staffIds.filter((uid) => (specByUser.get(uid) ?? []).includes(spec))
          : [];
        let pick: string | null = null;
        let reason: string | null = null;
        if (s.plannerProviderId && staffIds.includes(s.plannerProviderId)) {
          // Pedido 1: indicação do Planner tem prioridade — mas só vale se o
          // profissional atende a unidade ATUAL do cliente (staffIds).
          pick = s.plannerProviderId;
          reason = "indicado pelo Planner";
        } else if (
          spec &&
          treatmentDentist &&
          specialists.includes(treatmentDentist)
        ) {
          pick = treatmentDentist;
          reason = `especialista em ${spec} e já atende o cliente`;
        } else if (!spec && treatmentDentist) {
          pick = treatmentDentist;
          reason = "já atende este cliente";
        } else if (specialists.length > 0) {
          pick = specialists[0];
          reason = `especialista em ${spec}`;
        } else if (treatmentDentist) {
          pick = treatmentDentist;
          reason = "já atende este cliente";
        } else if (s.procedureId && historyByProc.has(s.procedureId)) {
          pick = historyByProc.get(s.procedureId) ?? null;
          reason = "já fez este procedimento na unidade";
        }
        if (pick) {
          s.suggestedProviderId = pick;
          s.suggestedProviderName = nameOf(pick);
          s.suggestionReason = reason;
        }
      }
    }
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
          .select(
            "id, body, created_at, created_by, updated_at, updated_by, clinic:clinics ( name )"
          )
          .eq("client_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("clinical_media")
          .select(
            "id, kind, original_name, display_name, note, storage_path, external_url, content_type, size_bytes, created_at, uploaded_by"
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
    clinicalNotes = (noteRows ?? []).map((n) => {
      const cRaw = (
        n as { clinic?: { name: string } | { name: string }[] | null }
      ).clinic;
      return {
        id: n.id,
        body: n.body,
        createdAt: n.created_at,
        authorName: n.created_by ? (nameById.get(n.created_by) ?? null) : null,
        updatedAt: n.updated_at ?? null,
        editedByName: n.updated_by ? (nameById.get(n.updated_by) ?? null) : null,
        clinicName: (Array.isArray(cRaw) ? cRaw[0] : cRaw)?.name ?? null,
      };
    });
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
          displayName: (m as { display_name?: string | null }).display_name ?? null,
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
  }

  // H3.11: informações complementares ao Centro de Planejamento.
  let planningSupplements: PlanningSupplement[] = [];
  if (canViewClinical) {
    const { data: supRows } = await supabase
      .from("planning_supplements")
      .select(
        "id, body, created_at, seen_at, author:profiles!planning_supplements_created_by_fkey ( full_name )"
      )
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .returns<
        {
          id: string;
          body: string;
          created_at: string;
          seen_at: string | null;
          author: { full_name: string } | { full_name: string }[] | null;
        }[]
      >();
    planningSupplements = (supRows ?? []).map((s) => {
      const a = Array.isArray(s.author) ? s.author[0] : s.author;
      return {
        id: s.id,
        body: s.body,
        createdAt: s.created_at,
        authorName: a?.full_name ?? null,
        seenAt: s.seen_at,
      };
    });
  }
  const canAddSupplement = canEditClinical;

  // -- Anamnese (A3): fichas configuráveis. Coordenador preenche; Dentista,
  // Planner, Gerente e Admin visualizam. Carrega as fichas ativas (perguntas da
  // rede + acréscimos desta unidade), o preenchimento atual e o histórico.
  const canViewAnamnesis =
    canViewClinical || hasRoleInClinic(session, scheduleClinicId, ["dentist"]);
  let anamnesisTemplates: FillTemplate[] = [];
  let anamnesisFills: AnamnesisTypeGroup[] = [];
  const anamnesisAlerts: { label: string; message: string }[] = [];
  if (canViewAnamnesis) {
    const [{ data: tplRows }, { data: qRows }, { data: fillRows }] =
      await Promise.all([
        supabase
          .from("anamnesis_templates")
          .select("id, name, description, is_active, is_default, sort_order")
          .eq("is_active", true)
          .order("sort_order")
          .order("name")
          .returns<AnamnesisTemplateRow[]>(),
        // Perguntas da rede (clinic_id null) + acréscimos desta unidade.
        supabase
          .from("anamnesis_questions")
          .select(
            "id, template_id, clinic_id, section, label, kind, options, detail_prompt, required, sort_order, alert_when, alert_message, gender, condition_question_id, condition_values"
          )
          .or(`clinic_id.is.null,clinic_id.eq.${scheduleClinicId}`)
          .order("sort_order")
          .returns<AnamnesisQuestionRow[]>(),
        // Sem filtro por clínica: um cliente transferido enxerga a anamnese
        // feita na unidade anterior (a RLS libera via histórico do cliente).
        supabase
          .from("anamnesis_fills")
          .select(
            "id, template_id, template_name, filled_at, filled_by, no_changes"
          )
          .eq("client_id", id)
          .order("filled_at", { ascending: false })
          .returns<
            {
              id: string;
              template_id: string | null;
              template_name: string | null;
              filled_at: string;
              filled_by: string | null;
              no_changes: boolean;
            }[]
          >(),
      ]);

    const qByTemplate = new Map<string, ReturnType<typeof mapQuestion>[]>();
    for (const r of qRows ?? []) {
      const list = qByTemplate.get(r.template_id) ?? [];
      list.push(mapQuestion(r));
      qByTemplate.set(r.template_id, list);
    }
    anamnesisTemplates = (tplRows ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      isDefault: t.is_default,
      questions: (qByTemplate.get(t.id) ?? []).sort(
        (a, b) => a.sortOrder - b.sortOrder
      ),
    }));

    const fills = fillRows ?? [];
    const fillerIds = [
      ...new Set(fills.map((f) => f.filled_by).filter((x): x is string => Boolean(x))),
    ];
    const fillerNames = new Map<string, string>();
    if (fillerIds.length > 0) {
      const { data: people } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", fillerIds);
      for (const p of people ?? []) fillerNames.set(p.id, p.full_name);
    }
    // Agrupa por TIPO de ficha: a versão mais recente de cada tipo é a "atual"
    // daquele tipo; as anteriores do mesmo tipo formam o histórico dele.
    const byTemplate = new Map<string, typeof fills>();
    for (const f of fills) {
      const key = f.template_id ?? "__none__";
      const arr = byTemplate.get(key) ?? [];
      arr.push(f);
      byTemplate.set(key, arr);
    }
    const groups = [...byTemplate.values()];
    const latestIds = groups.map((g) => g[0].id);
    const answersByFill = new Map<string, ReturnType<typeof mapAnswer>[]>();
    if (latestIds.length > 0) {
      const { data: ansRows } = await supabase
        .from("anamnesis_answers")
        .select(
          "id, fill_id, question_id, section, label, kind, value, detail, is_adhoc, sort_order, alert_when, alert_message"
        )
        .in("fill_id", latestIds)
        .order("sort_order")
        .returns<(AnamnesisAnswerRow & { fill_id: string })[]>();
      for (const r of ansRows ?? []) {
        const list = answersByFill.get(r.fill_id) ?? [];
        list.push(mapAnswer(r));
        answersByFill.set(r.fill_id, list);
      }
    }
    anamnesisFills = groups
      .map((arr) => {
        const latest = arr[0];
        return {
          templateId: latest.template_id,
          templateName: latest.template_name,
          current: {
            id: latest.id,
            templateId: latest.template_id,
            templateName: latest.template_name,
            filledAt: latest.filled_at,
            filledByName: latest.filled_by
              ? (fillerNames.get(latest.filled_by) ?? null)
              : null,
            answers: answersByFill.get(latest.id) ?? [],
          },
          history: arr.map((f) => ({
            id: f.id,
            filledAt: f.filled_at,
            filledByName: f.filled_by
              ? (fillerNames.get(f.filled_by) ?? null)
              : null,
            templateName: f.template_name,
            noChanges: f.no_changes,
          })),
        };
      })
      .sort(
        (a, b) =>
          new Date(b.current.filledAt).getTime() -
          new Date(a.current.filledAt).getTime()
      );
    for (const g of anamnesisFills) {
      anamnesisAlerts.push(...evaluateAlerts(g.current.answers));
    }
  }

  // -- H4.6 A2: Desenvolvimento Clínico (anotações do dentista) — visível aos
  // dentistas/coordenadores/planner; o dentista escreve (salvamento automático).
  const canWriteProgress =
    session.isAdminMaster ||
    hasRoleInClinic(session, scheduleClinicId, ["dentist"]);
  const canViewProgress = canViewAnamnesis;
  let progressNotes: ProgressNoteItem[] = [];
  if (canViewProgress) {
    const { data: pnRows } = await supabase
      .from("clinical_progress_notes")
      .select(
        "id, body, author_id, created_at, updated_at, clinic:clinics ( name )"
      )
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .returns<
        {
          id: string;
          body: string;
          author_id: string;
          created_at: string;
          updated_at: string;
          clinic: { name: string } | { name: string }[] | null;
        }[]
      >();
    const progressAuthorIds = [
      ...new Set(
        (pnRows ?? [])
          .map((r) => r.author_id)
          .filter((x): x is string => Boolean(x))
      ),
    ];
    const progressAuthorNames = new Map<string, string>();
    if (progressAuthorIds.length > 0) {
      const { data: people } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", progressAuthorIds);
      for (const p of people ?? []) progressAuthorNames.set(p.id, p.full_name);
    }
    progressNotes = (pnRows ?? []).map((r) => {
      const cRaw = r.clinic;
      return {
        id: r.id,
        body: r.body,
        authorName: r.author_id
          ? (progressAuthorNames.get(r.author_id) ?? null)
          : null,
        clinicName: (Array.isArray(cRaw) ? cRaw[0] : cRaw)?.name ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at ?? null,
      };
    });
  }

  // -- H4.6 A3: Procedimentos do cliente (em aberto / agendados / finalizados) --
  const canViewProcedures =
    session.isAdminMaster ||
    isPlannerAnywhere ||
    isSdr ||
    hasRoleInClinic(session, scheduleClinicId, [
      "dentist",
      "clinical_coordinator",
      "unit_manager",
      "receptionist",
    ]);
  const canRequestScheduling =
    session.isAdminMaster ||
    hasRoleInClinic(session, scheduleClinicId, ["dentist"]);
  let procedureItems: ProcedureItem[] = [];
  if (canViewProcedures) {
    const { data: procSessRows } = await supabase
      .from("treatment_sessions")
      .select(
        "id, procedure_name, name, status, planned_date, done_at, executed_by, plan_order, session_index, appointment:appointments!treatment_sessions_appointment_id_fkey ( starts_at, status, provider:profiles!appointments_provider_user_id_fkey ( full_name ) )"
      )
      .eq("client_id", id)
      .order("plan_order", { nullsFirst: false })
      .order("session_index")
      .returns<
        {
          id: string;
          procedure_name: string;
          name: string | null;
          status: "pending" | "scheduled" | "done";
          planned_date: string | null;
          done_at: string | null;
          executed_by: string | null;
          appointment:
            | {
                starts_at: string;
                status: string;
                provider:
                  | { full_name: string }
                  | { full_name: string }[]
                  | null;
              }
            | {
                starts_at: string;
                status: string;
                provider:
                  | { full_name: string }
                  | { full_name: string }[]
                  | null;
              }[]
            | null;
        }[]
      >();
    const execIds = [
      ...new Set(
        (procSessRows ?? [])
          .map((r) => r.executed_by)
          .filter((x): x is string => Boolean(x))
      ),
    ];
    const execNames = new Map<string, string>();
    if (execIds.length > 0) {
      const { data: people } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", execIds);
      for (const p of people ?? []) execNames.set(p.id, p.full_name);
    }
    procedureItems = (procSessRows ?? []).map((r) => {
      const ap = Array.isArray(r.appointment)
        ? r.appointment[0]
        : r.appointment;
      const provRaw = ap?.provider ?? null;
      const prov = Array.isArray(provRaw) ? provRaw[0] : provRaw;
      const isScheduled =
        ap != null && (ap.status === "scheduled" || ap.status === "confirmed");
      const group: "open" | "scheduled" | "done" =
        r.status === "done" ? "done" : isScheduled ? "scheduled" : "open";
      return {
        id: r.id,
        procedureName: r.procedure_name,
        name: r.name,
        group,
        plannedDate: r.planned_date,
        appointmentAt: ap?.starts_at ?? null,
        providerName: prov?.full_name ?? null,
        doneAt: r.done_at,
        executorName: r.executed_by
          ? (execNames.get(r.executed_by) ?? null)
          : null,
      };
    });
  }

  // -- H4.6 C: documentos clínicos (prescrição/atestado/declaração/orientações) --
  const canEmitDocuments =
    session.isAdminMaster ||
    hasRoleInClinic(session, scheduleClinicId, [
      "dentist",
      "clinical_coordinator",
    ]);
  const canViewDocuments = canEmitDocuments || canViewClinical;
  let documentItems: ClinicalDocumentItem[] = [];
  let documentTemplates: DocumentTemplate[] = [];
  if (canViewDocuments) {
    const { data: docRows } = await supabase
      .from("clinical_documents")
      .select("id, kind, title, created_at, author_id")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .returns<
        {
          id: string;
          kind: DocumentKind;
          title: string;
          created_at: string;
          author_id: string;
        }[]
      >();
    const docAuthorIds = [
      ...new Set(
        (docRows ?? [])
          .map((r) => r.author_id)
          .filter((x): x is string => Boolean(x))
      ),
    ];
    const docAuthorNames = new Map<string, string>();
    if (docAuthorIds.length > 0) {
      const { data: people } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", docAuthorIds);
      for (const p of people ?? []) docAuthorNames.set(p.id, p.full_name);
    }
    documentItems = (docRows ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      createdAt: r.created_at,
      authorName: r.author_id
        ? (docAuthorNames.get(r.author_id) ?? null)
        : null,
    }));

    if (canEmitDocuments) {
      const { data: tplRows } = await supabase
        .from("document_templates")
        .select("id, kind, title, body, clinic_id")
        .eq("is_active", true)
        .order("kind")
        .order("title")
        .returns<
          {
            id: string;
            kind: DocumentKind;
            title: string;
            body: string;
            clinic_id: string | null;
          }[]
        >();
      documentTemplates = (tplRows ?? []).map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        body: t.body,
        clinicId: t.clinic_id,
      }));
    }
  }

  // -- H4.6 D: pedidos ao coordenador (reavaliação / revisão do plano) --
  const canCreateRequest =
    session.isAdminMaster ||
    hasRoleInClinic(session, scheduleClinicId, ["dentist"]);
  const canResolveRequest =
    session.isAdminMaster ||
    hasRoleInClinic(session, scheduleClinicId, ["clinical_coordinator"]);
  const canViewRequests =
    canCreateRequest || canResolveRequest || isPlannerAnywhere || canViewClinical;
  let clinicalRequests: ClinicalRequestItem[] = [];
  if (canViewRequests) {
    const { data: reqRows } = await supabase
      .from("clinical_requests")
      .select(
        "id, kind, body, status, requested_by, resolved_by, resolved_at, resolution_note, created_at"
      )
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .returns<
        {
          id: string;
          kind: ClinicalRequestKind;
          body: string;
          status: "open" | "resolved";
          requested_by: string;
          resolved_by: string | null;
          resolved_at: string | null;
          resolution_note: string | null;
          created_at: string;
        }[]
      >();
    const reqIds = (reqRows ?? []).map((r) => r.id);
    const mediaByReq = new Map<string, RequestMediaItem[]>();
    if (reqIds.length > 0) {
      const { data: rmRows } = await supabase
        .from("clinical_request_media")
        .select("id, request_id, storage_path, original_name")
        .in("request_id", reqIds)
        .order("created_at")
        .returns<
          {
            id: string;
            request_id: string;
            storage_path: string;
            original_name: string | null;
          }[]
        >();
      for (const m of rmRows ?? []) {
        let url: string | null = null;
        if (m.storage_path) {
          const { data: signed } = await supabase.storage
            .from(CLINICAL_BUCKET)
            .createSignedUrl(m.storage_path, 3600);
          url = signed?.signedUrl ?? null;
        }
        const list = mediaByReq.get(m.request_id) ?? [];
        list.push({ id: m.id, name: m.original_name ?? "arquivo", url });
        mediaByReq.set(m.request_id, list);
      }
    }
    const reqPersonIds = [
      ...new Set(
        (reqRows ?? [])
          .flatMap((r) => [r.requested_by, r.resolved_by])
          .filter((x): x is string => Boolean(x))
      ),
    ];
    const reqPersonNames = new Map<string, string>();
    if (reqPersonIds.length > 0) {
      const { data: people } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", reqPersonIds);
      for (const p of people ?? []) reqPersonNames.set(p.id, p.full_name);
    }
    clinicalRequests = (reqRows ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      body: r.body,
      status: r.status,
      requesterName: reqPersonNames.get(r.requested_by) ?? null,
      createdAt: r.created_at,
      resolvedByName: r.resolved_by
        ? (reqPersonNames.get(r.resolved_by) ?? null)
        : null,
      resolvedAt: r.resolved_at,
      resolutionNote: r.resolution_note,
      media: mediaByReq.get(r.id) ?? [],
    }));
  }

  // -- H4.12: câmera intraoral — captura de imagem (Coordenador e Dentista) --
  const canCaptureImage =
    session.isAdminMaster ||
    hasRoleInClinic(session, scheduleClinicId, [
      "clinical_coordinator",
      "dentist",
    ]);
  // O Coordenador já vê a galeria completa na aba Clínico (ClinicalSection); o
  // Dentista não — então mostramos a galeria de imagens aqui só para ele.
  const showImagesGallery =
    !canViewClinical &&
    hasRoleInClinic(session, scheduleClinicId, ["dentist"]);
  let captureConsent = consentInfo != null;
  let clinicalImages: ClinicalImageItem[] = [];
  if (canCaptureImage && !canViewClinical) {
    const { data: consentRows } = await supabase
      .from("client_consents")
      .select("id")
      .eq("client_id", id)
      .is("revoked_at", null)
      .limit(1);
    captureConsent = (consentRows?.length ?? 0) > 0;
  }
  if (showImagesGallery) {
    const { data: imgRows } = await supabase
      .from("clinical_media")
      .select("id, kind, original_name, display_name, storage_path")
      .eq("client_id", id)
      .in("kind", ["photo", "radiograph", "scan"])
      .order("created_at", { ascending: false })
      .returns<
        {
          id: string;
          kind: string;
          original_name: string | null;
          display_name: string | null;
          storage_path: string | null;
        }[]
      >();
    clinicalImages = await Promise.all(
      (imgRows ?? []).map(async (m) => {
        let url: string | null = null;
        if (m.storage_path) {
          const { data: signed } = await supabase.storage
            .from(CLINICAL_BUCKET)
            .createSignedUrl(m.storage_path, 3600);
          url = signed?.signedUrl ?? null;
        }
        return {
          id: m.id,
          url,
          kind: m.kind,
          name: m.display_name ?? m.original_name ?? "Imagem",
        };
      })
    );
  }

  // -- Anamnese A4: obrigatória na 1ª consulta; na reavaliação (Fase 6), exige
  // atualização se a última versão tem mais de 12 meses.
  const anamnesisCutoff = new Date();
  anamnesisCutoff.setFullYear(anamnesisCutoff.getFullYear() - 1);
  const anamnesisMissing = canViewAnamnesis && anamnesisFills.length === 0;
  const latestAnamnesisAt = anamnesisFills.reduce(
    (max, g) => Math.max(max, new Date(g.current.filledAt).getTime()),
    0
  );
  const anamnesisOutdated =
    anamnesisFills.length > 0 && latestAnamnesisAt < anamnesisCutoff.getTime();
  const isReeval = client.journey_phase === "reevaluation";
  const isFirstConsult = client.journey_phase === "clinical_conversion";
  const anamnesisBlocksPlanning =
    canViewAnamnesis && (anamnesisMissing || (isReeval && anamnesisOutdated));
  const anamnesisBlockMessage = anamnesisMissing
    ? "Preencha a anamnese do cliente antes de enviar ao Centro de Planejamento."
    : "A anamnese tem mais de 12 meses. Atualize-a antes de enviar ao planejamento.";
  const anamnesisNudge =
    !canEditClinical
      ? null
      : anamnesisMissing && (isFirstConsult || isReeval)
        ? "A anamnese ainda não foi preenchida — é obrigatória nesta consulta."
        : isReeval && anamnesisOutdated
          ? "Reavaliação: a anamnese tem mais de 12 meses. Atualize-a com o paciente."
          : null;

  // -- Plano de tratamento (Etapa 5 — Centro de Planejamento). O plano pertence
  // à unidade de origem do cliente; o Planner edita, o Coordenador/Gerente leem.
  const canEditPlanning = session.isAdminMaster || isPlannerAnywhere;
  const canViewPlanning =
    canEditPlanning ||
    hasRoleInClinic(session, client.clinic_id, [
      "clinical_coordinator",
      "unit_manager",
    ]);
  // The clinic's Coordenador (or Admin) approves/returns the submitted plan.
  const canReviewPlan =
    session.isAdminMaster ||
    hasRoleInClinic(session, client.clinic_id, ["clinical_coordinator"]);
  let treatmentPlan: TreatmentPlan | null = null;
  const protocolByProcedure: Record<string, ProtocolRef> = {};
  const realStatsByProcedure: Record<string, RealStat> = {};
  if (canViewPlanning) {
    const { data: planRows } = await supabase
      .from("treatment_plans")
      .select(
        "id, status, diagnosis, objectives, planning_notes, created_at, submitted_at, reviewed_at, review_notes"
      )
      .eq("client_id", id)
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

    // Protocolos (Rede + unidade do cliente) — base de sessões/tempo (E3).
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

    // Médias REALIZADAS por procedimento na unidade do cliente (E5).
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

  // -- H4.6 B2: resumo do plano SEM valores para o Dentista (que não vê a
  // PlanningSection com orçamento). Diagnóstico + procedimentos por etapa.
  const showPlanSummary =
    !canViewPlanning && hasRoleInClinic(session, scheduleClinicId, ["dentist"]);
  let planSummary: {
    diagnosis: string | null;
    objectives: string | null;
    optionTitle: string | null;
    stages: PlanSummaryStage[];
  } | null = null;
  if (showPlanSummary) {
    const { data: planRows } = await supabase
      .from("treatment_plans")
      .select("id, diagnosis, objectives")
      .eq("client_id", id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<{ id: string; diagnosis: string | null; objectives: string | null }[]>();
    const plan = planRows?.[0];
    if (plan) {
      const { data: optRows } = await supabase
        .from("treatment_plan_options")
        .select("id, is_primary, title, review_status, sort_order")
        .eq("plan_id", plan.id)
        .order("is_primary", { ascending: false })
        .order("sort_order")
        .returns<
          {
            id: string;
            is_primary: boolean;
            title: string;
            review_status: "pending" | "approved" | "rejected";
            sort_order: number;
          }[]
        >();
      const option =
        (optRows ?? []).find((o) => o.review_status === "approved") ??
        (optRows ?? [])[0];
      if (option) {
        const [{ data: sumItems }, { data: sumStages }] = await Promise.all([
          supabase
            .from("treatment_plan_option_items")
            .select(
              "id, description, quantity, planned_sessions, stage_id, suggested_provider_id, sort_order"
            )
            .eq("option_id", option.id)
            .order("sort_order")
            .returns<
              {
                id: string;
                description: string;
                quantity: number;
                planned_sessions: number | null;
                stage_id: string | null;
                suggested_provider_id: string | null;
                sort_order: number;
              }[]
            >(),
          supabase
            .from("treatment_plan_stages")
            .select("id, name, sort_order")
            .eq("option_id", option.id)
            .order("sort_order")
            .returns<{ id: string; name: string; sort_order: number }[]>(),
        ]);
        const provIds = [
          ...new Set(
            (sumItems ?? [])
              .map((i) => i.suggested_provider_id)
              .filter((x): x is string => Boolean(x))
          ),
        ];
        const provNames = new Map<string, string>();
        if (provIds.length > 0) {
          const { data: people } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", provIds);
          for (const p of people ?? []) provNames.set(p.id, p.full_name);
        }
        const stageMeta = new Map<string, { name: string; order: number }>();
        for (const st of sumStages ?? [])
          stageMeta.set(st.id, { name: st.name, order: st.sort_order });
        const groups = new Map<
          string,
          { name: string; order: number; items: PlanSummaryStage["items"] }
        >();
        for (const it of sumItems ?? []) {
          const key = it.stage_id ?? "__none__";
          const meta = it.stage_id ? stageMeta.get(it.stage_id) : undefined;
          const entry = groups.get(key) ?? {
            name: meta?.name ?? "",
            order: it.stage_id ? (meta?.order ?? 999) : 1000,
            items: [],
          };
          entry.items.push({
            description: it.description,
            quantity: it.quantity,
            sessions: it.planned_sessions,
            providerName: it.suggested_provider_id
              ? (provNames.get(it.suggested_provider_id) ?? null)
              : null,
          });
          groups.set(key, entry);
        }
        planSummary = {
          diagnosis: plan.diagnosis,
          objectives: plan.objectives,
          optionTitle: option.title,
          stages: [...groups.values()]
            .sort((a, b) => a.order - b.order)
            .map((g) => ({ name: g.name, items: g.items })),
        };
      }
    }
  }

  // Catálogo de preços com o preço efetivo da unidade do cliente (para o Planner
  // montar o orçamento). Só carregado para quem edita o plano.
  let priceCatalog: PricedProcedure[] = [];
  if (canEditPlanning) {
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
    priceCatalog = resolveProcedurePrices(procedures, overrides);
  }

  // H4.5 Pedido 1: profissionais (dentistas) da unidade do cliente, para o
  // Planner indicar quem realiza cada procedimento.
  let planProviderOptions: { id: string; name: string }[] = [];
  if (canEditPlanning) {
    const sched = await getUnitSchedulingData(client.clinic_id);
    planProviderOptions = sched.staff
      .filter((s) => s.roles.includes("dentist"))
      .map((s) => ({ id: s.userId, name: s.name }));
  }

  // -- Apresentação do plano (entrada): Planner monta, Comercial apresenta --
  const canPresent =
    session.isAdminMaster ||
    isPlannerAnywhere ||
    (await hasRoleWithScopeForClinic(session, client.clinic_id, [
      "commercial_consultant",
      "clinical_coordinator",
      "unit_manager",
    ]));
  let hasApprovedPlan = treatmentPlan?.status === "approved";
  if (treatmentPlan === null && canPresent) {
    const { count } = await supabase
      .from("treatment_plans")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .eq("status", "approved");
    hasApprovedPlan = (count ?? 0) > 0;
  }

  // Risarte Empresarial: benefícios do programa para o orçamento (economia).
  const isProgramMember =
    Boolean(client.empresarial_company_id) && client.empresarial_active !== false;
  const program = isProgramMember ? await loadClientProgram(client.id) : null;
  const usage = isProgramMember ? await loadClientUsage(client.id) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div className="relative overflow-hidden rounded-xl border bg-card p-4 sm:p-5">
        <RisarteMark className="pointer-events-none absolute -top-6 -right-4 h-28 text-gold/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <div
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-gold",
                isBirthdayToday &&
                  "ring-2 ring-gold ring-offset-2 ring-offset-card"
              )}
              aria-hidden
            >
              {initialsOf(client.full_name)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                  {client.full_name}
                </h1>
                {client.code && (
                  <span className="rounded-md bg-gold/15 px-2 py-0.5 font-mono text-xs font-medium text-gold-foreground">
                    {client.code}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Cliente desde{" "}
                {new Date(client.created_at).toLocaleDateString("pt-BR")}
                {creatorName && <> · cadastrado por {creatorName}</>}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {clinicName && (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                    <Building2 className="size-3.5 shrink-0" /> {clinicName}
                  </span>
                )}
                {ageText && (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                    <Cake className="size-3.5 shrink-0" /> {ageText}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                  <Route className="size-3.5 shrink-0" />{" "}
                  {PHASE_LABELS[client.journey_phase as JourneyPhase]}
                </span>
              </div>
              {isBirthdayToday && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge className="bg-gold/20 text-gold-foreground">
                    🎉 Aniversário hoje
                  </Badge>
                  <BirthdayWhatsAppButton
                    fullName={client.full_name}
                    phone={client.phone}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {client.staff_member_id &&
                (client.risartano_active === false ? (
                  <Badge
                    variant="outline"
                    className="border-gold/50 text-muted-foreground"
                  >
                    ★ Ex-Risartano (inativo)
                  </Badge>
                ) : (
                  <Badge className="bg-gold/20 text-gold-foreground">
                    ★ É um Risartano
                  </Badge>
                ))}
              {client.empresarial_company_id &&
                (client.empresarial_active === false ? (
                  <Badge
                    variant="outline"
                    className="border-gold/50 text-muted-foreground"
                  >
                    ★ Ex-Risarte Empresarial
                  </Badge>
                ) : (
                  <Badge className="bg-gold/20 text-gold-foreground">
                    ★ Risarte Empresarial
                  </Badge>
                ))}
              {viewerIsFormerClinicOnly && (
                <Badge variant="destructive">
                  Transferido para{" "}
                  {currentClinicEntry?.clinics?.name ?? "outra unidade"}
                </Badge>
              )}
              <Badge
                variant={client.status === "active" ? "secondary" : "outline"}
              >
                {STATUS_LABELS[client.status as keyof typeof STATUS_LABELS]}
              </Badge>
            </div>
            {(canScheduleFromFicha || (hasApprovedPlan && canPresent)) && (
              <div className="flex flex-wrap items-center justify-end gap-2">
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
                    config={fichaConfig}
                    initialClientId={client.id}
                    fixedClinicId={scheduleClinicId}
                    trigger={<Button size="sm">Novo agendamento</Button>}
                  />
                )}
                {hasApprovedPlan && canPresent && (
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`/apresentacao/${client.id}`} />}
                  >
                    Apresentação
                  </Button>
                )}
              </div>
            )}
          </div>
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

      {anamnesisAlerts.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4" />
            Alertas da anamnese
          </h2>
          <ul className="mt-1.5 space-y-1">
            {anamnesisAlerts.map((a, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-destructive">{a.message}</span>
                <span className="text-muted-foreground"> — {a.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {anamnesisNudge && (
        <div className="flex items-center gap-2 rounded-md border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          {anamnesisNudge}
        </div>
      )}

      <ProntuarioTabs>
        <TabPanel id="cadastro" label="Cadastro">
          <ClientShares
            clientId={client.id}
            shares={activeShares}
            units={shareUnits}
            canShare={canManageShare}
            canEnd={canEndShare}
          />

          <EmpresarialPanel summary={usage} />

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
                        href={`/prontuarios/${guardian.guardian_client_id}`}
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
                        href={`/prontuarios/${dependent.clients.id}`}
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

          <ClientDataSection
            client={client}
            canEdit={canEdit}
            initialGuardians={(guardians ?? []).map((g) => ({
              fullName: g.full_name,
              cpf: g.cpf,
              birthDate: g.birth_date,
              relationship: g.relationship,
              phone: g.phone,
              guardianClientId: g.guardian_client_id,
            }))}
          />
        </TabPanel>

        <TabPanel id="jornada" label="Jornada">
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
        </TabPanel>

        {(canViewClinical || canViewProgress || canViewAnamnesis) && (
          <TabPanel id="clinico" label="Clínico">
            {canCaptureImage && (
              <ClinicalImagesSection
                clientId={client.id}
                clinicId={scheduleClinicId}
                canCapture={canCaptureImage}
                hasConsent={captureConsent}
                showGallery={showImagesGallery}
                images={clinicalImages}
              />
            )}
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
                anamnesisBlocksPlanning={anamnesisBlocksPlanning}
                anamnesisBlockMessage={anamnesisBlockMessage}
                canSchedulePresentation={canScheduleFromFicha}
                scheduleStaff={fichaStaff}
                scheduleConfig={fichaConfig}
                scheduleClinicId={scheduleClinicId}
              />
            )}
            {canViewAnamnesis && (
              <AnamnesisFill
                clientId={client.id}
                canEdit={canEditClinical}
                hasConsent={Boolean(consentInfo)}
                templates={anamnesisTemplates}
                fills={anamnesisFills}
                clientGender={client.gender}
              />
            )}
            {canViewProgress && (
              <ClinicalProgressSection
                clientId={client.id}
                clinicId={scheduleClinicId}
                canWrite={canWriteProgress}
                notes={progressNotes}
              />
            )}
            {canViewClinical && (
              <PlanningSupplements
                clientId={client.id}
                canAdd={canAddSupplement}
                supplements={planningSupplements}
              />
            )}
          </TabPanel>
        )}

        {(planSummary || canViewPlanning) && (
          <TabPanel id="plano" label="Plano">
            {planSummary && (
              <PlanSummarySection
                diagnosis={planSummary.diagnosis}
                objectives={planSummary.objectives}
                optionTitle={planSummary.optionTitle}
                stages={planSummary.stages}
              />
            )}
            {canViewPlanning && (
              <PlanningSection
                clientId={client.id}
                clientName={client.full_name}
                plan={treatmentPlan}
                canEdit={canEditPlanning}
                canReview={canReviewPlan}
                inPlanningPhase={client.journey_phase === "planning_center"}
                catalog={priceCatalog}
                protocols={protocolByProcedure}
                realStats={realStatsByProcedure}
                currentPillar={
                  client.methodology_pillar as MethodologyPillar | null
                }
                cockpitHref={
                  canEditPlanning ? `/planejamento/${client.id}` : undefined
                }
                providerOptions={planProviderOptions}
                programActive={program?.active ?? false}
                programCompanyName={program?.companyName ?? null}
                programBenefits={program?.byProcedure ?? {}}
              />
            )}
          </TabPanel>
        )}

        {(treatmentSessions.length > 0 || procedureItems.length > 0) && (
          <TabPanel id="sessoes" label="Sessões & Procedimentos">
            {treatmentSessions.length > 0 && (
              <TreatmentSessionsPanel
                clientId={client.id}
                clientName={client.full_name}
                clientInactive={client.status !== "active"}
                sessions={treatmentSessions}
                canSchedule={canScheduleFromFicha}
                staff={fichaStaff}
                config={fichaConfig}
                clinicId={scheduleClinicId}
              />
            )}
            {procedureItems.length > 0 && (
              <ClientProceduresSection
                clientId={client.id}
                canRequest={canRequestScheduling}
                items={procedureItems}
              />
            )}
          </TabPanel>
        )}

        {canViewDocuments && (
          <TabPanel id="documentos" label="Documentos">
            <DocumentsSection
              clientId={client.id}
              clinicId={scheduleClinicId}
              canEmit={canEmitDocuments}
              documents={documentItems}
              templates={documentTemplates}
            />
          </TabPanel>
        )}

        {canViewRequests && (
          <TabPanel id="pedidos" label="Pedidos">
            <RequestsSection
              clientId={client.id}
              clinicId={scheduleClinicId}
              canCreate={canCreateRequest}
              canResolve={canResolveRequest}
              requests={clinicalRequests}
            />
          </TabPanel>
        )}

        {((shareHistoryRows ?? []).length > 0 ||
          (clinicHistory ?? []).length > 1 ||
          (appointmentChanges ?? []).length > 0 ||
          (clientChanges ?? []).length > 0) && (
          <TabPanel id="historico" label="Histórico">
            {(shareHistoryRows ?? []).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Histórico de compartilhamento
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {(shareHistoryRows ?? []).map((s) => (
                      <li key={s.id} className="text-sm">
                        <span className="font-medium">
                          {s.clinics?.name ?? "Unidade"}
                        </span>{" "}
                        <Badge
                          variant={s.ended_at ? "outline" : "secondary"}
                          className="text-[10px]"
                        >
                          {s.ended_at ? "Encerrado" : "Ativo"}
                        </Badge>
                        <div className="text-xs text-muted-foreground">
                          Início:{" "}
                          {new Date(s.started_at).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {s.ended_at
                            ? ` · Encerrado: ${new Date(
                                s.ended_at
                              ).toLocaleString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}`
                            : ""}
                          {s.profiles?.full_name
                            ? ` · por ${s.profiles.full_name}`
                            : ""}
                          {s.reason ? ` · ${s.reason}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {(clinicHistory ?? []).length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Histórico de unidades
                  </CardTitle>
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
          </TabPanel>
        )}
      </ProntuarioTabs>
    </div>
  );
}
