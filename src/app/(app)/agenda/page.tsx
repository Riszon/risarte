import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  AppointmentStatus,
  AppointmentType,
  StaffOption,
} from "@/lib/appointments";
import type { UserRole } from "@/lib/roles";
import type { JourneyPhase, MethodologyPillar } from "@/lib/journey";
import { AppointmentFormDialog } from "./appointment-form-dialog";
import { WeekGrid, type AgendaAppointment } from "./week-grid";

export const metadata: Metadata = { title: "Agenda" };

type AppointmentRow = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  provider_user_id: string | null;
  provider: { full_name: string } | null;
  clinic_id?: string;
  clinics?: { name: string } | null;
  clients: {
    id: string;
    full_name: string;
    journey_phase: JourneyPhase;
    methodology_pillar: MethodologyPillar | null;
  } | null;
};

type StaffRow = {
  user_id: string;
  role: UserRole;
  profiles: { full_name: string } | null;
};

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = sunday
  const diff = day === 0 ? -6 : 1 - day; // monday as first day
  d.setDate(d.getDate() + diff);
  return d;
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function AgendaPage(props: PageProps<"/agenda">) {
  const session = await getSessionContext();
  const searchParams = await props.searchParams;
  const clinicId = session.activeClinic?.id;
  const isFranchisor = session.activeClinic?.type === "franchisor";

  const weekParam =
    typeof searchParams.semana === "string" ? searchParams.semana : "";
  const baseDate = weekParam ? new Date(`${weekParam}T00:00:00`) : new Date();
  const weekStart = startOfWeek(
    Number.isNaN(baseDate.getTime()) ? new Date() : baseDate
  );
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const prevWeek = new Date(weekStart);
  prevWeek.setDate(prevWeek.getDate() - 7);
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const weekLabelHeader = `${weekStart.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  })} – ${new Date(weekEnd.getTime() - 864e5).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  })}`;

  // -------------------------------------------------------------------------
  // Franchisor context: consolidated NETWORK agenda focused on the cases the
  // Dentista Planner cares about — evaluations (FASE 2), reevaluations
  // (FASE 6) and, highlighted, commercial presentations (FASE 4).
  // -------------------------------------------------------------------------
  if (isFranchisor) {
    const isPlanner = Object.values(session.rolesByClinic).some((roles) =>
      roles.includes("planner_dentist")
    );
    const canSeeNetwork =
      session.isAdminMaster || isPlanner || session.clinics.length > 1;

    if (!canSeeNetwork) {
      return (
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                A Franqueadora não tem agenda própria
              </CardTitle>
              <CardDescription>
                Os atendimentos acontecem nas unidades. Use o seletor no menu
                lateral para abrir a agenda de uma unidade.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      );
    }

    const unitFilter =
      typeof searchParams.unidade === "string" ? searchParams.unidade : "";
    const supabase = await createClient();

    let netQuery = supabase
      .from("appointments")
      .select(
        "id, type, status, starts_at, ends_at, notes, provider_user_id, clinic_id, clinics ( name ), provider:profiles!appointments_provider_user_id_fkey ( full_name ), clients ( id, full_name, journey_phase, methodology_pillar )"
      )
      .in("type", ["evaluation", "reevaluation", "commercial_presentation"])
      .gte("starts_at", weekStart.toISOString())
      .lt("starts_at", weekEnd.toISOString())
      .order("starts_at");
    if (unitFilter) netQuery = netQuery.eq("clinic_id", unitFilter);

    const [{ data: netAppts }, { data: unitOptions }] = await Promise.all([
      netQuery.returns<AppointmentRow[]>(),
      supabase
        .from("clinics")
        .select("id, name")
        .eq("type", "franchise_unit")
        .eq("is_active", true)
        .order("name"),
    ]);

    const networkAppointments: AgendaAppointment[] = (netAppts ?? []).map(
      (a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
        notes: a.notes,
        provider_user_id: a.provider_user_id,
        provider: a.provider,
        clinic_name: a.clinics?.name ?? null,
        clients: a.clients,
      })
    );

    return (
      <div className="space-y-4 px-4 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Agenda da rede
            </h1>
            <p className="text-sm text-muted-foreground">
              Avaliações (Fase 2), reavaliações (Fase 6) e, em{" "}
              <span className="font-medium text-gold">destaque dourado</span>,
              apresentações comerciais (Fase 4) — semana de {weekLabelHeader}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="semana" value={toIsoDate(weekStart)} />
              <select
                name="unidade"
                defaultValue={unitFilter}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="">Todas as unidades</option>
                {(unitOptions ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" size="sm">
                Filtrar
              </Button>
            </form>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link
                  href={`/agenda?semana=${toIsoDate(prevWeek)}${unitFilter ? `&unidade=${unitFilter}` : ""}`}
                />
              }
            >
              ← Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/agenda" />}
            >
              Hoje
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link
                  href={`/agenda?semana=${toIsoDate(nextWeek)}${unitFilter ? `&unidade=${unitFilter}` : ""}`}
                />
              }
            >
              Próxima →
            </Button>
          </div>
        </div>
        <div className="mx-auto max-w-7xl overflow-x-auto pb-4">
          <WeekGrid
            weekStartIso={weekStart.toISOString()}
            appointments={networkAppointments}
            canManage={false}
            staff={[]}
            highlightType="commercial_presentation"
          />
        </div>
      </div>
    );
  }

  let appointments: AppointmentRow[] = [];
  let clients: { id: string; full_name: string }[] = [];
  let staff: StaffOption[] = [];
  const canSchedule = hasRoleInClinic(session, clinicId, [
    "receptionist",
    "sdr",
  ]);

  if (clinicId) {
    const supabase = await createClient();
    const [{ data: appts }, { data: clientRows }, { data: staffRows }] =
      await Promise.all([
        supabase
          .from("appointments")
          .select(
            "id, type, status, starts_at, ends_at, notes, provider_user_id, provider:profiles!appointments_provider_user_id_fkey ( full_name ), clients ( id, full_name, journey_phase, methodology_pillar )"
          )
          .eq("clinic_id", clinicId)
          .gte("starts_at", weekStart.toISOString())
          .lt("starts_at", weekEnd.toISOString())
          .order("starts_at")
          .returns<AppointmentRow[]>(),
        canSchedule
          ? supabase
              .from("clients")
              .select("id, full_name")
              .eq("clinic_id", clinicId)
              .eq("status", "active")
              .order("full_name")
              .limit(300)
          : Promise.resolve({ data: [] }),
        canSchedule
          ? supabase
              .from("user_clinic_roles")
              .select("user_id, role, profiles ( full_name )")
              .eq("clinic_id", clinicId)
              .returns<StaffRow[]>()
          : Promise.resolve({ data: [] as StaffRow[] }),
      ]);
    appointments = appts ?? [];
    clients = clientRows ?? [];

    const staffMap = new Map<string, StaffOption>();
    for (const row of staffRows ?? []) {
      const entry = staffMap.get(row.user_id) ?? {
        userId: row.user_id,
        name: row.profiles?.full_name ?? "—",
        roles: [],
      };
      entry.roles.push(row.role);
      staffMap.set(row.user_id, entry);
    }

    // Commercial presentations are run by Consultores Comerciais of the matriz
    // whose unit-access scope reaches this clinic — add them to the providers.
    if (canSchedule) {
      const { data: consultants } = await supabase.rpc(
        "providers_with_access",
        { p_clinic_id: clinicId, p_role: "commercial_consultant" }
      );
      for (const c of (consultants ?? []) as {
        user_id: string;
        full_name: string;
      }[]) {
        const entry = staffMap.get(c.user_id) ?? {
          userId: c.user_id,
          name: c.full_name ?? "—",
          roles: [],
        };
        if (!entry.roles.includes("commercial_consultant")) {
          entry.roles.push("commercial_consultant");
        }
        staffMap.set(c.user_id, entry);
      }
    }

    staff = [...staffMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  const weekLabel = `${weekStart.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  })} – ${new Date(weekEnd.getTime() - 864e5).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  })}`;

  return (
    <div className="space-y-4 px-4 py-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            {session.activeClinic
              ? `${session.activeClinic.name} — semana de ${weekLabel}`
              : "Selecione uma clínica no menu lateral."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/agenda?semana=${toIsoDate(prevWeek)}`} />}
          >
            ← Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/agenda" />}
          >
            Hoje
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/agenda?semana=${toIsoDate(nextWeek)}`} />}
          >
            Próxima →
          </Button>
          {canSchedule && clinicId && (
            <AppointmentFormDialog
              clients={clients}
              staff={staff}
              trigger={<Button size="sm">Novo agendamento</Button>}
            />
          )}
        </div>
      </div>

      {clinicId && (
        <div className="mx-auto max-w-7xl overflow-x-auto pb-4">
          <WeekGrid
            weekStartIso={weekStart.toISOString()}
            appointments={appointments as AgendaAppointment[]}
            canManage={canSchedule}
            staff={staff}
          />
        </div>
      )}
    </div>
  );
}
