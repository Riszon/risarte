import type { Metadata } from "next";
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
  AttendanceStatus,
} from "@/lib/appointments";
import type { JourneyPhase } from "@/lib/journey";
import { AttendancePanel, type PanelAppointment } from "./attendance-panel";

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
  provider: { full_name: string } | null;
  clinics: { name: string } | null;
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
  const { start, end, label: periodLabel } = periodRange(period);

  const SELECT =
    "id, type, status, starts_at, attendance, checked_in_at, called_at, done_at, checked_in_by, called_by, done_by, provider_user_id, provider:profiles!appointments_provider_user_id_fkey ( full_name ), clinics ( name ), clients ( id, full_name, journey_phase )";

  const supabase = await createClient();
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

  const shown =
    providerFilter && !consultantView
      ? rows.filter((r) => r.provider_user_id === providerFilter)
      : rows;

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
    checkedInAt: a.checked_in_at,
    calledAt: a.called_at,
    doneAt: a.done_at,
    checkedInByName: nameOf(a.checked_in_by),
    calledByName: nameOf(a.called_by),
    doneByName: nameOf(a.done_by),
  }));

  // Reception only registers arrival; the professional calls and concludes.
  const canCheckIn =
    !consultantView &&
    hasRoleInClinic(session, clinicId, ["receptionist", "sdr"]);
  const canCall =
    consultantView ||
    hasRoleInClinic(session, clinicId, [
      "clinical_coordinator",
      "dentist",
      "commercial_consultant",
    ]);

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
        <form method="get" className="flex flex-wrap items-center gap-2">
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
          <Button type="submit" variant="outline" size="sm">
            Filtrar
          </Button>
        </form>
      </div>
      <AttendancePanel
        appointments={appointments}
        canCheckIn={canCheckIn}
        canCall={canCall}
        currentUserId={session.userId}
        isAdmin={session.isAdminMaster}
      />
    </div>
  );
}
