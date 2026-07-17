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
import {
  AttendanceIndicators,
  type AttendanceMetrics,
  type MetricPerson,
} from "./attendance-indicators";

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
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
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
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // H3.4: dispara os alertas de espera longa / pendências de dias anteriores
  // (idempotente — dedupe no banco) e resolve o limite de espera da unidade.
  let waitingAlertMinutes = 20;
  if (!consultantView && clinicId) {
    const { data: settingRows } = await supabase
      .from("clinic_agenda_settings")
      .select(
        "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end, waiting_alert_minutes"
      )
      .returns<AgendaSettingRow[]>();
    await supabase.rpc("notify_attendance_alerts", { p_clinic_id: clinicId });
    waitingAlertMinutes = resolveAgendaSettings(
      settingRows ?? [],
      clinicId
    ).waitingAlertMinutes;
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
  let rows = data ?? [];

  // H3.4b: pendências de dias anteriores (a chegar / em espera / em atendimento)
  // são CARREGADAS para o painel de hoje até serem resolvidas — sem precisar
  // caçar em que dia ficaram. (Só na visão da unidade.)
  let carriedCount = 0;
  if (!consultantView && clinicId) {
    // Pendências de dias anteriores: as que continuam EM ABERTO
    // (scheduled/confirmed) + as CONCLUÍDAS HOJE (done_at de hoje) — estas para
    // o card não "sumir" da coluna Concluídos logo após concluir/resolver.
    const { data: carried } = await supabase
      .from("appointments")
      .select(SELECT)
      .eq("clinic_id", clinicId)
      .lt("starts_at", todayStart.toISOString())
      .or(
        `status.in.(scheduled,confirmed),done_at.gte.${todayStart.toISOString()}`
      )
      .order("starts_at")
      .returns<Row[]>();
    const seen = new Set(rows.map((r) => r.id));
    const extra = (carried ?? []).filter((r) => !seen.has(r.id));
    // O aviso conta só as que ainda estão EM ABERTO (não as já resolvidas hoje).
    carriedCount = extra.filter(
      (r) => r.status === "scheduled" || r.status === "confirmed"
    ).length;
    rows = [...extra, ...rows];
  }

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

  const todayIsoDate = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, "0")}-${String(todayStart.getDate()).padStart(2, "0")}`;
  const localDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // H4.6 A1: sessões de tratamento ainda em aberto ligadas a cada atendimento
  // mostrado — usadas na confirmação "O que foi feito hoje?" (baixa parcial).
  const sessionsByAppt = new Map<
    string,
    { id: string; label: string; plannedMinutes: number | null }[]
  >();
  const shownIds = shown.map((a) => a.id);
  if (shownIds.length > 0) {
    const { data: sessRows } = await supabase
      .from("treatment_sessions")
      .select("id, appointment_id, procedure_name, name, planned_minutes, plan_order, session_index")
      .in("appointment_id", shownIds)
      .neq("status", "done")
      .order("plan_order", { nullsFirst: false })
      .order("session_index")
      .returns<
        {
          id: string;
          appointment_id: string;
          procedure_name: string;
          name: string | null;
          planned_minutes: number | null;
          plan_order: number | null;
          session_index: number;
        }[]
      >();
    for (const s of sessRows ?? []) {
      const list = sessionsByAppt.get(s.appointment_id) ?? [];
      list.push({
        id: s.id,
        label: s.name ? `${s.procedure_name} — ${s.name}` : s.procedure_name,
        plannedMinutes: s.planned_minutes,
      });
      sessionsByAppt.set(s.appointment_id, list);
    }
  }

  const appointments: PanelAppointment[] = shown.map((a) => {
    const apptDate = localDate(a.starts_at);
    return {
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
      // H3.4b: carregado de um dia anterior ainda sem resolução.
      pendingSinceIso: apptDate < todayIsoDate ? apptDate : null,
      checkedInAt: a.checked_in_at,
      calledAt: a.called_at,
      doneAt: a.done_at,
      checkedInByName: nameOf(a.checked_in_by),
      calledByName: nameOf(a.called_by),
      doneByName: nameOf(a.done_by),
      sessions: sessionsByAppt.get(a.id) ?? [],
    };
  });

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
  // H4.6 A1: só o Dentista (ou Admin) confirma a baixa das sessões.
  const isDentist =
    !consultantView && hasRoleInClinic(session, clinicId, ["dentist"]);

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

  // -- H4.15: indicadores do Atendimento (popup). Dentista vê só os seus; a
  // Recepção/Coordenador/Gerente (e Admin) veem todos. Sempre no PERÍODO acima.
  const canSeeAllMetrics =
    !consultantView &&
    (session.isAdminMaster ||
      hasRoleInClinic(session, clinicId, [
        "receptionist",
        "clinical_coordinator",
        "unit_manager",
      ]));
  const canViewMetrics = canSeeAllMetrics || isDentist;
  let metrics: AttendanceMetrics | null = null;
  if (canViewMetrics && clinicId) {
    const periodRows = (data ?? []).filter((r) =>
      canSeeAllMetrics ? true : r.provider_user_id === session.userId
    );
    const person = (r: Row): MetricPerson => ({
      id: r.clients?.id ?? null,
      name: r.clients?.full_name ?? "—",
      detail: new Date(r.starts_at).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
    const completed = periodRows.filter((r) => r.attendance === "done");
    const noShows = periodRows.filter((r) => r.status === "no_show");
    const cancellations = periodRows.filter(
      (r) => r.status === "cancelled" && r.attendance !== "gave_up"
    );
    const giveUps = periodRows.filter((r) => r.attendance === "gave_up");
    const waits = periodRows
      .filter((r) => r.checked_in_at && r.called_at)
      .map(
        (r) =>
          (new Date(r.called_at as string).getTime() -
            new Date(r.checked_in_at as string).getTime()) /
          60000
      )
      .filter((m) => m >= 0);
    const avgWaitMin =
      waits.length > 0
        ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
        : null;

    // Produtividade: sessões finalizadas no período (dentista = só as dele).
    let productivityQ = supabase
      .from("treatment_sessions")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "done")
      .gte("done_at", start.toISOString())
      .lt("done_at", end.toISOString());
    if (!canSeeAllMetrics)
      productivityQ = productivityQ.eq("executed_by", session.userId);
    const { count: productivity } = await productivityQ;

    // Trocas de profissional no período (de → para).
    let swapsQ = supabase
      .from("appointment_provider_swaps")
      .select("id, appointment_id, from_provider, to_provider, created_at")
      .eq("clinic_id", clinicId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false });
    if (!canSeeAllMetrics)
      swapsQ = swapsQ.or(
        `from_provider.eq.${session.userId},to_provider.eq.${session.userId}`
      );
    const { data: swapRows } = await swapsQ.returns<
      {
        id: string;
        appointment_id: string;
        from_provider: string | null;
        to_provider: string;
      }[]
    >();
    const swapList = swapRows ?? [];
    const swapApptIds = [...new Set(swapList.map((s) => s.appointment_id))];
    const clientByAppt = new Map<string, { id: string; name: string }>();
    if (swapApptIds.length > 0) {
      const { data: apps } = await supabase
        .from("appointments")
        .select("id, clients ( id, full_name )")
        .in("id", swapApptIds)
        .returns<
          { id: string; clients: { id: string; full_name: string } | null }[]
        >();
      for (const a of apps ?? []) {
        if (a.clients)
          clientByAppt.set(a.id, { id: a.clients.id, name: a.clients.full_name });
      }
    }
    const swapProvIds = [
      ...new Set(
        swapList
          .flatMap((s) => [s.from_provider, s.to_provider])
          .filter((x): x is string => Boolean(x))
      ),
    ];
    const provName = new Map<string, string>();
    for (const id of swapProvIds) {
      const n = nameById.get(id);
      if (n) provName.set(id, n);
    }
    const missingProv = swapProvIds.filter((id) => !provName.has(id));
    if (missingProv.length > 0) {
      const { data: people } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", missingProv);
      for (const p of people ?? []) provName.set(p.id, p.full_name);
    }
    const swaps: MetricPerson[] = swapList.map((s) => {
      const c = clientByAppt.get(s.appointment_id);
      const from = s.from_provider ? (provName.get(s.from_provider) ?? "—") : "—";
      const to = provName.get(s.to_provider) ?? "—";
      return {
        id: c?.id ?? null,
        name: c?.name ?? "Cliente",
        detail: `${from} → ${to}`,
      };
    });

    metrics = {
      scheduled: periodRows.length,
      completed: completed.length,
      attendanceRate:
        periodRows.length > 0
          ? Math.round((completed.length / periodRows.length) * 100)
          : null,
      productivity: productivity ?? 0,
      avgWaitMin,
      noShows: noShows.map(person),
      cancellations: cancellations.map(person),
      giveUps: giveUps.map(person),
      swaps,
    };
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Atendimento</h1>
          <p className="text-sm text-muted-foreground">
            {consultantView
              ? `Seus atendimentos — ${periodLabel}.`
              : `Sala de espera de ${session.activeClinic?.name} — ${periodLabel}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {metrics && (
            <AttendanceIndicators
              metrics={metrics}
              periodLabel={periodLabel}
              scopeNote={
                canSeeAllMetrics
                  ? undefined
                  : "Mostrando somente os seus atendimentos."
              }
            />
          )}
          <FilterForm className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
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
      </div>
      {carriedCount > 0 && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠ <strong>{carriedCount}</strong> pendência
          {carriedCount === 1 ? "" : "s"} de dias anteriores (marcada
          {carriedCount === 1 ? "" : "s"} <strong>“Pendente desde…”</strong>).
          Conclua ou registre falta/desistência para liberar a cadeira.
        </p>
      )}
      <AttendancePanel
        appointments={appointments}
        canCheckIn={canCheckIn}
        canCall={canCall}
        currentUserId={session.userId}
        isAdmin={session.isAdminMaster}
        isDentist={isDentist}
        waitingAlertMinutes={waitingAlertMinutes}
        canSwapProvider={canSwapProvider}
        swapStaff={swapStaff}
      />
    </div>
  );
}
