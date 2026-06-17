import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import type {
  AppointmentStatus,
  AppointmentType,
  AttendanceStatus,
  StaffOption,
} from "@/lib/appointments";
import type { UserRole } from "@/lib/roles";
import type { JourneyPhase, MethodologyPillar } from "@/lib/journey";
import { AppointmentFormDialog } from "./appointment-form-dialog";
import { getUnitSchedulingData } from "./actions";
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
  attendance: AttendanceStatus | null;
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
    // Every franchisor-context user sees the consolidated agenda of the units
    // they have access to (RLS limits the rows to their scope).
    const isPlanner = Object.values(session.rolesByClinic).some((r) =>
      r.includes("planner_dentist")
    );
    const isConsultant = Object.values(session.rolesByClinic).some((r) =>
      r.includes("commercial_consultant")
    );
    const isSdr = Object.values(session.rolesByClinic).some((r) =>
      r.includes("sdr")
    );
    // A Consultor Comercial sees ONLY the appointments under their own name.
    const consultantOnly =
      isConsultant && !isPlanner && !session.isAdminMaster;
    // The SDR sees the FULL agenda of the units she covers and can schedule.
    const sdrOnly = isSdr && !isPlanner && !isConsultant && !session.isAdminMaster;

    const unitFilter =
      typeof searchParams.unidade === "string" ? searchParams.unidade : "";
    const supabase = await createClient();

    let netQuery = supabase
      .from("appointments")
      .select(
        "id, type, status, starts_at, ends_at, notes, provider_user_id, attendance, clinic_id, clinics ( name ), provider:profiles!appointments_provider_user_id_fkey ( full_name ), clients ( id, full_name, journey_phase, methodology_pillar )"
      )
      .gte("starts_at", weekStart.toISOString())
      .lt("starts_at", weekEnd.toISOString())
      .order("starts_at");
    if (consultantOnly) {
      netQuery = netQuery
        .eq("provider_user_id", session.userId)
        .eq("type", "commercial_presentation");
    } else if (!sdrOnly) {
      netQuery = netQuery.in("type", [
        "evaluation",
        "reevaluation",
        "commercial_presentation",
      ]);
    }
    if (unitFilter) netQuery = netQuery.eq("clinic_id", unitFilter);

    const [{ data: netAppts }, { data: unitOptions }, { data: accessIds }] =
      await Promise.all([
        netQuery.returns<AppointmentRow[]>(),
        supabase
          .from("clinics")
          .select("id, name")
          .eq("type", "franchise_unit")
          .eq("is_active", true)
          .order("name"),
        sdrOnly
          ? supabase.rpc("user_full_access_clinic_ids")
          : Promise.resolve({ data: null }),
      ]);

    // Units the SDR can schedule into.
    const accessibleIds = new Set<string>(
      ((accessIds as { clinic_id?: string }[] | string[] | null) ?? []).map(
        (x) => (typeof x === "string" ? x : (x.clinic_id ?? ""))
      )
    );
    const sdrUnits = (unitOptions ?? []).filter((u) => accessibleIds.has(u.id));

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
        attendance: a.attendance,
        clinic_name: a.clinics?.name ?? null,
        clients: a.clients,
      })
    );

    return (
      <div className="space-y-4 px-4 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {consultantOnly ? "Minhas apresentações" : "Agenda da rede"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {consultantOnly ? (
                <>
                  Apresentações comerciais (Fase 4) agendadas para você — semana
                  de {weekLabelHeader}.
                </>
              ) : (
                <>
                  Avaliações (Fase 2), reavaliações (Fase 6) e, em{" "}
                  <span className="font-medium text-gold">destaque dourado</span>
                  , apresentações comerciais (Fase 4) — semana de{" "}
                  {weekLabelHeader}.
                </>
              )}
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
            {sdrOnly && sdrUnits.length > 0 && (
              <AppointmentFormDialog
                clients={[]}
                staff={[]}
                units={sdrUnits}
                loadUnitData={getUnitSchedulingData}
                trigger={<Button size="sm">Novo agendamento</Button>}
              />
            )}
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
  let clients: { id: string; full_name: string; inactive: boolean }[] = [];
  let staff: StaffOption[] = [];
  let preselectClientId: string | undefined;
  const clienteParam =
    typeof searchParams.cliente === "string" ? searchParams.cliente : "";
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
            "id, type, status, starts_at, ends_at, notes, provider_user_id, attendance, provider:profiles!appointments_provider_user_id_fkey ( full_name ), clients ( id, full_name, journey_phase, methodology_pillar )"
          )
          .eq("clinic_id", clinicId)
          .gte("starts_at", weekStart.toISOString())
          .lt("starts_at", weekEnd.toISOString())
          .order("starts_at")
          .returns<AppointmentRow[]>(),
        canSchedule
          ? supabase
              .from("clients")
              .select("id, full_name, status")
              .eq("clinic_id", clinicId)
              .neq("status", "anonymized")
              .order("full_name")
              .limit(300)
              .returns<{ id: string; full_name: string; status: string }[]>()
          : Promise.resolve({
              data: [] as { id: string; full_name: string; status: string }[],
            }),
        canSchedule
          ? supabase
              .from("user_clinic_roles")
              .select("user_id, role, profiles ( full_name )")
              .eq("clinic_id", clinicId)
              .returns<StaffRow[]>()
          : Promise.resolve({ data: [] as StaffRow[] }),
      ]);
    appointments = appts ?? [];
    clients = (clientRows ?? []).map((c) => ({
      id: c.id,
      full_name: c.full_name,
      inactive: c.status === "inactive",
    }));
    if (clienteParam && clients.some((c) => c.id === clienteParam)) {
      preselectClientId = clienteParam;
    }

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

  // Resolve provider names from the staff list. The professional may be a
  // Consultor of the matriz whose profile the receptionist can't read via the
  // join (RLS) — but the staff list already has the name.
  const staffNameById = new Map(staff.map((s) => [s.userId, s.name]));
  const unitAppointments: AgendaAppointment[] = appointments.map((a) => ({
    id: a.id,
    type: a.type,
    status: a.status,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    notes: a.notes,
    provider_user_id: a.provider_user_id,
    provider: a.provider_user_id
      ? {
          full_name:
            staffNameById.get(a.provider_user_id) ??
            a.provider?.full_name ??
            "—",
        }
      : null,
    attendance: a.attendance,
    clients: a.clients,
  }));

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
              initialClientId={preselectClientId}
              defaultOpen={Boolean(preselectClientId)}
            />
          )}
        </div>
      </div>

      {clinicId && (
        <div className="mx-auto max-w-7xl overflow-x-auto pb-4">
          <WeekGrid
            weekStartIso={weekStart.toISOString()}
            appointments={unitAppointments}
            canManage={canSchedule}
            staff={staff}
          />
        </div>
      )}
    </div>
  );
}
