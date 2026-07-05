import type { Metadata } from "next";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FilterForm } from "@/components/filter-form";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  AppointmentStatus,
  AppointmentType,
  AttendanceStatus,
} from "@/lib/appointments";
import {
  resolveAgendaSettings,
  type AgendaSettingRow,
} from "@/lib/agenda-settings";
import type { JourneyPhase } from "@/lib/journey";
import {
  AttendancePanel,
  type PanelAppointment,
  type SwapStaff,
} from "./attendance-panel";

export const metadata: Metadata = { title: "Atendimento" };

type Row = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  starts_at: string;
  attendance: AttendanceStatus | null;
  checked_in_at: string | null;
  called_at: string | null;
  done_at: string | null;
  checked_in_by: string | null;
  called_by: string | null;
  done_by: string | null;
  provider_user_id: string | null;
  clinic_id: string;
  is_online: boolean | null;
  provider: { full_name: string } | null;
  clinics: { name: string } | null;
  room: { name: string } | null;
  clients: { id: string; full_name: string; journey_phase: JourneyPhase } | null;
};

type Period = "dia" | "semana" | "mes";

const PERIOD_LABELS: Record<Period, string> = {
  dia: "Dia",
  semana: "Semana",
  mes: "Mês",
};

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = sunday
  const diff = day === 0 ? -6 : 1 - day; // monday as first day
  d.setDate(d.getDate() + diff);
  return d;
}

function periodRange(period: Period): { start: Date; end: Date; label: string } {
  const base = new Date();
  if (period === "semana") {
    const start = startOfWeek(base);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const last = new Date(end.getTime() - 864e5);
    return {
      start,
      end,
      label: `semana de ${start.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      })} a ${last.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      })}`,
    };
  }
  if (period === "mes") {
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    return {
      start,
      end,
      label: base.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      }),
    };
  }
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end, label: `hoje, ${start.toLocaleDateString("pt-BR")}` };
}

export default async function AtendimentoPage(
  props: PageProps<"/atendimento">
) {
  const session = await getSessionContext();
  const searchParams = await props.searchParams;
  const clinicId = session.activeClinic?.id;
  const isUnit = session.activeClinic?.type === "franchise_unit";

  // A Consultor Comercial (franchisor context) sees only their own scheduled
  // clients across the units they cover.
  const isConsultant = Object.values(session.rolesByClinic).some((r) =>
    r.includes("commercial_consultant")
  );
  const consultantView = !isUnit && isConsultant;

  if (!consultantView && (!clinicId || !isUnit)) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Atendimento</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Selecione uma unidade</CardTitle>
            <CardDescription>
              O painel de atendimento (sala de espera) é por unidade. Use o
              seletor no menu lateral para entrar em uma unidade.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const period: Period =
    searchParams.periodo === "semana" || searchParams.periodo === "mes"
      ? searchParams.periodo
      : "dia";
  const providerFilter =
    typeof searchParams.profissional === "string"
      ? searchParams.profissional
      : "";
  const unitFilter =
    typeof searchParams.unidade === "string" ? searchParams.unidade : "";
  const { start, end, label: periodLabel } = periodRange(period);

  const SELECT =
    "id, type, status, starts_at, attendance, checked_in_at, called_at, done_at, checked_in_by, called_by, done_by, provider_user_id, clinic_id, is_online, provider:profiles!appointments_provider_user_id_fkey ( full_name ), clinics ( name ), room:clinic_rooms ( name ), clients ( id, full_name, journey_phase )";

  const supabase = await createClient();

  // H3.4: dispara os alertas de espera longa / pendências de dias anteriores
  // (idempotente — dedupe no banco) e resolve o limite de espera da unidade.
  let waitingAlertMinutes = 20;
  let staleCount = 0;
  if (!consultantView && clinicId) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [{ data: settingRows }, { count: stale }] = await Promise.all([
      supabase
        .from("clinic_agenda_settings")
        .select(
          "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end, waiting_alert_minutes"
        )
        .returns<AgendaSettingRow[]>(),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .in("attendance", ["waiting", "in_service"])
        .lt("starts_at", todayStart.toISOString()),
      supabase.rpc("notify_attendance_alerts", { p_clinic_id: clinicId }),
    ]);
    waitingAlertMinutes = resolveAgendaSettings(
      settingRows ?? [],
      clinicId
    ).waitingAlertMinutes;
    staleCount = stale ?? 0;
  }

  let query = supabase
    .from("appointments")
    .select(SELECT)
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString())
    .order("starts_at");
  if (consultantView) {
    query = query.eq("provider_user_id", session.userId);
  } else {
    query = query.eq("clinic_id", clinicId!);
  }
  const { data } = await query.returns<Row[]>();
  const rows = data ?? [];

  // Resolve the names of everyone who moved a client (and the providers, for
  // the professional filter) in a single query.
  const userIds = [
    ...new Set(
      rows.flatMap((r) =>
        [r.checked_in_by, r.called_by, r.done_by, r.provider_user_id].filter(
          (x): x is string => Boolean(x)
        )
      )
    ),
  ];
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const p of people ?? []) nameById.set(p.id, p.full_name);
  }
  const nameOf = (id: string | null, fallback?: string | null) =>
    (id ? nameById.get(id) : null) ?? fallback ?? null;

  // Professional filter options (unit view): distinct providers in the period.
  const providerOptions = consultantView
    ? []
    : [
        ...new Map(
          rows
            .filter((r) => r.provider_user_id)
            .map((r) => [
              r.provider_user_id as string,
              nameOf(r.provider_user_id, r.provider?.full_name) ?? "—",
            ])
        ).entries(),
      ]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

  // Unit options for the Consultor view (their clients spread across units).
  const consultantUnits = consultantView
    ? [
        ...new Map(
          rows
            .filter((r) => r.clinic_id)
            .map((r) => [r.clinic_id, r.clinics?.name ?? "—"])
        ).entries(),
      ]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  let shown = rows;
  if (consultantView) {
    if (unitFilter) shown = rows.filter((r) => r.clinic_id === unitFilter);
  } else if (providerFilter) {
    shown = rows.filter((r) => r.provider_user_id === providerFilter);
  }

  const appointments: PanelAppointment[] = shown.map((a) => ({
    id: a.id,
    type: a.type,
    status: a.status,
    starts_at: a.starts_at,
    attendance: a.attendance,
    clientId: a.clients?.id ?? null,
    clientName: a.clients?.full_name ?? "—",
    providerName: nameOf(a.provider_user_id, a.provider?.full_name),
    providerUserId: a.provider_user_id,
    calledBy: a.called_by,
    clinicName: consultantView ? (a.clinics?.name ?? null) : null,
    roomName: a.is_online ? "ONLINE" : (a.room?.name ?? null),
    checkedInAt: a.checked_in_at,
    calledAt: a.called_at,
    doneAt: a.done_at,
    checkedInByName: nameOf(a.checked_in_by),
    calledByName: nameOf(a.called_by),
    doneByName: nameOf(a.done_by),
  }));

  // Reception registers arrival; in the Consultor view the Consultor handles
  // all steps of their own presentations (arrival, call, conclude).
  const canCheckIn =
    consultantView || hasRoleInClinic(session, clinicId, ["receptionist", "sdr"]);
  const canCall =
    consultantView ||
    hasRoleInClinic(session, clinicId, [
      "clinical_coordinator",
      "dentist",
      "commercial_consultant",
    ]);

  // H3.6: Recepção ou Gerente troca o profissional de última hora. Carrega a
  // equipe da unidade para o seletor do novo profissional.
  const canSwapProvider =
    !consultantView &&
    Boolean(clinicId) &&
    hasRoleInClinic(session, clinicId, ["receptionist", "unit_manager"]);
  let swapStaff: SwapStaff[] = [];
  if (canSwapProvider && clinicId) {
    const [{ data: roleRows }, { data: consultants }] = await Promise.all([
      supabase
        .from("user_clinic_roles")
        .select("user_id, role, profiles ( full_name )")
        .eq("clinic_id", clinicId)
        .returns<
          { user_id: string; role: string; profiles: { full_name: string } | null }[]
        >(),
      supabase.rpc("providers_with_access", {
        p_clinic_id: clinicId,
        p_role: "commercial_consultant",
      }),
    ]);
    const map = new Map<string, SwapStaff>();
    for (const r of roleRows ?? []) {
      const e = map.get(r.user_id) ?? {
        userId: r.user_id,
        name: r.profiles?.full_name ?? "—",
        roles: [],
      };
      e.roles.push(r.role);
      map.set(r.user_id, e);
    }
    for (const c of (consultants ?? []) as {
      user_id: string;
      full_name: string;
    }[]) {
      const e = map.get(c.user_id) ?? {
        userId: c.user_id,
        name: c.full_name ?? "—",
        roles: [],
      };
      if (!e.roles.includes("commercial_consultant")) {
        e.roles.push("commercial_consultant");
      }
      map.set(c.user_id, e);
    }
    swapStaff = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Atendimento</h1>
          <p className="text-sm text-muted-foreground">
            {consultantView
              ? `Seus atendimentos — ${periodLabel}.`
              : `Sala de espera de ${session.activeClinic?.name} — ${periodLabel}.`}
          </p>
        </div>
        <FilterForm className="flex flex-wrap items-center gap-2">
          <select
            name="periodo"
            defaultValue={period}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
          {!consultantView && providerOptions.length > 0 && (
            <select
              name="profissional"
              defaultValue={providerFilter}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Todos os profissionais</option>
              {providerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {consultantView && consultantUnits.length > 0 && (
            <select
              name="unidade"
              defaultValue={unitFilter}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Todas as unidades</option>
              {consultantUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </FilterForm>
      </div>
      {staleCount > 0 && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          ⚠ {staleCount} atendimento{staleCount === 1 ? "" : "s"} de dias
          anteriores continua{staleCount === 1 ? "" : "m"} em aberto (em espera
          ou em atendimento). Use o filtro <strong>Semana</strong> ou{" "}
          <strong>Mês</strong> para localizá-los e conclua — ou registre falta/
          desistência.
        </p>
      )}
      <AttendancePanel
        appointments={appointments}
        canCheckIn={canCheckIn}
        canCall={canCall}
        currentUserId={session.userId}
        isAdmin={session.isAdminMaster}
        waitingAlertMinutes={waitingAlertMinutes}
        canSwapProvider={canSwapProvider}
        swapStaff={swapStaff}
      />
    </div>
  );
}
