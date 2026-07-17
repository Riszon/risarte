import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FilterForm } from "@/components/filter-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  APPOINTMENT_TYPE_LABELS,
  type AppointmentType,
  type AttendanceStatus,
} from "@/lib/appointments";
import { WeeklyForecastNotifier } from "./weekly-forecast-notifier";

export const metadata: Metadata = { title: "Meu Dia" };

type ApptRow = {
  id: string;
  type: AppointmentType;
  status: string;
  starts_at: string;
  attendance: AttendanceStatus | null;
  clients: { id: string; full_name: string } | null;
};

type PendingRow = {
  id: string;
  procedure_name: string;
  name: string | null;
  client_id: string;
  clients: { full_name: string } | null;
};

type PeriodRow = {
  attendance: AttendanceStatus | null;
  status: string;
  checked_in_at: string | null;
  called_at: string | null;
};

const ATTENDANCE_BADGE: Record<
  AttendanceStatus,
  { label: string; className: string }
> = {
  waiting: { label: "Em espera", className: "bg-amber-100 text-amber-800" },
  in_service: { label: "Em atendimento", className: "bg-violet-100 text-violet-800" },
  done: { label: "Concluído", className: "bg-emerald-100 text-emerald-800" },
  gave_up: { label: "Desistiu", className: "bg-red-100 text-red-800" },
};

type Period = "dia" | "semana" | "mes" | "periodo";
const PERIOD_LABELS: Record<Period, string> = {
  dia: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
  periodo: "Período específico",
};

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}
function fmtMin(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h}h ${r}min` : `${h}h`;
}
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}
function parseYmd(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function periodRange(
  period: Period,
  de?: string,
  ate?: string
): { start: Date; end: Date; label: string } {
  const base = new Date();
  if (period === "semana") {
    const start = startOfWeek(base);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end, label: PERIOD_LABELS.semana };
  }
  if (period === "mes") {
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    return { start, end, label: PERIOD_LABELS.mes };
  }
  if (period === "periodo") {
    const s = parseYmd(de) ?? new Date(base.getFullYear(), base.getMonth(), 1);
    const eRaw = parseYmd(ate) ?? new Date();
    const end = new Date(eRaw);
    end.setDate(end.getDate() + 1);
    end.setHours(0, 0, 0, 0);
    s.setHours(0, 0, 0, 0);
    return {
      start: s,
      end,
      label: `${s.toLocaleDateString("pt-BR")} a ${eRaw.toLocaleDateString("pt-BR")}`,
    };
  }
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end, label: PERIOD_LABELS.dia };
}

function StatTile({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`text-xl font-semibold tabular-nums ${muted ? "text-muted-foreground" : ""}`}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function MeuDiaPage(props: PageProps<"/meu-dia">) {
  const session = await getSessionContext();
  const searchParams = await props.searchParams;
  const clinicId = session.activeClinic?.id ?? null;
  const isDentistHere =
    session.isAdminMaster || hasRoleInClinic(session, clinicId, ["dentist"]);

  if (!clinicId || !isDentistHere) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Meu Dia</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Somente para o dentista</CardTitle>
            <CardDescription>
              Esta tela mostra os atendimentos, a produção e as pendências do
              dentista na unidade ativa. Selecione uma unidade em que você atende
              como dentista no menu lateral.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const period: Period =
    searchParams.periodo === "semana" ||
    searchParams.periodo === "mes" ||
    searchParams.periodo === "periodo"
      ? searchParams.periodo
      : "mes";
  const de = typeof searchParams.de === "string" ? searchParams.de : undefined;
  const ate = typeof searchParams.ate === "string" ? searchParams.ate : undefined;
  const { start, end, label: periodLabel } = periodRange(period, de, ate);

  const supabase = await createClient();
  const now = new Date();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const horizon = new Date(todayStart);
  horizon.setDate(horizon.getDate() + 14);

  const SELECT =
    "id, type, status, starts_at, attendance, clients ( id, full_name )";

  const [
    { data: todayRows },
    { data: upcomingRows },
    { data: pendingRows },
    { data: periodApptRows },
    { data: doneSessionRows },
    { count: futureCount },
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select(SELECT)
      .eq("clinic_id", clinicId)
      .eq("provider_user_id", session.userId)
      .gte("starts_at", todayStart.toISOString())
      .lt("starts_at", tomorrowStart.toISOString())
      .not("status", "in", "(cancelled,no_show)")
      .order("starts_at")
      .returns<ApptRow[]>(),
    supabase
      .from("appointments")
      .select(SELECT)
      .eq("clinic_id", clinicId)
      .eq("provider_user_id", session.userId)
      .gte("starts_at", tomorrowStart.toISOString())
      .lt("starts_at", horizon.toISOString())
      .in("status", ["scheduled", "confirmed"])
      .order("starts_at")
      .limit(20)
      .returns<ApptRow[]>(),
    supabase
      .from("treatment_sessions")
      .select("id, procedure_name, name, client_id, clients ( full_name )")
      .eq("clinic_id", clinicId)
      .eq("planner_provider_id", session.userId)
      .eq("status", "pending")
      .is("appointment_id", null)
      .order("created_at")
      .returns<PendingRow[]>(),
    // Produção: atendimentos do dentista no período (para concluídos + espera).
    supabase
      .from("appointments")
      .select("attendance, status, checked_in_at, called_at")
      .eq("clinic_id", clinicId)
      .eq("provider_user_id", session.userId)
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .returns<PeriodRow[]>(),
    // Sessões finalizadas por ele no período (tempo realizado × previsto).
    supabase
      .from("treatment_sessions")
      .select("actual_minutes, planned_minutes")
      .eq("clinic_id", clinicId)
      .eq("executed_by", session.userId)
      .eq("status", "done")
      .gte("done_at", start.toISOString())
      .lt("done_at", end.toISOString())
      .returns<{ actual_minutes: number | null; planned_minutes: number | null }[]>(),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("provider_user_id", session.userId)
      .gte("starts_at", now.toISOString())
      .in("status", ["scheduled", "confirmed"]),
  ]);

  const today = todayRows ?? [];
  const upcoming = upcomingRows ?? [];
  const pending = pendingRows ?? [];
  const periodAppts = periodApptRows ?? [];
  const doneSessions = doneSessionRows ?? [];

  // -- Indicadores da produção --
  const concluidos = periodAppts.filter(
    (a) => a.attendance === "done" || a.status === "completed"
  ).length;
  const sessoesFinalizadas = doneSessions.length;
  const tempoRealizado = doneSessions.reduce(
    (s, r) => s + (r.actual_minutes ?? 0),
    0
  );
  const tempoPrevisto = doneSessions.reduce(
    (s, r) => s + (r.planned_minutes ?? 0),
    0
  );
  const waits = periodAppts
    .filter((a) => a.checked_in_at && a.called_at)
    .map(
      (a) =>
        (new Date(a.called_at as string).getTime() -
          new Date(a.checked_in_at as string).getTime()) /
        60000
    )
    .filter((m) => m >= 0);
  const esperaMedia =
    waits.length > 0 ? waits.reduce((s, m) => s + m, 0) / waits.length : null;

  const pendingByClient = new Map<string, { name: string; items: string[] }>();
  for (const p of pending) {
    const entry = pendingByClient.get(p.client_id) ?? {
      name: p.clients?.full_name ?? "—",
      items: [],
    };
    entry.items.push(
      p.name ? `${p.procedure_name} — ${p.name}` : p.procedure_name
    );
    pendingByClient.set(p.client_id, entry);
  }

  const remainingToday = today.filter(
    (a) => a.attendance !== "done" && a.attendance !== "gave_up"
  ).length;

  function ApptRowView({ a, showDay }: { a: ApptRow; showDay?: boolean }) {
    const att = a.attendance ? ATTENDANCE_BADGE[a.attendance] : null;
    const late =
      !a.attendance &&
      new Date(a.starts_at).getTime() < now.getTime() &&
      showDay !== true;
    return (
      <li className="flex items-center justify-between gap-2 rounded-md border p-3">
        <div className="min-w-0">
          {a.clients ? (
            <Link
              href={`/prontuarios/${a.clients.id}`}
              className="text-sm font-medium hover:underline"
            >
              {a.clients.full_name}
            </Link>
          ) : (
            <span className="text-sm font-medium">—</span>
          )}
          <p className="text-xs text-muted-foreground">
            {showDay ? `${dayLabel(a.starts_at)} · ` : ""}
            {time(a.starts_at)} · {APPOINTMENT_TYPE_LABELS[a.type]}
          </p>
        </div>
        {att ? (
          <Badge className={att.className}>{att.label}</Badge>
        ) : late ? (
          <Badge variant="destructive">Atrasado</Badge>
        ) : (
          <Badge variant="secondary">A chegar</Badge>
        )}
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <WeeklyForecastNotifier />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Meu Dia — {session.fullName.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {session.activeClinic?.name} ·{" "}
          {today.length === 0
            ? "sem atendimentos hoje"
            : `${today.length} atendimento(s) hoje, ${remainingToday} pendente(s)`}
        </p>
      </div>

      {/* B3: Dashboard de produção (por período) */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Minha produção</CardTitle>
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
              {period === "periodo" && (
                <>
                  <input
                    type="date"
                    name="de"
                    defaultValue={de}
                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                  />
                  <input
                    type="date"
                    name="ate"
                    defaultValue={ate}
                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                  />
                </>
              )}
            </FilterForm>
          </div>
          <CardDescription>{periodLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile
              label="Atendimentos concluídos"
              value={String(concluidos)}
            />
            <StatTile
              label="Sessões finalizadas"
              value={String(sessoesFinalizadas)}
            />
            <StatTile
              label="Tempo em cadeira"
              value={fmtMin(tempoRealizado)}
              hint={
                tempoPrevisto > 0
                  ? `previsto pela rede: ${fmtMin(tempoPrevisto)}`
                  : undefined
              }
            />
            <StatTile
              label="Espera média do cliente"
              value={esperaMedia != null ? fmtMin(esperaMedia) : "—"}
              hint={esperaMedia == null ? "sem dados no período" : undefined}
            />
            <StatTile
              label="Em aberto p/ você"
              value={String(pending.length)}
              hint="sem agendamento"
            />
            <StatTile
              label="Atendimentos futuros"
              value={String(futureCount ?? 0)}
            />
            <StatTile
              label="NPS do seu atendimento"
              value="—"
              hint="ainda não disponível"
              muted
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Hoje <Badge variant="secondary">{today.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {today.length > 0 ? (
            <ul className="space-y-2">
              {today.map((a) => (
                <ApptRowView key={a.id} a={a} />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Você não tem atendimentos hoje.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Próximos (14 dias){" "}
            <Badge variant="secondary">{upcoming.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length > 0 ? (
            <ul className="space-y-2">
              {upcoming.map((a) => (
                <ApptRowView key={a.id} a={a} showDay />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Nenhum atendimento agendado nos próximos 14 dias.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Procedimentos em aberto destinados a você{" "}
            <Badge variant="secondary">{pending.length}</Badge>
          </CardTitle>
          <CardDescription>
            Sessões indicadas para você que ainda não têm agendamento — peça à
            Recepção para agendar (na ficha do cliente).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingByClient.size > 0 ? (
            <ul className="space-y-2">
              {[...pendingByClient.entries()].map(([cid, entry]) => (
                <li key={cid} className="rounded-md border p-3">
                  <Link
                    href={`/prontuarios/${cid}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {entry.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {entry.items.join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Nenhum procedimento em aberto destinado a você.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
