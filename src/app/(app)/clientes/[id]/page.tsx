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
import type { StaffOption } from "@/lib/appointments";
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
      "id, code, clinic_id, preferred_clinic_id, full_name, cpf, birth_date, phone, email, address, address_number, complement, neighborhood, city, state, zip_code, notes, status, created_at, created_by, journey_phase, journey_status, phase_entered_at, methodology_pillar, creator:profiles!clients_created_by_fkey ( full_name )"
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

  const canEdit =
    client.status !== "anonymized" &&
    hasRoleInClinic(session, client.clinic_id, ["receptionist"]);

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
  const ageText = client.birth_date
    ? formatDetailedAge(client.birth_date)
    : "";

  // "Novo agendamento" from the ficha (reception of the client's unit, or SDR).
  // SDR-registered clients belong to the Franqueadora but prefer a unit, so we
  // schedule into the preferred unit when set.
  const isSdr = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("sdr")
  );
  const effectiveClinicId =
    (client as { preferred_clinic_id?: string | null }).preferred_clinic_id ??
    client.clinic_id;
  const canScheduleFromFicha =
    client.status !== "anonymized" &&
    (hasRoleInClinic(session, effectiveClinicId, ["receptionist"]) || isSdr);
  let fichaStaff: StaffOption[] = [];
  if (canScheduleFromFicha) {
    fichaStaff = (await getUnitSchedulingData(effectiveClinicId)).staff;
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
              fixedClinicId={effectiveClinicId}
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
