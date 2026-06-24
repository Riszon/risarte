import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { FilterForm } from "@/components/filter-form";
import {
  agendaRange,
  isAgendaView,
  toIsoDate,
  type AgendaView,
} from "@/lib/agenda-view";
import type {
  AppointmentStatus,
  AppointmentType,
  AttendanceStatus,
  StaffOption,
} from "@/lib/appointments";
import type { UserRole } from "@/lib/roles";
import type { JourneyPhase, MethodologyPillar } from "@/lib/journey";
import { AppointmentFormDialog } from "./appointment-form-dialog";
import {
  getAgendaFormConfig,
  getUnitSchedulingData,
  notifyPendingHolidays,
  type AgendaFormConfig,
} from "./actions";
import { holidaysInRange } from "@/lib/holidays";
import { WeekGrid, type AgendaAppointment } from "./week-grid";
import { WeekTimeGrid } from "./week-time-grid";
import { MonthView } from "./month-grid";
import { DayRoomGrid } from "./day-room-grid";
import { RoomFilter } from "./room-filter";
import { CloseAgendaDialog } from "./close-agenda-dialog";
import { AgendaToolbar } from "./agenda-toolbar";
import {
  mapClosure,
  type AgendaClosure,
  type AgendaClosureRow,
} from "@/lib/closures";

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
  room_id?: string | null;
  is_online?: boolean | null;
  room?: { name: string } | null;
  needs_reschedule?: boolean | null;
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

export default async function AgendaPage(props: PageProps<"/agenda">) {
  const session = await getSessionContext();
  const searchParams = await props.searchParams;
  const clinicId = session.activeClinic?.id;
  const isFranchisor = session.activeClinic?.type === "franchisor";

  const view: AgendaView =
    typeof searchParams.vista === "string" && isAgendaView(searchParams.vista)
      ? searchParams.vista
      : "semana";
  const refParam = typeof searchParams.ref === "string" ? searchParams.ref : "";
  const refBase = refParam ? new Date(`${refParam}T00:00:00`) : new Date();
  const ref = Number.isNaN(refBase.getTime()) ? new Date() : refBase;
  const range = agendaRange(view, ref);

  const periodLabel =
    range.weekNumber !== null
      ? `${range.label} (semana ${range.weekNumber})`
      : range.label;

  // -------------------------------------------------------------------------
  // Franchisor context: consolidated NETWORK agenda (avaliações F2, reavaliações
  // F6 e, em destaque, apresentações comerciais F4).
  // -------------------------------------------------------------------------
  if (isFranchisor) {
    const isPlanner = Object.values(session.rolesByClinic).some((r) =>
      r.includes("planner_dentist")
    );
    const isConsultant = Object.values(session.rolesByClinic).some((r) =>
      r.includes("commercial_consultant")
    );
    const isSdr = Object.values(session.rolesByClinic).some((r) =>
      r.includes("sdr")
    );
    const consultantOnly =
      isConsultant && !isPlanner && !session.isAdminMaster;
    const sdrOnly = isSdr && !isPlanner && !isConsultant && !session.isAdminMaster;

    const unitFilter =
      typeof searchParams.unidade === "string" ? searchParams.unidade : "";
    const supabase = await createClient();

    let netQuery = supabase
      .from("appointments")
      .select(
        "id, type, status, starts_at, ends_at, notes, provider_user_id, attendance, room_id, is_online, room:clinic_rooms ( name ), clinic_id, clinics ( name ), provider:profiles!appointments_provider_user_id_fkey ( full_name ), clients ( id, full_name, journey_phase, methodology_pillar )"
      )
      .gte("starts_at", range.start.toISOString())
      .lt("starts_at", range.end.toISOString())
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
        room_id: a.room_id ?? null,
        room_name: a.room?.name ?? null,
        is_online: a.is_online ?? false,
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
              {consultantOnly
                ? "Apresentações comerciais (Fase 4) agendadas para você."
                : "Avaliações (Fase 2), reavaliações (Fase 6) e apresentações comerciais (Fase 4, em destaque dourado)."}{" "}
              <span className="font-medium">{periodLabel}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterForm className="flex items-center gap-2">
              <input type="hidden" name="vista" value={view} />
              <input type="hidden" name="ref" value={toIsoDate(range.start)} />
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
            </FilterForm>
            <AgendaToolbar view={view} range={range} unidade={unitFilter} />
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
          {view === "mes" ? (
            <MonthView
              monthStartIso={range.start.toISOString()}
              appointments={networkAppointments}
              unidade={unitFilter || undefined}
            />
          ) : (
            <WeekGrid
              weekStartIso={range.start.toISOString()}
              appointments={networkAppointments}
              canManage={false}
              staff={[]}
              highlightType="commercial_presentation"
              dayCount={range.dayCount}
            />
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Unit agenda.
  // -------------------------------------------------------------------------
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
  const canConfig = hasRoleInClinic(session, clinicId, ["unit_manager"]);
  const canCloseAgenda = hasRoleInClinic(session, clinicId, [
    "receptionist",
    "unit_manager",
  ]);
  let roomCount = 0;
  let formConfig: AgendaFormConfig | undefined;
  let closures: AgendaClosure[] = [];
  let openDayDates: string[] = [];
  const holidayClosedDates: string[] = [];
  const holidayOpenDates: string[] = [];
  let rangeHolidays: { date: string; name: string }[] = [];

  if (clinicId) {
    const supabase = await createClient();
    formConfig = await getAgendaFormConfig(clinicId);
    roomCount = formConfig.rooms.length;
    const { data: closureRows } = await supabase
      .from("agenda_closures")
      .select(
        "id, starts_at, ends_at, scope, reason, note, agenda_closure_rooms ( room_id ), agenda_closure_providers ( user_id )"
      )
      .eq("clinic_id", clinicId)
      .lt("starts_at", range.end.toISOString())
      .gt("ends_at", range.start.toISOString())
      .order("starts_at");
    closures = (closureRows ?? []).map((r) =>
      mapClosure(r as AgendaClosureRow)
    );

    // Working days / special open days / holiday decisions (G5).
    const rangeStartIso = toIsoDate(range.start);
    const rangeEndIso = toIsoDate(range.end);
    const rangeLastIso = toIsoDate(new Date(range.end.getTime() - 86_400_000));
    const [{ data: openDayRows }, { data: holidayRows }] = await Promise.all([
      supabase
        .from("agenda_open_days")
        .select("date")
        .eq("clinic_id", clinicId)
        .gte("date", rangeStartIso)
        .lt("date", rangeEndIso),
      supabase
        .from("clinic_holiday_decisions")
        .select("holiday_date, will_attend")
        .eq("clinic_id", clinicId)
        .gte("holiday_date", rangeStartIso)
        .lt("holiday_date", rangeEndIso),
    ]);
    openDayDates = (openDayRows ?? []).map((r) => r.date as string);
    for (const r of (holidayRows ?? []) as {
      holiday_date: string;
      will_attend: boolean;
    }[]) {
      if (r.will_attend) holidayOpenDates.push(r.holiday_date);
      else holidayClosedDates.push(r.holiday_date);
    }
    rangeHolidays = holidaysInRange(rangeStartIso, rangeLastIso);

    // Managers get a one-time notification per upcoming undecided holiday.
    if (canConfig) {
      const todayDate = new Date();
      const horizon = new Date(todayDate);
      horizon.setDate(horizon.getDate() + 60);
      const upcoming = holidaysInRange(toIsoDate(todayDate), toIsoDate(horizon));
      await notifyPendingHolidays(
        clinicId,
        upcoming.map((h) => h.date),
        upcoming.map((h) => h.name)
      );
    }

    const [{ data: appts }, { data: clientRows }, { data: staffRows }] =
      await Promise.all([
        supabase
          .from("appointments")
          .select(
            "id, type, status, starts_at, ends_at, notes, provider_user_id, attendance, room_id, is_online, needs_reschedule, room:clinic_rooms ( name ), provider:profiles!appointments_provider_user_id_fkey ( full_name ), clients ( id, full_name, journey_phase, methodology_pillar )"
          )
          .eq("clinic_id", clinicId)
          .gte("starts_at", range.start.toISOString())
          .lt("starts_at", range.end.toISOString())
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
        canSchedule || canCloseAgenda
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
    room_id: a.room_id ?? null,
    room_name: a.room?.name ?? null,
    is_online: a.is_online ?? false,
    needs_reschedule: a.needs_reschedule ?? false,
    clients: a.clients,
  }));

  // Room filter (G3): ?salas=id,id,online (empty = all rooms).
  const salasRaw = Array.isArray(searchParams.salas)
    ? searchParams.salas.join(",")
    : typeof searchParams.salas === "string"
      ? searchParams.salas
      : "";
  const selectedSalas = salasRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const hasSalaFilter = selectedSalas.length > 0;
  const filteredUnitAppointments = hasSalaFilter
    ? unitAppointments.filter(
        (a) =>
          (a.is_online && selectedSalas.includes("online")) ||
          (a.room_id != null && selectedSalas.includes(a.room_id))
      )
    : unitAppointments;
  const allRooms = (formConfig?.rooms ?? []).map((r) => ({
    id: r.id,
    name: r.name,
  }));
  const displayRooms = hasSalaFilter
    ? allRooms.filter((r) => selectedSalas.includes(r.id))
    : allRooms;

  // Day open/holiday info (G5) for the day view.
  const dayIso = toIsoDate(range.start);
  const holidaysByDate = new Map(rangeHolidays.map((h) => [h.date, h.name]));
  const dayHolidayName = holidaysByDate.get(dayIso) ?? null;
  const dayHolidayDecision = holidayOpenDates.includes(dayIso)
    ? true
    : holidayClosedDates.includes(dayIso)
      ? false
      : null;
  const weekdaysCfg = formConfig?.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
  let dayIsOpen =
    weekdaysCfg.includes(range.start.getDay()) ||
    openDayDates.includes(dayIso);
  if (dayHolidayDecision === true) dayIsOpen = true;
  if (dayHolidayDecision === false) dayIsOpen = false;

  return (
    <div className="space-y-4 px-4 py-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            {session.activeClinic
              ? `${session.activeClinic.name} — ${periodLabel}${
                  roomCount > 0
                    ? ` · ${roomCount} sala${roomCount === 1 ? "" : "s"}`
                    : ""
                }`
              : "Selecione uma clínica no menu lateral."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AgendaToolbar view={view} range={range} salas={salasRaw || undefined} />
          {canConfig && clinicId && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/agenda/configuracao" />}
            >
              Configurar agenda
            </Button>
          )}
          {canCloseAgenda && clinicId && (
            <CloseAgendaDialog
              clinicId={clinicId}
              rooms={allRooms}
              staff={staff}
            />
          )}
          {(canSchedule || canCloseAgenda) && clinicId && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/agenda/retornos" />}
            >
              Retornos e controles
            </Button>
          )}
          {canSchedule && clinicId && (
            <AppointmentFormDialog
              clients={clients}
              staff={staff}
              config={formConfig}
              activeClinicId={clinicId}
              trigger={<Button size="sm">Novo agendamento</Button>}
              initialClientId={preselectClientId}
              defaultOpen={Boolean(preselectClientId)}
            />
          )}
        </div>
      </div>

      {clinicId && allRooms.length > 0 && (
        <div className="mx-auto max-w-7xl">
          <RoomFilter rooms={allRooms} selected={selectedSalas} />
        </div>
      )}

      {clinicId && (
        <div className="mx-auto max-w-7xl overflow-x-auto pb-4">
          {view === "mes" ? (
            <MonthView
              monthStartIso={range.start.toISOString()}
              appointments={filteredUnitAppointments}
            />
          ) : view === "dia" ? (
            <DayRoomGrid
              dateIso={range.start.toISOString()}
              appointments={filteredUnitAppointments}
              rooms={displayRooms}
              selectedSalas={selectedSalas}
              unitHasRooms={allRooms.length > 0}
              openTime={formConfig?.openTime ?? "08:00"}
              closeTime={formConfig?.closeTime ?? "18:00"}
              canManage={canSchedule}
              staff={staff}
              clients={clients}
              config={formConfig}
              closures={closures}
              canManageClosures={canCloseAgenda}
              holidayName={dayHolidayName}
              holidayDecision={dayHolidayDecision}
              dayOpen={dayIsOpen}
              canDecideHoliday={canConfig}
              clinicId={clinicId}
            />
          ) : (
            <WeekTimeGrid
              weekStartIso={range.start.toISOString()}
              appointments={filteredUnitAppointments}
              canManage={canSchedule}
              staff={staff}
              config={formConfig}
              clients={clients}
              activeClinicId={clinicId}
              weekdays={formConfig?.weekdays}
              openDayDates={openDayDates}
              holidayClosedDates={holidayClosedDates}
              holidayOpenDates={holidayOpenDates}
              holidays={rangeHolidays}
            />
          )}
        </div>
      )}
    </div>
  );
}
